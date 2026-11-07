import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { analyze } from '../src/document';
import { sourceHeadingChanges } from '../src/heading-commands';
import { normalizeColor, sourceColorChanges, sourceColorStatus, stripTextColors, readTextColors, inspectTextColors, type ColorAst } from '../src/text-color-markdown';
const parser = unified().use(remarkParse).use(remarkGfm);
const span = (s: string, color = '#D32F2F') => `<span style="color:${color}">${s}</span>`;
function change(text: string, color: string | null, from = 0, to = text.length) {
  for (const c of sourceColorChanges(text, from, to, color).reverse()) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  return text;
}
describe('portable text colors', () => {
  it('normalizes safe values and rejects arbitrary CSS', () => {
    expect(normalizeColor('#abc')).toBe('#AABBCC'); expect(normalizeColor('rgb(211, 47, 47)')).toBe('#D32F2F'); expect(normalizeColor('red')).toBe('#FF0000');
    for (const value of ['constructor', '__proto__', 'toString', 'rgb(999,0,0)', 'url(https://x)', 'red;display:none', 'var(--color)', 'transparent', '#12345678']) expect(normalizeColor(value)).toBeNull();
  });
  it('supports nested colors without leaking the inner color into later text', () => {
    const tree = parser.parse(span('A ' + span('B', '#2563EB') + ' C')) as ColorAst;
    expect([...inspectTextColors(tree).leaves.values()]).toEqual(['#D32F2F', '#2563EB', '#D32F2F']);
    readTextColors(tree); expect(JSON.stringify(tree)).not.toContain('"type":"html"');
  });
  it('preserves unsupported, malformed and block HTML and literal code on export', () => {
    for (const text of ['<span style="color:red" onclick="evil()">text</span>', '<span style="color:red;display:none">text</span>', '<span style="color:red">missing', '<span style="color:red">\n**block**\n</span>', '`' + span('code') + '`', '```html\n' + span('code') + '\n```']) expect(stripTextColors(text)).toBe(text);
    expect(stripTextColors(span('safe') + '\n\n<!-- other -->')).toBe('safe\n\n<!-- other -->');
  });
  it('colors partial text and resets just the selected middle of an existing color', () => {
    expect(change('abcdef', '#D32F2F', 1, 4)).toBe('a' + span('bcd') + 'ef');
    const source = span('abcdef'), from = source.indexOf('abcdef') + 2;
    const reset = change(source, null, from, from + 2);
    expect(reset).toBe(span('ab') + 'cd' + span('ef'));
    expect(change(source, '#D32F2F')).toBe(source);
    expect(change(source, null)).toBe('abcdef');
    expect(sourceColorChanges('abc', 1, 1, '#D32F2F')).toEqual([]);
  });
  it('retains Markdown structure, code, destinations and layout comments', () => {
    const source = '# 제목\n\n- **굵게** *기울임* [링크](https://example.com) `code`\n\n<!-- folio:table:v1 widths=120 -->\n\n| 이름 |\n| --- |\n| 값 |\n';
    const colored = change(source, '#D32F2F');
    expect(stripTextColors(colored)).toBe(source);
    expect(colored).toContain('**' + span('굵게') + '**');
    expect(colored).toContain('[' + span('링크') + '](https://example.com)');
    expect(colored).toContain('`code`');
    expect(analyze(colored).headings[0].label).toBe('제목');
    expect(sourceHeadingChanges('# ' + span('제목'), 0, 0, 2)[0].insert).toBe('## ' + span('제목'));
  });
  it('keeps soft breaks and quote prefixes outside color tags', () => {
    const source = '> 첫째\n> 둘째\n\n다음\n문장\n';
    const result = change(source, '#D32F2F');
    expect(stripTextColors(result)).toBe(source);
    expect(result).toContain('> ' + span('첫째') + '\n> ' + span('둘째'));
    expect(result).not.toMatch(/<span[^>]*>\n/);
  });
  it('does not split entities, escapes or emoji', () => {
    for (const text of ['a &amp; b', 'a \\* b', 'a 😀 b']) {
      const result = change(text, '#D32F2F', 3, 4);
      expect(stripTextColors(result)).toBe(text);
      expect(result).toContain(span(text.slice(2, text.indexOf(' b'))));
    }
  });
  it('reports mixed colors and ignores code-only selections', () => {
    const text = span('red') + ' plain';
    expect(sourceColorStatus(text, 0, text.length)).toMatchObject({ enabled: true, mixed: true });
    expect(sourceColorStatus('`code`', 0, 6).enabled).toBe(false);
  });
});
