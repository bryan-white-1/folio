import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']);
let cached: { text: string; tree: ReturnType<typeof parser.parse> } | undefined;

// Consumers share this tree and must leave it unchanged.
export function markdownTree(text: string) {
  if (cached?.text !== text) cached = { text, tree: parser.parse(text) };
  return cached.tree;
}

// Markdown block positions are ordered and include their container syntax.
export function blocksInRange(text: string, from: number, to: number) {
  const nodes = markdownTree(text).children;
  let low = 0, high = nodes.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (nodes[mid].position!.end.offset! < from) low = mid + 1;
    else high = mid;
  }
  let end = low;
  while (end < nodes.length && nodes[end].position!.start.offset! <= to) end++;
  return nodes.slice(low, end);
}
