갱신: 2026-09-18 16:01:36 KST (UTC+09:00)

렌더링 찾기·모서리 반경 축소 · Folio 0.1.11

| 검증 | 결과 |
|---|---|
| 웹 단위 / production UI / 저장 계층 / Windows 통합 | 33 / 67 / 21 / 30개 통과, 총 151개·건너뛴 검사 없음 |
| 렌더링 찾기 | 한글·대소문자·리터럴 특수문자·이모지·서식 경계·표/목록/코드·현재/전체, 순환/스크롤·실시간 수정/Undo·IME·원문 검색 유지·로드 초기화·닫기 후 강조 제거 |
| 문서 불변 | 검색·이동·닫기는 text/revision/dirty/선택·공통 Undo 불변, Windows 호스트 find 경로 검증 |
| UI | 밝음/어두움 캡처 확인·400px 검색창 배치, 웹 버튼 4px·모드 6px·패널 8px, 네이티브 버튼 4 DIP·편집 프레임 8 DIP 검증 |
| 배포 범위 | Windows x64 Release publish 통과. 설치·제거 수명주기 검사는 이번 버전에서 재실행하지 않음 |
| 근거 | artifacts/build-0.1.11.log · artifacts/windows-smoke-0.1.11.json · artifacts/search-light.png · artifacts/search-dark.png · artifacts/windows-search-0.1.11.png |

체크리스트·표 우클릭 복사 · Folio 0.1.10

| 검증 | 결과 |
|---|---|
| 웹 단위 / production UI / 저장 계층 / Windows 통합 | 29 / 61 / 21 / 28개 통과, 총 139개·건너뛴 검사 없음 |
| 체크리스트 | 문단·선택 줄·기존/중첩 목록 전환, 완료 상태·서식 유지, 해제·Undo/Redo, 빈 문서·Enter·중간 분할, 보호 블록 비활성 |
| 표 복사 | 드래그 범위 유지·단일 셀·키보드 메뉴·실패 안내, HTML 서식·TSV, 실제 브라우저/Windows 클립보드 읽기·붙여넣기, 문서 상태 불변 |
| 배포 | Folio-Setup-0.1.10-win-x64-online.exe 생성, 설치 파일·앱/Web 자산 SHA-256 일치. 이번 버전 설치·제거 수명주기는 재실행하지 않음 |
| 근거 | artifacts/build-0.1.10.log · artifacts/windows-smoke-0.1.10.json · artifacts/table-copy-menu.png · artifacts/checklist-light.png |

이미지 선택·파일/스크린샷 붙여넣기 · 2026-09-17

| 검증 | 결과 |
|---|---|
| TypeScript·Vite / Windows Release publish | 통과. 기존 번들 안내 유지 |
| 저장 계층 | 21개 통과. 이미지 고유 파일·배치 사전 검증·첫 저장 복사·복구 식별자·경로 제한 포함 |
| production UI | 전체 53개 중 51개 최초 통과. 이미지 버튼 커서·실제 클립보드 PNG 2개는 단독 3회씩 모두 통과. 클립보드 복원 시 빈 포맷 항목 제외 수정 |
| Windows WebView2 | 25개 통과. 파일 paste → 호스트 저장 → 미저장 이미지 렌더 → Undo → 첫 저장 → Redo → 디스크 재열기·복구 경로 포함 |
| 시스템 클립보드 제한 | 네이티브 경로 복사 1개는 기존 OpenClipboard 오류 5 환경 제약으로 제외. 브라우저 PNG Ctrl+V는 통과 |

실행본: artifacts/Folio-image-ui-20260917-win-x64/Folio.exe. Windows 파일 붙여넣기는 실제 WebView2의 File·DataTransfer 이벤트에서 호스트로 전달하여 검증했다. 파일 선택창 직접 조작, 탐색기 Ctrl+X → 앱 Ctrl+V의 CF_HDROP 경로는 수동 확인 대상. 잘라내기 파일도 원본을 삭제하지 않고 복사한다. 기존 설치본 자동 교체·설치파일 재생성은 수행하지 않았다.

증거: artifacts/windows-smoke-image-ui-20260917.json. API 참고: [Microsoft FileOpenPicker](https://learn.microsoft.com/en-us/uwp/api/windows.storage.pickers.fileopenpicker). 아래는 이전 검증 이력이다.

표 메뉴·문단 간격 조정 · 2026-09-17

| 검증 | 결과 |
|---|---|
| TypeScript·Vite production / Windows publish | 통과. 기존 DOMPurify·ELK 번들 안내 유지 |
| 관련 production UI | 27개 통과: 상단 표 도구 제거·문단/표 간격 동일, 우클릭·Shift+F10 선택 유지, 행/열·정렬·너비·클립보드·Undo/Redo·좁은 창·테마 |
| Windows 호스트 통합 | 23개 통과. 시스템 클립보드 1개는 기존 실행 환경 제약으로 명시적 제외 |
| 시각 확인 | 밝음/어두움 캡처 확인. 표 위 44px 예약 여백 제거, 바깥 여백 15px |
| 실행본 | artifacts/Folio-table-ui-20260917-win-x64/Folio.exe. 최신 웹 자산 64개 해시 대응 바이트 일치 |

표 키보드 메뉴는 최신 DOM 커서를 반영한 뒤 선택 셀 옆에 표시하며 명시적 셀 범위는 유지한다. 기존 설치본 자동 교체·설치파일 재생성은 수행하지 않았다. 증거: artifacts/table-editing-light.png, artifacts/table-editing-dark.png, artifacts/windows-smoke-table-ui-20260917.json. 아래는 이전 검증 이력이다.

Folio 0.1.7 검증 · 경로 복사·Excel/표 클립보드·이미지 아이콘·코드 해제

| 검증 | 결과 | 범위 |
|---|---|---|
| TypeScript·Vite production | 통과 | DOMPurify 공용 번들 안내·기존 ELK 청크 크기 안내 |
| 단위 테스트 | 19개 통과 | 기존 17개·코드 해제 2개: fence/들여쓰기·특수문자·컨테이너·선택 범위 |
| production 브라우저 UI | 50개 통과 | 기존 39개·신규 11개: Excel HTML/TSV·셀 개행/따옴표/빈 값·확장·머리행/본문 복사·잘라내기·서식/너비/정렬·Undo/Redo·재로딩·코드 해제·이미지 호스트 명령·브라우저 Ctrl+C/V |
| 저장 계층 | 15개 통과 | UTF-8/BOM/개행·충돌·이미지·설정·최근 문서 회귀 |
| Windows Release publish | 통과 | 앱/웹 0.1.7, `artifacts/Folio-0.1.7-win-x64-release`, production 웹 64개 파일 해시 일치 |
| Windows 호스트 통합 | 23개 통과·1개 제외 | 경로 선택 팝업·전체 선택·복사 컨트롤·본문 불변, WebView2 Excel 형식 붙여넣기·Undo·코드 해제·이미지 아이콘, 기존 21개 회귀 |
| 시각 확인 | 밝음/어두움·경로 팝업 PNG 확인 | 이미지 아이콘·표 복사 결과·네이티브 전체 경로 선택 |

검증 제한: 시스템 클립보드 쓰기/읽기 1개는 실행 환경의 `OpenClipboard` 액세스 거부(Win32 오류 5)로 명시적 제외했다. `FOLIO_TEST_SKIP_SYSTEM_CLIPBOARD=1`로 실행했고 보고서 `skipped`에 기록한다. 해당 변수를 지정하지 않으면 실제 Windows 클립보드 왕복을 필수 검증한다. 브라우저 Ctrl+C/V는 통과했으며 Windows→Notepad의 경로 붙여넣기, 실제 Excel 앱 복사, 파일 선택 대화상자, 0.1.7 설치/업데이트/제거 수명주기는 수동 검증 대상이다. 경로 복사는 일시 점유 시 6회 재시도 후 실패 알림을 표시하며, 문서를 변경하지 않는다. API 근거: [Microsoft Clipboard.SetContentWithOptions](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.datatransfer.clipboard.setcontentwithoptions).

증거: `artifacts/clipboard-ui-0.1.7.json`, `artifacts/windows-smoke-0.1.7.json`, `artifacts/clipboard-editing-light.png`, `artifacts/clipboard-editing-dark.png`, `artifacts/windows-copy-path-0.1.7.png`. 아래는 이전 버전 검증 이력이다.

Folio 0.1.6 검증 · 본문/H1–H6·표 편집 1차

| 검증 | 결과 | 범위 |
|---|---|---|
| TypeScript·Vite production | 통과 | 기존 Mermaid ELK 청크 크기 안내 유지 |
| 단위 테스트 | 17개 통과 | 문서 모델 6개·제목 변환 11개. ATX/Setext·문단 중간 커서·혼합 레벨·컨테이너·줄바꿈·원문 보존 구간·본문 복원 escape/문단 경계 |
| production 브라우저 UI | 39개 통과 | 기존 27개·신규 편집 12개. 제목 0–6·원문 단축키·행/열 편집·정렬/너비 왕복·내용 지우기·머리행/최소 구조 보호·Tab 추가·다중 셀 우클릭·중첩 표·이력·크기 선택 |
| 100행×50열 | 생성·입력·Undo 통과 | production 4,176ms: 생성 버튼 클릭부터 첫 머리셀 입력 확인까지. UI 테스트 병행 상태의 단일 측정, 지연 보장값 아님 |
| Windows Release publish | 통과 | 앱·웹 0.1.6, `artifacts/Folio-0.1.6-win-x64` |
| Windows 호스트 통합 | 21개 통과 | 기존 19개·신규 2개. 실제 WebView2 제목 메뉴→네이티브 목차, 표 행/열/정렬→공통 이력→원자적 디스크 저장→재열기 |
| 시각 확인 | 밝음/어두움·Windows PNG 확인 | 표 도구의 제목 겹침 수정, 48px 상단 유지·390px 화면 메뉴 경계 확인 |

증거: `artifacts/formatting-ui-0.1.6.json`, `artifacts/windows-smoke-0.1.6.json`, `artifacts/table-editing-light.png`, `artifacts/table-editing-dark.png`, `artifacts/windows-formatting-0.1.6.png`. Windows 검증은 `.tools/qa-profile` 격리 프로필에서 실행했다. 호스트 메뉴 테스트는 WebView2 DOM 클릭/선택 경로를 사용한다. 물리 키보드의 모든 한글 IME 조합·OS 단축키 충돌 및 이번 설치본의 설치/업데이트/제거 수명주기는 별도 재시험하지 않았다. 아래는 기존 버전 검증 이력이다.

Folio 0.1.5 검증 · 최근 문서 20개·전체 경로 검색·표/이미지 크기 저장

| 검증 | 결과 | 범위 |
|---|---|---|
| Windows Release publish | 통과 · 경고 0, 오류 0 | `artifacts/Folio-0.1.5-win-x64`, 앱·웹 패키지 버전 0.1.5 |
| 저장 계층 | 15개 통과 | 기존 10개 + 최근 20개 보관/재로딩·경로 정규화/중복/최신 순서·구형 8개 이관·잘못된 항목·null 보정 |
| production 브라우저 UI | 27개 통과 | 편집기·Mermaid·표 열 너비·이미지 크기·직렬화 재로딩·Undo/Redo |
| Windows 호스트 통합 | 19개 통과 | 기존 17개 + 실제 최근 문서 창의 20개/긴 경로 줄바꿈/검색/빈 상태/취소·동일 파일명 구분/선택 열기/최근 순서 갱신 |
| 시각 확인 | 실제 Windows 캡처 직접 확인 | `.tools/qa-profile/diagnostics/windows-recent-documents.png` |

검증 프로필은 `.tools/qa-profile`로 격리했다. 현재 사용자 앱·문서·설정은 변경하지 않았다. Windows 통합 결과는 `artifacts/windows-smoke-0.1.5.json`, 설치 파일의 버전·크기·SHA-256·동봉 자산 해시는 설치 EXE 옆 `.json`·`.sha256`에 기록한다. 이번 버전의 설치/업데이트/제거 수명주기·WebView2 미설치 PC 시험은 수행하지 않았다. 아래 기록은 이전 개발본·배포 버전의 검증 이력이다.

크기 조절 개발본 검증 · 2026-09-12 · `artifacts/Folio-Layout-20260912-win-x64/Folio.exe`

| 검증 | 결과 | 범위 |
|---|---|---|
| TypeScript·Vite production | 통과 | 기존 선택 ELK 청크 크기 경고 유지 |
| 전체 브라우저 UI | 27개 통과 | 기존 편집·Mermaid 23개 + 크기 조절 4개 |
| 크기 조절 production UI | 4개 통과 | 실제 드래그·크기 저장/재로딩·모드 전환·Undo/Redo·숫자 입력·원본 복원·이미지 비율/경로/title·중첩 표·중복 이미지·잘못된 주석 보존·390px 화면 |
| 문서 모델 | 6개 통과 | 기존 파싱·공통 편집 이력 회귀 |
| Windows Release publish | 통과 | 별도 출력 폴더, 기존 설치 파일 유지 |
| 시각 확인 | 밝음/어두움 PNG 직접 확인 | `artifacts/layout-resizing-light.png`, `artifacts/layout-resizing-dark.png` |

크기 변경은 기존 Markdown snapshot 경로로 저장한다. 이번 작업에서는 실제 Windows 파일 대화상자·디스크 저장 후 재열기·설치 업데이트를 재시험하지 않았다. UI 재로딩은 직렬화된 snapshot을 load 메시지로 다시 전달해 검증했다. 실행본 예제: `examples/layout.md`. 아래는 기존 0.1.4 배포의 이력이며 이번 개발본의 재검증 결과와 구분한다.

Folio 0.1.4 기존 배포 검증 기록 · 설치/업데이트 13개 통과 · Mermaid 구현 기준 검증 56개 유지

| 검증 | 결과 | 확인 범위 |
|---|---|---|
| Windows Release 빌드 | 통과 · 경고 0, 오류 0 | .NET 8.0.425, Windows App SDK 1.8.260804001, win-x64 |
| 문서 모델·목차 | 6개 통과 | 코드/인용 제외, Setext, 중복·깊이 건너뛰기, 보호 문법, 공통 Undo, 오래된 저장 ACK, 이력 초기화, 중복·중첩 Mermaid 블록 본문 위치 |
| 브라우저 UI | production 23개 통과 | 기존 13개 회귀 + Mermaid 10개: 5종 문법·한글·라벨 경계·테마 색상·줄바꿈·확대·정확한 원문 이동·Undo·오류·상한·외부 리소스 차단·구문 설정 보호·ID·비동기·DPI·성능 |
| 파일 저장 계층 | 10개 통과 | UTF-8·BOM·개행·외부 충돌·임시 파일 정리·이미지 복사, 설정 저장/재로딩·구형 설정 이관·범위 보정 |
| Windows 호스트 통합 | 17개 통과 | 기존 15개 + 동봉 Mermaid의 한글 SVG·테마·dirty 불변·네이티브 저장 ACK·UTF-8 재열기 |
| Setup EXE 설치·업데이트·제거 | 0.1.4 경량 13개 통과 · 2026-09-12 | 0.1.3 → 0.1.4 업데이트·문서/설정 보존, 설치된 앱/Web/예제 70개 SHA-256 일치, 재설치·실행 중 업데이트/제거 차단·설치 앱 호스트 통합·제거·파일 연결 보존 |

Mermaid 구현 기준 산출물(2026-09-11): `artifacts/Folio-Mermaid-20260911-final-win-x64/Folio.exe`. 빌드 경고: 웹은 Mermaid에 포함된 선택 ELK 청크 1.47MB에 대한 크기 경고 1건; 동적 청크이므로 기본 Dagre 사용 시 초기 로딩 대상 아님. 웹 자산 총 6,226,629바이트/64개. JS 파일명 내부 점을 하이픈으로 치환해 Windows PRI qualifier 경고 해결; 최종 Windows publish 경고·오류 없음. 파일명 조정 후 참조 flowchart·5종 문법·성능 production 3개 및 Windows 통합 17개 재검증.

성능 측정: Intel Core i7-1165G7, Microsoft Edge 152.0.4191.66, production 로컬 번들. 20노드·30연결선, 최초 437ms, 반복 10회 p95 361ms. 문서 로드·AST·SVG 렌더·DOM 삽입·상태 확인 포함; 순수 렌더 함수 시간이나 모든 PC 성능 보장은 아님. 20블록 문서의 화면 밖 지연 렌더·끝 블록 스크롤 렌더 확인. 외부 요청 0건. 원시 기록: `artifacts/mermaid-performance.json`.

시각 검증: `artifacts/mermaid-light.png`, `mermaid-dark.png`, `mermaid-expanded.png` 및 `.tools/qa-profile/diagnostics/windows-mermaid.png` 직접 확인. 초기 정제 과정의 검은 노드 문제 수정 후 SVG fill·연결선 fill·라벨 경계 검사를 추가. 브라우저 560px 폭·DPI 1/1.5/2에서 확대 모달 범위 확인. 웹 화면 검증과 실제 Windows 호스트 검증을 각각 수행했다.

재현: `web`에서 `npm test`, `npm run build`, PowerShell `$env:FOLIO_TEST_PRODUCTION='1'; npm run test:ui`; 루트에서 `.tools/dotnet/dotnet.exe run --project tests/Folio.Storage.Tests/Folio.Storage.Tests.csproj -c Release`, `scripts/Test-Windows.ps1 -AppDirectory <최종 실행 폴더>`.

설치 검증 보고서: `artifacts/installer-tests-online.json`. 설치 파일명·SHA-256으로 검증한 패키지 식별. EXE 옆 `.json`·`.sha256`에 크기·생성 시각·runtime 해시 기록. 구버전 오프라인 보고서는 `artifacts/installer-tests.json`이며 현재 버전 검증으로 간주하지 않는다.

Windows 검증은 격리 프로필·별도 진단 인스턴스로 수행한다. 기존 사용자 앱·미저장 문서를 유지한다. 설치 시험은 Folio 설치/연결 등록이 없는 상태에서 실행하고, 기존 시작 메뉴 바로가기는 /NOICONS와 해시 비교로 보존한다. 새 바로가기 생성은 이번 실행에서 생략했다. 기존 .md/.markdown 기본값·UserChoice ProgID/Hash는 설치 전후·제거 후 동일함을 확인했다.

시각 확인: `.tools/qa-profile/diagnostics/windows-shell.png`는 상단 제목·네이티브 목차, `windows-editor.png`는 서식/모드 도구 줄·렌더링 본문, `windows-configuration.png`는 설정창. 네이티브 픽셀 캡처에서 WebView2 표면은 비어 있으므로 본문은 WebView2 별도 캡처로 확인한다. 실제 컨트롤·호스트 메시지 왕복도 함께 검증했다.

검증 한계: Explorer 더블클릭 UI와 기본 앱 선택 화면 직접 조작, 실제 Windows 한글 IME·스크린리더·파일 선택 대화상자, Windows 10·ARM64·다른 PC 첫 설치, WebView2 미설치 PC의 최초 runtime 다운로드, 장시간 복구·대용량 성능은 별도 수동 검증 대상이다. 연결 명령의 실제 프로세스 실행·한글 경로 전달은 검증했으며 사용자 기본 앱을 테스트 목적으로 바꾸지 않았다. 합성 composition 이벤트는 실제 IME 검증을 대체하지 않는다. 코드 서명·SmartScreen 평판은 미적용이다.

저장 안정성 검증은 단일 앱의 정상 파일시스템 동작·외부 수정 충돌 범위다. 전원 차단·네트워크 드라이브·최종 해시 확인과 파일 교체 사이의 타 프로세스 쓰기까지 조정하는 분산 잠금은 제공하지 않는다.

0.1.4 배포: `artifacts/Folio-Setup-0.1.4-win-x64-online.exe`, 64,670,615바이트. 앱·패키지·lock 버전 0.1.4; 동일 AppId 유지. `build.ps1 -SkipTests -Installer`로 재빌드했으며 Web 65개 파일이 2026-09-11 검증본과 바이트 단위 일치한다. 이번 작업에서는 웹 기능 테스트를 반복하지 않고 설치된 앱의 실제 Windows 통합 진단 17개를 실행했다. 이전 구현의 56개 검증·성능 수치는 2026-09-11 기준이다. 최종 Windows publish 경고·오류 없음; 웹의 선택 ELK 청크 크기 경고는 기존과 동일하다.

설치 검증 재현: `scripts/Test-Installer.ps1 -InstallerPath artifacts/Folio-Setup-0.1.4-win-x64-online.exe -PreviousInstallerPath artifacts/Folio-Setup-0.1.3-win-x64-online.exe`. 격리 경로에서 이전 버전 설치→업데이트→재설치→실행 중 보호→제거 완료. 원본 사용자 바로가기·Markdown 기본 앱 유지. 버전별 증빙: 설치 EXE 옆 `.tests.json`, `.json`, `.sha256`. 이전 0.1.3 증빙은 `artifacts/installer-tests-0.1.3-online.json`에 보존. 오프라인 0.1.1 설치파일은 이번 배포 갱신 대상에서 제외했다.
