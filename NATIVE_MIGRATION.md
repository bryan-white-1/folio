갱신: 2026-09-30 09:50 KST (UTC+09:00)

# Folio 0.2.2 · 2-A 네이티브 호스트

범위: C#/.NET/WinUI 호스트를 C++20/Win32로 교체. 기존 TypeScript 편집기·Milkdown/ProseMirror·CodeMirror·Mermaid·DOMPurify 유지. 신규 편집 엔진·Markdown 파서 구현 없음. 기존 C# 소스·공개 0.1.11 배포물 유지. 공유 WebView2 Runtime 필요; 실행 파일/설치 파일 크기에 공유 런타임 크기는 포함하지 않는다.

| 계층 | 구현 |
|---|---|
| Windows | `src/Folio.Native/main.cpp`: 창·DPI·아이콘·파일 선택·WebView2 COM·비동기 메시지·클립보드 |
| 저장 | `platform.h`: UTF-8/BOM/개행·SHA-256 충돌 검사·임시 파일 flush/교체·설정/복구·이미지 가져오기/복사 |
| IPC | `activation.h`: 기존 mutex/pipe 이름·32KB UTF-8 경로·ACK·동일 사용자 ACL·로컬 연결·32건 대기·취소/시간 제한 |
| JSON/COM | 자체 JSON 값/파서·직렬화, COM 수명/콜백 보조 코드. 외부 C++ 애플리케이션 프레임워크 없음 |
| 웹 셸 | `native-shell.ts/css`: 상단 바·목차·최근 문서·설정·경로·대화상자. `?native=1`일 때만 활성화 |
| 기존 편집기 | `main.ts`에 셸 초기화·셸 입력 필드 단축키 분리·앱 문자열 번역 연결. 기존 편집 로직·웹 의존성 유지 |

호환: `%LOCALAPPDATA%/Folio`, `settings.json`, `recovery.json`, `drafts/<id>/assets` 유지. 같은 사용자 실행 요청은 기존 프로세스로 전달하므로 구버전 실행 중에는 그 창이 열린다. 새 네이티브 앱을 확인하려면 기존 Folio를 저장·종료한 뒤 실행한다. 테스트는 별도 `FOLIO_DATA_DIRECTORY`를 사용한다.

언어: settings.json Language(ko/en) 우선, 미지정 시 설치 언어, ZIP은 Windows UI 언어(한국어/그 외 영어). 네이티브·웹은 web/src/locales/en.json을 공유하며 빌드 시 locales/en.json 동봉. 설정 변경은 다음 실행부터 적용; 사용자 문서·경로·목차·편집 이력 불변. 예제 메뉴는 examples/{ko,en} 선택. 밝은 테마 본문·목차 배경 #FFFFFF.

저장 계약: 변경 없는 파일 바이트 유지, 수정 시 기존 BOM/주요 개행 유지. 저장 스냅샷·documentId/revision ACK, 외부 변경 시 덮어쓰기/다른 이름/취소, 미저장 확인, 3초 복구 기록. 이미지 상대 경로·초안 이미지·Save As 복사·파일 충돌 거부. 파일 요청/이미지 응답은 편집기 메시지 규약 유지.

경계: 앱 origin 외 탐색·팝업·권한·다운로드 차단. 이미지 경로는 canonical 경로 기준 문서 폴더 내부만 허용. JSON 깊이·파일/이미지/IPC 크기 제한. 기존 CSP·SVG/HTML 정제 유지. 원문 편집기 전체 최적화·WebView2 제거·라이브러리 제거는 2-A 범위 밖.

| 빌드/검증 | 명령 |
|---|---|
| 기본 빌드·검증 | `./build.ps1` |
| 설치 EXE·ZIP | `./build.ps1 -Installer -Zip` |
| 기존 WinUI | `./build.ps1 -HostMode Legacy` |
| 네이티브만 재컴파일 | `./scripts/Build-Native.ps1 -SkipWebBuild -SkipTests` — 기존 web/dist 재사용 |
| 실제 앱 통합 | `./scripts/Test-Windows.ps1 -AppDirectory <네이티브 배포 폴더>` |
| 설치/업그레이드/제거 | `./scripts/Test-NativeInstaller.ps1 -AppDirectory <네이티브 배포 폴더> -LegacyDirectory artifacts/Folio-0.1.11-win-x64` |

도구: LLVM-MinGW 20260922·WebView2 SDK 1.0.3179.45 고정. 프로젝트 `.tools/native`에 다운로드·SHA-256 검사, Loader Microsoft 서명 검사. C++ 표준 런타임 정적 링크, Windows UCRT 사용. .NET SDK·Windows App SDK 설치/배포 불필요. 빌드 도구 라이선스와 기존 웹 의존성 고지 동봉.

업그레이드: 동일 설치 AppId 유지. 알려진 0.1.11 런타임/웹 자산은 상대 경로+SHA-256 일치 파일만 정리. 사용자 문서·수정된 파일·미등록 구버전 파일은 보존. QA는 별도 AppId·설치 경로, 바로가기/연결 미선택으로 실제 사용자 설치와 분리한다.

README 개편 전 측정: 네이티브 폴더 약 8.50MiB, 온라인 설치 EXE 약 5.58MiB. 기존 폴더 215.43MiB·온라인 설치 EXE 61.83MiB 대비 각각 약 3.9%·9.0%. 공개 패키지는 영문 README·릴리스 노트·스크린샷을 추가 동봉하므로 최종 크기는 릴리스 자산의 .json·.sha256을 기준으로 한다. 검증 결과는 TEST_RESULTS.md 참고. 패키지 크기 감소는 실행 메모리 90% 감소를 의미하지 않는다.

수동 검증 잔여: 물리 Windows 한글 IME·실제 Excel 앱·OS 파일 선택 대화상자·스크린리더·Windows 10·WebView2 미설치 PC·장시간/대용량 문서. 합성 composition 이벤트와 브라우저 클립보드 테스트는 실제 IME/Excel 검증을 대체하지 않는다. 미서명 빌드. 공개 배포·영문 변경 내역: [Folio v0.2.2](https://github.com/bryan-white-1/folio/releases/tag/v0.2.2).
