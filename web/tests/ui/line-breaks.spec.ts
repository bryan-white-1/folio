import { test, expect, type Page } from '@playwright/test';

async function load(page: Page, text: string) {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'line-break-test', name: '줄바꿈.md', dirty: false }), text);
}
const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });

test('Shift+Enter saves two-space hard breaks and retains them through undo, save and reload', async ({ page }) => {
  const original = '첫 줄\n'; await load(page, original);
  await page.locator('.ProseMirror p').click(); await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('다음 줄');
  const edited = await snapshot(page);
  expect(edited).toMatchObject({ text: '첫 줄  \n다음 줄\n', dirty: true });
  await expect(page.locator('.ProseMirror p br[data-type="hardbreak"]')).toHaveCount(1);
  await page.getByRole('tab', { name: '원문', exact: true }).click();
  await page.getByRole('tab', { name: '렌더링', exact: true }).click();
  expect(await snapshot(page)).toEqual(edited);
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(original);
  await page.locator('#redo').click(); expect((await snapshot(page)).text).toBe(edited.text);
  await page.evaluate(state => (window as any).folio.receive({ type: 'saved', ...state, name: '줄바꿈.md' }), edited);
  expect((await snapshot(page)).dirty).toBe(false);
  await load(page, edited.text);
  await expect(page.locator('.ProseMirror p')).toHaveText('첫 줄다음 줄');
  await expect(page.locator('.ProseMirror p br[data-type="hardbreak"]')).toHaveCount(1);
  expect(await snapshot(page)).toMatchObject({ text: edited.text, dirty: false });
});

for (const { name, original, selector, expected } of [
  { name: 'blockquote', original: '> 첫 줄\n', selector: 'blockquote p', expected: '> 첫 줄  \n> 다음 줄\n' },
  { name: 'list', original: '* 첫 줄\n', selector: 'li p', expected: '* 첫 줄  \n  다음 줄\n' },
  { name: 'bold text', original: '**첫 줄**\n', selector: 'p', expected: '**첫 줄**  \n다음 줄\n' },
]) test(`Shift+Enter retains ${name} structure after serializing and reopening`, async ({ page }) => {
  await load(page, original);
  await page.locator(`.ProseMirror ${selector}`).first().click(); await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('다음 줄');
  expect((await snapshot(page)).text).toBe(expected);
  await load(page, expected);
  await expect(page.locator(`.ProseMirror ${selector}`).first()).toHaveText('첫 줄다음 줄');
  await expect(page.locator('.ProseMirror br[data-type="hardbreak"]')).toHaveCount(1);
});

test('existing backslash breaks normalize only on visual edits while literal code and preserved HTML survive', async ({ page }) => {
  const code = '```text\nkeep\\\nnext\n```\n', html = '<!-- keep\\\nraw -->';
  const original = '# 제목\n\n첫 줄\\\n다음 줄\n\n`keep\\`\n\n' + code + '\n' + html + '\n';
  await load(page, original);
  await page.getByRole('tab', { name: '원문', exact: true }).click();
  await page.getByRole('tab', { name: '렌더링', exact: true }).click();
  expect(await snapshot(page)).toMatchObject({ text: original, dirty: false });
  await page.locator('.ProseMirror h1').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' 수정');
  const edited = await snapshot(page);
  expect(edited.text).toContain('첫 줄  \n다음 줄');
  for (const literal of [code, '`keep\\`', html]) expect(edited.text).toContain(literal);
  await load(page, edited.text);
  await expect(page.locator('.ProseMirror br[data-type="hardbreak"]')).toHaveCount(1);
  await expect(page.locator('.ProseMirror pre code')).toHaveText('keep\\\nnext');
});
