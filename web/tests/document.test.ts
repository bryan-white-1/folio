import { describe, it, expect } from 'vitest';
import { DocumentModel, analyze, codeBlocks } from '../src/document';

it('locates duplicate fenced blocks within containers without matching by content', () => {
  const text = '```mermaid\nA\n```\n\n> ```mermaid\n> A\n> ```\n\n- item\n\n  ```mermaid\n  A\n  ```';
  const blocks = codeBlocks(text);
  expect(blocks).toHaveLength(3);
  expect(blocks.map(b => text.slice(b.bodyFrom, b.bodyFrom + 1))).toEqual(['A', 'A', 'A']);
  expect(new Set(blocks.map(b => b.bodyFrom)).size).toBe(3);
});

describe('Markdown outline', () => {
  it('excludes fenced/quoted headings, supports Setext, duplicates and skipped levels', () => {
    const text = '# A\n\n### Same\n\n```md\n# hidden\n```\n\n> # quote\n\n### Same\n\nEnd\n===\n';
    const { headings } = analyze(text);
    expect(headings.map(h => h.label)).toEqual(['A', 'Same', 'Same', 'End']);
    expect(headings[1].parentId).toBe(headings[0].id);
    expect(headings[2].id).not.toBe(headings[1].id);
    expect(headings[0].sectionEnd).toBe(headings[3].from);
    expect(headings[1].sectionEnd).toBe(headings[2].from);
  });
  it('protects HTML, frontmatter and reference definitions', () => {
    for (const text of ['<script>alert(1)</script>', '---\ntitle: x\n---\n# hi', '[link][id]\n\n[id]: https://example.com']) expect(analyze(text).protectedReason).toBeTruthy();
    expect(analyze('# 한글\n\n- [x] 확인\n').protectedReason).toBeNull();
  });
});
describe('shared editing history', () => {
  it('groups typing but keeps mode transitions as separate undo steps', () => {
    const doc = new DocumentModel(); doc.load('# A');
    doc.change('# AB', 'source', 4, 1000); doc.change('# ABC', 'source', 5, 1200);
    doc.breakGroup(); doc.change('# ABC\n\n본문', 'rendered', 0, 1300);
    doc.undo(); expect(doc.text).toBe('# ABC'); doc.undo(); expect(doc.text).toBe('# A'); expect(doc.dirty).toBe(false);
    doc.redo(); expect(doc.text).toBe('# ABC');
  });
  it('a save acknowledgement for an older revision does not clear later edits', () => {
    const doc = new DocumentModel(); doc.load('A'); doc.change('AB', 'source'); const saved = doc.text;
    doc.change('ABC', 'source'); doc.markSaved(saved); expect(doc.dirty).toBe(true);
  });
  it('resets history when loading another file and invalidates redo after new edits', () => {
    const doc = new DocumentModel(); doc.load('A'); doc.change('B', 'source'); doc.undo(); doc.change('C', 'source');
    expect(doc.canRedo).toBe(false); doc.load('D'); expect(doc.canUndo).toBe(false); expect(doc.dirty).toBe(false);
  });
});
