import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import net from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const payload = path.resolve(process.argv[2] ?? path.join(root, 'artifacts/Folio-0.2.2-native-win-x64'));
const profile = path.join(root, '.tools/workspace-qa', new Date().toISOString().replaceAll(/[:.]/g, '-'));
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
  const project = path.join(profile, 'project'); await mkdir(path.join(project,'src'), {recursive:true}); await mkdir(path.join(project,'node_modules'), {recursive:true});
  const md = path.join(project, 'README.md'), py = path.join(project,'src','main.py'), json = path.join(project,'data.json');
  await writeFile(md, '# Project\n\nProject notes\n\n| Source |\n| --- |\n| [greet](../project/src/main.py#L2) |\n'); await writeFile(py, '\ufeffdef greet():\r\n    return "hello"\n# end'); await writeFile(json, '{"count":1}\n');
  await launch();
  await page.evaluate(() => { window.chrome.webview.addEventListener('message', e => { if(e.data.type==='hostState') window.testHostState=e.data; }); });
  const host = () => page.evaluate(() => window.testHostState);
  const open = async p => { await packet({type:'command',name:'openPath',path:p}); await waitFor(async () => (await host())?.path.toLowerCase()===p.toLowerCase() && (await state()).documentId===(await host()).documentId, 'Open '+p); };
  const activate = async id => { await packet({type:'command',name:'activateTab',path:id}); await waitFor(async () => (await state()).documentId===id,'Activate tab'); };
  const edit = async value => { if((await state()).kind==='markdown') await page.locator('#source-mode').click(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(value); };
  const payloadFile = path.join(project, 'payload.json');
  const longLine = JSON.stringify({rows: Array(32000).fill({name:'choice', options:[1, 2, 3], selected:false})});
  await writeFile(payloadFile, longLine);
  await open(payloadFile); const payloadId = (await state()).documentId;
  await open(py); const verifyId = (await state()).documentId;
  assert.equal((await state()).language, 'python');
  await activate(payloadId); assert.equal((await state()).text, longLine);
  await activate(verifyId); assert.equal((await state()).language, 'python');
  await packet({type:'command', name:'closeTab', path:verifyId});
  await waitFor(async () => (await state()).documentId === payloadId, 'Close Python tab');
  await open(md); const mdId=(await state()).documentId;
  await packet({type:'command', name:'closeTab', path:payloadId});
  await waitFor(async () => (await host()).tabs.length === 1 && (await state()).documentId === mdId, 'Continue opening and closing after long JSON');
  tests.push('Switch from a large single-line JSON file to Python and resume both tabs');
  for (let visit = 0; visit < 2; visit++) {
    await page.getByRole('link', {name:'greet'}).click();
    await waitFor(async () => (await host()).path === py && await page.evaluate(() =>
      document.getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent.includes('return')), 'Follow table link to line 2');
    assert.equal((await host()).tabs.length, 2);
    if (!visit) await activate(mdId);
  }
  await packet({type:'command',name:'closeTab',path:(await state()).documentId});
  await waitFor(async () => (await state()).documentId === mdId, 'Return to linked document');
  tests.push('Click a relative table link to open and reuse a source tab at the specified line');
  const tabNames = ['SelectControl.tsx', 'SourcingPolicyGuidelineEditor.tsx', 'a.ts', 'SourcingTypeEditor.tsx', 'SpendAllocationEvidence.tsx', 'b.ts', 'c.ts'];
  for (const name of tabNames) {
    const file = path.join(project, name); await writeFile(file, 'export {}'); await open(file);
  }
  const rows = page.locator('.document-tab');
  const tabBar = await page.locator('.document-tabs').boundingBox();
  const sidebarBar = await page.locator('.sidebar-chooser').boundingBox();
  assert(Math.abs(tabBar.height - 30) < 0.1);
  assert(Math.abs(sidebarBar.height - tabBar.height) < 0.1 && Math.abs(sidebarBar.y - tabBar.y) < 0.1);
  const widths = await rows.evaluateAll(items => items.map(item => item.getBoundingClientRect().width));
  assert(widths.every(width => Math.abs(width - 164) < 0.1), `Tab widths: ${widths}`);
  const filename = name => rows.locator('.tab-name').filter({hasText:name});
  assert(await filename(tabNames[0]).evaluate(el => el.scrollWidth <= el.clientWidth));
  const long = filename(tabNames[1]);
  assert(await long.evaluate(el => el.scrollWidth > el.clientWidth));
  const tooltip = await long.evaluate(el => el.closest('[title]').title);
  assert.equal(tooltip, tabNames[1] + '\n' + path.join(project, tabNames[1]));
  const strip = page.locator('.tab-items');
  assert(await strip.evaluate(el => el.scrollWidth > el.clientWidth));
  const activeId = (await state()).documentId;
  const prev = page.getByRole('button', {name:'이전 탭'});
  await prev.click(); await prev.click();
  assert.equal((await state()).documentId, activeId);
  assert.equal(await page.locator(':focus .tab-name').textContent(), 'SpendAllocationEvidence.tsx');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await host()).name === 'SpendAllocationEvidence.tsx', 'Activate focused tab');
  await page.getByRole('button', {name:'열린 파일 목록'}).click();
  await page.getByRole('menuitemradio', {name:'README.md'}).click();
  await waitFor(async () => (await state()).documentId === mdId, 'Choose file from menu');
  await strip.evaluate(el => { el.scrollLeft = 0; });
  const box = await rows.nth(1).locator('.tab-close').boundingBox();
  for (const name of tabNames) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitFor(async () => !(await host()).tabs.some(tab => tab.name === name), 'Close at the same position: ' + name);
  }
  await waitFor(async () => (await state()).documentId === mdId, 'Return to Markdown');
  tests.push('Equal-width tabs, full filename and path tooltip, overflow and consecutive closes at a fixed pointer position');
  const svgFile = path.join(project, '그림 #1.SVG');
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="900"><rect width="100%" height="100%" fill="teal"/></svg>';
  const raster = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 12;
    return ['image/png', 'image/jpeg'].map(type => canvas.toDataURL(type).split(',')[1]);
  });
  const images = [
    [svgFile, Buffer.from(svgText), 2000],
    [path.join(project, 'snapshot.PNG'), Buffer.from(raster[0], 'base64'), 24],
    ...['jpg','jpeg','jfif'].map(ext => [path.join(project, 'photo.' + ext), Buffer.from(raster[1], 'base64'), 24]),
    [path.join(project, 'animated.gif'), Buffer.from('R0lGODlhEAAQAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAIwAAACwAAAAAEAAQAAAIHQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFgQEBACH5BAEjAAEALAAAAAAQABAAgQAA/wAAAAAAAAAAAAgdAAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWBAQEAOw==','base64'), 16],
    [path.join(project, 'animated.webp'), Buffer.from('UklGRoQAAABXRUJQVlA4WAoAAAACAAAADwAADwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAA8AAA8AAF4BAAJWUDhMDwAAAC8PwAMABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAA8AAA8AAF4BAABWUDhMDwAAAC8PwAMABxDR//4HIqL/AQA=','base64'), 16],
  ];
  for (const [file, bytes, width] of images) {
    await writeFile(file, bytes);
    if (file === svgFile) {
      await packet({type:'command', name:'openFolderPath', path:project});
      await page.locator('.folder-actions button[data-folder=refresh]').click();
      await page.locator('.folder-tree').getByText(path.basename(file), {exact:true}).dblclick();
    } else await open(file);
    const img = page.locator('#image-preview img');
    await waitFor(async () => (await state()).kind === 'image' && await img.evaluate(el => el.naturalWidth) === width, 'Decode ' + path.extname(file));
    assert(await page.locator('[data-host-command=save]').isDisabled());
    assert(!(await page.locator('#editor-scroll').isVisible()));
    if (file === svgFile) {
      const fittedWidth = (await img.boundingBox()).width;
      assert(fittedWidth < width);
      await page.locator('#image-zoom-in').click();
      assert((await img.boundingBox()).width > fittedWidth);
      await page.locator('#image-original').click();
      assert.equal(Math.round((await img.boundingBox()).width), width);
      await page.locator('#image-zoom-in').click();
      assert.equal(Math.round((await img.boundingBox()).width), width * 1.25);
      const zoom = page.getByRole('textbox', {name:'확대율'});
      await zoom.fill('137.5%'); await zoom.press('Enter');
      assert.equal(Math.round((await img.boundingBox()).width), width * 1.375);
      await zoom.fill('401'); await zoom.press('Enter');
      assert(await zoom.evaluate(input => !input.validity.valid));
      await zoom.press('Escape'); assert.equal(await zoom.inputValue(), '137.5%');
      await zoom.fill('112.5'); await zoom.press('Tab');
      assert.equal(Math.round((await img.boundingBox()).width), width * 1.125);
      await activate(mdId); assert.equal((await state()).kind, 'markdown');
      await open(file);
      await waitFor(async () => (await zoom.inputValue()) === '112.5%', 'Restore custom image zoom');
      await img.hover();
      await page.keyboard.down('Control'); await page.mouse.wheel(0, 100); await page.keyboard.up('Control');
      await waitFor(async () => (await zoom.inputValue()) === '100%', 'Ctrl+wheel zoom out');
      await page.locator('#image-zoom-out').click();
      assert.equal(Math.round((await img.boundingBox()).width), width * 0.75);
      await page.locator('#image-fit').click();
      assert(Math.abs((await img.boundingBox()).width - fittedWidth) < 1);
    }
    if (width === 16) {
      const frame = await img.screenshot({animations:'allow'});
      await waitFor(async () => !frame.equals(await img.screenshot({animations:'allow'})), 'Animation advances: ' + path.extname(file));
    }
    await packet({type:'command',name:'save'});
    assert.deepEqual(await readFile(file), bytes);
    await packet({type:'command',name:'closeTab'});
    await waitFor(async () => (await state()).documentId === mdId, 'Close image tab');
  }
  tests.push('Read-only PNG, JPEG aliases, animated GIF/WebP and SVG open from the tree and switch between fit and 100%');
  await edit('\nunsaved markdown');
  await open(py); const pyId=(await state()).documentId;
  assert.equal((await state()).kind,'text'); assert.equal((await state()).language,'python'); await edit('!');
  await open(json); const jsonId=(await state()).documentId; assert.equal((await host()).tabs.length,3); assert.equal((await state()).language,'json');
  await open(py.toUpperCase()); assert.equal((await state()).documentId,pyId); assert.equal((await host()).tabs.length,3);
  assert.equal((await state()).text,'def greet():\r\n    return "hello"\n# end!');
  await page.keyboard.press('Control+z'); assert.equal((await state()).dirty,false); await page.keyboard.press('Control+y'); assert.equal((await state()).dirty,true);
  await packet({type:'command',name:'save'}); await waitFor(async()=>!(await state()).dirty,'Text save');
  assert.equal(await readFile(py,'utf8'),'\ufeffdef greet():\r\n    return "hello"\n# end!');
  tests.push('Mixed Markdown/Text tabs, automatic language, case-insensitive deduplication, isolated undo, byte-preserving Text save');
  await packet({type:'command',name:'openFolderPath',path:project});
  await page.locator('.folder-tree [data-path]').first().waitFor();
  assert.equal(await page.locator('.folder-tree').getByText('node_modules',{exact:true}).count(),0);
  await page.locator('.folder-excluded input').check(); await page.locator('.folder-tree').getByText('node_modules',{exact:true}).waitFor();
  await page.locator('.folder-tree').getByText('src',{exact:true}).dblclick(); await page.locator('.folder-tree').getByText('main.py',{exact:true}).waitFor();
  await page.locator('.folder-tree').getByText('data.json',{exact:true}).dblclick(); await waitFor(async()=>(await state()).documentId===jsonId,'Tree opens existing tab');
  tests.push('Lazy folder expansion, exclusion toggle, file opening from tree');
  await activate(mdId); assert((await state()).text.includes('unsaved markdown'));
  await packet({type:'command',name:'closeTab',path:mdId}); await page.getByRole('button',{name:'취소',exact:true}).click(); assert.equal((await host()).tabs.length,3); assert((await state()).dirty);
  await packet({type:'command',name:'saveAll'}); await waitFor(async()=>(await host()).tabs.every(t=>!t.dirty),'Save all'); assert((await readFile(md,'utf8')).includes('unsaved markdown'));
  tests.push('Dirty close cancellation and save all');
  await activate(pyId); await edit('\nlocal edit'); await activate(jsonId); await writeFile(py,'external change\n');
  await waitFor(async()=>(await host()).tabs.find(t=>t.id===pyId).external,'Inactive external change',10000);
  const notice = page.locator('.external-notice');
  assert.equal(await notice.isVisible(), false);
  await activate(pyId);
  await notice.getByRole('button', {name:'계속 편집'}).click();
  await activate(jsonId); await activate(pyId);
  assert.equal(await notice.isVisible(), false);
  await packet({type:'command',name:'save'}); await page.getByRole('button',{name:'취소',exact:true}).click(); assert((await state()).dirty); assert.equal(await readFile(py,'utf8'),'external change\n');
  await packet({type:'command',name:'save'}); await page.getByRole('button',{name:'덮어쓰기',exact:true}).click(); await waitFor(async()=>!(await state()).dirty,'Overwrite');
  tests.push('Inactive tab external-change detection and conflict cancellation/explicit overwrite');
  await writeFile(py, 'first disk version\n');
  const reload = notice.getByRole('button', {name:'다시 읽기', exact:true});
  await reload.waitFor();
  const version = (await host()).tabs.find(t => t.id === pyId).externalVersion;
  await writeFile(py, 'latest disk version\n');
  await waitFor(async () => (await host()).tabs.find(t => t.id === pyId).externalVersion !== version, 'Repeated external change');
  assert.equal(await notice.count(), 1);
  await reload.click();
  await waitFor(async () => !(await notice.isVisible()) && (await state()).text === 'latest disk version\n', 'Clean reload');
  await edit('local change');
  await writeFile(py, 'replacement\n');
  await notice.getByRole('button', {name:'내 변경을 버리고 다시 읽기'}).click();
  await waitFor(async () => !(await notice.isVisible()) && !(await state()).dirty && (await state()).text === 'replacement\n', 'Discard edits and reload');
  await unlink(py);
  await notice.getByRole('button', {name:'다른 이름으로 저장'}).waitFor();
  assert.equal((await state()).text, 'replacement\n');
  await writeFile(py, 'replacement\n');
  await notice.waitFor({state:'hidden'});
  tests.push('Active-tab reload, repeated writes, explicit discard and delete/restore at the original contents');
  const binary=path.join(project,'binary.dat'); await writeFile(binary,Buffer.from([0,1,2,3]));
  await packet({type:'command',name:'openPath',path:binary}); await page.getByRole('button',{name:'확인',exact:true}).click(); assert.equal((await state()).documentId,pyId); assert.equal((await host()).tabs.length,3);
  tests.push('Binary open failure preserves active tab');
  await edit('\nrecover Python'); await activate(mdId); await edit('\nrecover Markdown');
  await waitFor(async()=>JSON.parse(await readFile(path.join(profile,'recovery.json'),'utf8')).Documents.length===2,'Multi-document recovery snapshot');
  await page.screenshot({path:path.join(profile,'workspace-markdown.png')}); await activate(pyId); await page.screenshot({path:path.join(profile,'workspace-text.png')});
  await packet({type:'command',name:'theme'}); await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'); await page.screenshot({path:path.join(profile,'workspace-dark.png')});
  const crashed=once(child,'exit');child.kill();await crashed;await browser.close().catch(()=>{});
  await launch(); await page.getByRole('button',{name:'복구',exact:true}).click();
  await waitFor(async()=>(await state()).dirty && (await state()).text.includes('recover'),'Recovery reopen');
  assert.equal(await page.locator('.document-tab').count(),2);
  await page.locator('.tab-select').filter({hasText:'README.md'}).click(); await waitFor(async()=>(await state()).text.includes('recover Markdown'),'Recover Markdown');
  await page.locator('.tab-select').filter({hasText:'main.py'}).click(); await waitFor(async()=>(await state()).text.includes('recover Python'),'Recover Python');
  tests.push('Crash recovery restores both modified documents independently');
  await packet({type:'command',name:'saveAll'}); await waitFor(async()=>(await page.locator('.tab-select').allTextContents()).every(t=>!t.includes('●')),'Recovered save all');
  await packet({type:'command',name:'closeTab'}); await waitFor(async()=>await page.locator('.document-tab').count()===1,'Close clean tab');
  await cleanClose();
  console.log(JSON.stringify({passed:true,tests,profile,payload},null,2));
} catch(error) { console.error(error); if(page) { console.error(await page.evaluate(()=>({state:window.folio?.snapshot(),host:window.testHostState,body:document.body.innerText})).catch(()=>null)); await page.screenshot({path:path.join(profile,'failure.png')}).catch(()=>{}); } process.exitCode=1; }
finally { await browser?.close().catch(()=>{}); if(child && child.exitCode===null) child.kill(); }
