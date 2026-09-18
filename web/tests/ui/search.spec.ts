import { test, expect, type Page } from '@playwright/test';

const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
async function load(page: Page, text: string) {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'search', name: '찾기.md', dirty: false }), text);
}
async function find(page: Page, text: string) {
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: '검색어', exact: true }).fill(text);
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });

test('rendered search counts headings, formatted phrases, tables, tasks and ordinary code without modifying Markdown', async ({ page }) => {
  await load(page, '# 한글 찾기\n\n한글 **찾기**\n\n| 제목 | 값 |\n| --- | --- |\n| 한글 찾기 | 값 |\n\n- [x] 한글 찾기\n\n```js\n한글 찾기\n```\n');
  const before = await snapshot(page);
  await find(page, '한글 찾기');
  await expect(page.locator('#search-count')).toHaveText('1 / 5');
  await expect(page.getByRole('tab', { name: '렌더링' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter'); await expect(page.locator('#search-count')).toHaveText('2 / 5');
  await expect(page.locator('strong .folio-search-current')).toHaveText('찾기');
  await expect(page.locator('#search-query')).toBeFocused();
  await page.keyboard.press('Shift+Enter'); await page.keyboard.press('Shift+F3');
  await expect(page.locator('#search-count')).toHaveText('5 / 5');
  await page.locator('#search-next').click(); await expect(page.locator('#search-count')).toHaveText('1 / 5');
  await page.locator('#search-previous').click(); await expect(page.locator('#search-count')).toHaveText('5 / 5');
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('#rendered-search')).toBeHidden();
  await expect(page.locator('.folio-search-match')).toHaveCount(0);
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
});

test('literal case-insensitive Unicode search, empty and no-match states, and Ctrl+F selects the previous query', async ({ page }) => {
  await load(page, 'Alpha ALPHA alpha a.b aXb 😀한글 😀한글\n');
  await find(page, 'ALPHA'); await expect(page.locator('#search-count')).toHaveText('1 / 3');
  await page.keyboard.press('Control+f'); await page.keyboard.insertText('a.b');
  await expect(page.locator('#search-count')).toHaveText('1 / 1');
  await expect(page.locator('.folio-search-current')).toHaveText('a.b');
  await page.locator('#search-query').fill('😀한글'); await expect(page.locator('#search-count')).toHaveText('1 / 2');
  await page.locator('#search-query').fill('없음'); await expect(page.locator('#search-count')).toHaveText('0 / 0');
  await expect(page.locator('#search-count')).toHaveAttribute('aria-label', '일치하는 결과 없음');
  await expect(page.locator('#search-next')).toBeDisabled();
  await page.locator('#search-query').fill(''); await expect(page.locator('.folio-search-match')).toHaveCount(0);
  await expect(page.locator('#search-count')).toHaveAttribute('aria-label', '검색어를 입력하세요');
});

test('search results update on edits and Undo while search actions do not enter shared history', async ({ page }) => {
  await load(page, '대상 하나\n\n대상 둘\n');
  await find(page, '대상'); await expect(page.locator('#search-count')).toHaveText('1 / 2');
  await page.locator('.ProseMirror p').last().click(); await page.keyboard.press('End'); await page.keyboard.insertText(' 대상');
  await expect(page.locator('#search-count')).toHaveText('1 / 3');
  await page.locator('#search-next').click(); await expect(page.locator('#search-count')).toHaveText('2 / 3');
  await page.locator('#undo').click(); await expect(page.locator('#search-count')).toHaveText('1 / 2');
  expect((await snapshot(page)).text).toBe('대상 하나\n\n대상 둘\n');
  await expect(page.locator('#undo')).toBeDisabled();
});

test('mode-aware toolbar and host Find keep source search available and document load clears rendered search', async ({ page }) => {
  await load(page, '문서 검색\n'); await page.locator('#find').click();
  await page.locator('#search-query').fill('검색'); await expect(page.locator('#search-count')).toHaveText('1 / 1');
  await page.getByRole('tab', { name: '원문' }).click(); await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search')).toBeVisible();
  await expect(page.getByRole('tab', { name: '원문' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#rendered-search')).toBeHidden();
  await page.getByRole('tab', { name: '렌더링' }).click();
  await page.evaluate(() => (window as any).folio.receive({ type: 'find' }));
  await expect(page.locator('#search-count')).toHaveText('1 / 1');
  await load(page, '다른 문서\n'); await expect(page.locator('#rendered-search')).toBeHidden();
  await page.locator('#find').click(); await expect(page.locator('#search-query')).toHaveValue('');
  await expect(page.locator('#search-count')).toHaveText('0 / 0');
});

test('navigation scrolls current matches into view; reduced corners and search remain readable in light, dark and narrow layouts', async ({ page }) => {
  await load(page, '# 검색 예제\n\n대상 첫째\n\n' + Array.from({ length: 35 }, (_, i) => `본문 ${i}`).join('\n\n') + '\n\n대상 마지막\n');
  await find(page, '대상'); await expect(page.locator('#search-count')).toHaveText('1 / 2');
  await page.keyboard.press('F3'); await expect(page.locator('#search-count')).toHaveText('2 / 2');
  const bounds = await page.locator('.folio-search-current').boundingBox();
  const viewport = await page.locator('#editor-scroll').boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(viewport!.y);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
  await expect(page.locator('#find')).toHaveCSS('border-radius', '4px');
  await expect(page.locator('.mode-switch')).toHaveCSS('border-radius', '6px');
  await page.keyboard.press('Shift+F3');
  await page.screenshot({ path: '../artifacts/search-light.png', fullPage: true });
  await page.evaluate(() => (window as any).folio.receive({ type: 'theme', value: 'dark' }));
  await page.screenshot({ path: '../artifacts/search-dark.png', fullPage: true });
  await page.setViewportSize({ width: 400, height: 720 });
  const close = await page.locator('#search-close').boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(400);
  await expect(page.locator('#search-query')).toBeVisible();
});

test('IME Enter does not navigate or close the search and closing cancels a pending search', async ({ page }) => {
  await load(page, '한글 한글\n'); await find(page, '한글'); await expect(page.locator('#search-count')).toHaveText('1 / 2');
  await page.locator('#search-query').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(page.locator('#search-count')).toHaveText('1 / 2');
  await page.locator('#search-query').fill('글'); await page.locator('#search-close').click();
  await page.waitForTimeout(160); await expect(page.locator('.folio-search-match')).toHaveCount(0);
  await expect(page.locator('#rendered-search')).toBeHidden();
});
