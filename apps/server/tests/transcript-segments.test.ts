/**
 * 分句与时间轴对齐接口集成测试。
 *
 * 覆盖：
 *   上传音频 -> 人工录入转写 -> 一键自动分句对齐（不落库）
 *   -> 保存分句时间轴 -> 详情与分句列表一致
 *   -> 非法时间轴被拒（重叠 / 空句 / 超长）
 *   -> 乐观锁 409
 *   -> 从某一句一键生成原声片段
 *   -> 旁观者只读、跨空间用户被拒
 *   -> ASR 风格带时间戳分句经 transcribe 落库（用 monkeypatch 不可行，改为直接验证持久化接口语义）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db/client';

const app = createApp();

interface Session {
  token: string;
  userId: string;
}

async function register(email: string, displayName: string): Promise<Session> {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'froa12345', displayName })
    .expect(201);
  return {
    token: response.body.data.tokens.accessToken as string,
    userId: response.body.data.user.id as string,
  };
}

const auth = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

/** 最小可用 WAV（静音），服务端只校验类型与大小 */
function fakeWav(seconds = 12): Buffer {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function uploadAudio(
  session: Session,
  recipeId: string,
  durationMs: number,
  peaks?: number[],
): Promise<string> {
  const response = await request(app)
    .post('/api/audio')
    .set(auth(session))
    .field('recipeId', recipeId)
    .field('kind', 'recipe_voice')
    .field('durationMs', String(durationMs))
    .field('peaks', JSON.stringify(peaks ?? [0.1, 0.5, 0.9, 0.4, 0.2, 0.6, 0.8, 0.3]))
    .attach('file', fakeWav(Math.max(1, Math.round(durationMs / 1000))), {
      filename: 'voice.wav',
      contentType: 'audio/wav',
    })
    .expect(201);
  return response.body.data.id as string;
}

describe('转写分句与时间轴对齐', () => {
  let organizer: Session;
  let viewer: Session;
  let outsider: Session;
  let workspaceId = '';
  let recipeId = '';
  let audioId = '';

  beforeAll(async () => {
    organizer = await register('align-owner@seg.test', '整理者');
    viewer = await register('align-viewer@seg.test', '外婆');
    outsider = await register('align-outsider@seg.test', '外人');

    const ws = await request(app)
      .post('/api/workspaces')
      .set(auth(organizer))
      .send({ name: '分句测试厨房' })
      .expect(201);
    workspaceId = ws.body.data.id;

    await request(app)
      .post('/api/workspaces/join')
      .set(auth(viewer))
      .send({ inviteCode: ws.body.data.inviteCode })
      .expect(201);

    // 加入默认是 contributor（可以录音），这里降为旁观者，专门验证只读边界
    await request(app)
      .patch(`/api/workspaces/${workspaceId}/members/${viewer.userId}`)
      .set(auth(organizer))
      .send({ role: 'viewer' })
      .expect(200);

    const recipe = await request(app)
      .post('/api/recipes')
      .set(auth(organizer))
      .send({ workspaceId, title: '分句测试菜' })
      .expect(201);
    recipeId = recipe.body.data.id;

    audioId = await uploadAudio(organizer, recipeId, 12000);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. 人工录入转写原文', async () => {
    await request(app)
      .patch(`/api/audio/${audioId}/transcript`)
      .set(auth(organizer))
      .send({ transcript: '先炒糖色，放一点点糖就行。中火炒到收汁，肉炖到用筷子能戳透。' })
      .expect(200);
  });

  it('2. 一键自动分句对齐：句子数、全覆盖、文字与原文一致', async () => {
    const response = await request(app)
      .post(`/api/audio/${audioId}/transcript/align`)
      .set(auth(organizer))
      .send({})
      .expect(200);

    const { segments, sentenceCount, snapped } = response.body.data as {
      segments: { startMs: number; endMs: number; text: string }[];
      sentenceCount: number;
      snapped: boolean;
    };

    expect(sentenceCount).toBe(segments.length);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0]!.startMs).toBe(0);
    expect(segments[segments.length - 1]!.endMs).toBe(12000);
    for (let i = 0; i < segments.length - 1; i += 1) {
      expect(segments[i + 1]!.startMs).toBe(segments[i]!.endMs);
      expect(segments[i]!.endMs).toBeGreaterThan(segments[i]!.startMs);
    }
    expect(snapped).toBe(true);
    // 拼回来仍是原文（分句不丢字）
    expect(segments.map((s) => s.text).join('')).toBe(
      '先炒糖色，放一点点糖就行。中火炒到收汁，肉炖到用筷子能戳透。',
    );

    // 自动对齐只是"算"，不能落库：此时分句列表仍为空
    const stored = await request(app)
      .get(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .expect(200);
    expect(stored.body.data).toEqual([]);
  });

  it('3. 保存整理者"拖过边界"的分句表：成功落库并同步 transcript', async () => {
    const response = await request(app)
      .put(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .send({
        segments: [
          { startMs: 0, endMs: 4200, text: '先炒糖色，放一点点糖就行。', edited: true },
          { startMs: 4300, endMs: 12000, text: '中火炒到收汁，肉炖到用筷子能戳透。', edited: true },
        ],
      })
      .expect(200);

    const updated = response.body.data.audio;
    expect(updated.segments).toHaveLength(2);
    expect(updated.segments[0].startMs).toBe(0);
    expect(updated.segments[0].endMs).toBe(4200);
    expect(updated.segments[0].edited).toBe(true);
    expect(updated.transcriptUpdatedAt).toBeTruthy();

    const list = await request(app)
      .get(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].orderIndex).toBe(0);

    // 分句文字拼回 transcript
    const detail = await request(app).get(`/api/audio/${audioId}`).set(auth(organizer)).expect(200);
    expect(detail.body.data.transcript).toContain('先炒糖色');
    expect(detail.body.data.segments).toHaveLength(2);
  });

  it('4. 非法时间轴被拒：重叠 / 空句 / 超出音频长度', async () => {
    const overlap = await request(app)
      .put(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .send({
        segments: [
          { startMs: 0, endMs: 5000, text: '前一句很长很长' },
          { startMs: 4000, endMs: 12000, text: '后一句压上来了' },
        ],
      })
      .expect(400);
    expect(overlap.body.error.code).toBe('VALIDATION_FAILED');

    const emptyText = await request(app)
      .put(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .send({ segments: [{ startMs: 0, endMs: 12000, text: '   ' }] })
      .expect(400);
    expect(emptyText.body.error.code).toBe('VALIDATION_FAILED');

    const overflow = await request(app)
      .put(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .send({ segments: [{ startMs: 0, endMs: 999999, text: '超出音频长度' }] })
      .expect(400);
    expect(overflow.body.error.code).toBe('VALIDATION_FAILED');

    // 被拒后旧分句完好无损
    const stored = await request(app)
      .get(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .expect(200);
    expect(stored.body.data).toHaveLength(2);
  });

  it('5. 乐观锁：带旧时间戳保存返回 409，且不覆盖现有内容', async () => {
    const response = await request(app)
      .put(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .send({
        expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
        segments: [{ startMs: 0, endMs: 12000, text: '想偷偷覆盖的整段' }],
      })
      .expect(409);
    expect(response.body.error.code).toBe('EDIT_CONFLICT');

    const stored = await request(app)
      .get(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(organizer))
      .expect(200);
    expect(stored.body.data).toHaveLength(2);
  });

  it('6. 空转写 / 缺时长的音频不允许对齐', async () => {
    const noDuration = await uploadAudio(organizer, recipeId, 0);

    const failed = await request(app)
      .post(`/api/audio/${noDuration}/transcript/align`)
      .set(auth(organizer))
      .send({ transcript: '随便说两句。' })
      .expect(400);
    expect(failed.body.error.code).toBe('VALIDATION_FAILED');

    const noText = await request(app)
      .post(`/api/audio/${audioId}/transcript/align`)
      .set(auth(organizer))
      .send({ transcript: '   ' })
      .expect(400);
    expect(noText.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('7. 从某一句区间创建原声片段（"这句说不清"的证据锚点）', async () => {
    const response = await request(app)
      .post(`/api/audio/${audioId}/clips`)
      .set(auth(organizer))
      .send({ startMs: 1200, endMs: 3000, label: '放一点点糖' })
      .expect(201);
    expect(response.body.data.startMs).toBe(1200);
    expect(response.body.data.endMs).toBe(3000);
  });

  it('8. 权限：旁观者可以看但不能改；空间外用户全部拒绝', async () => {
    await request(app)
      .get(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(viewer))
      .expect(200);

    await request(app)
      .put(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(viewer))
      .send({ segments: [{ startMs: 0, endMs: 12000, text: '旁观者想改' }] })
      .expect(403);

    await request(app)
      .post(`/api/audio/${audioId}/transcript/align`)
      .set(auth(viewer))
      .send({})
      .expect(403);

    await request(app)
      .get(`/api/audio/${audioId}/transcript/segments`)
      .set(auth(outsider))
      .expect(403);
  });

  it('9. 不存在的音频返回 404 而不是 500', async () => {
    await request(app)
      .get('/api/audio/audio-does-not-exist/transcript/segments')
      .set(auth(organizer))
      .expect(404);
  });
});
