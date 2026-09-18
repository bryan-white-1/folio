import type { Command, EditorState } from '@milkdown/kit/prose/state';
import type { Node } from '@milkdown/kit/prose/model';
import { codeBlocks } from './document';

export function selectedCodeBlocks(state: EditorState) {
  const blocks: { node: Node; pos: number }[] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name === 'code_block') { blocks.push({ node, pos }); return false; }
  });
  return blocks;
}

export const removeCodeBlocks: Command = (state, dispatch) => {
  const blocks = selectedCodeBlocks(state);
  if (!blocks.length) return false;
  const tr = state.tr;
  for (const { node, pos } of blocks.reverse()) {
    const content: Node[] = [];
    node.textContent.split('\n').forEach((line, i) => {
      if (i) content.push(state.schema.nodes.hardbreak.create());
      if (line) content.push(state.schema.text(line));
    });
    tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.paragraph.create(null, content));
  }
  dispatch?.(tr.scrollIntoView());
  return true;
};

let cachedText: string | undefined, cachedBlocks: ReturnType<typeof codeBlocks> = [];
export function sourceCodeBlocks(text: string, from: number, to: number) {
  if (text !== cachedText) { cachedText = text; cachedBlocks = codeBlocks(text); }
  return cachedBlocks.filter(block => from === to ? from >= block.from && from <= block.to : block.from < to && block.to > from);
}

export function sourceCodeRemoval(text: string, from: number, to: number) {
  return sourceCodeBlocks(text, from, to).map(block => {
    const lineStart = text.lastIndexOf('\n', block.from - 1) + 1;
    const prefix = text.slice(lineStart, block.from);
    const continuation = prefix.replace(/(?:[*+-]|\d+[.)])\s+/g, marker => ' '.repeat(marker.length));
    // Escape literal code so removing its fence cannot turn it into headings,
    // tables, HTML or emphasis. Hard breaks retain the original line boundaries.
    const lines = block.value.split('\n').map(line => line
      .replace(/&/g, '&amp;').replace(/([\\`*{}\[\]()#+.!_>~|=<>-])/g, '\\$1')
      .replace(/^[ \t]+/, spaces => spaces.replace(/ /g, '&#32;').replace(/\t/g, '&#9;')));
    return { from: block.from, to: block.to, insert: lines.join('  \n' + continuation) || '<br />' };
  });
}
