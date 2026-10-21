import { test, expect, type Page } from '@playwright/test';

async function snapshot(page: Page) { return page.evaluate(() => (window as any).folio.snapshot()); }
async function load(page: Page, text: string) {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'navigation', name: '이동.md', dirty: false }), text);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const listeners: ((event: any) => void)[] = [];
    const host = (window as any).testHost = {
      preferences: { BodyLineHeight: 1.95, OutlineLineHeight: 2, DocumentAlignment: 'center', FontFamily: 'Malgun Gothic' },
      headings: [], packets: [] as any[],
      emit(packet: any) { listeners.forEach(listener => listener({ data: packet })); },
      state() { host.emit({ type: 'hostState', name: '이동.md', path: '', preferences: host.preferences, headings: host.headings }); },
    };
    (window as any).chrome = { webview: {
      addEventListener: (_type: string, listener: (event: any) => void) => listeners.push(listener),
      postMessage(packet: any) {
        host.packets.push(packet);
        if (packet.type === 'changed') { host.headings = packet.headings; host.state(); }
        if (packet.type === 'cursor') host.emit({ type: 'hostCursor', headingId: packet.headingId });
        if (packet.type === 'hostPreferences') {
          Object.assign(host.preferences, packet.preferences);
          host.emit({ type: 'configuration', bodyLineHeight: host.preferences.BodyLineHeight, documentAlignment: host.preferences.DocumentAlignment, fontFamily: host.preferences.FontFamily }); host.state();
        }
      },
    } };
  });
  await page.goto('/?native=1');
  await page.waitForFunction(() => !!(window as any).folio);
});

test('outline clicks focus and reveal headings in both modes, including repeated selection', async ({ page }) => {
  const text = '# 시작\n\n' + '긴 본문입니다.\n\n'.repeat(70) + '## 목적지\n\n끝 본문\n';
  await load(page, text);
  const before = await snapshot(page);
  for (const mode of ['렌더링', '원문']) {
    await page.getByRole('tab', { name: mode, exact: true }).click();
    await page.locator('#host-filter').fill('목적지');
    await page.getByRole('treeitem').filter({ hasText: '목적지' }).click();
    if (mode === '렌더링') {
      await expect(page.locator('.ProseMirror h2')).toBeInViewport();
      await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('h2')?.textContent)).toBe('목적지');
      await page.locator('#editor-scroll').evaluate(el => el.scrollTop = 0);
      await page.getByRole('treeitem').filter({ hasText: '목적지' }).click();
      await expect(page.locator('.ProseMirror h2')).toBeInViewport();
    } else {
      await expect(page.locator('.cm-line').filter({ hasText: '## 목적지' })).toBeInViewport();
    }
    await expect(page.getByRole('treeitem').filter({ hasText: '목적지' })).toHaveAttribute('aria-selected', 'true');
  }
  expect(await snapshot(page)).toEqual(before);
});

test('first table boundary accepts Enter, text, and undo without changing table metadata', async ({ page }) => {
  const text = '<!-- folio:table:v1 widths=140,220 -->\n\n| 머리 | 둘째 |\n| :--- | ---: |\n| 본문 | 값 |\n';
  await load(page, text);
  const before = await snapshot(page);
  await page.locator('th p').first().click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.ProseMirror-gapcursor')).toHaveCSS('display', 'block');
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror > p').first()).toBeVisible();
  await page.keyboard.insertText('표 앞 한글');
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('표 앞 한글');
  expect((await snapshot(page)).text).toContain('widths=140,220');
  await expect(page.locator('th').first()).toHaveText('머리');
  await page.locator('#undo').click();
  await expect(page.locator('.ProseMirror > p').first()).toBeEmpty();
  await page.locator('#undo').click();
  expect(await snapshot(page)).toMatchObject({ text, dirty: false });
  await page.locator('#redo').click();
  await page.locator('#redo').click();
  await page.getByRole('tab', { name: '원문', exact: true }).click();
  await page.getByRole('tab', { name: '렌더링', exact: true }).click();
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('표 앞 한글');
  await expect(page.locator('table')).toHaveCount(1);
});

test('clicking above the first table creates a boundary cursor without editing', async ({ page }) => {
  await load(page, '| 머리 |\n| --- |\n| 본문 |\n');
  const before = await snapshot(page);
  await page.locator('.ProseMirror').click({ position: { x: 5, y: 3 } });
  await expect(page.locator('.ProseMirror-gapcursor')).toHaveCSS('display', 'block');
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('앞줄');
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('앞줄');
  await expect(page.locator('th')).toHaveText('머리');
});

test('font settings preview, cancel, save, reset and validate without editing the document', async ({ page }) => {
  await load(page, '# 한글 제목\n\n본문 글꼴\n\n| 표 |\n| --- |\n| 내용 |\n');
  const before = await snapshot(page);
  const settings = page.getByRole('button', { name: '설정 · Configuration', exact: true });
  const font = page.getByRole('combobox', { name: '한글 글꼴', exact: true });
  await settings.click();
  await font.fill('Batang');
  await expect(page.locator('.ProseMirror')).toHaveCSS('font-family', /Batang/);
  await expect(page.locator('.host-tree-row')).toHaveCSS('font-family', /Batang/);
  await expect(page.locator('#host-font-preview')).toHaveCSS('font-family', /Batang/);
  await page.screenshot({ path: '../artifacts/font-settings.png' });
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toHaveCSS('font-family', /Malgun Gothic/);
  await settings.click(); await font.fill('NanumGothic');
  await page.locator('.host-dialog').getByRole('button', { name: '저장', exact: true }).click();
  expect(await page.evaluate(() => (window as any).testHost.packets.filter((p: any) => p.type === 'hostPreferences' && p.save).at(-1).preferences.FontFamily)).toBe('NanumGothic');
  await settings.click(); await expect(font).toHaveValue('NanumGothic');
  await font.fill(''); await expect(page.locator('.host-dialog').getByRole('button', { name: '저장', exact: true })).toBeDisabled();
  await font.fill('invalid"font'); await expect(page.locator('.host-dialog').getByRole('button', { name: '저장', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '기본값', exact: true }).click();
  await expect(font).toHaveValue('Malgun Gothic');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ProseMirror')).toHaveCSS('font-family', /NanumGothic/);
  await page.getByRole('tab', { name: '원문', exact: true }).click();
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-family', /Consolas, NanumGothic/);
  await page.getByRole('tab', { name: '렌더링', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
});
