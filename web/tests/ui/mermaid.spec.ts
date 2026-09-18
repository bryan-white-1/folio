import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const fence = (code: string, language = 'mermaid') => '```' + language + '\n' + code + '\n```';
const sample = 'flowchart TB\n A("`Excel 업로드\nTemplate + Supplier\nWorkbooks`") --> B("`서버: Sheet별 셀 JSON 구성\n셀 주소·값·수식·표시 형식·병합 범위`")\n B --> C("`LLM ① 구조 탐지\nHeader·Identifier·Field 역할`")\n C --> D("서버: 영역 구조 검증")\n D --> E("`서버: 원본 셀에서 추출\n영역별 Markdown + Source Map`")\n B -.- F("원본 셀 JSON도 입력")';
async function load(page: Page, text: string, documentId = 'mermaid-test') {
  await page.evaluate(async packet => (window as any).folio.receive(packet), { type: 'load', text, name: '다이어그램.md', documentId, dirty: false });
}
const snapshot = (page: Page) => page.evaluate(() => (window as any).folio.snapshot());
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).folio); });

test('reference flowchart, themes, zoom and mode changes preserve the document', async ({ page }) => {
  const text = '# 처리 흐름\n\n' + fence(sample) + '\n\n다음 문단\n';
  await load(page, text); const before = await snapshot(page);
  const card = page.locator('.mermaid-card'); await expect(card).toHaveAttribute('data-state', 'ready');
  await expect(card.locator('svg')).toBeVisible(); await expect(card.locator('svg')).toContainText('Excel 업로드');
  await expect(card.locator('foreignObject')).toHaveCount(0);
  await expect(card.locator('.node rect').first()).toHaveCSS('fill', 'rgb(255, 255, 255)');
  await expect(card.locator('.flowchart-link').first()).toHaveCSS('fill', 'none');
  const clipped = await card.locator('.node').evaluateAll(nodes => nodes.some(node => {
    const shape = node.querySelector(':scope > rect')?.getBoundingClientRect();
    const label = node.querySelector('.label')?.getBoundingClientRect();
    return shape && label && (label.left < shape.left - 1 || label.right > shape.right + 1 || label.top < shape.top - 1 || label.bottom > shape.bottom + 1);
  }));
  expect(clipped).toBe(false);
  await page.screenshot({ path: '../artifacts/mermaid-light.png', fullPage: true });
  await card.getByRole('button', { name: '확대', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mermaid 확대 보기' }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '100%', exact: true }).click(); await expect(dialog.locator('output')).toHaveText('100%');
  await dialog.getByRole('button', { name: '확대', exact: true }).click(); await expect(dialog.locator('output')).toHaveText('125%');
  await page.screenshot({ path: '../artifacts/mermaid-expanded.png' });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(card.getByRole('button', { name: '확대', exact: true })).toBeFocused();
  await page.evaluate(() => (window as any).folio.receive({ type: 'theme', value: 'dark' }));
  await expect(card).toHaveAttribute('data-state', 'ready');
  await expect(card.locator('.node rect').first()).toHaveCSS('fill', 'rgb(32, 41, 39)');
  await page.screenshot({ path: '../artifacts/mermaid-dark.png', fullPage: true });
  await page.getByRole('tab', { name: '원문', exact: true }).click();
  await page.getByRole('tab', { name: '렌더링', exact: true }).click();
  await expect(card).toHaveAttribute('data-state', 'ready'); expect(await snapshot(page)).toEqual(before);
});

test('all five supported diagram families render alongside normal editable code', async ({ page }) => {
  const diagrams = ['flowchart LR\nA(시작) --> B(완료)', 'sequenceDiagram\n사용자->>서버: 요청\n서버-->>사용자: 응답', 'classDiagram\nAnimal <|-- Duck\nAnimal : +int age', 'stateDiagram-v2\n[*] --> Ready\nReady --> [*]', 'erDiagram\nUSER ||--o{ ORDER : places'];
  await load(page, diagrams.map(code => fence(code)).join('\n\n') + '\n\n' + fence('const value = 1;', 'js'));
  const cards = page.locator('.mermaid-card'); await expect(cards).toHaveCount(5);
  for (let i = 0; i < 5; i++) { await cards.nth(i).scrollIntoViewIfNeeded(); await expect(cards.nth(i)).toHaveAttribute('data-state', 'ready'); }
  const code = page.locator('.ProseMirror pre[data-language=js] code'); await code.click(); await page.keyboard.press('End'); await page.keyboard.insertText(' // edit');
  expect((await snapshot(page)).text).toContain('// edit');
  for (const diagram of diagrams) expect((await snapshot(page)).text).toContain(diagram);
});

test('duplicate and nested blocks navigate to the exact source and share undo', async ({ page }) => {
  const code = 'flowchart LR\nA --> B';
  const text = '# 테스트\n\n' + fence(code) + '\n\n> ' + fence(code).replaceAll('\n', '\n> ') + '\n\n- 항목\n\n  ' + fence(code).replaceAll('\n', '\n  ') + '\n';
  await load(page, text);
  const third = page.locator('.mermaid-card').nth(2); await third.scrollIntoViewIfNeeded();
  await third.getByRole('button', { name: '원문 수정' }).click();
  await page.keyboard.press('End'); await page.keyboard.insertText('   ');
  const edited = (await snapshot(page)).text as string;
  expect(edited).toContain('  flowchart LR   \n'); expect(edited.match(/flowchart LR   /g)).toHaveLength(1);
  await page.getByRole('tab', { name: '렌더링', exact: true }).click();
  await page.keyboard.press('Control+z'); expect((await snapshot(page)).text).toBe(text);
  await page.keyboard.press('Control+y'); expect((await snapshot(page)).text).toBe(edited);
});

test('syntax errors, empty, unsupported and oversized blocks do not break the document', async ({ page }) => {
  await load(page, [fence('flowchart LR\nA[broken'), fence(''), fence('pie\n"A" : 1'), fence('flowchart LR\n' + ' '.repeat(20_001)), fence('flowchart LR\nA --> B')].join('\n\n'));
  const cards = page.locator('.mermaid-card');
  for (let i = 0; i < 5; i++) { await cards.nth(i).scrollIntoViewIfNeeded(); await expect(cards.nth(i)).toHaveAttribute('data-state', ['error', 'error', 'unsupported', 'limited', 'ready'][i]); }
  expect((await snapshot(page)).dirty).toBe(false);
  await expect(page.locator('.mermaid-stage')).toHaveCount(0);
});

test('configuration cannot enable HTML, external requests or escape into editor styling', async ({ page }) => {
  const requests: string[] = [];
  const origin = new URL(page.url()).origin;
  page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) requests.push(request.url()); });
  const malicious = '---\nconfig:\n  securityLevel: loose\n  htmlLabels: true\n  themeCSS: "body {display:none}"\n  maxEdges: 999999\n---\nflowchart LR\n A["<img src=https://example.invalid/x onerror=alert(1)>"] --> B["완료"]\n click B "https://example.invalid/"';
  await load(page, fence(malicious));
  const card = page.locator('.mermaid-card'); await expect(card).toHaveAttribute('data-state', 'ready');
  await expect(card.locator('img, image, foreignObject, a, script')).toHaveCount(0);
  await expect(page.locator('body')).toBeVisible(); expect(requests).toEqual([]);
  expect((await snapshot(page)).text).toContain(malicious);
});

test('edge limit and image nodes are contained; ordinary class styling remains available', async ({ page }) => {
  const many = "%%{init: {'maxEdges': 999999, 'securityLevel': 'loose'}}%%\nflowchart LR\n" + Array.from({ length: 201 }, (_, i) => `A${i} --> A${i + 1}`).join('\n');
  await load(page, fence(many));
  await expect(page.locator('.mermaid-card')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('.mermaid-status')).toContainText('200개');
  await load(page, fence('flowchart LR\nA@{ img: "https://example.invalid/x.png" }'));
  await expect(page.locator('.mermaid-card')).toHaveAttribute('data-state', 'unsupported');
  await load(page, fence('flowchart LR\nA["첫 줄<br/>둘째 줄"] --> B[끝]\nclassDef accent fill:#eef7ef,stroke:#187863\nclass A accent'));
  const card = page.locator('.mermaid-card'); await expect(card).toHaveAttribute('data-state', 'ready');
  await expect(card.locator('.node rect').first()).toHaveCSS('fill', 'rgb(238, 247, 239)');
  await expect(card.locator('svg')).toContainText('둘째 줄');
});

test('narrow layout and high DPI keep the viewer within its viewport', async ({ browser }) => {
  for (const scale of [1, 1.5, 2]) {
    const context = await browser.newContext({ viewport: { width: 560, height: 760 }, deviceScaleFactor: scale });
    const page = await context.newPage(); await page.goto(test.info().project.use.baseURL!);
    await page.waitForFunction(() => !!(window as any).folio); await load(page, fence(sample));
    const card = page.locator('.mermaid-card'); await expect(card).toHaveAttribute('data-state', 'ready');
    expect((await card.boundingBox())!.width).toBeLessThan(560);
    await card.getByRole('button', { name: '확대', exact: true }).click();
    const dialog = page.locator('.mermaid-viewer');
    await dialog.getByRole('button', { name: '100%', exact: true }).click();
    await dialog.getByRole('button', { name: '폭 맞춤', exact: true }).click();
    const bounds = (await dialog.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(561);
    await context.close();
  }
});

test('warm render measurements and twenty-block lazy rendering stay local', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const origin = new URL(page.url()).origin;
  const external: string[] = [];
  await page.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  const code = 'flowchart TB\n' + Array.from({ length: 19 }, (_, i) => `N${i}(단계 ${i}) --> N${i + 1}(단계 ${i + 1})`).join('\n') + '\n' + Array.from({ length: 11 }, (_, i) => `N${i} -.-> N${i + 2}`).join('\n');
  const timings: number[] = [];
  for (let i = 0; i < 11; i++) {
    const start = Date.now(); await load(page, fence(code), `measure-${i}`);
    await page.waitForFunction(() => document.querySelector('.mermaid-card')?.getAttribute('data-state') === 'ready');
    timings.push(Date.now() - start);
  }
  await load(page, Array.from({ length: 20 }, (_, i) => fence(`flowchart LR\nA${i} --> B${i}`)).join('\n\n'));
  const cards = page.locator('.mermaid-card'); await expect(cards).toHaveCount(20);
  await expect(cards.first()).toHaveAttribute('data-state', 'ready');
  await expect(cards.last()).toHaveAttribute('data-state', 'waiting');
  await cards.last().scrollIntoViewIfNeeded(); await expect(cards.last()).toHaveAttribute('data-state', 'ready');
  expect(external).toEqual([]);
  const warm = timings.slice(1).sort((a, b) => a - b);
  fs.writeFileSync('../artifacts/mermaid-performance.json', JSON.stringify({ timestamp: new Date().toISOString(), browser: browser.version(), production: process.env.FOLIO_TEST_PRODUCTION === '1', nodes: 20, edges: 30, coldMs: timings[0], warmMs: timings.slice(1), warmP95Ms: warm[Math.ceil(warm.length * 0.95) - 1], includes: 'document load, AST, render, DOM mount and polling', externalRequests: external }, null, 2));
});

test('latest document and theme win over queued renders; SVG identifiers are unique', async ({ page }) => {
  await load(page, fence(sample), 'old');
  await load(page, fence('flowchart LR\nNEW --> B') + '\n\n' + fence('flowchart LR\nNEW --> B'), 'new');
  await page.evaluate(async () => {
    await (window as any).folio.receive({ type: 'theme', value: 'dark' });
    await (window as any).folio.receive({ type: 'theme', value: 'light' });
  });
  const cards = page.locator('.mermaid-card');
  for (let i = 0; i < 2; i++) await expect(cards.nth(i)).toHaveAttribute('data-state', 'ready');
  const ids = await cards.locator('svg').evaluateAll(nodes => nodes.flatMap(svg => [svg.id, ...[...svg.querySelectorAll('[id]')].map(n => n.id)]));
  expect(new Set(ids).size).toBe(ids.length); await expect(cards.first().locator('svg')).not.toContainText('Excel');
  expect((await snapshot(page)).documentId).toBe('new'); expect((await snapshot(page)).dirty).toBe(false);
});

test('selected diagram can be deleted and restored; surrounding visual edit preserves source', async ({ page }) => {
  const text = '# 제목\n\n' + fence('flowchart LR\n%% keep comment\nA --> B', 'Mermaid') + '\n\n끝 문단\n';
  await load(page, text); const card = page.locator('.mermaid-card'); await expect(card).toHaveAttribute('data-state', 'ready');
  await page.locator('.ProseMirror h1').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' 수정');
  expect((await snapshot(page)).text).toContain('%% keep comment\nA --> B');
  await card.locator('.mermaid-badge').click(); await page.keyboard.press('Delete'); await expect(card).toHaveCount(0);
  await page.keyboard.press('Control+z'); await expect(card).toHaveCount(1); await expect(card).toHaveAttribute('data-state', 'ready');
});
