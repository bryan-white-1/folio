import { t, tr, uiHtml } from './i18n';
import './native-shell.css';

type Packet = { type: string; [key: string]: any };
type Bridge = { postMessage(packet: unknown): void; addEventListener(type: string, listener: (event: MessageEvent<Packet>) => void): void };
type Heading = { id: string; parentId: string | null; label: string; depth: number };

// Win32 shell only. The existing editor and legacy WinUI host keep their protocol.
export function installNativeShell(bridge: Bridge | undefined) {
  if (!bridge || new URLSearchParams(location.search).get('native') !== '1') return;
  const root = document.documentElement;
  root.dataset.nativeShell = 'true';
  const app = document.getElementById('app')!;
  const shell = document.createElement('div'); shell.id = 'native-shell';
  shell.innerHTML = uiHtml(`<header class="host-bar"><div class="host-brand"><span>f.</span><b>Folio</b></div><button id="host-path" aria-label="파일 전체 경로 보기 및 복사">시작하기.md</button><nav aria-label="문서 작업"><button data-host-command="new">＋ 새 문서</button><button data-host-command="open">열기</button><button data-host-command="recent">최근 문서</button><button data-host-command="save" class="primary">저장</button><button data-host-command="configuration" aria-label="설정 · Configuration">⚙</button><button id="host-more" aria-label="더 보기" aria-expanded="false">⋯</button></nav></header><div class="host-workspace"><aside class="host-sidebar" aria-label="문서 목차"><div class="host-outline-title"><b>문서 목차</b><span id="host-count">00</span></div><input id="host-filter" aria-label="목차에서 찾기" placeholder="목차에서 찾기"><div id="host-outline" role="tree" aria-label="제목 목록"></div><p id="host-empty">제목을 쓰면 목차가 나타납니다.</p><footer><span id="host-status">편집기 준비 중…</span><small>LOCAL FIRST · 나만의 문서 공간</small></footer></aside><div id="host-grip" role="separator" tabindex="0" aria-label="목차 너비" aria-orientation="vertical" aria-valuemin="200" aria-valuemax="420" aria-valuenow="260"></div><section id="host-editor" aria-label="문서 편집 영역"></section></div><div id="host-menu" role="menu" hidden><button role="menuitem" data-host-command="saveAs">다른 이름으로 저장 <small>Ctrl+Shift+S</small></button><button role="menuitem" data-host-command="image">이미지 삽입…</button><button role="menuitem" data-host-command="examples">기본 예제</button><hr><button role="menuitem" data-host-command="toggleMode">원문 / 렌더링 전환</button><button role="menuitem" data-host-command="sidebar">목차 표시 / 숨기기</button><button role="menuitem" data-host-command="theme">밝은 / 어두운 테마</button><button role="menuitem" data-host-command="configuration">설정 · Configuration</button></div>`);
  document.body.append(shell); shell.querySelector('#host-editor')!.append(app);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const send = (packet: Packet) => bridge.postMessage(packet);
  const command = (name: string, extra: object = {}) => send({ type: 'command', name, ...extra });
  let preferences: Record<string, any> = {}, headings: Heading[] = [], path = '', active = '', treeKey = '';
  const collapsed = new Set<string>();
  let modal: HTMLDialogElement | undefined;
  const dialogs: Packet[] = [];
  let localDialog: string | undefined;
  const shellReceive = (packet: Packet) => { void (window as any).folio?.receive(packet); };
  function closeMenu() { el('host-menu').hidden = true; el('host-more').setAttribute('aria-expanded', 'false'); }
  function createDialog(title: string, kind = 'local') {
    const dialog = document.createElement('dialog'); dialog.className = 'host-dialog';
    const heading = document.createElement('h2'); heading.id = 'host-dialog-title'; heading.textContent = title;
    dialog.setAttribute('aria-labelledby', heading.id); dialog.append(heading);
    const body = document.createElement('div'); body.className = 'host-dialog-body'; dialog.append(body);
    const actions = document.createElement('div'); actions.className = 'dialog-actions'; dialog.append(actions);
    document.body.append(dialog); modal = dialog; localDialog = kind;
    dialog.addEventListener('close', () => { if (modal === dialog) { modal = undefined; localDialog = undefined; } dialog.remove(); queueMicrotask(showNext); });
    const button = (label: string, action: () => void, primary = false) => { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; b.onclick = action; actions.append(b); return b; };
    return { dialog, body, button };
  }
  function showNext() {
    if (modal || !dialogs.length) return;
    const p = dialogs.shift()!; const d = createDialog(p.title, 'host');
    const text = document.createElement('p'); text.textContent = p.message; d.body.append(text);
    let answered = false;
    const answer = (choice: number) => { if (answered) return; answered = true; send({ type: 'hostDialogResult', id: p.id, choice }); d.dialog.close(); };
    p.buttons.forEach((label: string, i: number) => d.button(label, () => answer(i), i === 0));
    d.dialog.addEventListener('cancel', e => { e.preventDefault(); answer(-1); }); d.dialog.showModal();
  }
  function recent() {
    if (modal) return;
    const d = createDialog(t('최근 문서')); d.dialog.classList.add('host-recent-dialog');
    const search = document.createElement('input'); search.placeholder = t('파일명 또는 폴더 경로로 찾기'); search.setAttribute('aria-label', t('최근 문서 검색'));
    const count = document.createElement('p'); count.className = 'host-muted';
    const list = document.createElement('div'); list.className = 'host-recent-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', t('최근 문서 목록'));
    d.body.append(search, count, list); let selected = '';
    const open = () => { if (!selected) return; d.dialog.close(); command('openPath', { path: selected }); };
    d.button(t('닫기'), () => d.dialog.close()); const choose = d.button(t('열기'), open, true); choose.disabled = true;
    function filter() {
      list.replaceChildren(); selected = ''; choose.disabled = true;
      const paths = (preferences.RecentFiles ?? []).filter((p: string) => p.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
      count.textContent = paths.length ? tr`${paths.length}개 문서` : t('최근 문서가 없습니다.');
      paths.forEach((p: string) => { const row = document.createElement('button'); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
        const name = document.createElement('b'); name.textContent = p.split(/[\\/]/).at(-1)!; const full = document.createElement('span'); full.textContent = p; row.append(name, full);
        row.onclick = () => { selected = p; choose.disabled = false; list.querySelectorAll('[aria-selected]').forEach(x => x.setAttribute('aria-selected', String(x === row))); };
        row.ondblclick = () => { selected = p; open(); }; row.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); selected = p; open(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling as HTMLElement)?.dispatchEvent(new MouseEvent('click')); ((e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null)?.focus(); } }; list.append(row);
      });
    }
    search.oninput = filter; search.onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); (list.firstElementChild as HTMLElement)?.focus(); } if (e.key === 'Enter' && selected) open(); };
    filter(); d.dialog.showModal(); search.focus();
  }
  function settings() {
    if (modal) return;
    const original = { BodyLineHeight: preferences.BodyLineHeight ?? 1.95, OutlineLineHeight: preferences.OutlineLineHeight ?? 2, DocumentAlignment: preferences.DocumentAlignment ?? 'center', Language: preferences.Language ?? 'ko' };
    const d = createDialog(t('설정 · Configuration'));
    d.body.innerHTML = uiHtml(`<p class="host-muted">변경 사항을 즉시 미리 봅니다. 저장하면 다음 실행에도 유지됩니다.</p><label>본문 · 표 줄 높이<input id="host-body-spacing" type="number" min="1" max="3" step="0.05"></label><label>문서 영역 배치<select id="host-alignment"><option value="left">왼쪽</option><option value="center">가운데</option></select></label><label>목차 줄 높이<input id="host-outline-spacing" type="number" min="1" max="3" step="0.05"></label><p class="host-muted">줄 높이 1.00–3.00배 · 0.05배 단위</p><label>언어 · Language<select id="host-language"><option value="ko">한국어</option><option value="en">English</option></select></label><p class="host-muted">언어는 저장 후 다음 실행부터 적용됩니다.</p>`);
    const body = el<HTMLInputElement>('host-body-spacing'), outline = el<HTMLInputElement>('host-outline-spacing'), alignment = el<HTMLSelectElement>('host-alignment'), locale = el<HTMLSelectElement>('host-language');
    body.value = String(original.BodyLineHeight); outline.value = String(original.OutlineLineHeight); alignment.value = original.DocumentAlignment; locale.value = original.Language;
    let saved = false;
    const values = () => ({ BodyLineHeight: body.valueAsNumber, OutlineLineHeight: outline.valueAsNumber, DocumentAlignment: alignment.value, Language: locale.value });
    const preview = () => { save.disabled = !body.validity.valid || !outline.validity.valid || !Number.isFinite(body.valueAsNumber + outline.valueAsNumber); if (!save.disabled) send({ type: 'hostPreferences', preferences: values(), save: false }); };
    d.button(t('기본값'), () => { body.value = '1.95'; outline.value = '2'; alignment.value = 'center'; preview(); });
    d.button(t('취소'), () => d.dialog.close()); const save = d.button(t('저장'), () => { saved = true; send({ type: 'hostPreferences', preferences: values(), save: true }); d.dialog.close(); }, true);
    [body, outline, alignment].forEach(input => input.addEventListener('input', preview));
    d.dialog.addEventListener('close', () => { if (!saved) send({ type: 'hostPreferences', preferences: original, save: false }); }); d.dialog.showModal();
  }
  function examples() {
    if (modal) return;
    const d = createDialog(t('기본 예제'));
    for (const [id, label] of [['formatting', t('표·제목 편집')], ['layout', t('표·이미지 크기 조절')], ['mermaid', t('Mermaid 다이어그램')]]) {
      const b = document.createElement('button'); b.className = 'host-example'; b.textContent = label;
      b.onclick = () => { d.dialog.close(); command('openExample', { path: id }); }; d.body.append(b);
    }
    d.button(t('닫기'), () => d.dialog.close()); d.dialog.showModal();
  }
  function showPath() {
    if (modal) return; const d = createDialog(t('파일 전체 경로')); const input = document.createElement('textarea'); input.readOnly = true; input.setAttribute('aria-label', t('파일 전체 경로')); input.value = path || t('저장한 문서의 경로가 여기에 표시됩니다.'); d.body.append(input);
    d.button(t('닫기'), () => d.dialog.close()); const copy = d.button(t('전체 경로 복사'), () => { command('copyPath'); d.dialog.close(); }, true); copy.disabled = !path; d.dialog.showModal(); input.focus(); input.select();
  }
  function rename(h: Heading) {
    if (modal) return; const d = createDialog(t('제목 이름 변경')); const input = document.createElement('input'); input.value = h.label; input.setAttribute('aria-label', t('제목 이름')); d.body.append(input);
    const apply = () => { if (input.value.trim()) { shellReceive({ type: 'renameHeading', id: h.id, title: input.value.trim() }); d.dialog.close(); } };
    d.button(t('취소'), () => d.dialog.close()); d.button(t('변경'), apply, true); input.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); apply(); } }; d.dialog.showModal(); input.select();
  }
  function renderTree() {
    const filter = el<HTMLInputElement>('host-filter').value.trim().toLocaleLowerCase(); const key = JSON.stringify([headings, filter, [...collapsed]]);
    if (key === treeKey) return; treeKey = key;
    const tree = el('host-outline'), oldFocus = (document.activeElement as HTMLElement)?.dataset.heading; tree.replaceChildren();
    const byId = new Map(headings.map(h => [h.id, h])); const visible = new Set<string>();
    headings.filter(h => h.label.toLocaleLowerCase().includes(filter)).forEach(h => { let p: Heading | undefined = h; while (p) { visible.add(p.id); p = byId.get(p.parentId ?? ''); } });
    const items: HTMLElement[] = [];
    headings.filter(h => visible.has(h.id)).forEach(h => {
      let parent = byId.get(h.parentId ?? ''), depth = 0; while (parent) { if (!filter && collapsed.has(parent.id)) return; depth++; parent = byId.get(parent.parentId ?? ''); }
      const row = document.createElement('div'); row.className = 'host-tree-row'; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth + 1)); row.tabIndex = h.id === active || !items.length ? 0 : -1; row.dataset.heading = h.id; row.style.paddingLeft = `${8 + depth * 15}px`; row.setAttribute('aria-selected', String(h.id === active)); row.title = `H${h.depth} · ${h.label}`;
      const children = headings.some(x => x.parentId === h.id); const caret = document.createElement('span'); caret.className = 'host-caret'; caret.textContent = children ? collapsed.has(h.id) && !filter ? '›' : '⌄' : '';
      if (children) { row.setAttribute('aria-expanded', String(!collapsed.has(h.id) || !!filter)); caret.onclick = e => { e.stopPropagation(); if (collapsed.has(h.id)) collapsed.delete(h.id); else collapsed.add(h.id); renderTree(); }; }
      const text = document.createElement('span'); text.textContent = h.label || t('(빈 제목)'); row.append(caret, text); row.onclick = () => shellReceive({ type: 'jump', id: h.id }); row.oncontextmenu = e => { e.preventDefault(); rename(h); };
      row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } else if (e.key === 'F2' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); rename(h); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[items.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus(); } else if (children && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); if (e.key === 'ArrowLeft') collapsed.add(h.id); else collapsed.delete(h.id); renderTree(); } };
      items.push(row); tree.append(row);
    });
    el('host-count').textContent = String(headings.length).padStart(2, '0'); el('host-empty').hidden = items.length > 0; el('host-empty').textContent = filter ? t('일치하는 제목이 없습니다.') : t('제목을 쓰면 목차가 나타납니다.\n# 제목으로 시작해보세요.');
    if (oldFocus) items.find(row => row.dataset.heading === oldFocus)?.focus();
  }
  function action(name: string) { closeMenu(); if (name === 'recent') recent(); else if (name === 'configuration') settings(); else if (name === 'examples') examples(); else if (name === 'sidebar') shell.classList.toggle('host-no-sidebar'); else command(name); }
  shell.querySelectorAll<HTMLElement>('[data-host-command]').forEach(b => b.onclick = () => action(b.dataset.hostCommand!));
  el('host-path').onclick = showPath;
  el('host-path').oncontextmenu = e => { e.preventDefault(); if (path) command('copyPath'); };
  el('host-more').onclick = () => { const menu = el('host-menu'); menu.hidden = !menu.hidden; el('host-more').setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector<HTMLElement>('button')?.focus(); };
  el('host-filter').oninput = renderTree;
  document.addEventListener('pointerdown', e => { if (!(e.target as HTMLElement).closest('#host-menu,#host-more')) closeMenu(); });
  document.addEventListener('keydown', e => {
    const target = e.target as HTMLElement;
    if (target.closest('#host-menu')) { if (e.key === 'Escape') { closeMenu(); el('host-more').focus(); } if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); const buttons = [...el('host-menu').querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(target as HTMLButtonElement); buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus(); } }
    if (e.isComposing || modal) return;
    if (e.ctrlKey && !target.closest('#app') && (e.key.toLowerCase() === 'f' || (e.shiftKey && e.key.toLowerCase() === 'm'))) { e.preventDefault(); e.stopImmediatePropagation(); command(e.key.toLowerCase() === 'f' ? 'find' : 'toggleMode'); }
    if (e.ctrlKey && ['s', 'o', 'n'].includes(e.key.toLowerCase()) && !target.closest('#app')) { e.preventDefault(); e.stopImmediatePropagation(); const key = e.key.toLowerCase(); action(key === 's' ? e.shiftKey ? 'saveAs' : 'save' : key === 'o' ? e.shiftKey ? 'recent' : 'open' : 'new'); }
  }, true);
  const grip = el('host-grip'); let drag: { x: number; width: number } | undefined;
  const width = (value: number, save: boolean) => { const n = Math.max(200, Math.min(420, value)); shell.style.setProperty('--sidebar-width', `${n}px`); grip.setAttribute('aria-valuenow', String(n)); if (save) send({ type: 'hostPreferences', preferences: { SidebarWidth: n }, save: true }); };
  grip.onpointerdown = e => { drag = { x: e.clientX, width: el('host-outline').parentElement!.getBoundingClientRect().width }; grip.setPointerCapture(e.pointerId); };
  grip.onpointermove = e => { if (drag) width(drag.width + e.clientX - drag.x, false); };
  grip.onpointerup = e => { if (drag) width(drag.width + e.clientX - drag.x, true); drag = undefined; };
  grip.onpointercancel = () => { if (drag) width(drag.width, false); drag = undefined; };
  grip.onkeydown = e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); width(Number(grip.getAttribute('aria-valuenow')) + (e.key === 'ArrowLeft' ? -10 : 10), true); } };
  bridge.addEventListener('message', event => {
    const p = event.data;
    if (p.type === 'hostState') { path = p.path; preferences = p.preferences; headings = p.headings ?? []; el('host-path').textContent = `${p.dirty ? '● ' : ''}${p.name}`; el('host-path').title = path || p.name; el('host-status').textContent = p.dirty ? t('● 저장하지 않은 변경') : t('✓ 모든 변경 저장됨'); if (!drag) width(preferences.SidebarWidth ?? 260, false); shell.style.setProperty('--outline-height', `${12 * (preferences.OutlineLineHeight ?? 2) + 8}px`); renderTree(); }
    else if (p.type === 'hostCursor') { active = p.headingId ?? ''; shell.querySelectorAll<HTMLElement>('[data-heading]').forEach(row => { const selected = row.dataset.heading === active; row.setAttribute('aria-selected', String(selected)); row.tabIndex = selected ? 0 : -1; }); }
    else if (p.type === 'hostAction') action(p.name);
    else if (p.type === 'hostDialog') { dialogs.push(p); if (modal && localDialog !== 'host') modal.close(); showNext(); }
  });
}
