import { expect, test } from '@playwright/test';

/**
 * 分句与时间轴对齐的 UI 闭环：
 *   上传语音 -> 录入整段口述 -> 一键分句并对齐 -> 每句落到音频区间
 *   -> 拖动句间边界修正 -> 保存 -> 某句一键标为待澄清（自动带上该句区间）
 */

const button = (label: string) =>
  new RegExp(label.split('').map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'));

function makeWav(seconds = 10): Buffer {
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

test('口述转写自动分句、拖动边界修正并按句标记待澄清', async ({ page }) => {
  const stamp = Date.now();
  const email = `seg-${stamp}@e2e.test`;

  await page.goto('/register');
  await page.getByLabel('你的称呼').fill('整理者');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill('froa12345');
  await page.getByRole('button', { name: button('注册并继续') }).click();

  await page.getByRole('button', { name: button('创建家庭空间') }).click();
  await page.getByLabel('空间名称').fill(`分句厨房 ${stamp}`);
  await page.getByRole('dialog').getByRole('button', { name: button('创建') }).click();

  await page.getByRole('button', { name: button('新建食谱') }).click();
  await page.getByLabel('这道菜叫什么').fill('时间轴测试菜');
  await page.getByRole('button', { name: button('创建并开始录音') }).click();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'voice.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(10),
  });
  await expect(page.getByRole('heading', { name: '转写与标注' })).toBeVisible();

  // 1. 录入整段口述并保存原文
  await page
    .getByPlaceholder(/先炒糖色/)
    .fill('先炒糖色，放一点点糖就行。中火炒到收汁。肉炖到筷子能戳透。');
  await page.getByRole('button', { name: button('保存转写原文') }).click();
  await expect(page.getByText('转写文本已保存')).toBeVisible();

  // 2. 一键分句并对齐时间轴
  await page.getByRole('button', { name: button('分句并对齐时间轴') }).click();
  // 三句带句号 → 三行
  const rows = page.locator('.froa-segment-row');
  await expect(rows).toHaveCount(3);
  await expect(page.getByText('有未保存的修改')).toBeVisible();

  // 波形上应出现 2 个可拖句间手柄
  const timelineWave = page.locator('[aria-label="分句时间轴波形（拖动竖柄调整句间边界）"]');
  await expect(page.locator('.froa-wave-handle')).toHaveCount(2);
  await timelineWave.scrollIntoViewIfNeeded();

  // 3. 拖第一个句间手柄向右修正边界。
  // 直接取手柄自身的位置（不同句子长度不同，第一句边界不在 1/3 处）。
  const handle = page.locator('.froa-wave-handle').first();
  await handle.scrollIntoViewIfNeeded();
  const hb = await handle.boundingBox();
  if (!hb) throw new Error('句间手柄没有渲染出来');
  const startX = hb.x + hb.width / 2;
  const startY = hb.y + hb.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (const dx of [4, 10, 20, 36, 52]) {
    await page.mouse.move(startX + dx, startY, { steps: 3 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  // 拖动后相邻两句都标为已修正
  await expect(page.locator('.froa-segment-row .ant-tag').filter({ hasText: '已修正' })).toHaveCount(2);

  // 4. 保存对齐结果
  await page.getByRole('button', { name: button('保存对齐结果') }).click();
  await expect(page.getByText('分句与时间轴已保存')).toBeVisible();
  await expect(page.getByText('有未保存的修改')).toHaveCount(0);

  // 5. 第一句"这句说不清"：应自动建片段并打开标记弹窗，且原话已预填
  page.on('dialog', () => {});
  await page.locator('.froa-segment-row').first().getByRole('button', { name: /这句说不清/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('家人的原话')).toHaveValue(/先炒糖色/);
  await expect(page.getByText(/会关联你刚框选的片段/)).toBeVisible();
});
