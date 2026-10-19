import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import net from 'node:net';

// Run against either Native or Legacy, always with a disposable profile/document.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.ok(process.argv[2], 'Usage: node tests/host-refresh.mjs <app-directory>');
const payload = path.resolve(process.argv[2]);
const profile = path.join(root, '.tools/refresh-qa', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(profile, { recursive: true });
await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ Language: 'ko' }));
const documentPath = path.join(profile, '새로고침 검증.md');
const original = '# 새로고침 검증\n\n보존할 본문\n';
await writeFile(documentPath, original);
let child, browser, page;
const tests = [];
async function waitFor(fn, message, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await fn()) return; } catch {}
    await delay(100);
  }
  throw new Error(message);
}
async function launch() {
  const listener = net.createServer(); listener.listen(0, '127.0.0.1');
  await once(listener, 'listening'); const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  child = spawn(path.join(payload, 'Folio.exe'), [documentPath], {
    env: { ...process.env, FOLIO_DATA_DIRECTORY: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
    windowsHide: true, stdio: 'ignore',
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 'Startup timeout', 45000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await waitFor(() => {
    page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().startsWith('https://folio.local'));
    return page;
  }, 'No editor page');
  page.setDefaultTimeout(10000);
  await waitFor(async () => (await state()).text === original, 'Initial file did not open');
}
const state = () => page.evaluate(() => window.folio.snapshot());
const command = name => page.evaluate(name => window.chrome.webview.postMessage({ type: 'command', name }), name);
async function verifyRefresh(label) {
  const before = await state();
  const session = await page.evaluate(() => window.refreshSession ??= crypto.randomUUID());
  for (const key of ['F5', 'Control+r', 'Shift+F5', 'Control+Shift+r']) {
    await page.keyboard.press(key); await delay(300);
    assert.equal(await page.evaluate(() => window.refreshSession), session, `${label}: ${key} replaced editor`);
    assert.deepEqual(await state(), before, `${label}: ${key} changed document`);
  }
  // Exercise the host navigation gate independently of keyboard handling.
  await page.reload({ waitUntil: 'commit', timeout: 5000 }).catch(error => {
    assert.match(error.message, /ERR_ABORTED/, 'Unexpected reload failure');
  });
  assert.equal(await page.evaluate(() => window.refreshSession), session, `${label}: reload replaced editor`);
  assert.deepEqual(await state(), before, `${label}: reload changed document`);
  tests.push(label); console.log(`PASS ${label}`);
}
async function close() {
  const exited = once(child, 'exit');
  await command('close');
  let timer;
  try {
    const [code] = await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Close timeout after refresh')), 8000);
    })]);
    assert.equal(code, 0);
  } finally { clearTimeout(timer); }
  await browser.close().catch(() => {}); browser = undefined;
}
try {
  await launch();
  await page.locator('.ProseMirror').click();
  await verifyRefresh('Saved file: rendered view, reload shortcuts and host reload preserve session');
  await close(); tests.push('Saved file closes normally after refresh');
  await launch();
  await page.locator('#source-mode').click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n미저장 편집');
  const edited = await state(); assert.equal(edited.dirty, true);
  await verifyRefresh('Unsaved edit: source view, reload shortcuts and host reload preserve session');
  await page.keyboard.press('Control+z');
  await waitFor(async () => (await state()).text === original, 'Undo history lost');
  await page.keyboard.press('Control+y');
  await waitFor(async () => (await state()).text === edited.text, 'Redo history lost');
  tests.push('Undo/Redo survive refresh');
  await page.locator('#rendered-mode').click(); await page.locator('.ProseMirror').click();
  await verifyRefresh('Unsaved edit: rendered view preserves document and dirty state');
  await command('save');
  await waitFor(async () => !(await state()).dirty, 'Save ACK timeout after refresh');
  assert.equal(await readFile(documentPath, 'utf8'), edited.text);
  await close(); tests.push('Unsaved edit saves to the same file and closes normally');
  const report = { timestamp: new Date().toISOString(), passed: true, payload, profile, tests };
  await writeFile(path.join(profile, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(profile, 'failure.png') }).catch(() => {});
  console.error(error); console.error(`Artifacts: ${profile}`); process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) child.kill();
}
