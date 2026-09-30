import { language } from './i18n';
const korean = `# 생각이 문서가 되는 곳

Folio에 오신 것을 환영합니다. **글에 집중하고, 구조는 한눈에.**

왼쪽 목차로 문서를 탐색하고, 위의 **렌더링 / 원문** 버튼으로 편집 방식을 바꿔보세요. 이 문서는 자유롭게 수정할 수 있는 시작 문서입니다.

## 두 가지 방식, 하나의 문서

### 렌더링으로 쓰기

지금 보이는 문장을 클릭해 바로 수정하세요. 텍스트를 선택하고 도구 모음에서 굵게, 기울임, 링크를 적용할 수 있습니다.

> 좋은 문서는 작은 생각 하나에서 시작합니다.

### 원문으로 다듬기

Markdown 문법을 직접 편집하고 싶다면 **원문**으로 전환하세요. 수정 내용과 목차가 함께 바뀝니다.

\`\`\`markdown
# 문서 제목
## 새로운 아이디어
- 첫 번째 할 일
- 두 번째 할 일
\`\`\`

## 오늘의 체크리스트

- [x] 나만의 글쓰기 공간 열기
- [ ] 첫 번째 제목 작성하기
- [ ] Markdown 파일로 저장하기

## 빠른 사용법

| 하고 싶은 일 | 단축키 |
| --- | --- |
| 파일 열기 | Ctrl + O |
| 저장 | Ctrl + S |
| 편집 모드 전환 | Ctrl + Shift + M |
| 실행 취소 | Ctrl + Z |
| 원문에서 찾기 | Ctrl + F |

---

이제 새로운 문서를 열고, 다음 생각을 이어가세요.
`;

const english = `# Where thoughts become documents

Welcome to Folio. **Focus on your words. See the structure at a glance.**

Navigate with the outline on the left. Switch between **Rendered / Source** above. This starter document is yours to edit.

## Two views, one document

### Write in rendered view

Click any sentence to edit it. Select text and use the toolbar to apply bold, italic or a link.

> Every good document starts with a small idea.

### Refine the source

Switch to **Source** to edit Markdown directly. Your changes and the outline stay in sync.

\`\`\`markdown
# Document title
## A new idea
- First task
- Second task
\`\`\`

## Today's checklist

- [x] Open your writing space
- [ ] Write your first heading
- [ ] Save a Markdown file

## Quick reference

| Action | Shortcut |
| --- | --- |
| Open a file | Ctrl + O |
| Save | Ctrl + S |
| Switch editor mode | Ctrl + Shift + M |
| Undo | Ctrl + Z |
| Find | Ctrl + F |

---

Open a new document and keep your thoughts moving.
`;

export const welcome = language === 'en' ? english : korean;
