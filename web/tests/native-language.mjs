import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const payload = path.resolve(process.argv[2]);
const installed = process.argv.includes('--installed');
const koreanDefault = process.argv.includes('--korean-default');
const profile = path.resolve('.tools/native-language-qa', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(profile, { recursive: true });
if (!installed) await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ Language: 'en' }));
else assert.equal(await readFile(path.join(payload, 'install-language.txt'), 'utf8'), koreanDefault ? 'korean' : 'english');
let child, browser, page;
const tests = [];
const pass = message => { tests.push(message); console.log('PASS ' + message); };
async function waitFor(fn, label, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { const result = await fn(); if (result) return result; } catch {} await new Promise(r => setTimeout(r, 150)); }
  throw new Error(label);
}
async function launch() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(r => server.close(r));
  child = spawn(path.join(payload, 'Folio.exe'), [], { env: { ...process.env, FOLIO_DATA_DIRECTORY: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` }, windowsHide: true, stdio: 'ignore' });
  browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1200 }), 'Native startup failed');
  page = await waitFor(() => browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://folio.local')), 'No editor page');
  page.setDefaultTimeout(15000); await page.waitForFunction(() => window.folio && document.querySelector('#native-shell'));
}
const command = (name, extra = {}) => page.evaluate(packet => window.chrome.webview.postMessage(packet), { type: 'command', name, ...extra });
const state = () => page.evaluate(() => window.folio.snapshot());
async function close() { const exit = once(child, 'exit'); await command('close'); await exit; await browser.close(); }
try {
  await launch();
  const expected = koreanDefault ? 'ko' : 'en';
  assert.equal(await page.locator('html').getAttribute('lang'), expected);
  assert.ok((await state()).text.startsWith(koreanDefault ? '# 생각이 문서가 되는 곳' : '# Where thoughts become documents'));
  pass(installed ? `${expected} installer language initializes an existing app with no language preference` : 'English preference initializes menu and welcome document');
  if (!koreanDefault) {
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /[가-힣]/);
    const colors = await page.evaluate(() => ['.host-sidebar', '.host-sidebar footer', '#host-grip', '#editor-scroll'].map(s => getComputedStyle(document.querySelector(s)).backgroundColor));
    assert.deepEqual(colors, Array(4).fill('rgb(255, 255, 255)')); pass('English chrome and pure white outline / editor');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Example documents', exact: true }).click();
    await page.getByRole('button', { name: 'Tables and headings', exact: true }).click();
    await waitFor(async () => (await state()).text.includes('# Tables and headings'), 'English example not opened');
    assert.doesNotMatch((await state()).text, /[가-힣]/); pass('Example menu opens English files');
    await command('openPath', { path: path.join(profile, 'missing.md') });
    await page.getByRole('heading', { name: 'Could not complete the operation' }).waitFor();
    assert.doesNotMatch(await page.locator('.host-dialog').innerText(), /[가-힣]/);
    await page.getByRole('button', { name: 'OK', exact: true }).click(); pass('Native file errors are English');
    const doc = path.join(profile, '저장.md');
    const text = '# 저장\n\n열기 본문 원문 설정\n'; await writeFile(doc, text);
    await command('openPath', { path: doc }); await waitFor(async () => (await state()).text === text, 'Korean user document open failed');
    await page.getByRole('tab', { name: 'Source', exact: true }).click(); await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n보존할 변경');
    const before = await state();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#host-language').selectOption('ko'); await page.locator('.host-dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await waitFor(async () => JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8')).Language === 'ko', 'Language preference not saved');
    assert.deepEqual(await state(), before);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await waitFor(async () => JSON.parse(await readFile(path.join(profile, 'recovery.json'), 'utf8')).Text === before.text, 'Recovery not persisted');
    pass('Language setting preserves user content, dirty state and editor history');
    const exited = once(child, 'exit'); child.kill(); await exited; await browser.close();
    await launch(); await page.getByRole('button', { name: '복구', exact: true }).click();
    await waitFor(async () => (await state()).text === before.text, 'Localized recovery lost content');
    assert.equal(await page.locator('html').getAttribute('lang'), 'ko');
    await page.getByRole('button', { name: '설정 · Configuration', exact: true }).click();
    await page.locator('#host-language').selectOption('en'); await page.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8')).Language, 'ko');
    pass('Explicit app language overrides installer; restart recovery and settings cancellation preserve data');
    await command('save'); await waitFor(async () => !(await state()).dirty, 'Final save failed');
    assert.equal(await readFile(doc, 'utf8'), before.text);
  }
  await close();
  await writeFile(path.join(profile, 'results.json'), JSON.stringify({ passed: true, tests, payload, installed, profile }, null, 2));
  console.log(`Report: ${path.join(profile, 'results.json')}`);
} finally {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) child.kill();
}
