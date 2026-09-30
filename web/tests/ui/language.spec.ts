import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=en');
  await page.waitForFunction(() => !!(window as any).folio);
});

test('English startup translates document, toolbar, dialogs and accessibility labels', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Where thoughts become documents' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Rendered', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find (Ctrl+F)' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.locator('[data-command="link"]').click();
  await expect(page.getByRole('dialog')).toContainText('Display text');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#heading-picker').click();
  await expect(page.getByRole('menuitemradio').filter({ hasText: 'Heading 2' })).toBeVisible();
  expect(await page.locator('#format-popover').innerText()).not.toMatch(/[가-힣]/);
});

test('English controls never translate Korean user text or alter clean document history', async ({ page }) => {
  const text = '# 저장\n\n열기 설정 문서\n\n| 원문 | 본문 |\n| --- | --- |\n| 복사 | 닫기 |\n';
  await page.evaluate(async text => (window as any).folio.receive({ type: 'load', text, name: '저장.md', documentId: 'locale-user', dirty: false }), text);
  const before = await page.evaluate(() => (window as any).folio.snapshot());
  await page.getByRole('button', { name: 'Find (Ctrl+F)' }).click();
  await page.getByRole('textbox', { name: 'Search text' }).fill('저장');
  await expect(page.locator('#search-count')).toHaveAttribute('aria-label', 'Match 1 of 1');
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await page.getByRole('tab', { name: 'Source', exact: true }).click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search')).toContainText('next');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Rendered', exact: true }).click();
  await expect(page.locator('#document-name')).toHaveText('저장.md');
  const state = await page.evaluate(() => (window as any).folio.snapshot());
  expect(state).toMatchObject({ text, dirty: false, revision: before.revision });
});

test('English table size controls and generated image text use translated strings', async ({ page }) => {
  await page.evaluate(async () => (window as any).folio.receive({ type: 'load', text: 'A paragraph\n', name: 'Example.md', documentId: 'en-table', dirty: false }));
  await page.locator('.ProseMirror p').click();
  await page.locator('[data-command="table"]').click();
  await expect(page.getByRole('dialog', { name: 'Choose table size' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create table' })).toBeVisible();
  await expect(page.locator('.grid-preview')).toHaveText('3 rows × 2 columns');
  expect(await page.locator('#format-popover').innerText()).not.toMatch(/[가-힣]/);
});
