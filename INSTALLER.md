갱신: 2026-09-30 08:38 KST (UTC+09:00)

Folio 0.2.2 · Windows 네이티브 호스트 설치 패키지

기본 산출물: `artifacts/Folio-Setup-0.2.2-win-x64-online.exe`. C++/Win32·WebView2 Loader·기존 웹 편집기를 동봉하며 .NET/WinUI 런타임은 제외한다. 공유 WebView2는 필요하며 최초 설치 용량은 앱 패키지와 별도다. `./build.ps1 -HostMode Legacy -Installer`로 아래 기존 0.1.11 패키지도 빌드할 수 있다.

0.1.11 → 0.2.2: 동일 AppId·설정·복구·파일 연결 규약 유지. 설치 전 실행 중인 대상 앱 종료 필요. `installer/legacy-0.1.11-files.txt`에 기록한 상대 경로와 SHA-256이 모두 일치하는 구버전 런타임·웹 자산만 제거한 후 새 파일 설치. 사용자 문서·변경된 파일·알 수 없는 파일은 유지한다. 다른 구버전의 미등록 파일은 남을 수 있다.

언어: 설치 선택을 install-language.txt에 기록. 유효한 앱 Language 설정이 없으면 메뉴·안내·시작 문서·예제에 적용한다. 명시적 앱 설정은 재설치보다 우선하며 앱 내 변경은 저장 후 재시작 적용. examples/en·examples/ko 모두 동봉하고, 루트 examples는 선택 언어 파일이 없을 때만 생성해 기존 예제를 보존한다. 탐색기 우클릭은 설치 언어의 “Folio에서 편집”/“Edit with Folio”. 제거 시 설치 언어 표식도 삭제한다.

네이티브 설치 검증: `./scripts/Test-NativeInstaller.ps1 -AppDirectory <네이티브 배포 폴더> -LegacyDirectory artifacts/Folio-0.1.11-win-x64`. 동일 설치 스크립트에서 QA AppId만 분리하고 바로가기·파일 연결을 선택하지 않는다. 한글 경로 설치·영어/한국어 초기 언어·영문 예제·앱 언어 우선/복구·선택적 구버전 업그레이드·재설치·실제 WebView2 통합·제거·사용자 문서 및 기존 설치 등록 보존을 검증한다. 결과: `artifacts/native-installer-tests.json`. 현재 계정의 실제 Folio 설치는 교체하지 않는다.

아래는 기존 0.1.11 배포 계약·검증 절차다.

경량 권장: `artifacts/Folio-Setup-0.1.11-win-x64-online.exe` 하나를 복사·실행한다. WebView2가 없는 PC에서만 인터넷 연결이 필요하다. 구버전 오프라인용(0.1.1, Configuration 미포함): `artifacts/Folio-Setup-0.1.1-win-x64.exe` 약 320MB. 두 버전 모두 압축 해제·PowerShell·.NET SDK 설치 불필요. 정확한 크기는 각 EXE 옆 `.json`의 bytes 참고.

| 항목 | 계약 |
|---|---|
| 설치 | 한국어 기본·영어 선택, 사용자 계정 권한, 경로 선택, 시작 메뉴 등록, 바탕 화면 선택 |
| 파일 연결 | 추가 작업의 Markdown 연결 기본 체크: .md·.markdown, 연결 프로그램 목록·Folio에서 편집 우클릭 명령·문서 아이콘·기본 앱 후보 등록 |
| 기본 앱 선택 | 완료 화면의 Markdown 기본 앱 설정 열기 → Folio → .md·.markdown 선택. 기존 Windows 기본 앱은 자동 교체하지 않음. 앱별 페이지가 열리지 않는 Windows에서는 기본 앱 화면에서 Folio 검색 |
| 파일 열기 | Folio 실행 중에도 파일 요청을 기존 창으로 전달. 미저장 문서는 저장·버리기·취소 후 전환 |
| 기본 경로 | `%LOCALAPPDATA%\Programs\Folio` |
| 동봉 | 공통: Folio·.NET 8·Windows App SDK·Mermaid 포함 웹 편집 자산·예제 문서. 경량: WebView2 Bootstrapper 약 1.8MB. 오프라인: x64 Standalone 약 258.6MB |
| WebView2 | 시스템/사용자 설치 확인 → 설치됨: 생략 / 없음: 동봉 설치 파일 실행 → 재확인 → 앱 설치. 경량은 runtime 다운로드, 오프라인은 동봉 runtime 사용. 실패 시 앱 설치 중단·재시도 안내 |
| 업데이트 | 0.1.11 Setup 실행, 동일 AppId·설치 경로 사용. 경로 복사·Excel/표 클립보드·이미지 아이콘·코드 해제 포함. 해당 경로의 앱 실행 중이면 저장·종료 안내 |
| 제거 | Windows 설정 → 앱 → 설치된 앱 → Folio Markdown Editor → 제거. Folio 파일 연결 등록·우클릭 명령 정리 |
| 보존 | 사용자 Markdown·이미지, `%LOCALAPPDATA%\Folio` 설정·복구본, 공유 WebView2 |
| 기존 ZIP 앱 | 기존 창 저장·종료 후 설치 앱 실행. 같은 사용자 설정·최근 파일 사용. ZIP 폴더는 별도 유지 |
| 코드 서명 | 현재 미서명. Windows에서 게시자 미확인·SmartScreen 안내가 표시될 수 있음. 신뢰된 배포 서명용 인증서는 별도 필요 |
| 무결성 | EXE 옆 `.sha256`·`.json`에 SHA-256·크기·빌드 시각·동봉 runtime 해시 기록 |

빌드: `./build.ps1 -Installer`는 경량 기본. 오프라인은 `./build.ps1 -Installer -RuntimeMode Offline`. 기존 publish 사용: `./scripts/Build-Installer.ps1 -AppDirectory <폴더> [-RuntimeMode Online|Offline]`. Inno Setup 7.1.0·Microsoft WebView2를 공식 배포처에서 확보하고 Authenticode를 검사한다. 다운로드 캐시는 `.tools/installer`; 동일 이름의 기존 생성물은 해당 경로의 `previous-*`에 보관한다. 경량/오프라인 파일명은 서로 달라 별도 유지된다. 캐시된 Evergreen 설치 파일 갱신은 해당 파일을 별도 보관 후 재빌드한다. Inno Setup 7 상업용 빌드는 해당 도구의 상업 라이선스 조건을 따른다.

검증: `./scripts/Test-Installer.ps1`는 경량 기본, 다른 파일은 `-InstallerPath <EXE>` 지정. Folio 설치·파일 연결 등록이 없는 계정에서 수행. 기존 시작 메뉴 바로가기가 있으면 /NOICONS로 생성·제거를 생략하고 기존 파일 보존을 검증한다. 임시 한글 경로에 설치 후 재설치, 실행 중 업데이트·제거 차단, 설치 앱 통합 진단, 제거·문서 보존, 연결 옵션 해제/선택, 두 확장자의 열기 명령·아이콘·기본 앱 후보 등록·제거, 기존 기본 앱 보존을 확인한다. 테스트 문서·로그는 `.tools/installer/qa-*`에 유지한다. 결과: 경량 `artifacts/installer-tests-online.json`, 오프라인 `artifacts/installer-tests.json`.

한계: Windows 11의 기존 WebView2 환경에서 검증. WebView2가 없는 새 PC의 최초 온라인/오프라인 설치, Windows 10·ARM64, SmartScreen 평판은 별도 환경 검증 대상이다. 테스트를 위해 공유 WebView2를 제거하지 않는다. 경량 설치 파일 감소는 runtime 미설치 PC의 총 다운로드량·설치 후 디스크 사용량 감소를 뜻하지 않는다.

파일 연결 근거: [Microsoft 기본 앱 설정 URI](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-apps-settings), [Inno Setup 파일 연결 등록 예시](https://jrsoftware.org/isfaq.php).

배포 근거: [Microsoft WebView2 배포](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution), [Inno Setup 공식 다운로드·라이선스 안내](https://jrsoftware.org/isdl.php).

0.1.4 → 0.1.5 업데이트 검증 명령: `./scripts/Test-Installer.ps1 -PreviousInstallerPath artifacts/Folio-Setup-0.1.4-win-x64-online.exe`. 이전 버전 설치 후 문서·설정을 유지한 업데이트와 설치된 앱·Web 자산·예제의 SHA-256 일치를 확인한다.
