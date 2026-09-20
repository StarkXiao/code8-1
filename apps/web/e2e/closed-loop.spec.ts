import { expect, test } from '@playwright/test';

/**
 * antd 会在「两个汉字的按钮」中间插一个空格（"创建" -> "创 建"），
 * 所以按可访问名找按钮时要允许字与字之间有空白。
 */
const button = (label: string) =>
  new RegExp(label.split('').map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'));

/** 一段 1 秒的静音 WAV，用来走真实的"上传语音"路径 */
function makeWav(): Buffer {
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

/**
 * UI 层闭环：注册 -> 建空间 -> 建食谱 -> 标记模糊口述 -> 追问 -> 整理结论 -> 发布
 * 这条用例证明"页面上真的能走完一遍"，而不只是接口能跑。
 */
test('从注册到发布一条可复做结论的完整闭环', async ({ page }) => {
  const stamp = Date.now();
  const email = `ui-${stamp}@e2e.test`;

  // 1. 注册
  await page.goto('/register');
  await page.getByLabel('你的称呼').fill('我');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill('froa12345');
  await page.getByRole('button', { name: button('注册并继续') }).click();
  await expect(page.getByRole('heading', { name: '我的家庭空间' })).toBeVisible();

  // 2. 创建家庭空间
  await page.getByRole('button', { name: button('创建家庭空间') }).click();
  await page.getByLabel('空间名称').fill(`测试厨房 ${stamp}`);
  await page.getByRole('dialog').getByRole('button', { name: button('创建') }).click();

  // 3. 新建食谱（自动跳到录音工作台）
  await page.getByRole('button', { name: button('新建食谱') }).click();
  await page.getByLabel('这道菜叫什么').fill('外婆的红烧肉');
  await page.getByRole('button', { name: button('创建并开始录音') }).click();
  await expect(page.getByRole('heading', { name: /录音工作台/ })).toBeVisible();

  // 4. 上传一段原始语音
  await page.locator('input[type="file"]').setInputFiles({
    name: 'voice.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(),
  });
  await expect(page.getByRole('heading', { name: '转写与标注' })).toBeVisible();

  // 5. 在波形上框出"放糖"那一句，作为这条结论的原声证据
  const wave = page.getByRole('slider', { name: '音频波形' });
  const box = await wave.boundingBox();
  if (!box) throw new Error('波形没有渲染出来');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: button('把选中部分设为单独片段') }).click();
  // 注意：toast 里也有"已框选片段"，加冒号以只匹配页面上的那个标签
  await expect(page.getByText(/已框选：/).first()).toBeVisible();

  // 6. 把这段口述的转写打进去（默认转写驱动是 manual，需要人工录入）
  await page
    .getByPlaceholder(/先炒糖色/)
    .fill('先炒糖色，放一点点糖，中火炒到收汁');

  // 7. 手动标记一条"说不清"的口述
  await page.getByRole('button', { name: button('手动标记一条说不清的') }).click();
  await page.getByLabel('家人的原话').fill('放一点点糖');
  // antd 的 Select 不能直接点内部的 search input（会被选中项遮挡），要点它的容器
  await page.getByRole('dialog').locator('.ant-select-selector').first().click();
  await page.locator('.ant-select-item-option[title="用量"]').click();
  // 框选的片段应该被自动带上
  await expect(page.getByText(/会关联你刚框选的片段/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: button('加入追问台') }).click();
  await expect(page.getByText('已加入追问台')).toBeVisible();

  // 8. 到追问台把它整理成可复做结论
  await page.getByRole('button', { name: /去追问台/ }).click();
  await expect(page.getByRole('heading', { name: /追问台/ })).toBeVisible();
  await page.getByText('「放一点点糖」').click();
  await page.getByRole('button', { name: button('整理成可复做结论') }).click();

  await page.getByLabel('具体数值').fill('4');
  await page.getByLabel('单位').fill('g');
  await page.getByLabel('参照物 / 依据').fill('白瓷勺半勺');
  // 默认置信度是"暂定"，而"暂定"的结论不允许发布 —— 这里明确确认它。
  // antd 的 Radio.Button 真正的 input 是隐藏的，要点它的外包装。
  await page.locator('.ant-radio-button-wrapper', { hasText: '已确认' }).click();
  await page.getByRole('button', { name: button('保存为可复做结论') }).click();
  await expect(page.getByText('已保存为可复做结论')).toBeVisible();

  // 8. 编辑草稿并发布
  await page.getByRole('button', { name: button('编辑草稿') }).click();
  await page.getByRole('button', { name: button('提交并发布') }).click();
  await page.getByLabel('变更说明（必填）').fill('把"一点点糖"整理为 4g，依据外婆家的白瓷勺');
  await page.getByRole('dialog').getByRole('button', { name: button('确认发布') }).click();
  await expect(page.getByText('版本已发布')).toBeVisible();

  // 9. 回到食谱页，确认整理结果可读、且导出真的能下载
  await page.getByRole('link', { name: button('返回食谱') }).click();
  await expect(page.getByRole('heading', { name: '外婆的红烧肉' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /口述整理记录/ })).toBeVisible();
  await expect(page.getByText(/白瓷勺半勺/)).toBeVisible();

  // 导出走的是 <a href> 直接下载，没法带请求头 ——
  // 这条断言就是防止"令牌没带上导致 401"再次发生
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: button('导出 Markdown 食谱') }).click(),
  ]);
  expect(download.suggestedFilename()).toContain('.md');
});
