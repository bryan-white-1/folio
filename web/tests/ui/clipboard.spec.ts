import { test, expect, type Page } from '@playwright/test';

const table = '<!-- folio:table:v1 widths=140,220 -->\n\n| 이름 | 값 |\n| :--- | ---: |\n| 첫째 | **10** |\n| 둘째 | 20 |\n';
async function load(page: Page, text: string) {
  await page.evaluate(text => (window as any).folio.receive({ type: 'load', text, documentId: 'clipboard-test', name: '편집.md', dirty: false }), text);
}
const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
async function paste(page: Page, text: string, html = '') {
  await page.evaluate(({ text, html }) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    if (html) clipboardData.setData('text/html', html);
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, { text, html });
}
async function copy(page: Page, cut = false) {
  return page.evaluate(cut => {
    const clipboardData = new DataTransfer();
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent(cut ? 'cut' : 'copy', { clipboardData, bubbles: true, cancelable: true }));
    return { text: clipboardData.getData('text/plain'), html: clipboardData.getData('text/html') };
  }, cut);
}
async function selectTable(page: Page) {
  await page.keyboard.press('Shift+F10'); await page.locator('[data-action="select-table"]').click();
}

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });

test('Excel HTML without a header creates a table preserving cells, escaped syntax and line breaks after reload', async ({ page }) => {
  await load(page, '');
  await page.locator('.ProseMirror').click();
  await paste(page, '', '<html><body><!--StartFragment--><table><tr><td>이름</td><td>값</td></tr><tr><td><b>A &amp; B</b></td><td>00123</td></tr><tr><td>두<br>줄</td><td>=SUM(A1:B2)</td></tr></table><!--EndFragment--></body></html>');
  await expect(page.locator('th')).toHaveText(['이름', '값']);
  await expect(page.locator('td')).toHaveText(['A & B', '00123', '두줄', '=SUM(A1:B2)']);
  await expect(page.locator('td strong')).toHaveText('A & B');
  await expect(page.locator('td br')).toHaveCount(1);
  const after = await snapshot(page); expect(after.dirty).toBe(true);
  await load(page, after.text); await expect(page.locator('tr')).toHaveCount(3); await expect(page.locator('td br')).toHaveCount(1);
});

test('Excel TSV extends an existing table at its current cell, preserving other cells and column formatting', async ({ page }) => {
  await load(page, table); await page.locator('td').last().click();
  await paste(page, '가\t나\t\r\n"여러\n줄"\t"a""b"\t끝\r\n');
  await expect(page.locator('tr')).toHaveCount(4); await expect(page.locator('th')).toHaveCount(4);
  await expect(page.locator('tr').nth(1).locator('td')).toHaveText(['첫째', '10', '', '']);
  await expect(page.locator('tr').nth(2).locator('td')).toHaveText(['둘째', '가', '나', '']);
  await expect(page.locator('tr').nth(3).locator('td')).toHaveText(['', '여러줄', 'a"b', '끝']);
  await expect(page.locator('tr').nth(3).locator('td').nth(1)).toHaveCSS('text-align', 'right');
  expect((await snapshot(page)).text).toContain('widths=140,220,0,0');
  const after = await snapshot(page);
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(table);
  await page.locator('#redo').click(); expect((await snapshot(page)).text).toBe(after.text);
});

test('header-inclusive copy pastes into empty space and another table without missing or duplicate rows', async ({ page }) => {
  await load(page, table); await page.locator('th').first().click(); await selectTable(page);
  const before = await snapshot(page), copied = await copy(page);
  expect(await snapshot(page)).toEqual(before); expect(copied.text).toBe('이름\t값\r\n첫째\t10\r\n둘째\t20');
  expect(copied.html).toContain('<th');
  await load(page, ''); await page.locator('.ProseMirror').click(); await paste(page, copied.text, copied.html);
  await expect(page.locator('th')).toHaveText(['이름', '값']); await expect(page.locator('td')).toHaveText(['첫째', '10', '둘째', '20']);
  await expect(page.locator('td strong')).toHaveText('10'); expect((await snapshot(page)).text).toContain('widths=140,220');
  await load(page, '| 기존 | 머리 |\n| --- | --- |\n| 이전 | 내용 |\n'); await page.locator('td').first().click();
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await paste(page, copied.text, copied.html);
  await expect(page.locator('th')).toHaveText(['기존', '머리']);
  await expect(page.locator('td')).toHaveText(['이름', '값', '첫째', '10', '둘째', '20']);
  await expect(page.locator('.ProseMirror table')).toHaveCount(1);
  const pasted = await snapshot(page); await load(page, pasted.text); await expect(page.locator('tr')).toHaveCount(4);
});

test('header-only and body-only copies form valid standalone GFM tables; cut clears contents and can undo', async ({ page }) => {
  await load(page, table); await page.locator('th').first().click();
  await page.keyboard.press('Shift+F10'); await page.locator('[data-action="select-row"]').click();
  const header = await copy(page);
  await load(page, ''); await paste(page, header.text, header.html);
  await expect(page.locator('th')).toHaveText(['이름', '값']); await expect(page.locator('tr')).toHaveCount(2);
  const headerOnly = await snapshot(page); await load(page, headerOnly.text); await expect(page.locator('th')).toHaveText(['이름', '값']);
  await load(page, table); await page.locator('td').first().click();
  await page.keyboard.press('Shift+F10'); await page.locator('[data-action="select-row"]').click();
  const body = await copy(page, true);
  await expect(page.locator('td')).toHaveText(['', '', '둘째', '20']); expect((await snapshot(page)).text).toContain('widths=140,220');
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(table);
  await load(page, ''); await paste(page, body.text, body.html); await expect(page.locator('th')).toHaveText(['첫째', '10']);
  await expect(page.locator('tr')).toHaveCount(2);
});

test('one-column and scalar paste fill the chosen table area', async ({ page }) => {
  await load(page, table); await page.locator('td').first().click(); await expect(page.locator('.ProseMirror')).toBeFocused(); await paste(page, 'A\r\nB\r\n');
  await expect(page.locator('td')).toHaveText(['A', '10', 'B', '20']);
  await selectTable(page); await paste(page, '공통');
  await expect(page.locator('th')).toHaveText(['공통', '공통']); await expect(page.locator('td')).toHaveText(['공통', '공통', '공통', '공통']);
});

test('ordinary prose and code pastes remain text; oversized table paste is rejected without a mutation', async ({ page }) => {
  await load(page, ''); await paste(page, '첫 문단\n둘째 문단'); await expect(page.locator('table')).toHaveCount(0);
  await load(page, '```\n코드\n```\n'); await page.locator('.ProseMirror pre').click(); await paste(page, 'A\tB\nC\tD');
  await expect(page.locator('table')).toHaveCount(0); await expect(page.locator('pre')).toContainText('A\tB');
  await load(page, table); await page.locator('td').first().click(); const before = await snapshot(page);
  await paste(page, Array(257).fill('x').join('\t')); expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#toast')).toContainText('최대 256열');
});

test('merged Excel cells flatten to a rectangle and clipboard HTML cannot execute', async ({ page }) => {
  await load(page, ''); await paste(page, '', '<table><tr><td colspan="2">합계</td></tr><tr><td rowspan="2">묶음</td><td>1</td></tr><tr><td>2<script>window.clipboardXss=true</script><img src="https://example.invalid/x" onerror="window.clipboardXss=true"></td></tr></table>');
  await expect(page.locator('th')).toHaveText(['합계', '']); await expect(page.locator('td')).toHaveText(['묶음', '1', '', '2']);
  expect(await page.evaluate(() => (window as any).clipboardXss)).toBeUndefined();
});

test('code button toggles literal multiline code to body and supports shared undo', async ({ page }) => {
  const text = '```js\n# literal\n\nconst a = "**text**";\n```\n';
  await load(page, text); await page.locator('pre').click();
  await expect(page.locator('[data-command="code"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-command="code"]').click(); await expect(page.locator('pre')).toHaveCount(0);
  await expect(page.locator('.ProseMirror')).toContainText('# literal'); await expect(page.locator('.ProseMirror')).toContainText('const a = "**text**";');
  await expect(page.locator('.ProseMirror h1, .ProseMirror strong')).toHaveCount(0);
  const plain = await snapshot(page); await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe(text);
  await page.locator('#redo').click(); expect((await snapshot(page)).text).toBe(plain.text);
  await load(page, plain.text); await expect(page.locator('pre')).toHaveCount(0);
});

test('source code removal handles selected fences and nested code; shortcut applies and removes code', async ({ page }) => {
  await load(page, '> ```js\n> # literal\n> **value**\n> ```\n\n뒷문단\n');
  await page.getByRole('tab', { name: '원문', exact: true }).click(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.locator('[data-command="code"]').click();
  expect((await snapshot(page)).text).not.toContain('```');
  await page.getByRole('tab', { name: '렌더링', exact: true }).click();
  await expect(page.locator('blockquote')).toContainText('# literal'); await expect(page.locator('blockquote')).toContainText('**value**');
  await expect(page.locator('blockquote h1, blockquote strong')).toHaveCount(0);
  await load(page, '본문\n'); await page.locator('.ProseMirror p').click(); await page.keyboard.press('Control+Alt+c'); await expect(page.locator('pre')).toHaveText('본문');
  await page.keyboard.press('Control+Alt+c'); await expect(page.locator('pre')).toHaveCount(0); await expect(page.locator('.ProseMirror p')).toHaveText('본문');
});

test('image toolbar sends the native picker command and returned image inserts at the saved cursor with its own undo', async ({ page }) => {
  await page.addInitScript(() => { (window as any).packets = []; (window as any).chrome = { webview: { postMessage: (packet: any) => (window as any).packets.push(packet), addEventListener: () => {} } }; });
  await page.reload(); await page.waitForFunction(() => !!(window as any).folio);
  await load(page, '앞뒤\n'); await page.locator('.ProseMirror p').click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '이미지 삽입', exact: true }).click();
  expect(await page.evaluate(() => (window as any).packets.at(-1))).toMatchObject({ type: 'command', name: 'image', documentId: 'clipboard-test' });
  await page.evaluate(() => (window as any).folio.receive({ type: 'insertImages', requestId: (window as any).packets.at(-1).requestId, documentId: 'clipboard-test', paths: ['assets/test.png'] }));
  expect((await snapshot(page)).text).toContain('앞![이미지](assets/test.png)뒤');
  await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe('앞뒤\n');
});

test('image files and screenshot paste use the host store, retain the cursor, and undo as one action in both modes', async ({ page }) => {
  await page.addInitScript(() => { (window as any).packets = []; (window as any).chrome = { webview: { postMessage: (packet: any) => (window as any).packets.push(packet), addEventListener: () => {} } }; });
  await page.reload(); await page.waitForFunction(() => !!(window as any).folio);
  await page.route('https://document.local/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQifb4DwADFQG/3OBqxQAAAABJRU5ErkJggg==', 'base64') }));
  for (const source of [false, true]) {
    await load(page, '앞뒤\n');
    await page.getByRole('tab', { name: source ? '원문' : '렌더링', exact: true }).click();
    await page.locator(source ? '.cm-content' : '.ProseMirror p').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowRight');
    await page.evaluate(source => {
      const data = new DataTransfer();
      data.items.add(new File(['file-image'], '잘라낸 파일.png', { type: 'image/png' }));
      data.items.add(new File(['screenshot-image'], 'image.png', { type: 'image/png' }));
      document.querySelector(source ? '.cm-content' : '.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, source);
    await expect.poll(() => page.evaluate(() => (window as any).packets.filter((p: any) => p.type === 'importImages').length)).toBe(source ? 2 : 1);
    expect((await snapshot(page)).text).toBe('앞뒤\n');
    const request = await page.evaluate(() => (window as any).packets.findLast((p: any) => p.type === 'importImages'));
    expect(request.images).toEqual([Buffer.from('file-image').toString('base64'), Buffer.from('screenshot-image').toString('base64')]);
    await page.evaluate(requestId => (window as any).folio.receive({ type: 'insertImages', requestId, documentId: 'clipboard-test', paths: ['assets/file.png', 'assets/screen.png'] }), request.requestId);
    expect((await snapshot(page)).text).toContain('앞![이미지](assets/file.png)');
    expect((await snapshot(page)).text).toContain('![이미지](assets/screen.png)뒤');
    await page.getByRole('tab', { name: '렌더링', exact: true }).click();
    await expect(page.locator('.ProseMirror img')).toHaveCount(2);
    await expect(page.locator('.ProseMirror img').first()).toHaveJSProperty('naturalWidth', 1);
    await page.locator('#undo').click(); expect((await snapshot(page)).text).toBe('앞뒤\n');
    await page.locator('#redo').click(); await expect(page.locator('.ProseMirror img')).toHaveCount(2);
  }
});

test('image cancellation, rejected files and late replies leave the document unchanged', async ({ page }) => {
  await page.addInitScript(() => { (window as any).packets = []; (window as any).chrome = { webview: { postMessage: (packet: any) => (window as any).packets.push(packet), addEventListener: () => {} } }; });
  await page.reload(); await page.waitForFunction(() => !!(window as any).folio);
  await load(page, '본문\n'); await page.locator('.ProseMirror p').click(); const before = await snapshot(page);
  await page.getByRole('button', { name: '이미지 삽입', exact: true }).click();
  await page.evaluate(() => (window as any).folio.receive({ type: 'insertImages', requestId: (window as any).packets.at(-1).requestId, documentId: 'clipboard-test', paths: [] }));
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(['not-image'], 'file.exe'));
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#toast')).toContainText('이미지 파일'); expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: '이미지 삽입', exact: true }).click();
  const requestId = await page.evaluate(() => (window as any).packets.at(-1).requestId);
  await load(page, '다른 문서\n');
  await page.evaluate(requestId => (window as any).folio.receive({ type: 'insertImages', requestId, documentId: 'clipboard-test', paths: ['assets/late.png'] }), requestId);
  expect((await snapshot(page)).text).toBe('다른 문서\n'); await expect(page.locator('.ProseMirror img')).toHaveCount(0);
});

test('native Ctrl+V forwards a real clipboard PNG to image storage', async ({ page, context }) => {
  await page.addInitScript(() => { (window as any).packets = []; (window as any).chrome = { webview: { postMessage: (packet: any) => (window as any).packets.push(packet), addEventListener: () => {} } }; });
  await page.reload(); await page.waitForFunction(() => !!(window as any).folio);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    const items = (await navigator.clipboard.read()).filter(item => item.types.length > 0);
    (window as any).imageClipboardRestore = await Promise.all(items.map(async item => Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))));
  });
  try {
    await page.evaluate(async () => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQifb4DwADFQG/3OBqxQAAAABJRU5ErkJggg=='), char => char.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    });
    await load(page, ''); await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+v');
    await expect.poll(() => page.evaluate(() => (window as any).packets.filter((p: any) => p.type === 'importImages').length)).toBe(1);
    const images = await page.evaluate(() => (window as any).packets.find((p: any) => p.type === 'importImages').images);
    expect(Buffer.from(images[0], 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect((await snapshot(page)).text).toBe('');
  } finally {
    await page.evaluate(async () => {
      const saved = (window as any).imageClipboardRestore;
      if (saved.length) await navigator.clipboard.write(saved.map((data: any) => new ClipboardItem(data)));
      else await navigator.clipboard.writeText('');
    });
  }
});

test('native Ctrl+C, context Copy and Ctrl+V round-trip a selected table through the browser clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const previous = await page.evaluate(async () => {
    const items = (await navigator.clipboard.read()).filter(item => item.types.length > 0);
    (window as any).clipboardRestore = await Promise.all(items.map(async item => Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))));
    return items.length;
  });
  try {
    await load(page, table); await page.locator('th').first().click(); await selectTable(page); await page.keyboard.press('Control+c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('이름\t값');
    await page.keyboard.press('Shift+F10'); await page.locator('[data-action=copy]').click();
    await expect(page.locator('#toast')).toContainText('선택한 셀을 복사했습니다');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('이름\t값');
    await load(page, ''); await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+v');
    await expect(page.locator('th')).toHaveText(['이름', '값']); await expect(page.locator('td')).toHaveText(['첫째', '10', '둘째', '20']);
    await page.screenshot({ path: '../artifacts/clipboard-editing-light.png', fullPage: true });
    await page.evaluate(() => (window as any).folio.receive({ type: 'theme', value: 'dark' }));
    await page.screenshot({ path: '../artifacts/clipboard-editing-dark.png', fullPage: true });
  } finally {
    await page.evaluate(async previous => {
      if (previous) await navigator.clipboard.write((window as any).clipboardRestore.map((data: any) => new ClipboardItem(data)));
      else await navigator.clipboard.writeText('');
    }, previous);
  }
});
