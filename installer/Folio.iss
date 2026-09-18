#ifndef AppVersion
  #error AppVersion must match the validated Windows publish folder.
#endif
#ifndef PayloadDir
  #error PayloadDir must point to a validated Windows publish folder.
#endif
#ifndef RuntimeInstaller
  #error RuntimeInstaller must point to the signed WebView2 installer.
#endif
#ifndef OfflineRuntime
  #define OfflineRuntime "0"
#endif
#if OfflineRuntime == "1"
  #define RuntimeFileName "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
  #define InstallerSuffix ""
#else
  #define RuntimeFileName "MicrosoftEdgeWebview2Setup.exe"
  #define InstallerSuffix "-online"
#endif
#ifndef OutputPath
  #define OutputPath "..\artifacts"
#endif

[Setup]
AppId={{A5B41CCB-9B45-467E-9748-621958D995B9}
AppName=Folio
AppVersion={#AppVersion}
AppVerName=Folio {#AppVersion}
AppPublisher=Folio
DefaultDirName={localappdata}\Programs\Folio
DefaultGroupName=Folio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputPath}
OutputBaseFilename=Folio-Setup-{#AppVersion}-win-x64{#InstallerSuffix}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
WizardImageFile=assets\wizard.bmp
WizardSmallImageFile=assets\wizard-small.bmp
SetupIconFile=..\src\Folio\Assets\Folio.ico
UninstallDisplayIcon={app}\Folio.exe
UninstallDisplayName=Folio Markdown Editor
DisableWelcomePage=no
DisableProgramGroupPage=yes
AllowNoIcons=yes
CloseApplications=no
RestartApplications=no
ChangesAssociations=yes
SetupLogging=yes
UsePreviousTasks=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
korean.WelcomeLabel1=생각을 문서로, Folio
#if OfflineRuntime == "1"
korean.WelcomeLabel2=Markdown 제목으로 문서를 탐색하고, 렌더링과 원문에서 자유롭게 편집하세요.%n%nFolio와 필요한 실행 구성 요소를 이 계정에 설치합니다. 별도의 압축 해제나 개발 도구가 필요하지 않습니다.%n%n기존 문서와 개인 설정은 유지됩니다.
#else
korean.WelcomeLabel2=Markdown 제목으로 문서를 탐색하고, 렌더링과 원문에서 자유롭게 편집하세요.%n%nWebView2가 설치되어 있으면 바로 진행합니다. 없는 PC에서는 자동으로 다운로드하므로 인터넷 연결이 필요합니다.%n%n기존 문서와 개인 설정은 유지됩니다.
#endif
korean.FinishedLabel=Folio 설치가 완료되었습니다.%n%n시작 메뉴에서 Folio를 열어 문서 작성을 시작하세요.
english.WelcomeLabel1=Make room for your words.
#if OfflineRuntime == "1"
english.WelcomeLabel2=Explore Markdown by heading. Edit your document in rendered or source mode.%n%nSetup installs Folio and the required runtime for your account. No development tools or manual extraction needed.%n%nYour documents and preferences are preserved.
#else
english.WelcomeLabel2=Explore Markdown by heading. Edit your document in rendered or source mode.%n%nIf WebView2 is installed, setup continues immediately. Otherwise, it is downloaded automatically and an internet connection is required.%n%nYour documents and preferences are preserved.
#endif

[CustomMessages]
korean.DesktopShortcut=바탕 화면에 바로가기 만들기
korean.LaunchFolio=Folio 실행
korean.AssociateFiles=Markdown 문서를 Folio와 연결 (.md, .markdown)
korean.DefaultApps=Markdown 기본 앱 설정 열기 (Folio 선택)
english.AssociateFiles=Register Folio for Markdown documents (.md, .markdown)
english.DefaultApps=Choose Folio as the default Markdown app
korean.CloseFolio=설치 대상 Folio가 실행 중입니다. 문서를 저장하고 Folio를 종료한 뒤 다시 시도해주세요.
korean.RuntimeInstalling=문서 편집에 필요한 WebView2를 설치하고 있습니다…
korean.RuntimeFailed=WebView2 설치를 완료하지 못했습니다. %1
korean.ProcessCheckFailed=실행 중인 Folio를 확인하지 못했습니다. Folio를 종료하고 다시 시도해주세요.
english.DesktopShortcut=Create a desktop shortcut
english.LaunchFolio=Launch Folio
english.CloseFolio=The Folio installation being updated is running. Save your document and close Folio, then try again.
english.RuntimeInstalling=Installing WebView2 for the document editor…
english.RuntimeFailed=WebView2 installation did not complete. %1
#if OfflineRuntime == "1"
korean.RuntimeFailureHint=설치 로그를 확인한 뒤 다시 실행해주세요. 오류 코드: %1
english.RuntimeFailureHint=Check the setup log and try again. Error code: %1
#else
korean.RuntimeFailureHint=인터넷 연결을 확인하고 다시 설치해주세요. 오류가 계속되면 오프라인 설치 파일을 사용해주세요. 오류 코드: %1
english.RuntimeFailureHint=Check your internet connection and try again. If the problem persists, use the offline installer. Error code: %1
#endif
english.ProcessCheckFailed=Could not check running Folio instances. Close Folio and try again.

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopShortcut}"; Flags: unchecked
Name: "associatefiles"; Description: "{cm:AssociateFiles}"

[Registry]
Root: HKCU; Subkey: "Software\Classes\Folio.Markdown"; ValueType: string; ValueData: "Markdown Document"; Tasks: associatefiles; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Folio.Markdown\DefaultIcon"; ValueType: string; ValueData: """{app}\Folio.exe"",0"; Tasks: associatefiles
Root: HKCU; Subkey: "Software\Classes\Folio.Markdown\shell\open\command"; ValueType: string; ValueData: """{app}\Folio.exe"" ""%1"""; Tasks: associatefiles
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "Folio.Markdown"; ValueData: ""; Tasks: associatefiles; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "Folio.Markdown"; ValueData: ""; Tasks: associatefiles; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Folio\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Folio"; Tasks: associatefiles; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Folio\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Markdown editor"; Tasks: associatefiles
Root: HKCU; Subkey: "Software\Folio\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "Folio.Markdown"; Tasks: associatefiles
Root: HKCU; Subkey: "Software\Folio\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "Folio.Markdown"; Tasks: associatefiles
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Folio"; ValueData: "Software\Folio\Capabilities"; Tasks: associatefiles; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\Folio"; ValueType: string; ValueData: "Folio에서 편집"; Tasks: associatefiles; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\Folio\command"; ValueType: string; ValueData: """{app}\Folio.exe"" ""%1"""; Tasks: associatefiles
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\Folio"; ValueType: string; ValueData: "Folio에서 편집"; Tasks: associatefiles; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\Folio\command"; ValueType: string; ValueData: """{app}\Folio.exe"" ""%1"""; Tasks: associatefiles

[Files]
; Extract prerequisite before the solid-compressed application payload.
Source: "{#RuntimeInstaller}"; Flags: dontcopy nocompression
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Excludes: "*.pdb,*.ps1,*.log,*.WebView2\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Folio"; Filename: "{app}\Folio.exe"; WorkingDir: "{app}"; Comment: "Folio Markdown Editor"; AppUserModelID: "Folio.MarkdownEditor"
Name: "{autodesktop}\Folio"; Filename: "{app}\Folio.exe"; WorkingDir: "{app}"; Tasks: desktopicon; AppUserModelID: "Folio.MarkdownEditor"

[InstallDelete]
; Retire the old script uninstaller when upgrading a script-based installation.
Type: files; Name: "{app}\Install-Folio.ps1"
Type: files; Name: "{app}\Uninstall-Folio.ps1"

[Run]
Filename: "ms-settings:defaultapps?registeredAppUser=Folio"; Description: "{cm:DefaultApps}"; Tasks: associatefiles; Flags: shellexec nowait postinstall skipifsilent
Filename: "{app}\Folio.exe"; Description: "{cm:LaunchFolio}"; Flags: nowait postinstall skipifsilent unchecked

[Code]
const
  WebViewKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasRuntimeVersion(RootKey: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, WebViewKey, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function WebViewInstalled: Boolean;
begin
  Result := HasRuntimeVersion(HKLM32) or HasRuntimeVersion(HKCU32) or HasRuntimeVersion(HKCU64);
end;

function TargetAppRunning: Boolean;
var
  Locator, Services, Processes, Process: Variant;
  Index: Integer;
  ExecutablePath: String;
begin
  Result := False;
  if not FileExists(ExpandConstant('{app}\Folio.exe')) then Exit;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('', 'root\CIMV2');
    Processes := Services.ExecQuery('SELECT ExecutablePath FROM Win32_Process WHERE Name = ''Folio.exe''');
    for Index := 0 to Processes.Count - 1 do begin
      Process := Processes.ItemIndex(Index);
      if VarIsNull(Process.ExecutablePath) then begin
        Result := True;
        Exit;
      end;
      ExecutablePath := Process.ExecutablePath;
      if CompareText(ExecutablePath, ExpandConstant('{app}\Folio.exe')) = 0 then begin
        Result := True;
        Exit;
      end;
    end;
  except
    Log(CustomMessage('ProcessCheckFailed'));
    Result := True;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if TargetAppRunning then begin
    Result := CustomMessage('CloseFolio');
    Exit;
  end;
  if WebViewInstalled then begin
    Log('WebView2 runtime detected; bundled prerequisite skipped.');
    Exit;
  end;
  WizardForm.StatusLabel.Caption := CustomMessage('RuntimeInstalling');
  Log('Preparing WebView2 prerequisite: {#RuntimeFileName}');
  ExtractTemporaryFile('{#RuntimeFileName}');
  ExitCode := -1;
  if not Exec(ExpandConstant('{tmp}\{#RuntimeFileName}'),
    '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
    Result := FmtMessage(CustomMessage('RuntimeFailed'), [FmtMessage(CustomMessage('RuntimeFailureHint'), [IntToStr(ExitCode)])]);
    Exit;
  end;
  Log('WebView2 installer exit code: ' + IntToStr(ExitCode));
  if not WebViewInstalled then
    Result := FmtMessage(CustomMessage('RuntimeFailed'), [FmtMessage(CustomMessage('RuntimeFailureHint'), [IntToStr(ExitCode)])]);
end;

function InitializeUninstall: Boolean;
begin
  Result := not TargetAppRunning;
  if not Result then
    SuppressibleMsgBox(CustomMessage('CloseFolio'), mbError, MB_OK, IDOK);
end;

// Inno removes only its recorded application files.
// User Markdown files, AppData settings/recovery, and shared WebView2 remain intact.
