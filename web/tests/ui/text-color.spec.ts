import { test, expect, type Page } from '@playwright/test';
const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
const span = (s: string, color = '#D32F2F') => `<span style="color:${color}">${s}</span>`;
async function load(page: Page, text: string) { await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'color-test', name: '색상.md', dirty: false }), text); }
async function selectAll(page: Page, mode = 'rendered') { await page.locator(mode === 'source' ? '.cm-content' : '.ProseMirror').focus(); await page.keyboard.press('Control+a'); }
async function color(page: Page, value: string) { await page.locator('#color-picker').click(); await page.locator(`#format-popover [data-color="${value}"]`).click(); }
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });
for (const mode of ['rendered', 'source']) test(`${mode}: apply/reset color, no-op, undo and reload preserve text and formatting`, async ({ page }) => {
  await load(page, '# 제목\n\n본문 **강조**와 [링크](https://example.com)\n\n| A |\n| --- |\n| 값 |\n');
  if (mode === 'source') await page.locator('#source-mode').click();
  await selectAll(page, mode); await color(page, '#D32F2F');
  const colored = await snapshot(page); expect(colored.text).toContain('color:#D32F2F'); expect(colored.dirty).toBe(true);
  await color(page, '#D32F2F'); expect(await snapshot(page)).toEqual(colored);
  await page.locator('#undo').click(); expect((await snapshot(page)).text).not.toContain('<span');
  await page.locator('#redo').click(); expect((await snapshot(page)).text).toBe(colored.text);
  await load(page, colored.text); await page.locator('#rendered-mode').click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('제목');
  await expect(page.locator('.ProseMirror strong')).toHaveText('강조');
  await expect(page.locator('.ProseMirror h1 span')).toHaveCSS('color', 'rgb(211, 47, 47)');
  expect(await snapshot(page)).toMatchObject({ text: colored.text, dirty: false });
  await selectAll(page); await color(page, 'reset'); expect((await snapshot(page)).text).not.toContain('<span');
});
test('nested spans, soft breaks, malformed HTML and code survive editing and mode switches', async ({ page }) => {
  const text = span('첫째 ' + span('파랑', '#2563EB') + ' 끝') + '\n둘째\n\n`코드`\n\n<span style="color:red;display:none">보존</span>\n';
  await load(page, text);
  await expect(page.locator('.ProseMirror span').filter({ hasText: /^파랑$/ })).toHaveCSS('color', 'rgb(37, 99, 235)');
  const before = await snapshot(page); await page.locator('#source-mode').click(); await page.locator('#rendered-mode').click(); expect(await snapshot(page)).toEqual(before);
  await selectAll(page); await color(page, '#15803D');
  const edited = (await snapshot(page)).text; expect(edited).toContain('`코드`'); expect(edited).toContain('color:red;display:none');
  await load(page, edited); await expect(page.locator('.ProseMirror code')).toHaveText('코드');
});
test('menu cancellation, mixed state, HEX input and export do not mutate the original unexpectedly', async ({ page }) => {
  await load(page, span('빨강') + ' 기본\n'); await selectAll(page);
  await expect(page.locator('#color-picker')).toHaveAttribute('data-mixed', 'true');
  const before = await snapshot(page); await page.locator('#color-picker').click(); await page.keyboard.press('Escape'); expect(await snapshot(page)).toEqual(before);
  await page.locator('#color-picker').click(); await page.getByRole('textbox', { name: 'HEX 색상' }).fill('#abcdef'); await page.getByRole('button', { name: '적용', exact: true }).click();
  expect((await snapshot(page)).text).toContain('color:#ABCDEF');
  const colored = await snapshot(page); await page.locator('#color-picker').click();
  const download = page.waitForEvent('download'); await page.locator('[data-action="export-no-color"]').click();
  expect((await download).suggestedFilename()).toMatch(/\.plain\.md$/); expect(await snapshot(page)).toEqual(colored);
});
test('partial reset retains surrounding colors and works with clipboard HTML', async ({ page }) => {
  await load(page, span('abcdef') + '\n');
  await page.locator('.ProseMirror').focus();
  await page.locator('.ProseMirror p span').evaluate(element => {
    const text = element.firstChild!;
    window.getSelection()!.setBaseAndExtent(text, 2, text, 4);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('cd');
  await color(page, 'reset');
  expect((await snapshot(page)).text).toBe(span('ab') + 'cd' + span('ef') + '\n');
  await page.keyboard.press('Control+End');
  await page.locator('.ProseMirror').evaluate(element => { const data = new DataTransfer(); data.setData('text/html', '<span style="color:rgb(37,99,235)">붙여넣기</span>'); data.setData('text/plain', '붙여넣기'); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect.poll(async () => (await snapshot(page)).text).toContain('color:#2563EB');
});
test('source partial selections remain precise across consecutive color commands', async ({ page }) => {
  await load(page, 'abcdef\n'); await page.locator('#source-mode').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
  await color(page, '#D32F2F'); expect((await snapshot(page)).text).toBe('a' + span('bc') + 'def\n');
  await color(page, '#2563EB'); expect((await snapshot(page)).text).toBe('a' + span('bc', '#2563EB') + 'def\n');
  await color(page, 'reset'); expect((await snapshot(page)).text).toBe('abcdef\n');
});
test('multiline emphasis, hard breaks and links retain their structure through colored serialization', async ({ page }) => {
  await load(page, '**첫째\n둘째**와 *기울임* [링크](https://example.com)  \n끝\n\n- 항목\n');
  await selectAll(page); await color(page, '#7C3AED');
  const saved = (await snapshot(page)).text;
  await load(page, saved);
  await expect(page.locator('.ProseMirror .raw-block,.ProseMirror .raw-inline')).toHaveCount(0);
  await expect(page.locator('.ProseMirror strong')).toHaveText('첫째\n둘째');
  await expect(page.locator('.ProseMirror em')).toHaveText('기울임');
  await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.com');
  await expect(page.locator('.ProseMirror li')).toHaveText('항목');
  await expect(page.locator('.ProseMirror br')).toHaveCount(1);
});
test('colored table HTML survives Excel-style paste and cell-range formatting', async ({ page }) => {
  await load(page, '본문\n'); await selectAll(page);
  await page.locator('.ProseMirror').evaluate(element => { const data = new DataTransfer(); data.setData('text/html', '<table><tr><th>제목</th></tr><tr><td><span style="color:#D32F2F"><strong>값</strong></span></td></tr></table>'); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(page.locator('.ProseMirror td span')).toHaveCSS('color', 'rgb(211, 47, 47)');
  await page.locator('.ProseMirror td').click(); await page.keyboard.press('Shift+F10'); await page.locator('[data-action="select-table"]').click();
  await color(page, '#2563EB'); const saved = (await snapshot(page)).text;
  await load(page, saved); await expect(page.locator('.ProseMirror td strong')).toHaveText('값');
  await expect(page.locator('.ProseMirror th span')).toHaveCSS('color', 'rgb(37, 99, 235)');
  await expect(page.locator('.ProseMirror td span')).toHaveCSS('color', 'rgb(37, 99, 235)');
});
test('code-only selections cannot be colored; English palette and narrow dark layout stay usable', async ({ page }) => {
  await page.goto('/?lang=en'); await page.waitForFunction(() => !!(window as any).folio);
  await load(page, '`code`\n'); await selectAll(page); await page.locator('#color-picker').click();
  await expect(page.locator('[data-color="#D32F2F"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reset color' })).toBeDisabled(); await page.keyboard.press('Escape');
  await load(page, span('한글 색상') + ' plain\n'); await selectAll(page);
  await page.setViewportSize({ width: 380, height: 680 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await selectAll(page);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain('한글 색상');
  const before = await snapshot(page); await page.locator('#color-picker').click();
  const box = await page.locator('#format-popover').boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(380);
  await expect(page.getByRole('textbox', { name: 'HEX color' })).toBeVisible();
  await expect(page.locator('[data-color="#D32F2F"]')).toBeEnabled();
  await page.screenshot({ path: 'test-results/text-color-dark.png' });
  await page.keyboard.press('Escape'); expect(await snapshot(page)).toEqual(before);
});
test('native export sends a separate colorless snapshot and preserves literal Markdown text', async ({ page }) => {
  await page.addInitScript(() => { (window as any).packets = []; (window as any).chrome = { webview: { postMessage: (packet: any) => (window as any).packets.push(packet), addEventListener: () => {} } }; });
  await page.reload(); await page.waitForFunction(() => !!(window as any).folio);
  await load(page, span('# literal') + '\n\n' + span('* literal') + '\n\n**굵게**\n\n<!-- keep -->\n');
  const before = await snapshot(page); await page.locator('#color-picker').click(); await page.locator('[data-action="export-no-color"]').click();
  const exported = await page.evaluate(() => (window as any).packets.findLast((p: any) => p.type === 'exportMarkdown'));
  expect(exported.documentId).toBe('color-test'); expect(exported.text).not.toContain('<span');
  expect(exported.text).toContain('<!-- keep -->'); expect(exported.text).toContain('**굵게**');
  expect(await snapshot(page)).toEqual(before);
  await load(page, exported.text);
  await expect(page.locator('.ProseMirror h1,.ProseMirror li')).toHaveCount(0);
  await expect(page.locator('.ProseMirror p').first()).toHaveText('# literal');
});
