import { describe, it, expect } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { renderedMatches, renderedSearchKey, renderedSearchPlugin } from '../src/rendered-search';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' },
  code_block: { group: 'block', content: 'text*', attrs: { language: { default: '' } } },
  text: { group: 'inline' }, image: { group: 'inline', inline: true, atom: true },
}, marks: { strong: {} } });
const p = (...children: any[]) => schema.node('paragraph', null, children);
const t = (text: string, bold = false) => schema.text(text, bold ? [schema.mark('strong')] : []);
const doc = (...children: any[]) => schema.node('doc', null, children);

describe('rendered text search', () => {
  it('joins marked text, but never joins separate blocks or inline atoms', () => {
    const value = doc(p(t('한글 '), t('찾기', true)), p(t('한글 ')), p(t('찾기')), p(t('한글 '), schema.node('image'), t('찾기')));
    expect(renderedMatches(value, '한글 찾기')).toEqual([{ from: 1, to: 6 }]);
  });
  it('matches literal punctuation, Unicode and case without shifting document positions', () => {
    const value = doc(p(t('İ😀 a.b A.B axb')));
    expect(renderedMatches(value, 'a.b')).toEqual([{ from: 5, to: 8 }, { from: 9, to: 12 }]);
    expect(renderedMatches(value, '😀')).toEqual([{ from: 2, to: 4 }]);
    expect(renderedMatches(value, '')).toEqual([]);
    expect(renderedMatches(value, '[')).toEqual([]);
  });
  it('searches code text and excludes hidden Mermaid source', () => {
    const value = doc(schema.node('code_block', { language: 'js' }, t('target')), schema.node('code_block', { language: 'Mermaid' }, t('target')));
    expect(renderedMatches(value, 'target')).toEqual([{ from: 1, to: 7 }]);
  });
  it('wraps navigation and maps the current match through edits without changing document or selection', () => {
    let state = EditorState.create({ doc: doc(p(t('one one'))), plugins: [renderedSearchPlugin(() => {})] });
    const original = state.doc, selection = state.selection;
    state = state.apply(state.tr.setMeta(renderedSearchKey, { query: 'one' }));
    state = state.apply(state.tr.setMeta(renderedSearchKey, { step: -1 }));
    expect(renderedSearchKey.getState(state)!.index).toBe(1);
    expect(state.doc).toBe(original); expect(state.selection.eq(selection)).toBe(true);
    state = state.apply(state.tr.insertText('prefix ', 1));
    expect(renderedSearchKey.getState(state)!.matches[1]).toEqual({ from: 12, to: 15 });
    expect(renderedSearchKey.getState(state)!.index).toBe(1);
    state = state.apply(state.tr.delete(12, 15));
    expect(renderedSearchKey.getState(state)!.index).toBe(0);
  });
});
