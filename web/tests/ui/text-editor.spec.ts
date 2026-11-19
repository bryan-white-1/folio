import { test, expect } from '@playwright/test';
const snapshot = (page: any) => page.evaluate(() => (window as any).folio.snapshot());
const load = (page: any, packet: any) => page.evaluate((p: any) => (window as any).folio.receive({ type:'load', dirty:false, session:true, ...p }), packet);
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });
test('text editing highlights Python and preserves mixed line endings without Markdown commands', async ({ page }) => {
  await load(page, {documentId:'python', name:'main.py', text:'def greet():\r\n    return "hello"\n# end'});
  await expect(page.getByRole('combobox', {name:'구문 강조 언어'})).toHaveValue('python');
  await expect(page.locator('#rendered-editor')).toBeHidden(); await expect(page.locator('.format-tools')).toBeHidden();
  expect(await page.locator('.cm-line span').count()).toBeGreaterThan(2);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('!');
  expect((await snapshot(page)).text).toBe('def greet():\r\n    return "hello"\n# end!');
  await page.keyboard.press('Control+b'); await page.keyboard.press('Control+Shift+m');
  const beforeHeading = await snapshot(page);
  for (let level = 1; level <= 6; level++) await page.keyboard.press(`Control+${level}`);
  expect(await snapshot(page)).toEqual(beforeHeading);
  expect((await snapshot(page)).kind).toBe('text'); expect((await snapshot(page)).text).not.toContain('**');
  await page.keyboard.press('Control+z'); expect((await snapshot(page)).dirty).toBe(false);
});
test('sessions retain isolated undo, selection, language and wrapping across Markdown and Text', async ({ page }) => {
  await load(page, {documentId:'text', name:'data.json', text:'{"a":1}'});
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' ');
  await page.getByRole('combobox', {name:'구문 강조 언어'}).selectOption('plain'); await page.getByRole('button', {name:'자동 줄바꿈'}).click();
  await load(page, {documentId:'md', name:'README.md', text:'# Overview\n\nBody'});
  await page.locator('.ProseMirror p').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' changed');
  await load(page, {documentId:'text', name:'data.json', text:'SHOULD NOT REPLACE', resume:true});
  expect(await snapshot(page)).toMatchObject({text:'{"a":1} ',language:'plain',wrap:true,dirty:true});
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+z'); expect((await snapshot(page)).text).toBe('{"a":1}');
  await load(page, {documentId:'md', name:'README.md', text:'', resume:true});
  expect((await snapshot(page)).text).toContain('Body changed'); await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+z'); expect((await snapshot(page)).text).toBe('# Overview\n\nBody');
});

for (const [name, language, text] of [['Main.java','java','public class Main { int n = 42; }'], ['main.c','c','int main(void) { return 0; }'], ['main.cpp','cpp','class Value { public: int n = 42; };']]) {
  test(`${language} language grammar highlights without altering source`, async ({page}) => {
    await load(page,{documentId:language,name,text}); await expect(page.getByRole('combobox',{name:'구문 강조 언어'})).toHaveValue(language);
    expect(await page.locator('.cm-line span').count()).toBeGreaterThan(1); expect((await snapshot(page)).text).toBe(text);
  });
}

for (const [name, language, text, token] of [
  ['types.d.TS', 'javascript', 'export type Identifier = string', 'Identifier'],
  ['View.tsx', 'javascript', 'export const View = () => <section>Hi</section>', 'section'],
  ['app.JS', 'javascript', 'export const enabled = true', 'const'],
  ['index.HTML', 'html', '<main title="Welcome">Hello</main>', 'main'],
  ['settings.YAML', 'yaml', 'editor:\n  enabled: true\n  indent: 2\n', 'enabled'],
]) {
  test(`${name} opens with ${language} highlighting`, async ({ page }) => {
    await load(page, { documentId: name, name, text });
    await expect(page.getByRole('combobox', { name: '구문 강조 언어' })).toHaveValue(language);
    const highlightedToken = page.locator('.cm-line span').filter({ hasText: new RegExp(`^${token}$`) });
    await expect(highlightedToken.first()).toBeVisible();
    expect((await snapshot(page)).text).toBe(text);
  });
}

test('restoring a TS file refreshes automatic highlighting and preserves a manual choice', async ({ page }) => {
  const file = { name: 'value.ts', text: 'const value = 1', language: 'plain' };
  const language = page.getByRole('combobox', { name: '구문 강조 언어' });
  await load(page, { ...file, documentId: 'auto', languageOverride: false });
  await expect(language).toHaveValue('javascript');
  await load(page, { ...file, documentId: 'manual', languageOverride: true });
  await expect(language).toHaveValue('plain');
});

test('switching from a long Text buffer retains its selection and scroll position', async ({page}) => {
  const text = Array.from({length:1000},(_,i)=>`line ${i+1}`).join('\n');
  await load(page,{documentId:'long',name:'long.txt',text});
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Shift+Home');
  await expect.poll(()=>page.locator('.cm-scroller').evaluate(e=>e.scrollTop)).toBeGreaterThan(1000);
  const top = await page.locator('.cm-scroller').evaluate(e=>e.scrollTop);
  await load(page,{documentId:'short',name:'short.txt',text:'short'});
  await load(page,{documentId:'long',name:'long.txt',text:'',resume:true});
  await expect.poll(async()=>Math.abs(await page.locator('.cm-scroller').evaluate(e=>e.scrollTop)-top)).toBeLessThan(8);
  await page.keyboard.insertText('replaced'); expect((await snapshot(page)).text).toBe(text.slice(0,text.lastIndexOf('\n')+1)+'replaced');
});

test('reload preserves the source caret, scroll and language choice and rejects intervening edits', async ({page}) => {
  const text = Array.from({length: 600}, (_, i) => `line ${i}`).join('\n');
  await load(page, {documentId:'reload', name:'notes.ts', text});
  await page.getByRole('combobox', {name:'구문 강조 언어'}).selectOption('plain');
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+End');
  await expect.poll(() => page.locator('.cm-scroller').evaluate(e => e.scrollTop)).toBeGreaterThan(1000);
  const top = await page.locator('.cm-scroller').evaluate(e => e.scrollTop);
  const request = {type:'reloadFile', documentId:'reload', expectedRevision:(await snapshot(page)).revision, text:text + '\nnew line', newline:'\n', bom:false};
  await page.evaluate(p => window.folio.receive(p), request);
  await expect.poll(async () => Math.abs(await page.locator('.cm-scroller').evaluate(e => e.scrollTop) - top)).toBeLessThan(8);
  await page.keyboard.insertText('!');
  const edited = await snapshot(page);
  expect(edited).toMatchObject({text:text + '!\nnew line', language:'plain', dirty:true});
  await page.evaluate(p => window.folio.receive(p), request);
  expect(await snapshot(page)).toEqual(edited);
});

test('reloading rendered Markdown keeps the caret in the paragraph and resets undo', async ({page}) => {
  const text = '# Notes\n\nCurrent paragraph\n\nOld ending';
  await load(page, {documentId:'rendered-reload', name:'notes.md', text});
  const paragraph = page.locator('.ProseMirror p').first();
  await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.insertText('s');
  await expect.poll(async () => (await snapshot(page)).text).toContain('Current paragraphs');
  const expectedRevision = (await snapshot(page)).revision;
  await page.evaluate(p => window.folio.receive(p), {
    type:'reloadFile', documentId:'rendered-reload', expectedRevision, text:text.replace('paragraph', 'paragraphs').replace('Old ending', 'New ending'), newline:'\n', bom:false,
  });
  await expect(page.locator('.ProseMirror p').last()).toHaveText('New ending');
  expect((await snapshot(page)).dirty).toBe(false);
  await page.keyboard.press('Control+z');
  await page.keyboard.insertText('!');
  await expect(paragraph).toHaveText('Current paragraphs!');
  await expect(page.locator('.ProseMirror p').last()).toHaveText('New ending');
});
