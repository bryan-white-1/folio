import { test, expect, type Page } from '@playwright/test';

const table = '| A | B | C |\n| --- | --- | --- |\n| a | **b** | c |\n| d | e | f |\n';
async function load(page: Page, text = table) {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'copy-menu', name: '표.md', dirty: false }), text);
}
const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
async function dragCells(page: Page) {
  const a = (await page.locator('td').nth(0).boundingBox())!, b = (await page.locator('td').nth(4).boundingBox())!;
  await page.mouse.move(a.x + 12, a.y + 12); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y + 20, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.selectedCell')).toHaveCount(4);
}
async function recordClipboard(page: Page, fail = false) {
  await page.evaluate(fail => {
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async (items: ClipboardItem[]) => {
      if (fail) throw new DOMException('denied', 'NotAllowedError');
      (window as any).copied = { text: await (await items[0].getType('text/plain')).text(), html: await (await items[0].getType('text/html')).text() };
    } });
  }, fail);
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });

test('dragged cell rectangle is copied with text and HTML without editing or losing selection', async ({ page }) => {
  await load(page); await recordClipboard(page); await dragCells(page);
  const before = await snapshot(page);
  await page.locator('td').nth(1).click({ button: 'right' }); await expect(page.locator('.selectedCell')).toHaveCount(4);
  await page.screenshot({ path: '../artifacts/table-copy-menu.png', fullPage: true });
  await page.locator('[data-action=copy]').click();
  await expect(page.locator('#toast')).toContainText('선택한 셀을 복사했습니다');
  const copied = await page.evaluate(() => (window as any).copied);
  expect(copied.text).toBe('a\tb\r\nd\te'); expect(copied.html).toContain('<strong>b</strong>');
  await expect(page.locator('.selectedCell')).toHaveCount(4); expect(await snapshot(page)).toEqual(before);
});

test('right click outside a selection copies just the clicked cell; keyboard menu copies the header', async ({ page }) => {
  await load(page); await recordClipboard(page); await dragCells(page);
  await page.locator('td').last().click({ button: 'right' }); await page.locator('[data-action=copy]').click();
  await expect.poll(() => page.evaluate(() => (window as any).copied?.text)).toBe('f');
  await page.locator('th').first().click(); await page.keyboard.press('Shift+F10'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).copied?.text)).toBe('A');
  expect((await page.evaluate(() => (window as any).copied)).html).toContain('<th');
  expect((await snapshot(page)).text).toBe(table);
});

test('clipboard denial leaves the document and selected cells intact and reports the failure', async ({ page }) => {
  await load(page); await recordClipboard(page, true); await dragCells(page);
  const before = await snapshot(page);
  await page.locator('td').first().click({ button: 'right' }); await page.locator('[data-action=copy]').click();
  await expect(page.locator('#toast')).toContainText('클립보드를 사용할 수 없습니다');
  await expect(page.locator('.selectedCell')).toHaveCount(4); expect(await snapshot(page)).toEqual(before);
});

