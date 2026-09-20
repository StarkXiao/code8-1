import { expect, test } from '@playwright/test';

// 录一段真实语音是这个产品的起点，但之前所有测试都是"上传文件"，
// MediaRecorder + Web Audio 解码峰值这条主路径从没被跑过。
// 这里用 Chrome 的虚拟麦克风走一遍完整录音流程。

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('在浏览器里录一段语音并保存，波形和转写都能出来', async ({ page, request }) => {
  const stamp = Date.now();

  // 准备账号与食谱
  const registered = await request.post('/api/auth/register', {
    data: { email: `rec-${stamp}@e2e.test`, password: 'froa12345', displayName: '录音测试' },
  });
  const auth = (await registered.json()).data;
  const token = auth.tokens.accessToken as string;

  const workspace = (
    await (
      await request.post('/api/workspaces', {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: '录音测试厨房' },
      })
    ).json()
  ).data;

  const recipe = (
    await (
      await request.post('/api/recipes', {
        headers: { Authorization: `Bearer ${token}` },
        data: { workspaceId: workspace.id, title: '录音红烧肉' },
      })
    ).json()
  ).data;

  await page.addInitScript(
    ([access, refresh]) => {
      localStorage.setItem('froa.accessToken', access as string);
      localStorage.setItem('froa.refreshToken', refresh as string);
    },
    [auth.tokens.accessToken, auth.tokens.refreshToken],
  );

  await page.goto(`/w/${workspace.id}/recipes/${recipe.id}/record`);
  await expect(page.getByRole('heading', { name: /录音工作台/ })).toBeVisible();

  // 1. 开始录音
  await page.getByRole('button', { name: '点击开始说话' }).click();
  await expect(page.getByText('正在录音…')).toBeVisible({ timeout: 10_000 });

  // 2. 让它录一会儿（虚拟麦克风持续产生声音）
  await page.waitForTimeout(1800);

  // 3. 停止 → 浏览器解码出波形
  await page.getByRole('button', { name: '停止并保存' }).click();
  await expect(page.getByText('刚才录的这段话')).toBeVisible({ timeout: 15_000 });

  // 时长不应为 0：为 0 说明 Web Audio 解码失败，后面的波形框选就全废了
  const duration = await page.locator('.froa-hint', { hasText: '时长' }).first().innerText();
  const seconds = Number(/(\d+):(\d+)/.exec(duration)?.[2] ?? '0');
  expect(seconds, `录音时长异常：${duration}`).toBeGreaterThan(0);
  expect(duration).toContain('已生成波形');

  // 4. 保存到服务端
  await page.getByRole('button', { name: '保存这段语音' }).click();

  // 5. 保存后进入"转写与标注"，并能看到这段语音持久化了
  await expect(page.getByRole('heading', { name: '转写与标注' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/校验和/)).toBeVisible();

  const audios = await request.get('/api/audio', {
    headers: { Authorization: `Bearer ${token}` },
    params: { recipeId: recipe.id },
  });
  const list = (await audios.json()).data;
  expect(list).toHaveLength(1);
  expect(list[0].durationMs).toBeGreaterThan(0);
  expect(list[0].peaks?.length).toBeGreaterThan(0);
  expect(list[0].sha256).toHaveLength(64);
});
