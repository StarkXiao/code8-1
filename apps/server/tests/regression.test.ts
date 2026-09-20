// 回归测试 —— 每个用例对应一个真实修过的缺陷。
// 目的是：同样的坑不能再踩第二次。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db/client';

const app = createApp();

interface Session {
  token: string;
  userId: string;
}

async function register(tag: string): Promise<Session> {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@reg.test`;
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'froa12345', displayName: tag })
    .expect(201);
  return {
    token: response.body.data.tokens.accessToken as string,
    userId: response.body.data.user.id as string,
  };
}

const auth = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

function fakeWav(): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * 2;
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

async function makeRecipeWithAudio(session: Session) {
  const ws = await request(app)
    .post('/api/workspaces')
    .set(auth(session))
    .send({ name: `空间-${Math.random().toString(36).slice(2, 8)}` })
    .expect(201);

  const recipe = await request(app)
    .post('/api/recipes')
    .set(auth(session))
    .send({ workspaceId: ws.body.data.id, title: '回归用食谱' })
    .expect(201);

  const audio = await request(app)
    .post('/api/audio')
    .set(auth(session))
    .field('recipeId', recipe.body.data.id)
    .field('kind', 'recipe_voice')
    .field('durationMs', '1000')
    .field('peaks', JSON.stringify([0.3, 0.8]))
    .attach('file', fakeWav(), { filename: 'v.wav', contentType: 'audio/wav' })
    .expect(201);

  return {
    workspaceId: ws.body.data.id as string,
    recipeId: recipe.body.data.id as string,
    audioId: audio.body.data.id as string,
  };
}

describe('回归：跨家庭数据隔离', () => {
  let alice: Session;
  let bob: Session;
  let aliceData: Awaited<ReturnType<typeof makeRecipeWithAudio>>;

  beforeAll(async () => {
    alice = await register('alice');
    bob = await register('bob');
    aliceData = await makeRecipeWithAudio(alice);
    // 让 bob 也成为"有自己空间的人"，否则他连试探的机会都没有
    await makeRecipeWithAudio(bob);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('不指定食谱时，音频列表不能返回别人空间的音频', async () => {
    const response = await request(app).get('/api/audio').set(auth(bob)).expect(200);
    const ids = (response.body.data as { id: string }[]).map((item) => item.id);

    expect(ids).not.toContain(aliceData.audioId);
    expect(
      (response.body.data as { recipeId: string }[]).every((item) => item.recipeId !== aliceData.recipeId),
    ).toBe(true);
  });

  it('按别人的 recipeId 拉音频仍然是 403', async () => {
    await request(app)
      .get('/api/audio')
      .query({ recipeId: aliceData.recipeId })
      .set(auth(bob))
      .expect(403);
  });
});

describe('回归：查询参数里的布尔值', () => {
  let user: Session;
  let data: Awaited<ReturnType<typeof makeRecipeWithAudio>>;

  beforeAll(async () => {
    user = await register('bool');
    data = await makeRecipeWithAudio(user);
  });

  it('includeDeleted=false 必须表示"不包含"（不能被当成 true）', async () => {
    await request(app).delete(`/api/audio/${data.audioId}`).set(auth(user)).expect(200);

    const withFalse = await request(app)
      .get('/api/audio')
      .query({ recipeId: data.recipeId, includeDeleted: 'false' })
      .set(auth(user))
      .expect(200);
    expect(withFalse.body.data.map((item: { id: string }) => item.id)).not.toContain(data.audioId);

    const withTrue = await request(app)
      .get('/api/audio')
      .query({ recipeId: data.recipeId, includeDeleted: 'true' })
      .set(auth(user))
      .expect(200);
    expect(withTrue.body.data.map((item: { id: string }) => item.id)).toContain(data.audioId);
  });
});

describe('回归：运维端点必须鉴权', () => {
  it('未登录不能触发完整性巡检', async () => {
    await request(app).post('/api/admin/integrity-scan').expect(401);
  });

  it('登录后可以触发', async () => {
    const user = await register('ops');
    await request(app).post('/api/admin/integrity-scan').set(auth(user)).expect(200);
  });
});

describe('回归：乐观锁', () => {
  let user: Session;
  let recipeId = '';
  let versionId = '';
  let stepId = '';
  let stepUpdatedAt = '';

  beforeAll(async () => {
    user = await register('lock');
    const ws = await request(app)
      .post('/api/workspaces')
      .set(auth(user))
      .send({ name: '并发测试厨房' })
      .expect(201);
    const recipe = await request(app)
      .post('/api/recipes')
      .set(auth(user))
      .send({ workspaceId: ws.body.data.id, title: '并发测试菜' })
      .expect(201);
    recipeId = recipe.body.data.id;

    const versions = await request(app)
      .get(`/api/recipes/${recipeId}/versions`)
      .set(auth(user))
      .expect(200);
    versionId = versions.body.data[0].id;

    const step = await request(app)
      .post(`/api/versions/${versionId}/steps`)
      .set(auth(user))
      .send({ title: '炒糖色', instruction: '中小火炒到枣红', sensoryCues: ['变枣红色'] })
      .expect(201);
    stepId = step.body.data.id;
    stepUpdatedAt = step.body.data.updatedAt;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('步骤 DTO 带着 updatedAt，前端才能回传', () => {
    expect(typeof stepUpdatedAt).toBe('string');
    expect(Number.isNaN(new Date(stepUpdatedAt).getTime())).toBe(false);
  });

  it('用最新的 updatedAt 提交可以成功，且 updatedAt 会变化', async () => {
    const updated = await request(app)
      .patch(`/api/steps/${stepId}`)
      .set(auth(user))
      .send({ tool: '厚底锅', expectedUpdatedAt: stepUpdatedAt })
      .expect(200);

    expect(updated.body.data.tool).toBe('厚底锅');
    expect(updated.body.data.updatedAt).not.toBe(stepUpdatedAt);
    stepUpdatedAt = updated.body.data.updatedAt;
  });

  it('用过期的 updatedAt 提交会得到 409，且不会覆盖别人的改动', async () => {
    await request(app)
      .patch(`/api/steps/${stepId}`)
      .set(auth(user))
      .send({ instruction: '别人改过的内容' })
      .expect(200);

    const conflict = await request(app)
      .patch(`/api/steps/${stepId}`)
      .set(auth(user))
      .send({ instruction: '我基于旧内容提交', expectedUpdatedAt: stepUpdatedAt })
      .expect(409);

    expect(conflict.body.error.code).toBe('EDIT_CONFLICT');
    expect(conflict.body.error.details.current.instruction).toBe('别人改过的内容');

    const after = await request(app)
      .get(`/api/versions/${versionId}/steps`)
      .set(auth(user))
      .expect(200);
    expect(after.body.data[0].instruction).toBe('别人改过的内容');
  });

  it('不传 expectedUpdatedAt 时退化为覆盖写入（兼容旧客户端）', async () => {
    await request(app)
      .patch(`/api/steps/${stepId}`)
      .set(auth(user))
      .send({ instruction: '直接覆盖' })
      .expect(200);
  });

  it('待澄清条目同样受乐观锁保护', async () => {
    const created = await request(app)
      .post(`/api/recipes/${recipeId}/vague-items`)
      .set(auth(user))
      .send({ category: 'amount', rawPhrase: '放一点糖' })
      .expect(201);

    const stale = created.body.data.updatedAt as string;

    await request(app)
      .patch(`/api/vague-items/${created.body.data.id}`)
      .set(auth(user))
      .send({ transcript: '第一版' })
      .expect(200);

    await request(app)
      .patch(`/api/vague-items/${created.body.data.id}`)
      .set(auth(user))
      .send({ transcript: '基于旧内容', expectedUpdatedAt: stale })
      .expect(409);
  });
});

describe('回归：食谱不能被搬到别的家庭空间', () => {
  it('PATCH 里的 workspaceId 会被忽略', async () => {
    const user = await register('move');
    const wsA = await request(app).post('/api/workspaces').set(auth(user)).send({ name: 'A 家' }).expect(201);
    const wsB = await request(app).post('/api/workspaces').set(auth(user)).send({ name: 'B 家' }).expect(201);

    const recipe = await request(app)
      .post('/api/recipes')
      .set(auth(user))
      .send({ workspaceId: wsA.body.data.id, title: 'A 家的菜' })
      .expect(201);

    const patched = await request(app)
      .patch(`/api/recipes/${recipe.body.data.id}`)
      .set(auth(user))
      .send({ title: '改个名', workspaceId: wsB.body.data.id })
      .expect(200);

    expect(patched.body.data.title).toBe('改个名');
    expect(patched.body.data.workspaceId).toBe(wsA.body.data.id);
  });
});

describe('回归：导出链接支持查询参数携带令牌', () => {
  it('带 access_token 的导出请求无需请求头也能成功', async () => {
    const user = await register('export');
    const data = await makeRecipeWithAudio(user);

    const versions = await request(app)
      .get(`/api/recipes/${data.recipeId}/versions`)
      .set(auth(user))
      .expect(200);

    const response = await request(app)
      .get(`/api/versions/${versions.body.data[0].id}/export`)
      .query({ format: 'md', access_token: user.token })
      .expect(200);

    expect(response.text).toContain('# 回归用食谱');
  });
});

describe('回归：跨空间写入必须全面被拒（按 id 逐个试探）', () => {
  let a: Session;
  let b: Session;
  let recipeA = '';
  let versionA = '';
  let workspaceA = '';
  let itemA = '';
  let ingredientB = '';
  let stepB = '';
  let itemB = '';
  let clipB = '';
  let audioB = '';
  let referenceB = '';
  let versionB = '';
  let workspaceB = '';

  beforeAll(async () => {
    a = await register('scan-a');
    b = await register('scan-b');

    workspaceA = (
      await request(app).post('/api/workspaces').set(auth(a)).send({ name: '扫描甲家' }).expect(201)
    ).body.data.id;
    workspaceB = (
      await request(app).post('/api/workspaces').set(auth(b)).send({ name: '扫描乙家' }).expect(201)
    ).body.data.id;

    const recipeA_ = (
      await request(app)
        .post('/api/recipes')
        .set(auth(a))
        .send({ workspaceId: workspaceA, title: '甲的菜' })
        .expect(201)
    ).body.data;
    recipeA = recipeA_.id;

    const recipeB = (
      await request(app)
        .post('/api/recipes')
        .set(auth(b))
        .send({ workspaceId: workspaceB, title: '乙的菜' })
        .expect(201)
    ).body.data;

    versionA = (
      await request(app).get(`/api/recipes/${recipeA}/versions`).set(auth(a)).expect(200)
    ).body.data[0].id;
    versionB = (
      await request(app).get(`/api/recipes/${recipeB.id}/versions`).set(auth(b)).expect(200)
    ).body.data[0].id;

    itemA = (
      await request(app)
        .post(`/api/recipes/${recipeA}/vague-items`)
        .set(auth(a))
        .send({ category: 'amount', rawPhrase: '甲的条目' })
        .expect(201)
    ).body.data.id;

    itemB = (
      await request(app)
        .post(`/api/recipes/${recipeB.id}/vague-items`)
        .set(auth(b))
        .send({ category: 'amount', rawPhrase: '乙的条目' })
        .expect(201)
    ).body.data.id;

    ingredientB = (
      await request(app)
        .post(`/api/versions/${versionB}/ingredients`)
        .set(auth(b))
        .send({ name: '乙冰糖', amountValue: 1, amountUnit: 'g' })
        .expect(201)
    ).body.data.id;

    stepB = (
      await request(app)
        .post(`/api/versions/${versionB}/steps`)
        .set(auth(b))
        .send({ title: '乙步骤', instruction: '乙说明' })
        .expect(201)
    ).body.data.id;

    referenceB = (
      await request(app)
        .post(`/api/workspaces/${workspaceB}/references`)
        .set(auth(b))
        .send({ label: '乙的勺子', amountValue: 5, amountUnit: 'g' })
        .expect(201)
    ).body.data.id;

    const audio = await request(app)
      .post('/api/audio')
      .set(auth(b))
      .field('recipeId', recipeB.id)
      .field('kind', 'recipe_voice')
      .field('durationMs', '1000')
      .attach('file', fakeWav(), { filename: 'b.wav', contentType: 'audio/wav' })
      .expect(201);

    audioB = audio.body.data.id as string;

    clipB = (
      await request(app)
        .post(`/api/audio/${audioB}/clips`)
        .set(auth(b))
        .send({ startMs: 0, endMs: 800 })
        .expect(201)
    ).body.data.id;
  });

  const rejected = async (label: string, run: () => Promise<{ status: number }>) => {
    const response = await run();
    expect(response.status, `${label} 竟然成功了（status=${response.status}）`).not.toBe(200);
    expect(response.status).not.toBe(201);
  };

  it('甲无法删除乙空间的参照物', async () => {
    await rejected('删乙的参照物', () =>
      request(app).delete(`/api/workspaces/${workspaceA}/references/${referenceB}`).set(auth(a)),
    );
    const list = await request(app).get(`/api/workspaces/${workspaceB}/references`).set(auth(b)).expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(referenceB);
  });

  it('甲无法改动乙的步骤与用量', async () => {
    await rejected('改乙的步骤', () =>
      request(app).patch(`/api/steps/${stepB}`).set(auth(a)).send({ instruction: '被篡改' }),
    );
    await rejected('删乙的步骤', () => request(app).delete(`/api/steps/${stepB}`).set(auth(a)));
    await rejected('改乙的用量', () =>
      request(app).patch(`/api/ingredients/${ingredientB}`).set(auth(a)).send({ amountValue: 999 }),
    );
    await rejected('删乙的用量', () =>
      request(app).delete(`/api/ingredients/${ingredientB}`).set(auth(a)),
    );
    await rejected('往乙的版本加步骤', () =>
      request(app)
        .post(`/api/versions/${versionB}/steps`)
        .set(auth(a))
        .send({ title: '闯入', instruction: '闯入' }),
    );
    await rejected('提交乙的版本', () => request(app).post(`/api/versions/${versionB}/submit`).set(auth(a)));
  });

  it('甲无法操作乙的待澄清条目', async () => {
    await rejected('改乙的条目', () =>
      request(app).patch(`/api/vague-items/${itemB}`).set(auth(a)).send({ rawPhrase: '改' }),
    );
    await rejected('追问乙的条目', () =>
      request(app).post(`/api/vague-items/${itemB}/ask`).set(auth(a)).send({ question: '套话' }),
    );
    await rejected('整理乙的条目', () =>
      request(app)
        .post(`/api/vague-items/${itemB}/resolve`)
        .set(auth(a))
        .send({
          resolvedSpec: {
            type: 'amount',
            value: 9,
            unit: 'g',
            confidence: 'confirmed',
            evidence: { answeredBy: a.userId },
          },
        }),
    );
    await rejected('伪造乙的答复', () =>
      request(app).post(`/api/vague-items/${itemB}/answer`).set(auth(a)).send({ answerText: '伪造' }),
    );
  });

  it('甲的条目不能引用乙空间的语音', async () => {
    await rejected('答复引用乙的片段', () =>
      request(app)
        .post(`/api/vague-items/${itemA}/answer`)
        .set(auth(a))
        .send({ answerText: 'x', answerClipId: clipB }),
    );
    await rejected('新建条目引用乙的片段', () =>
      request(app)
        .post(`/api/recipes/${recipeA}/vague-items`)
        .set(auth(a))
        .send({ category: 'amount', rawPhrase: 'x', clipId: clipB }),
    );
    await rejected('步骤引用乙的片段', () =>
      request(app)
        .post(`/api/versions/${versionA}/steps`)
        .set(auth(a))
        .send({ title: 'x', instruction: 'y', sourceClipId: clipB }),
    );
    await rejected('新建条目挂乙的版本', () =>
      request(app)
        .post(`/api/recipes/${recipeA}/vague-items`)
        .set(auth(a))
        .send({ category: 'amount', rawPhrase: 'x', versionId: versionB }),
    );
  });

  it('甲无法在乙的条目下评论，也无法读到乙空间的成员与日志', async () => {
    await rejected('评论乙的条目', () =>
      request(app)
        .post('/api/comments')
        .set(auth(a))
        .send({ targetType: 'vague_item', targetId: itemB, body: '闯入', mentions: [] }),
    );
    await rejected('读乙空间成员', () =>
      request(app).get(`/api/workspaces/${workspaceB}/members`).set(auth(a)),
    );
    await rejected('读乙空间日志', () =>
      request(app).get(`/api/workspaces/${workspaceB}/activity`).set(auth(a)),
    );
    await rejected('列乙空间的食谱', () =>
      request(app).get('/api/recipes').query({ workspaceId: workspaceB }).set(auth(a)),
    );
  });

  it('甲无法改乙音频的转写分句时间轴', async () => {
    await rejected('自动对齐乙的音频', () =>
      request(app).post(`/api/audio/${audioB}/transcript/align`).set(auth(a)).send({ transcript: '抢一句。' }),
    );
    await rejected('保存乙音频的分句', () =>
      request(app)
        .put(`/api/audio/${audioB}/transcript/segments`)
        .set(auth(a))
        .send({ segments: [{ startMs: 0, endMs: 900, text: '被篡改的句子' }] }),
    );
    await rejected('改乙的转写原文', () =>
      request(app)
        .patch(`/api/audio/${audioB}/transcript`)
        .set(auth(a))
        .send({ transcript: '被篡改' }),
    );
    await rejected('读乙音频详情（含分句）', () =>
      request(app).get(`/api/audio/${audioB}`).set(auth(a)),
    );
  });

  it('乙的数据自始至终没有被改动', async () => {
    const ingredients = await request(app)
      .get(`/api/versions/${versionB}/ingredients`)
      .set(auth(b))
      .expect(200);
    expect(ingredients.body.data[0].amountValue).toBe(1);

    const steps = await request(app).get(`/api/versions/${versionB}/steps`).set(auth(b)).expect(200);
    expect(steps.body.data[0].instruction).toBe('乙说明');
    expect(steps.body.data[0].sensoryCues).toEqual([]);
  });
});

describe('回归：整理结论不能写进别人空间的用量/步骤', () => {
  it('applyToIngredientId / applyToStepId 只接受同一张食谱内的目标', async () => {
    const attacker = await register('attacker');
    const victim = await register('victim');

    const attackerWs = (
      await request(app).post('/api/workspaces').set(auth(attacker)).send({ name: '攻击者家' }).expect(201)
    ).body.data;
    const victimWs = (
      await request(app).post('/api/workspaces').set(auth(victim)).send({ name: '受害者家' }).expect(201)
    ).body.data;

    const attackerRecipe = (
      await request(app)
        .post('/api/recipes')
        .set(auth(attacker))
        .send({ workspaceId: attackerWs.id, title: '攻击者的菜' })
        .expect(201)
    ).body.data;
    const victimRecipe = (
      await request(app)
        .post('/api/recipes')
        .set(auth(victim))
        .send({ workspaceId: victimWs.id, title: '受害者的菜' })
        .expect(201)
    ).body.data;

    const victimVersion = (
      await request(app)
        .get(`/api/recipes/${victimRecipe.id}/versions`)
        .set(auth(victim))
        .expect(200)
    ).body.data[0].id;

    const victimIngredient = (
      await request(app)
        .post(`/api/versions/${victimVersion}/ingredients`)
        .set(auth(victim))
        .send({ name: '受害者的冰糖', amountValue: 1, amountUnit: 'g' })
        .expect(201)
    ).body.data;
    const victimStep = (
      await request(app)
        .post(`/api/versions/${victimVersion}/steps`)
        .set(auth(victim))
        .send({ title: '受害者的步骤', instruction: '原样' })
        .expect(201)
    ).body.data;

    const attackerItem = (
      await request(app)
        .post(`/api/recipes/${attackerRecipe.id}/vague-items`)
        .set(auth(attacker))
        .send({ category: 'amount', rawPhrase: '放一点糖' })
        .expect(201)
    ).body.data;

    // 1. 指向别人的用量
    await request(app)
      .post(`/api/vague-items/${attackerItem.id}/resolve`)
      .set(auth(attacker))
      .send({
        resolvedSpec: {
          type: 'amount',
          value: 999,
          unit: 'g',
          confidence: 'confirmed',
          evidence: { answeredBy: attacker.userId },
        },
        applyToIngredientId: victimIngredient.id,
      })
      .expect(400);

    // 2. 指向别人的步骤
    const attackerHeat = (
      await request(app)
        .post(`/api/recipes/${attackerRecipe.id}/vague-items`)
        .set(auth(attacker))
        .send({ category: 'heat', rawPhrase: '中火' })
        .expect(201)
    ).body.data;

    await request(app)
      .post(`/api/vague-items/${attackerHeat.id}/resolve`)
      .set(auth(attacker))
      .send({
        resolvedSpec: {
          type: 'heat',
          criterion: '被写入的判断标准',
          confidence: 'confirmed',
          evidence: { answeredBy: attacker.userId },
        },
        applyToStepId: victimStep.id,
      })
      .expect(400);

    // 3. 关键：受害者的数据必须原封不动
    const ingredientsAfter = (
      await request(app)
        .get(`/api/versions/${victimVersion}/ingredients`)
        .set(auth(victim))
        .expect(200)
    ).body.data;
    expect(ingredientsAfter.find((i: { id: string }) => i.id === victimIngredient.id).amountValue).toBe(1);

    const stepsAfter = (
      await request(app).get(`/api/versions/${victimVersion}/steps`).set(auth(victim)).expect(200)
    ).body.data;
    expect(stepsAfter.find((s: { id: string }) => s.id === victimStep.id).sensoryCues).toEqual([]);
  });
});

describe('回归：版本差异必须能反映口述结论的变化', () => {
  let user: Session;
  let recipeId = '';
  let v1 = '';
  let v2 = '';

  beforeAll(async () => {
    user = await register('specdiff');
    const ws = await request(app)
      .post('/api/workspaces')
      .set(auth(user))
      .send({ name: '差异测试厨房' })
      .expect(201);
    const recipe = await request(app)
      .post('/api/recipes')
      .set(auth(user))
      .send({ workspaceId: ws.body.data.id, title: '差异测试菜' })
      .expect(201);
    recipeId = recipe.body.data.id;

    v1 = (
      await request(app).get(`/api/recipes/${recipeId}/versions`).set(auth(user)).expect(200)
    ).body.data[0].id;

    const item = await request(app)
      .post(`/api/recipes/${recipeId}/vague-items`)
      .set(auth(user))
      .send({ category: 'amount', rawPhrase: '放一点糖' })
      .expect(201);

    await request(app)
      .post(`/api/vague-items/${item.body.data.id}/resolve`)
      .set(auth(user))
      .send({
        resolvedSpec: {
          type: 'amount',
          value: 4,
          unit: 'g',
          confidence: 'confirmed',
          evidence: { answeredBy: user.userId },
        },
      })
      .expect(200);

    await request(app).post(`/api/versions/${v1}/submit`).set(auth(user)).expect(200);
    await request(app)
      .post(`/api/versions/${v1}/publish`)
      .set(auth(user))
      .send({ changeNote: '第一版：把一点糖整理成 4g' })
      .expect(200);

    v2 = (
      await request(app)
        .post(`/api/recipes/${recipeId}/versions`)
        .set(auth(user))
        .send({ fromVersionId: v1 })
        .expect(201)
    ).body.data.id;

    // 复做后调整结论：4g → 6g
    await request(app)
      .post(`/api/vague-items/${item.body.data.id}/reopen`)
      .set(auth(user))
      .send({ reason: '复做后觉得糖不够' })
      .expect(200);
    await request(app)
      .post(`/api/vague-items/${item.body.data.id}/resolve`)
      .set(auth(user))
      .send({
        resolvedSpec: {
          type: 'amount',
          value: 6,
          unit: 'g',
          confidence: 'confirmed',
          evidence: { answeredBy: user.userId },
        },
      })
      .expect(200);
  });

  it('差异不是空的，并且能看出结论从 4g 变成了 6g', async () => {
    const diff = await request(app)
      .get(`/api/versions/${v2}/diff`)
      .query({ against: v1 })
      .set(auth(user))
      .expect(200);

    const specEntries = (diff.body.data.entries as { section: string }[]).filter(
      (entry) => entry.section === 'spec',
    );
    expect(specEntries).toHaveLength(1);
    expect(specEntries[0]).toMatchObject({
      op: 'modified',
      label: '放一点糖',
      before: '4g',
      after: '6g',
    });
  });
});

describe('回归：软删除音频不能毁掉证据链', () => {
  let user: Session;
  let data: Awaited<ReturnType<typeof makeRecipeWithAudio>>;
  let clipId = '';
  let itemId = '';

  beforeAll(async () => {
    user = await register('evidence');
    data = await makeRecipeWithAudio(user);

    const clip = await request(app)
      .post(`/api/audio/${data.audioId}/clips`)
      .set(auth(user))
      .send({ startMs: 100, endMs: 700, label: '放糖那句' })
      .expect(201);
    clipId = clip.body.data.id;

    const item = await request(app)
      .post(`/api/recipes/${data.recipeId}/vague-items`)
      .set(auth(user))
      .send({ category: 'amount', rawPhrase: '放一点点糖', clipId })
      .expect(201);
    itemId = item.body.data.id;
  });

  it('删除引用中的音频后，语音列表里不再出现它', async () => {
    await request(app).delete(`/api/audio/${data.audioId}`).set(auth(user)).expect(200);

    const list = await request(app)
      .get('/api/audio')
      .query({ recipeId: data.recipeId })
      .set(auth(user))
      .expect(200);
    expect(list.body.data.map((a: { id: string }) => a.id)).not.toContain(data.audioId);
  });

  it('但引用它的片段仍然可读，原声仍然能播', async () => {
    await request(app).get(`/api/clips/${clipId}`).set(auth(user)).expect(200);
    await request(app).get(`/api/audio/${data.audioId}`).set(auth(user)).expect(200);

    const stream = await request(app)
      .get(`/api/audio/${data.audioId}/stream`)
      .set(auth(user))
      .expect(200);
    expect(stream.headers['accept-ranges']).toBe('bytes');
  });

  it('待澄清条目仍能带出原声片段与音频，界面不会出现断掉的播放器', async () => {
    const detail = await request(app).get(`/api/vague-items/${itemId}`).set(auth(user)).expect(200);
    expect(detail.body.data.clip).not.toBeNull();
    expect(detail.body.data.clipAudio).not.toBeNull();
    expect(detail.body.data.clipAudio.id).toBe(data.audioId);
  });

  it('完整性巡检仍然会检查被软删除的音频文件', async () => {
    const scan = await request(app)
      .post('/api/admin/integrity-scan')
      .set(auth(user))
      .expect(200);
    expect(scan.body.data.checked).toBeGreaterThan(0);
    expect(scan.body.data.missingFiles).toEqual([]);
  });
});

describe('回归：跨食谱引用与空间外指派', () => {
  let owner: Session;
  let stranger: Session;
  let recipeA = '';
  let recipeB = '';
  let versionA = '';
  let clipB = '';
  let workspaceId = '';

  beforeAll(async () => {
    owner = await register('owner-x');
    stranger = await register('stranger-x');

    const ws = await request(app)
      .post('/api/workspaces')
      .set(auth(owner))
      .send({ name: '引用校验厨房' })
      .expect(201);
    workspaceId = ws.body.data.id;

    const a = await request(app)
      .post('/api/recipes')
      .set(auth(owner))
      .send({ workspaceId, title: 'A 菜' })
      .expect(201);
    recipeA = a.body.data.id;

    const b = await request(app)
      .post('/api/recipes')
      .set(auth(owner))
      .send({ workspaceId, title: 'B 菜' })
      .expect(201);
    recipeB = b.body.data.id;

    versionA = (
      await request(app).get(`/api/recipes/${recipeA}/versions`).set(auth(owner)).expect(200)
    ).body.data[0].id;

    const audio = await request(app)
      .post('/api/audio')
      .set(auth(owner))
      .field('recipeId', recipeB)
      .field('kind', 'recipe_voice')
      .field('durationMs', '1000')
      .attach('file', fakeWav(), { filename: 'b.wav', contentType: 'audio/wav' })
      .expect(201);

    clipB = (
      await request(app)
        .post(`/api/audio/${audio.body.data.id}/clips`)
        .set(auth(owner))
        .send({ startMs: 0, endMs: 800 })
        .expect(201)
    ).body.data.id;
  });

  it('不能把 B 菜的音频片段挂到 A 菜的步骤上', async () => {
    const response = await request(app)
      .post(`/api/versions/${versionA}/steps`)
      .set(auth(owner))
      .send({ title: '偷挂', instruction: '不该成功', sourceClipId: clipB })
      .expect(400);

    expect(response.body.error.message).toContain('不属于这张食谱');
  });

  it('不能把条目指派给空间外的人', async () => {
    const response = await request(app)
      .post(`/api/recipes/${recipeA}/vague-items`)
      .set(auth(owner))
      .send({ category: 'amount', rawPhrase: '一点糖', assigneeId: stranger.userId })
      .expect(400);

    expect(response.body.error.details.outsiders).toContain(stranger.userId);
  });

  it('追问也不能指定给空间外的人', async () => {
    const item = await request(app)
      .post(`/api/recipes/${recipeA}/vague-items`)
      .set(auth(owner))
      .send({ category: 'heat', rawPhrase: '中火' })
      .expect(201);

    await request(app)
      .post(`/api/vague-items/${item.body.data.id}/ask`)
      .set(auth(owner))
      .send({ question: '多大火？', assigneeId: stranger.userId })
      .expect(400);
  });

  it('评论里 @ 空间外的人会被拒绝', async () => {
    const item = await request(app)
      .post(`/api/recipes/${recipeA}/vague-items`)
      .set(auth(owner))
      .send({ category: 'time', rawPhrase: '一会儿' })
      .expect(201);

    await request(app)
      .post('/api/comments')
      .set(auth(owner))
      .send({
        targetType: 'vague_item',
        targetId: item.body.data.id,
        body: '看这里',
        mentions: [stranger.userId],
      })
      .expect(400);
  });

  it('操作不存在的成员返回 404 而不是 500', async () => {
    const response = await request(app)
      .patch(`/api/workspaces/${workspaceId}/members/not-a-real-user`)
      .set(auth(owner))
      .send({ role: 'viewer' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('回归：登录接口有频次限制', () => {
  it('连续错误密码到达阈值后返回 429', async () => {
    const email = `bruteforce-${Date.now()}@reg.test`;
    await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'froa12345', displayName: '靶子' })
      .expect(201);

    let limited = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(app).post('/api/auth/login').send({ email, password: '错误密码' });
      if (response.status === 429) {
        limited = true;
        expect(response.body.error.code).toBe('RATE_LIMITED');
        break;
      }
    }

    expect(limited).toBe(true);
  });
});
