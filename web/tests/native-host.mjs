import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import net from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const payload = path.resolve(process.argv[2] ?? path.join(root, 'artifacts/Folio-0.2.2-native-win-x64'));
const profile = path.join(root, '.tools/native-qa', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(profile, { recursive: true });
await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ Language: 'ko' }));
const env = { ...process.env, FOLIO_DATA_DIRECTORY: profile };
let child, browser, page;
const tests = [];
tests.push = (...items) => { for (const item of items) console.log(`PASS ${item}`); return Array.prototype.push.apply(tests, items); };
async function waitFor(fn, message, timeout = 20000) { const until = Date.now() + timeout; while (Date.now() < until) { try { const result = await fn(); if (result) return result; } catch {} await new Promise(r => setTimeout(r, 150)); } throw new Error(message); }
async function launch() {
  // A killed WebView2 process may briefly keep its old debug endpoint alive.
  // Each launch gets a fresh port so recovery checks cannot attach to that process.
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const port = listener.address().port; await new Promise(r => listener.close(r));
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`;
  child = spawn(path.join(payload, 'Folio.exe'), [], { env, windowsHide: true, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 'WebView2 startup timeout', 45000);
  browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 }), 'WebView2 debug connection timeout');
  browser.contexts().forEach(context => context.setDefaultTimeout(15000));
  page = await waitFor(() => browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://folio.local')), 'No Folio page');
  await page.waitForFunction(() => window.folio && document.getElementById('native-shell'));
}
const packet = data => page.evaluate(data => window.chrome.webview.postMessage(data), data);
const state = () => page.evaluate(() => window.folio.snapshot());
async function cleanClose() { const exited = once(child, 'exit'); await packet({ type: 'command', name: 'close' }); let timer; try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Close timeout')), 15000); })]); } finally { clearTimeout(timer); } await browser.close().catch(() => {}); }
try {
  const doc = path.join(profile, '한글 공백.md');
  const original = Buffer.from('\ufeff# 호스트 검증\r\n\r\n본문 한글.\n\n## 하위 제목\r\n\n| 열 | 내용 |\n| --- | --- |\n| 값 | 표 |\n');
  await writeFile(doc, original);
  await launch();
  await packet({ type: 'command', name: 'openPath', path: doc });
  await waitFor(async () => (await state()).text.includes('# 호스트 검증'), 'Open failed');
  await page.getByRole('treeitem').filter({ hasText: '하위 제목' }).waitFor();
  await packet({ type: 'command', name: 'save' });
  await waitFor(async () => !(await state()).dirty, 'Save failed');
  assert.deepEqual(await readFile(doc), original); tests.push('UTF-8 BOM / mixed newline unchanged save');
  await page.getByRole('tab', { name: '원문', exact: true }).click(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n저장 검증');
  await packet({ type: 'command', name: 'save' });
  await waitFor(async () => (await readFile(doc, 'utf8')).includes('저장 검증') && !(await state()).dirty, 'Edited save failed'); tests.push('Editor snapshot / revision ACK / disk save');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n복구할 내용');
  await waitFor(async () => JSON.parse(await readFile(path.join(profile, 'recovery.json'), 'utf8')).Text.includes('복구할 내용'), 'Recovery write failed'); tests.push('Recovery snapshot persistence');
  await writeFile(doc, '# 외부 수정\n'); await packet({ type: 'command', name: 'save' });
  await page.getByRole('heading', { name: '외부에서 변경된 파일' }).waitFor(); await page.getByRole('button', { name: '취소', exact: true }).click();
  assert.equal(await readFile(doc, 'utf8'), '# 외부 수정\n'); assert.equal((await state()).dirty, true); tests.push('External conflict cancel preserves both versions');
  await packet({ type: 'command', name: 'save' }); await page.getByRole('button', { name: '덮어쓰기', exact: true }).click();
  await waitFor(async () => (await readFile(doc, 'utf8')).includes('복구할 내용') && !(await state()).dirty, 'Conflict overwrite failed');
  await page.getByRole('button', { name: '설정 · Configuration' }).click(); await page.locator('#host-body-spacing').fill('1.50'); await page.locator('#host-body-spacing').dispatchEvent('input');
  await page.getByRole('button', { name: '취소', exact: true }).click(); await waitFor(async () => (await page.locator('.ProseMirror').evaluate(e => getComputedStyle(e).lineHeight)) === '29.25px', 'Settings cancel failed');
  await page.getByRole('button', { name: '설정 · Configuration' }).click(); await page.locator('#host-body-spacing').fill('1.50'); await page.locator('#host-body-spacing').dispatchEvent('input'); await page.locator('.host-dialog').getByRole('button', { name: '저장', exact: true }).click();
  await waitFor(async () => JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8')).BodyLineHeight === 1.5, 'Settings save failed'); tests.push('Settings preview / cancel / persistence');
  await page.getByRole('tab', { name: '원문', exact: true }).click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n');
  await packet({ type: 'copyTable', text: '클립보드 검증\t두 번째 셀', html: '<table><tr><td>클립보드 검증</td><td>두 번째 셀</td></tr></table>' });
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('복사했습니다'));
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Control+v');
  await waitFor(async () => (await state()).text.includes('클립보드 검증\t두 번째 셀'), 'Native clipboard roundtrip failed'); tests.push('Windows Unicode / CF_HTML clipboard write and paste');
  await page.keyboard.insertText('\n\n');
  await page.evaluate(() => { const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='), c => c.charCodeAt(0)); const data = new DataTransfer(); data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' })); document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await waitFor(async () => (await state()).text.includes('![이미지](assets/'), 'Image paste import failed');
  await page.getByRole('tab', { name: '렌더링', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror img')].some(i => i.complete && i.naturalWidth === 1)); tests.push('Native image import / relative path / restricted resource serving');
  await packet({ type: 'command', name: 'save' }); await waitFor(async () => !(await state()).dirty, 'Image save failed');
  const other = path.join(profile, '전달 문서.md'); await writeFile(other, '# 전달 성공\n');
  const forwarded = spawn(path.join(payload, 'Folio.exe'), [other], { env, windowsHide: true, stdio: 'ignore' });
  assert.equal((await once(forwarded, 'exit'))[0], 0); await waitFor(async () => (await state()).text.startsWith('# 전달 성공'), 'Single instance forwarding failed'); tests.push('Same-user pipe / Korean path / single instance activation');
  await page.getByRole('button', { name: '최근 문서', exact: true }).click(); await page.getByRole('textbox', { name: '최근 문서 검색' }).fill('한글 공백'); await page.getByRole('option').dblclick(); await waitFor(async () => (await state()).text.includes('복구할 내용'), 'Recent open failed'); tests.push('Recent search / open / full path');
  await page.getByRole('tab', { name: '원문', exact: true }).click(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n재시작 복구');
  await waitFor(async () => JSON.parse(await readFile(path.join(profile, 'recovery.json'), 'utf8')).Text.includes('재시작 복구'), 'Recovery missing before crash');
  const exit = once(child, 'exit'); child.kill(); await exit; await browser.close().catch(() => {});
  await launch(); await page.getByRole('button', { name: '복구', exact: true }).click(); await waitFor(async () => (await state()).text.includes('재시작 복구') && (await state()).dirty, 'Recovery reopen failed'); tests.push('Crash recovery / compatible profile');
  await page.getByRole('tab', { name: '원문', exact: true }).click(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n```mermaid\ngraph TD\n A[시작] --> B[완료]\n```\n');
  await page.getByRole('tab', { name: '렌더링', exact: true }).click(); await page.locator('.mermaid-diagram').waitFor(); tests.push('Existing Mermaid retained in native WebView2');
  await page.screenshot({ path: path.join(profile, 'native-light.png') }); await packet({ type: 'command', name: 'theme' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); await page.screenshot({ path: path.join(profile, 'native-dark.png') });
  await packet({ type: 'command', name: 'save' }); await waitFor(async () => !(await state()).dirty, 'Final save failed'); await cleanClose();
  const report = { timestamp: new Date().toISOString(), passed: true, tests, profile, payload, limitations: ['Physical Windows IME / Excel / native file-picker interactions require manual verification.'] };
  await writeFile(path.join(profile, 'native-host-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(profile, 'failure.png') }).catch(() => {});
  console.error(error); console.error(`Artifacts: ${profile}`); process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {}); if (child && child.exitCode === null) child.kill();
}
