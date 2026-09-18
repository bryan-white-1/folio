import { test, expect, type Page } from '@playwright/test';

const table = '<!-- folio:table:v1 widths=140,220 -->\n\n| 이름 | 값 |\n| :--- | ---: |\n| 첫째 | 10 |\n| 둘째 | 20 |\n';
async function load(page: Page, text: string) {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'format-test', name: '편집.md', dirty: false }), text);
}
const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
async function heading(page: Page, level: number) {
  await page.locator('#heading-picker').click();
  await page.locator(`#format-popover [data-level="${level}"]`).click();
}
async function action(page: Page, name: string) {
  await page.keyboard.press('Shift+F10');
  await page.locator(`#format-popover [data-action="${name}"]`).click();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });

test('all heading levels, body, current status, no-op and individual undo work in rendered mode', async ({ page }) => {
  await load(page, '한글 **강조**\n'); await page.locator('.ProseMirror p').click();
  for (let level = 1; level <= 6; level++) {
    await heading(page, level);
    await expect(page.locator(`.ProseMirror h${level}`)).toHaveText('한글 강조');
    await expect(page.locator('#heading-picker')).toContainText(`제목 ${level}`);
    expect((await snapshot(page)).text).toContain('#'.repeat(level) + ' 한글');
  }
  const before = await snapshot(page); await heading(page, 6); expect(await snapshot(page)).toEqual(before);
  await page.locator('#undo').click(); await expect(page.locator('.ProseMirror h5')).toBeVisible();
  await page.locator('#redo').click(); await heading(page, 0); await expect(page.locator('.ProseMirror p')).toHaveText('한글 강조');
  expect((await snapshot(page)).text).toContain('**강조**');
});

test('source mode applies H1-H6 to whole blocks and shares shortcuts and undo', async ({ page }) => {
  await load(page, '**제목**\n-------\n\n그대로\n'); await page.getByRole('tab', { name: '원문', exact: true }).click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowRight');
  for (let level = 1; level <= 6; level++) {
    await page.keyboard.press(`Control+Alt+${level}`);
    await expect.poll(async () => (await snapshot(page)).text).toContain('#'.repeat(level) + ' **제목**');
  }
  await page.keyboard.press('Control+Alt+0'); await expect.poll(async () => (await snapshot(page)).text).toBe('**제목**\n\n그대로\n');
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toContain('###### **제목**');
  await page.getByRole('tab', { name: '렌더링', exact: true }).click(); await expect(page.locator('.ProseMirror h6')).toHaveText('제목');
});

test('menus and selection alone do not edit and heading is disabled in tables and code', async ({ page }) => {
  await load(page, '# 문서\n\n' + table + '\n```\ncode\n```\n');
  await page.locator('.ProseMirror h1').click(); const before = await snapshot(page);
  await page.locator('#heading-picker').click(); await page.keyboard.press('Escape'); expect(await snapshot(page)).toEqual(before);
  await page.locator('td').first().click(); await expect(page.locator('#heading-picker')).toBeDisabled();
  await action(page, 'select-col'); expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('Shift+F10'); await page.keyboard.press('Escape'); expect(await snapshot(page)).toEqual(before);
  await page.locator('.ProseMirror pre').click(); await expect(page.locator('#heading-picker')).toBeDisabled(); await expect(page.getByRole('toolbar', { name: '표 편집', exact: true })).toHaveCount(0);
});

test('row/column changes retain widths and alignment across reload and undo', async ({ page }) => {
  await load(page, table); await page.locator('td').first().click();
  await action(page, 'row-after'); await expect(page.locator('.ProseMirror tr')).toHaveCount(4);
  await expect(page.locator('tr').nth(2).locator('td').nth(1)).toHaveCSS('text-align', 'right');
  expect((await snapshot(page)).text).toContain('widths=140,220');
  await action(page, 'col-after'); await expect(page.locator('th')).toHaveCount(3);
  const inserted = await snapshot(page); expect(inserted.text).toContain('widths=140,0,220');
  await action(page, 'center');
  await expect(page.locator('th').nth(1)).toHaveCSS('text-align', 'center');
  const aligned = await snapshot(page); await load(page, aligned.text);
  await expect(page.locator('th').nth(1)).toHaveCSS('text-align', 'center');
  await page.locator('tr').nth(2).locator('td').nth(1).click(); await action(page, 'col-delete');
  await expect(page.locator('th')).toHaveCount(2); expect((await snapshot(page)).text).toContain('widths=140,220');
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(aligned.text);
  await page.locator('#redo').click(); await page.locator('td').first().click(); await action(page, 'row-delete');
  await expect(page.locator('tr')).toHaveCount(3);
});

test('clear selected columns preserves structure and widths; delete table removes its metadata only', async ({ page }) => {
  await load(page, '앞 문단\n\n' + table + '\n뒷 문단\n'); await page.locator('td').first().click();
  await action(page, 'select-col'); await expect(page.locator('.selectedCell')).toHaveCount(3);
  await page.keyboard.press('Delete');
  expect((await snapshot(page)).text).not.toContain('첫째'); expect((await snapshot(page)).text).toContain('widths=140,220');
  await expect(page.locator('tr')).toHaveCount(3); await expect(page.locator('th')).toHaveCount(2);
  await page.locator('#undo').click(); await page.locator('td').first().click();
  await action(page, 'delete'); await expect(page.locator('.ProseMirror table')).toHaveCount(0);
  expect((await snapshot(page)).text).not.toContain('folio:table'); expect((await snapshot(page)).text).toContain('뒷 문단');
  await page.locator('#undo').click(); await expect(page.locator('table')).toHaveCount(1);
});

test('header and last row/column constraints are visible and Tab appends one row', async ({ page }) => {
  await load(page, '| 머리 |\n| --- |\n| 마지막 |\n'); await page.locator('th').click();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-action="row-before"]')).toBeDisabled(); await expect(page.locator('[data-action="row-delete"]')).toBeDisabled(); await page.keyboard.press('Escape');
  await page.locator('td').click(); await page.keyboard.press('Shift+F10'); await expect(page.locator('[data-action="row-delete"]')).toBeDisabled(); await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10'); await expect(page.locator('[data-action="col-delete"]')).toBeDisabled(); await page.keyboard.press('Escape');
  await page.keyboard.press('Tab'); await expect(page.locator('tr')).toHaveCount(3);
  await page.locator('#undo').click(); await expect(page.locator('tr')).toHaveCount(2);
});

test('size picker creates matching empty tables in both modes and cancels cleanly', async ({ page }) => {
  for (const source of [false, true]) {
    await load(page, ''); if (source) await page.getByRole('tab', { name: '원문', exact: true }).click();
    const before = await snapshot(page); await page.locator('[data-command="table"]').click(); await page.keyboard.press('Escape'); expect(await snapshot(page)).toEqual(before);
    await page.locator('[data-command="table"]').click(); await page.getByRole('spinbutton', { name: '표 행 수' }).fill('4'); await page.getByRole('spinbutton', { name: '표 열 수' }).fill('3'); await page.getByRole('button', { name: '표 만들기' }).click();
    await expect.poll(async () => (await snapshot(page)).text).toContain('|');
    await page.getByRole('tab', { name: '렌더링', exact: true }).click(); await expect(page.locator('tr')).toHaveCount(4); await expect(page.locator('th')).toHaveCount(3);
    await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe('');
  }
});

test('right click and keyboard context menu use the intended table; controls fit themes and narrow windows', async ({ page }) => {
  await load(page, '# 표 편집\n\n사용 컬럼 (9개)\n\n비교 문단\n\n' + table + '\n다른 표\n\n| 다른 | 표 |\n| --- | --- |\n| 유지 | 유지 |\n');
  const gaps = await page.evaluate(() => {
    const paragraphs = document.querySelectorAll('.ProseMirror > p');
    const first = paragraphs[0].getBoundingClientRect(), second = paragraphs[1].getBoundingClientRect();
    const table = document.querySelector('.ProseMirror table')!.getBoundingClientRect();
    return { paragraph: second.top - first.bottom, table: table.top - second.bottom };
  });
  expect(gaps.table).toBeCloseTo(gaps.paragraph, 0);
  await expect(page.getByRole('toolbar', { name: '표 편집', exact: true })).toHaveCount(0);
  await page.locator('table').first().locator('td').first().click();
  await page.keyboard.press('Shift+F10'); await expect(page.getByRole('menu', { name: '표 편집 메뉴' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator('table').last().locator('td').first().click({ button: 'right' });
  await page.locator('[data-action="row-after"]').click(); await expect(page.locator('table').last().locator('tr')).toHaveCount(3); await expect(page.locator('table').first().locator('tr')).toHaveCount(3);
  await page.locator('table').first().locator('td').first().click();
  await page.screenshot({ path: '../artifacts/table-editing-light.png', fullPage: true });
  await page.evaluate(() => (window as any).folio.receive({ type: 'theme', value: 'dark' }));
  await page.keyboard.press('Shift+F10'); await page.screenshot({ path: '../artifacts/table-editing-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  const box = (await page.locator('#format-popover').boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('soft wrapped and multiple rendered paragraphs convert as blocks while code selections are protected', async ({ page }) => {
  await load(page, '첫째 **강조**\n이어짐\n\n둘째\n\n```\ncode\n```\n');
  await page.locator('.ProseMirror p').first().click(); await heading(page, 3);
  await expect(page.locator('.ProseMirror h3')).toHaveText('첫째 강조 이어짐');
  await page.evaluate(() => {
    const start = document.querySelector('.ProseMirror h3')!, end = document.querySelector('.ProseMirror > p')!;
    const range = document.createRange(); range.setStart(start, 0); range.setEnd(end, end.childNodes.length);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.locator('#heading-picker')).toContainText('혼합'); await heading(page, 4);
  await expect(page.locator('.ProseMirror h4')).toHaveCount(2);
  await page.keyboard.press('Control+a'); await expect(page.locator('#heading-picker')).toBeDisabled();
});

test('rectangular drag selection survives context menu and clears only selected cells', async ({ page }) => {
  await load(page, '| A | B | C |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |\n');
  const a = (await page.locator('td').nth(0).boundingBox())!, b = (await page.locator('td').nth(4).boundingBox())!;
  await page.mouse.move(a.x + 12, a.y + 12); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y + 20, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.selectedCell')).toHaveCount(4);
  await page.locator('td').nth(1).click({ button: 'right' }); await expect(page.locator('.selectedCell')).toHaveCount(4);
  await page.locator('[data-action="clear"]').click();
  await expect(page.locator('.selectedCell')).toHaveCount(4);
  expect(await page.locator('td').allTextContents()).toEqual(['', '', 'c', '', '', 'f']);
  await page.locator('#undo').click(); expect(await page.locator('td').allTextContents()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
});

test('nested tables retain layout metadata and each structural command has its own undo step', async ({ page }) => {
  const text = '# 문서\n\n' + table.split('\n').map(line => '> ' + line).join('\n') + '\n\n<!-- 사용자 보존 -->\n';
  await load(page, text); await page.locator('td').last().click(); await page.keyboard.press('End'); await page.keyboard.insertText('입력');
  const typed = await snapshot(page); await page.keyboard.press('Tab');
  await expect(page.locator('tr')).toHaveCount(4); const changed = await snapshot(page);
  expect(changed.text).toContain('widths=140,220'); expect(changed.text).toContain('<!-- 사용자 보존 -->');
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(typed.text);
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(text);
});

test('maximum insert size remains editable and first header receives input', async ({ page }, testInfo) => {
  await load(page, ''); await page.locator('[data-command="table"]').click();
  await page.getByRole('spinbutton', { name: '표 행 수' }).fill('100'); await page.getByRole('spinbutton', { name: '표 열 수' }).fill('50');
  const start = Date.now(); await page.getByRole('button', { name: '표 만들기' }).click();
  await expect(page.locator('tr')).toHaveCount(100); await expect(page.locator('th')).toHaveCount(50);
  await page.keyboard.insertText('머리'); await expect(page.locator('th').first()).toContainText('머리');
  await testInfo.attach('5000-cell-table-timing', { body: `${Date.now() - start} ms, insertion plus first header input`, contentType: 'text/plain' });
  await page.locator('#undo').click(); await expect(page.locator('th').first()).toHaveText('');
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe('');
});
