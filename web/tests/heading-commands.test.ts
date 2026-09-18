import { describe, it, expect } from 'vitest';
import { sourceHeadingChanges, sourceHeadingStatus } from '../src/heading-commands';

function change(text: string, level: number, from = 0, to = from) {
  for (const c of sourceHeadingChanges(text, from, to, level).reverse()) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  return text;
}
describe('source heading block conversion', () => {
  it('replaces levels at a mid-line cursor and unwraps without accumulating hashes', () => {
    expect(change('## **한글** [링크](https://example.com) ##\n', 6, 7)).toBe('###### **한글** [링크](https://example.com)\n');
    expect(change('###### 제목\n', 0, 8)).toBe('제목\n');
    expect(sourceHeadingChanges('## 제목 ##\n', 2, 2, 2)).toEqual([]);
  });
  it('converts Setext and soft-wrapped paragraphs as one block, preserving neighbors', () => {
    expect(change('**제목**\n=======\n\n다음\n', 3, 2)).toBe('### **제목**\n\n다음\n');
    expect(change('첫 문장\n둘째 문장\n\n마지막\n', 4, 8)).toBe('#### 첫 문장 둘째 문장\n\n마지막\n');
  });
  it('preserves quote/list prefixes and inline spelling in supported containers', () => {
    expect(change('> - **항목**\n>   계속\n', 2, 8)).toBe('> - ## **항목** 계속\n');
    expect(change('1. 제목\n', 5, 5)).toBe('1. ##### 제목\n');
    expect(change('> ## 제목\n', 0, 6)).toBe('> 제목\n');
  });
  it('supports multiple blocks and reports mixed levels', () => {
    const text = '# 첫째\n\n둘째\n\n### 셋째\n';
    expect(sourceHeadingStatus(text, 0, text.length).level).toBeNull();
    expect(change(text, 2, 0, text.length)).toBe('## 첫째\n\n## 둘째\n\n## 셋째\n');
  });
  it.each(['| A | B |\n| --- | --- |\n| C | D |', '```\n# 코드\n```', '<div>보존</div>', '---\nname: metadata\n---', '문장  \n강제 줄바꿈'])('rejects unsupported blocks without changing the document: %s', text => {
    expect(sourceHeadingStatus(text, 0, text.length).enabled).toBe(false);
    expect(change(text, 1, 0, text.length)).toBe(text);
  });
  it('does not partially convert a selection containing a code block', () => {
    const text = '문단\n\n```\ncode\n```\n';
    expect(change(text, 3, 0, text.length)).toBe(text);
  });
  it('creates an empty heading and escapes block markers when returning to body', () => {
    expect(change('', 6)).toBe('###### ');
    expect(change('# - 목록처럼 보이는 제목\n', 0, 4)).toBe('\\- 목록처럼 보이는 제목\n');
    expect(change('# ---\n', 0, 3)).toBe('\\---\n');
    expect(change('# 제목\n이어지는 본문\n', 0, 3)).toBe('제목\n\n이어지는 본문\n');
    expect(change('앞 문단\n# 제목\n', 0, 8)).toBe('앞 문단\n\n제목\n');
    expect(change('# 하나\n## 둘\n', 0, 0, 11)).toBe('하나\n\n둘\n');
    expect(change('> 본문\n> # 제목\n', 0, 10)).toBe('> 본문\n> \n> 제목\n');
    expect(change('# [주소]: https://example.com\n', 0, 5)).toBe('\\[주소]: https://example.com\n');
    expect(change('# ~~~\n', 0, 4)).toBe('\\~~~\n');
  });
});
