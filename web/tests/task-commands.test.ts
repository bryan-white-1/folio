import { describe, it, expect } from 'vitest';
import { sourceTaskChanges, sourceTaskStatus } from '../src/task-commands';

function toggle(text: string, from = 0, to = from) {
  for (const change of sourceTaskChanges(text, from, to).reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return text;
}

describe('source checklist conversion', () => {
  it('converts selected lines without changing inline syntax or the following line', () => {
    const text = '**첫째**\n[둘째](https://example.com)\n마지막\n';
    expect(toggle(text, 2, text.indexOf('마지막'))).toBe('- [ ] **첫째**\n- [ ] [둘째](https://example.com)\n마지막\n');
    expect(toggle('하나\n둘\n셋\n', 4)).toBe('하나\n- [ ] 둘\n셋\n');
  });
  it('adds to ordinary items while preserving completed tasks; removes checks from task selections', () => {
    const text = '- [x] 완료\n- 일반\n';
    expect(toggle(text, 0, text.length)).toBe('- [x] 완료\n- [ ] 일반\n');
    expect(toggle('- [x] 완료\n- [ ] 대기\n', 0, 18)).toBe('- 완료\n- 대기\n');
  });
  it('retains numbering, nested indentation and continuation paragraphs', () => {
    const text = '1. 부모\n   계속\n   - 자식\n2. 다음\n';
    expect(toggle(text, text.indexOf('계속'))).toBe('1. [ ] 부모\n   계속\n   - 자식\n2. 다음\n');
    expect(toggle(text, text.indexOf('자식'))).toBe('1. 부모\n   계속\n   - [ ] 자식\n2. 다음\n');
  });
  it('keeps quote markers and supports empty documents and empty tasks', () => {
    expect(toggle('> 하나\n> 둘\n', 0, 9)).toBe('> - [ ] 하나\n> - [ ] 둘\n');
    expect(toggle('')).toBe('- [ ] ');
    expect(toggle('- [ ] ', 6)).toBe('- ');
  });
  it.each(['```\n- [ ] 코드\n```\n', '| A | B |\n| --- | --- |\n| a | b |', '---\nname: metadata\n---', '<div>보존</div>', '# 제목'])('leaves protected Markdown intact: %s', text => {
    expect(sourceTaskStatus(text, 0, text.length).enabled).toBe(false);
    expect(toggle(text, 0, text.length)).toBe(text);
  });
  it('rejects a mixed selection containing code instead of partially converting it', () => {
    const text = '일반\n\n```\n코드\n```\n';
    expect(toggle(text, 0, text.length)).toBe(text);
  });
});
