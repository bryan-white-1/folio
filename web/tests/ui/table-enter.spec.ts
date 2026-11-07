import { test, expect, type Page } from '@playwright/test';

const table = '<!-- folio:table:v1 widths=140,220 -->\n\n| 이름 | 값 |\n| :--- | ---: |\n| 첫째 | 10 |\n| 둘째 | **마지막** |\n';
const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
async function load(page: Page, text = table + '\n뒷 문단\n') {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'table-enter', name: '표.md', dirty: false }), text);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).folio);
});

test('Enter at the last cell end appends a row, focuses its first cell, and preserves history and metadata', async ({ page }) => {
  await load(page);
  const before = await snapshot(page);
  await page.locator('td p').last().click(); await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('tr')).toHaveCount(4);
  await expect(page.locator('tr').last().locator('td').nth(1)).toHaveCSS('text-align', 'right');
  const added = await snapshot(page);
  expect(added.text).toContain('widths=140,220');
  expect(added.text).toContain('**마지막**');
  await page.keyboard.insertText('새 레코드');
  await expect(page.locator('tr').last().locator('td').first()).toHaveText('새 레코드');
  await expect(page.locator('.ProseMirror > p').last()).toHaveText('뒷 문단');
  await page.locator('#undo').click();
  expect((await snapshot(page)).text).toBe(added.text);
  await page.locator('#undo').click();
  expect(await snapshot(page)).toMatchObject({ text: before.text, dirty: false });
  await page.locator('#redo').click(); await page.locator('#redo').click();
  const edited = await snapshot(page);
  await load(page, edited.text);
  await expect(page.locator('tr')).toHaveCount(4);
  await expect(page.locator('tr').last().locator('td').first()).toHaveText('새 레코드');
});

test('Enter appends from an empty final cell, including a one-column table at document end', async ({ page }) => {
  await load(page, '| 머리 |\n| --- |\n| |\n');
  await page.locator('td p').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('tr')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(page.locator('tr')).toHaveCount(4);
  await page.keyboard.insertText('연속 추가');
  await expect(page.locator('td').last()).toHaveText('연속 추가');
});

for (const location of ['middle', 'selection', 'earlier-row', 'earlier-column', 'header', 'ctrl-enter', 'shift-enter', 'ime'] as const) {
  test(`Enter does not append a row for ${location}`, async ({ page }) => {
    await load(page);
    const cells = page.locator(location === 'header' ? 'th p' : 'td p');
    await cells.nth(location === 'earlier-row' ? 1 : location === 'earlier-column' ? 2 : await cells.count() - 1).click();
    await page.keyboard.press('End');
    if (location === 'middle') await page.keyboard.press('ArrowLeft');
    if (location === 'selection') await page.keyboard.press('Shift+Home');
    if (location === 'ime') {
      const before = await snapshot(page);
      await page.locator('.ProseMirror').dispatchEvent('compositionstart');
      await page.locator('.ProseMirror').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
      await page.locator('.ProseMirror').dispatchEvent('compositionend');
      expect(await snapshot(page)).toEqual(before);
    } else {
      await page.keyboard.press(location === 'ctrl-enter' ? 'Control+Enter' : location === 'shift-enter' ? 'Shift+Enter' : 'Enter');
    }
    await expect(page.locator('tr')).toHaveCount(3);
    if (location === 'ctrl-enter') {
      await page.keyboard.insertText('표 밖');
      await expect(page.locator('.ProseMirror > p').filter({ hasText: '표 밖' })).toHaveCount(1);
    }
  });
}
