import { it, expect } from 'vitest';
import { sourceCodeRemoval, sourceCodeBlocks } from '../src/code-commands';
import { codeBlocks, analyze } from '../src/document';

function remove(text: string, from = 0, to = text.length) {
  for (const c of sourceCodeRemoval(text, from, to).reverse()) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  return text;
}
it('unwraps fenced and indented code without interpreting literal Markdown or dropping leading whitespace', () => {
  for (const text of ['```md\n# heading\n**bold**\n  space\n```\n', '    # heading\n    **bold**\n      space\n']) {
    const result = remove(text);
    expect(codeBlocks(result)).toHaveLength(0); expect(analyze(result).headings).toHaveLength(0);
    expect(result).toContain('\\# heading'); expect(result).toContain('\\*\\*bold\\*\\*'); expect(result).toContain('&#32;&#32;space');
  }
});
it('removes only intersecting code blocks and retains container prefixes and outside content', () => {
  const text = '> ```\n> first\n> second\n> ```\n\nuntouched\n\n~~~js\nlast\n~~~\n';
  const result = remove(text, 8, 8);
  expect(result).toBe('> first  \n> second\n\nuntouched\n\n~~~js\nlast\n~~~\n');
  expect(sourceCodeBlocks(text, 35, 35)).toHaveLength(0);
  expect(codeBlocks(remove(text))).toHaveLength(0);
});
