import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import './rendered-search.css';

export type SearchMatch = { from: number; to: number };
type SearchState = { query: string; matches: SearchMatch[]; index: number; decorations: DecorationSet };
type SearchAction = { query: string } | { step: number };
export const renderedSearchKey = new PluginKey<SearchState>('folio-search');

// Search each text block as one string, so inline formatting never splits a match.
// Leaf nodes occupy one document position and must not join unrelated text.
export function renderedMatches(doc: ProseNode, query: string): SearchMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'mermaid') return false;
    const text = node.textBetween(0, node.content.size, '', '\ufffc');
    for (const match of text.matchAll(pattern)) matches.push({ from: pos + 1 + match.index!, to: pos + 1 + match.index! + match[0].length });
    return false;
  });
  return matches;
}

export function renderedSearchPlugin(changed: () => void) {
  return new Plugin<SearchState>({
    key: renderedSearchKey,
    state: {
      init: () => ({ query: '', matches: [], index: -1, decorations: DecorationSet.empty }),
      apply(tr, previous) {
        const action = tr.getMeta(renderedSearchKey) as SearchAction | undefined;
        if (!action && !tr.docChanged) return previous;
        const query = action && 'query' in action ? action.query : previous.query;
        const matches = query === previous.query && !tr.docChanged ? previous.matches : renderedMatches(tr.doc, query);
        let index = previous.index;
        if (query !== previous.query) index = 0;
        else if (tr.docChanged) {
          const anchor = previous.matches[index];
          const position = anchor ? tr.mapping.map(anchor.from, -1) : 0;
          index = matches.findIndex(match => match.from >= position);
          if (index < 0) index = matches.length - 1;
        }
        if (action && 'step' in action && matches.length) index = (index + action.step + matches.length) % matches.length;
        index = matches.length ? Math.max(0, Math.min(index, matches.length - 1)) : -1;
        const decorations = DecorationSet.create(tr.doc, matches.map((match, i) => Decoration.inline(match.from, match.to, {
          class: i === index ? 'folio-search-match folio-search-current' : 'folio-search-match',
        })));
        return { query, matches, index, decorations };
      },
    },
    props: { decorations: state => renderedSearchKey.getState(state)!.decorations },
    view: () => ({ update(view, previous) {
      if (renderedSearchKey.getState(view.state) !== renderedSearchKey.getState(previous)) changed();
    } }),
  });
}

export class RenderedSearch {
  private panel = document.getElementById('rendered-search')!;
  private input = document.getElementById('search-query') as HTMLInputElement;
  private count = document.getElementById('search-count')!;
  private previous = document.getElementById('search-previous') as HTMLButtonElement;
  private next = document.getElementById('search-next') as HTMLButtonElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private view: () => EditorView) {
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.search(), 100);
    });
    this.previous.onclick = () => this.move(-1);
    this.next.onclick = () => this.move(1);
    document.getElementById('search-close')!.onclick = () => this.close();
    this.update();
  }
  open() {
    this.panel.hidden = false;
    this.input.focus(); this.input.select();
    this.search();
  }
  close(focus = true, reset = false) {
    clearTimeout(this.timer);
    this.panel.hidden = true;
    if (reset) this.input.value = '';
    this.dispatch({ query: '' });
    if (focus) this.view().focus();
  }
  update() {
    const { matches, index, query } = renderedSearchKey.getState(this.view().state)!;
    this.count.textContent = `${index + 1} / ${matches.length}`;
    this.count.setAttribute('aria-label', matches.length ? `전체 ${matches.length}개 중 ${index + 1}번째 일치` : query ? '일치하는 결과 없음' : '검색어를 입력하세요');
    this.panel.classList.toggle('no-results', !!query && !matches.length);
    this.previous.disabled = this.next.disabled = !matches.length;
  }
  handleKeydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    const inside = event.target instanceof Element && this.panel.contains(event.target);
    if (event.key === 'F3' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (this.panel.hidden) this.open(); else this.move(event.shiftKey ? -1 : 1);
    } else if (!this.panel.hidden && event.key === 'Escape') this.close();
    else if (inside && event.target === this.input && event.key === 'Enter') this.move(event.shiftKey ? -1 : 1);
    else return false;
    event.preventDefault(); event.stopImmediatePropagation(); return true;
  }
  private dispatch(action: SearchAction) {
    const view = this.view();
    view.dispatch(view.state.tr.setMeta(renderedSearchKey, action).setMeta('addToHistory', false));
  }
  private search() {
    clearTimeout(this.timer);
    this.dispatch({ query: this.input.value });
    this.scroll();
  }
  private move(step: number) {
    clearTimeout(this.timer);
    const state = renderedSearchKey.getState(this.view().state)!;
    if (state.query !== this.input.value) this.search();
    else { this.dispatch({ step }); this.scroll(); }
  }
  private scroll() {
    this.view().dom.querySelector('.folio-search-current')?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}
