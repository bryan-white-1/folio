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
  await writeFile(md, '# Project\n\nProject notes\n'); await writeFile(py, '\ufeffdef greet():\r\n    return "hello"\n# end'); await writeFile(json, '{"count":1}\n');
  await launch();
  await page.evaluate(() => { window.chrome.webview.addEventListener('message', e => { if(e.data.type==='hostState') window.testHostState=e.data; }); });
  const host = () => page.evaluate(() => window.testHostState);
  const open = async p => { await packet({type:'command',name:'openPath',path:p}); await waitFor(async () => (await host())?.path.toLowerCase()===p.toLowerCase() && (await state()).documentId===(await host()).documentId, 'Open '+p); };
  const activate = async id => { await packet({type:'command',name:'activateTab',path:id}); await waitFor(async () => (await state()).documentId===id,'Activate tab'); };
  const edit = async value => { if((await state()).kind==='markdown') await page.locator('#source-mode').click(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(value); };
  await open(md); const mdId=(await state()).documentId; await edit('\nunsaved markdown');
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
  await activate(pyId); await packet({type:'command',name:'save'}); await page.getByRole('button',{name:'취소',exact:true}).click(); assert((await state()).dirty); assert.equal(await readFile(py,'utf8'),'external change\n');
  await packet({type:'command',name:'save'}); await page.getByRole('button',{name:'덮어쓰기',exact:true}).click(); await waitFor(async()=>!(await state()).dirty,'Overwrite');
  tests.push('Inactive tab external-change detection and conflict cancellation/explicit overwrite');
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
