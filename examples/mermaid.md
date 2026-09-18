갱신: 2026-09-11 10:06:09 KST (UTC+09:00)

# Mermaid 다이어그램

원문 모드에서 Mermaid 구문을 수정하고 렌더링으로 전환하면 결과를 확인할 수 있습니다. 각 카드의 **원문 수정**·**확대** 버튼을 사용하세요.

## Excel 처리 흐름

```mermaid
flowchart TB
    A("`Excel 업로드
Template + Supplier
Workbooks`")
    B("`서버: Sheet별 셀 JSON 구성
셀 주소·값·수식·표시 형식·병합 범위`")
    C("`LLM ① 구조 탐지
Sheet Type / TABLE·LIST·TEXT 영역
Header·Identifier·Field 역할`")
    D("서버: 영역 구조 검증")
    E("`서버: 원본 셀에서 추출
영역별 Markdown + Source Map`")
    F("원본 셀 JSON도 입력")
    A --> B --> C --> D --> E
    B -.- F
```

## 요청과 응답

```mermaid
sequenceDiagram
    participant U as 사용자
    participant S as 서버
    participant A as 분석기
    U->>S: 문서 업로드
    S->>A: 구조 분석 요청
    A-->>S: 분석 결과
    S-->>U: 다이어그램 표시
```

## 클래스

```mermaid
classDiagram
    Document "1" *-- "many" Diagram
    Document : +String markdown
    Document : +save()
    Diagram : +String source
    Diagram : +render()
```

## 상태

```mermaid
stateDiagram-v2
    [*] --> 대기
    대기 --> 렌더링: 화면 표시
    렌더링 --> 완료: 성공
    렌더링 --> 오류: 구문 오류
    오류 --> 렌더링: 원문 수정
    완료 --> [*]
```

## 데이터 관계

```mermaid
erDiagram
    DOCUMENT ||--o{ DIAGRAM : contains
    DOCUMENT {
        string title
        string markdown
    }
    DIAGRAM {
        string source
        string language
    }
```
