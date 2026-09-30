param([Parameter(Mandatory)][string]$AppDirectory, [string]$LegacyDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$payload = (Resolve-Path -LiteralPath $AppDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $payload 'folio-build.json') -Raw | ConvertFrom-Json
$qaRoot = Join-Path $projectRoot ('.tools/installer/native-qa-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$installPath = Join-Path $qaRoot '설치 경로/Folio'
New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
$compiler = Join-Path $projectRoot '.tools/installer/inno/ISCC.exe'
$runtime = Join-Path $projectRoot '.tools/installer/MicrosoftEdgeWebview2Setup.exe'
if (!(Test-Path -LiteralPath $compiler) -or !(Test-Path -LiteralPath $runtime)) { throw 'Build the production installer first to prepare Inno Setup and the verified WebView2 bootstrapper.' }
# Compile the same installer with an isolated AppId. Silent tests select no
# associations or shortcuts, and never touch the user's installed Folio.
$qaId = '029B6072-77A1-4D49-A00A-BFA04A270070'
$qaRegistry = "HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/{$qaId}_is1"
if (Test-Path -LiteralPath $qaRegistry) { throw 'An earlier QA installation remains; preserve it for inspection before rerunning.' }
$originalRegistry = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/{A5B41CCB-9B45-467E-9748-621958D995B9}_is1'
$before = if (Test-Path -LiteralPath $originalRegistry) { Get-ItemProperty -LiteralPath $originalRegistry | ConvertTo-Json -Compress } else { '' }
$scriptPath = Join-Path $qaRoot 'Folio-QA.iss'
$source = Get-Content -LiteralPath (Join-Path $projectRoot 'installer/Folio.iss') -Raw
$source = $source.Replace('A5B41CCB-9B45-467E-9748-621958D995B9', $qaId).Replace('AppName=Folio', 'AppName=Folio Native QA')
$source = $source.Replace('WizardImageFile=assets\wizard.bmp', 'WizardImageFile=' + (Join-Path $projectRoot 'installer/assets/wizard.bmp'))
$source = $source.Replace('WizardSmallImageFile=assets\wizard-small.bmp', 'WizardSmallImageFile=' + (Join-Path $projectRoot 'installer/assets/wizard-small.bmp'))
$source = $source.Replace('SetupIconFile=..\src\Folio\Assets\Folio.ico', 'SetupIconFile=' + (Join-Path $projectRoot 'src/Folio/Assets/Folio.ico'))
$source = $source.Replace('Source: "legacy-0.1.11-files.txt"', 'Source: "' + (Join-Path $projectRoot 'installer/legacy-0.1.11-files.txt') + '"')
Set-Content -LiteralPath $scriptPath -Value $source -Encoding utf8
function Build-QA([string]$Directory, [string]$Version, [int]$Native) {
    & $compiler '/Qp' "/DAppVersion=$Version" "/DPayloadDir=$Directory" "/DRuntimeInstaller=$runtime" '/DOfflineRuntime=0' "/DNativeHost=$Native" "/DOutputPath=$qaRoot" $scriptPath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'QA installer compilation failed' }
    return Join-Path $qaRoot "Folio-Setup-$Version-win-x64-online.exe"
}
function Install-QA([string]$Setup, [string]$Name, [string]$Language = 'english') {
    $process = Start-Process -FilePath $Setup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=""',('/LANG=' + $Language),('/DIR="' + $installPath + '"'),('/LOG="' + (Join-Path $qaRoot ($Name + '.log')) + '"')) -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(60000) -or $process.ExitCode -ne 0) { throw "QA installation failed: $Name" }
}
$results = [Collections.Generic.List[string]]::new()
$setup = Build-QA $payload $manifest.version 1
if ($LegacyDirectory) {
    $legacy = (Resolve-Path -LiteralPath $LegacyDirectory).Path
    $oldVersion = ([version](Get-Item -LiteralPath (Join-Path $legacy 'Folio.dll')).VersionInfo.FileVersion).ToString(3)
    Install-QA (Build-QA $legacy $oldVersion 0) 'legacy-install'
    $results.Add('Legacy installer installed into isolated AppId and Korean path')
}
New-Item -ItemType Directory -Path $installPath -Force | Out-Null
$document = Join-Path $installPath '사용자 보존.md'
[IO.File]::WriteAllText($document, "# 사용자 문서`n원본 보존")
$documentHash = (Get-FileHash -LiteralPath $document).Hash
Install-QA $setup 'native-upgrade'
if ((Get-FileHash -LiteralPath $document).Hash -ne $documentHash) { throw 'Upgrade changed user document' }
foreach ($name in @('coreclr.dll','Microsoft.ui.xaml.dll','onnxruntime.dll','DirectML.dll')) { if (Test-Path -LiteralPath (Join-Path $installPath $name)) { throw "Legacy runtime remains: $name" } }
$results.Add('Native upgrade removes known legacy runtimes while preserving user Markdown')
Install-QA $setup 'native-reinstall'
$results.Add('Native reinstallation succeeds')
if ([IO.File]::ReadAllText((Join-Path $installPath 'install-language.txt')) -ne 'english') { throw 'English installer language was not saved' }
foreach ($name in @('formatting','layout','mermaid')) {
    $english = [IO.File]::ReadAllText((Join-Path $installPath "examples/en/$name.md"))
    if ($english -match '[가-힣]') { throw "English example contains Korean: $name" }
    if (!$LegacyDirectory -and (Get-FileHash (Join-Path $installPath "examples/$name.md")).Hash -ne (Get-FileHash (Join-Path $installPath "examples/en/$name.md")).Hash) { throw 'English root example mismatch' }
}
& node (Join-Path $projectRoot 'web/tests/native-language.mjs') $installPath '--installed'
if ($LASTEXITCODE -ne 0) { throw 'English installation language checks failed' }
$results.Add('English install initializes English UI and examples; explicit language change preserves recovery')
Install-QA $setup 'korean-reinstall' 'korean'
& node (Join-Path $projectRoot 'web/tests/native-language.mjs') $installPath '--installed' '--korean-default'
if ($LASTEXITCODE -ne 0) { throw 'Korean installation language checks failed' }
$results.Add('Korean installer language initializes a new profile in Korean')
$installedBytes = (Get-ChildItem -LiteralPath $installPath -File -Recurse | Measure-Object Length -Sum).Sum
& node (Join-Path $projectRoot 'web/tests/native-host.mjs') $installPath
if ($LASTEXITCODE -ne 0) { throw 'Installed native host integration checks failed' }
$results.Add('Installed executable passes native WebView2 integration checks')
$uninstaller = Join-Path $installPath 'unins000.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="' + (Join-Path $qaRoot 'uninstall.log') + '"')) -WindowStyle Hidden -PassThru
if (!$process.WaitForExit(60000) -or $process.ExitCode -ne 0) { throw 'QA uninstall failed' }
if ((Test-Path -LiteralPath (Join-Path $installPath 'Folio.exe')) -or (Test-Path -LiteralPath $qaRegistry)) { throw 'QA uninstall left executable or registration' }
if ((Get-FileHash -LiteralPath $document).Hash -ne $documentHash) { throw 'Uninstall changed user document' }
$after = if (Test-Path -LiteralPath $originalRegistry) { Get-ItemProperty -LiteralPath $originalRegistry | ConvertTo-Json -Compress } else { '' }
if ($before -ne $after) { throw 'Production Folio registration changed' }
$results.Add('Uninstall removes QA app and registration; user document and production Folio remain intact')
$report = @{ timestamp=[DateTimeOffset]::Now.ToString('o'); passed=$true; payload=$payload; installedBytes=$installedBytes; tests=$results; logs=$qaRoot }
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $projectRoot 'artifacts/native-installer-tests.json') -Encoding utf8
$results | ForEach-Object { Write-Output "PASS $_" }
