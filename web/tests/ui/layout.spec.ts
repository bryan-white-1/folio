import { test, expect, type Page } from '@playwright/test';

const table = '| 이름 | 설명 |\n| :--- | ---: |\n| 첫째 | 내용 |\n';
const picture = '![샘플](assets/sample.svg "제목")';
async function load(page: Page, text: string) {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'layout-test', name: '크기.md', dirty: false }), text);
}
async function snapshot(page: Page) { return page.evaluate(() => (window as any).folio.snapshot()); }
test.beforeEach(async ({ page }) => {
  await page.route('https://document.local/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#187863"/><circle cx="300" cy="150" r="80" fill="#d9eee5"/></svg>' }));
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio);
});

test('table drag is persisted in Markdown and restored after reload and undo', async ({ page }) => {
  const original = '# 열 너비\n\n' + table;
  await load(page, original);
  const cell = page.locator('th').first(); const box = (await cell.boundingBox())!;
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await expect(page.locator('.column-resize-handle').first()).toBeVisible();
  await page.mouse.down(); await page.mouse.move(box.x + box.width + 79, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  const state = await snapshot(page);
  expect(state.dirty).toBe(true); expect(state.text).toContain('<!-- folio:table:v1 widths=');
  const savedWidth = await page.locator('col').first().evaluate(el => (el as HTMLElement).style.width);
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(original);
  await page.locator('#redo').click(); expect((await snapshot(page)).text).toBe(state.text);
  await page.getByRole('tab', { name: '원문' }).click(); await page.getByRole('tab', { name: '렌더링' }).click();
  await expect(page.locator('col').first()).toHaveCSS('width', savedWidth);
  await load(page, state.text);
  expect((await snapshot(page)).dirty).toBe(false);
  expect(await page.locator('col').first().evaluate(el => (el as HTMLElement).style.width)).toBe(savedWidth);
  await expect(page.locator('.raw-block')).toHaveCount(0);
  await page.locator('td').first().click(); await page.keyboard.press('End'); await page.keyboard.insertText(' 수정');
  expect((await snapshot(page)).text).toContain('<!-- folio:table:v1 widths=');
  await expect(page.locator('th').nth(1)).toHaveCSS('text-align', 'right');
});

test('image drag preserves aspect ratio, filename and title; reload and reset round trip', async ({ page }) => {
  await load(page, '# 이미지\n\n' + picture + '\n');
  const img = page.locator('.folio-image img'); await expect(img).toHaveJSProperty('naturalWidth', 600);
  await img.click();
  const handle = page.getByRole('button', { name: '이미지 크기 조절', exact: true });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 7, box.y + 7); await page.mouse.down(); await page.mouse.move(box.x - 93, box.y + 7, { steps: 5 }); await page.mouse.up();
  await expect(img).toHaveCSS('width', '500px'); await expect(img).toHaveCSS('height', '250px');
  const state = await snapshot(page);
  expect(state.text).toContain(picture + '<!-- folio:image:v1 width=500 -->');
  expect(state.images).toEqual(['assets/sample.svg']);
  await load(page, state.text);
  await expect(img).toHaveCSS('width', '500px'); expect((await snapshot(page)).dirty).toBe(false);
  await img.click();
  await page.getByRole('spinbutton', { name: '이미지 너비 (px)' }).fill('320');
  await page.getByRole('spinbutton', { name: '이미지 너비 (px)' }).press('Enter');
  await img.click(); // commit change by blurring the numeric input
  await expect(img).toHaveCSS('width', '320px');
  await page.locator('#undo').click(); await expect(img).toHaveCSS('width', '500px');
  await img.click(); await page.getByRole('button', { name: '이미지 원본 크기로 복원' }).click();
  expect((await snapshot(page)).text).not.toContain('folio:image'); await expect(img).toHaveCSS('width', '600px');
});

test('per-object metadata survives nested tables, repeated images, editing, and narrow views', async ({ page }) => {
  const text = '# 개별 크기\n\n<!-- folio:table:v1 widths=160,280 -->\n\n' + table + '\n> <!-- folio:table:v1 widths=190,230 -->\n>\n' + table.split('\n').filter(Boolean).map(line => '> ' + line).join('\n') + '\n\n' + picture + '<!-- folio:image:v1 width=240 --> ' + picture + '<!-- folio:image:v1 width=120 -->\n';
  await load(page, text);
  expect(await page.locator('col').evaluateAll(cols => cols.map(col => (col as HTMLElement).style.width))).toEqual(['160px', '280px', '190px', '230px']);
  await expect(page.locator('.folio-image').first()).toHaveCSS('width', '240px');
  await expect(page.locator('.folio-image').last()).toHaveCSS('width', '120px');
  await page.locator('h1').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' 수정');
  const state = await snapshot(page); await load(page, state.text);
  expect(state.text.match(/folio:table/g)).toHaveLength(2); expect(state.text.match(/folio:image/g)).toHaveLength(2);
  await expect(page.locator('.raw-inline, .raw-block')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1060, height: 900 });
  await page.locator('.folio-image').first().hover();
  await page.screenshot({ path: '../artifacts/layout-resizing-light.png', fullPage: true });
  await page.evaluate(() => (window as any).folio.receive({ type: 'theme', value: 'dark' }));
  await page.screenshot({ path: '../artifacts/layout-resizing-dark.png', fullPage: true });
});

test('invalid and orphan metadata stays inert and is preserved', async ({ page }) => {
  const text = '# 보존\n\n<!-- folio:table:v1 widths=999999,10 -->\n\n' + table + '\n' + picture + '<!-- folio:image:v1 width=9999 -->\n\n<!-- folio:table:v1 widths=100,100 -->\n\n일반 문단\n';
  await load(page, text);
  await page.locator('h1').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' 변경');
  const state = await snapshot(page);
  expect(state.text).toContain('widths=999999,10'); expect(state.text).toContain('width=9999'); expect(state.text).toContain('widths=100,100');
});
