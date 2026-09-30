Updated: 2026-09-30 08:26 KST (UTC+09:00)

# Mermaid diagrams

Edit Mermaid syntax in Source view, then switch to Rendered to see the result. Use each card's **Edit source** and **Zoom in** buttons.

## Spreadsheet workflow

```mermaid
flowchart TD
    A[Upload spreadsheet] --> B[Read workbook]
    B --> C{Valid structure?}
    C -- Yes --> D[Analyze data]
    C -- No --> E[Report errors]
    D --> F[Create report]
    E --> A
```

## Request and response

```mermaid
sequenceDiagram
    participant U as User
    participant S as Server
    participant A as Analyzer
    U->>S: Upload document
    S->>A: Analyze structure
    A-->>S: Analysis results
    S-->>U: Display diagram
```

## Classes

```mermaid
classDiagram
    Document "1" *-- "many" Diagram
    Document : +String markdown
    Document : +save()
    Diagram : +String source
    Diagram : +render()
```

## States

```mermaid
stateDiagram-v2
    [*] --> Waiting
    Waiting --> Rendering: Display
    Rendering --> Ready: Success
    Rendering --> Error: Syntax error
    Error --> Rendering: Edit source
    Ready --> [*]
```

## Data relationships

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
