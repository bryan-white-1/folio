import { test, expect, type Page } from '@playwright/test';

async function load(page: Page, text: string) {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'tasks', name: '체크리스트.md', dirty: false }), text);
}
const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
const taskButton = '[data-command="task"]';
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });

test('checklist icon converts paragraphs, preserves marks, toggles off and supports independent undo', async ({ page }) => {
  const text = '**첫째**\n\n둘째\n';
  await load(page, text); await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+a');
  await page.locator(taskButton).click();
  await expect(page.locator('input[type=checkbox]')).toHaveCount(2);
  await expect(page.locator('.ProseMirror strong')).toHaveText('첫째');
  await expect(page.locator(taskButton)).toHaveAttribute('aria-pressed', 'true');
  const checked = await snapshot(page);
  await page.locator(taskButton).click(); await expect(page.locator('input[type=checkbox]')).toHaveCount(0);
  await expect(page.locator('.ProseMirror li')).toHaveCount(2);
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(checked.text);
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(text);
  await page.locator('#redo').click(); await expect(page.locator('input[type=checkbox]')).toHaveCount(2);
});

test('existing completed and nested list items keep state and structure, with new unchecked items on Enter', async ({ page }) => {
  await load(page, '- [x] 완료\n- 일반\n  - 자식\n');
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+a'); await page.locator(taskButton).click();
  await expect(page.locator('input[type=checkbox]')).toHaveCount(3);
  await expect(page.locator('input[type=checkbox]').first()).toBeChecked();
  await expect(page.locator('.ProseMirror li li')).toHaveCount(1);
  await page.locator('.ProseMirror li p').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.insertText('새 작업');
  await expect(page.locator('input[type=checkbox]')).toHaveCount(4);
  await expect(page.locator('input[type=checkbox]').nth(1)).not.toBeChecked();
  await expect(page.locator('input[type=checkbox]').first()).toBeChecked();
  const saved = await snapshot(page); await load(page, saved.text);
  await expect(page.locator('input[type=checkbox]')).toHaveCount(4);
});

test('mixed paragraphs and lists convert without affecting code, tables or other protected selections', async ({ page }) => {
  await load(page, '문단\n\n- 항목\n\n다음\n');
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+a'); await page.locator(taskButton).click();
  await expect(page.locator('input[type=checkbox]')).toHaveCount(3);
  await expect(page.locator('.ProseMirror')).toContainText('다음');
  for (const text of ['```\n코드\n```\n', '| A | B |\n| --- | --- |\n| a | b |\n', '# 제목\n', '본문\n\n```\n코드\n```\n']) {
    await load(page, text); await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+a');
    await expect(page.locator(taskButton)).toBeDisabled(); expect((await snapshot(page)).text).toBe(text);
  }
});

test('source selection creates checklists and shares undo and rendered check state', async ({ page }) => {
  const text = '하나\n**둘**\n';
  await load(page, text); await page.getByRole('tab', { name: '원문' }).click(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator(taskButton).click(); expect((await snapshot(page)).text).toBe('- [ ] 하나\n- [ ] **둘**\n');
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(text);
  await page.locator('#redo').click(); await page.getByRole('tab', { name: '렌더링' }).click();
  await expect(page.locator('input[type=checkbox]')).toHaveCount(2);
  await page.locator('input[type=checkbox]').last().check(); expect((await snapshot(page)).text).toContain('[x] **둘**');
  await page.screenshot({ path: '../artifacts/checklist-light.png', fullPage: true });
  await page.evaluate(() => (window as any).folio.receive({ type: 'theme', value: 'dark' }));
  await page.screenshot({ path: '../artifacts/checklist-dark.png', fullPage: true });
});

test('empty document starts a checklist and splitting a completed item creates an unchecked continuation', async ({ page }) => {
  await load(page, ''); await page.locator('.ProseMirror').click(); await page.locator(taskButton).click();
  await expect(page.locator('input[type=checkbox]')).toHaveCount(1);
  await page.keyboard.insertText('새 항목'); expect((await snapshot(page)).text).toContain('[ ] 새 항목');
  await load(page, '- [x] 앞뒤\n'); await page.locator('.ProseMirror li p').click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(page.locator('input[type=checkbox]')).toHaveCount(2);
  await expect(page.locator('input[type=checkbox]').first()).toBeChecked();
  await expect(page.locator('input[type=checkbox]').last()).not.toBeChecked();
  await expect(page.locator('.ProseMirror li p')).toHaveText(['앞', '뒤']);
});
