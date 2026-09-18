param([string]$InstallerPath, [string]$PreviousInstallerPath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$InstallerPath) {
    $projectXml = [xml](Get-Content -LiteralPath (Join-Path $projectRoot 'src\Folio\Folio.csproj') -Raw)
    $InstallerPath = Join-Path $projectRoot "artifacts\Folio-Setup-$($projectXml.Project.PropertyGroup.Version)-win-x64-online.exe"
}
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$manifest = Get-Content -LiteralPath ($InstallerPath + '.json') -Raw | ConvertFrom-Json
$expectedVersion = $manifest.version
if ($PreviousInstallerPath) { $PreviousInstallerPath = (Resolve-Path -LiteralPath $PreviousInstallerPath).Path }
$reportName = if ([IO.Path]::GetFileNameWithoutExtension($InstallerPath).EndsWith('-online')) { 'installer-tests-online.json' } else { 'installer-tests.json' }
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{A5B41CCB-9B45-467E-9748-621958D995B9}_is1'
if (Test-Path -LiteralPath $uninstallKey) { throw 'An installed Folio is registered. Run this lifecycle test in a clean Windows account.' }
$associationKeys = @('HKCU:\Software\Classes\Folio.Markdown', 'HKCU:\Software\Folio\Capabilities', 'HKCU:\Software\Classes\SystemFileAssociations\.md\shell\Folio', 'HKCU:\Software\Classes\SystemFileAssociations\.markdown\shell\Folio')
foreach ($key in $associationKeys) { if (Test-Path -LiteralPath $key) { throw 'Existing Folio file association found. Use a clean Windows account.' } }
function Read-RegistryValue([string]$Path, [string]$Name) {
    if (!(Test-Path -LiteralPath $Path)) { return $null }
    return (Get-Item -LiteralPath $Path).GetValue($Name)
}
if ($null -ne (Read-RegistryValue 'HKCU:\Software\RegisteredApplications' 'Folio')) { throw 'Existing Folio default-app registration found.' }
foreach ($extension in @('.md','.markdown')) {
    if ($null -ne (Read-RegistryValue "HKCU:\Software\Classes\$extension\OpenWithProgids" 'Folio.Markdown')) { throw 'Existing Folio Open With registration found.' }
}
function Get-MarkdownDefaults {
    $values = [ordered]@{}
    foreach ($extension in @('.md','.markdown')) {
        $values[$extension] = Read-RegistryValue "HKCU:\Software\Classes\$extension" ''
        $choice = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice"
        $values["$extension-choice"] = Read-RegistryValue $choice 'ProgId'
        $values["$extension-hash"] = Read-RegistryValue $choice 'Hash'
    }
    return $values | ConvertTo-Json -Compress
}
$originalDefaults = Get-MarkdownDefaults
$testRoot = Join-Path $projectRoot ('.tools\installer\qa-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$installDirectory = Join-Path $testRoot '설치 경로\Folio'
$profile = Join-Path $testRoot 'profile'
$group = 'Folio'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) "$group\Folio.lnk"
$preserveShortcut = Test-Path -LiteralPath $shortcutPath
$originalShortcutHash = if ($preserveShortcut) { (Get-FileHash -LiteralPath $shortcutPath).Hash } else { $null }
New-Item -ItemType Directory -Path $testRoot,$profile -Force | Out-Null
$results = [Collections.Generic.List[string]]::new()
$previousProfile = $env:FOLIO_DATA_DIRECTORY
$env:FOLIO_DATA_DIRECTORY = $profile
function Run-Setup([string]$LogName, [string]$Tasks = 'associatefiles', [string]$SetupPath = $InstallerPath) {
    $arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LANG=korean',('/TASKS=' + $Tasks),('/DIR="' + $installDirectory + '"'),('/GROUP="' + $group + '"'),('/LOG="' + (Join-Path $testRoot $LogName) + '"'))
    if ($preserveShortcut) { $arguments += '/NOICONS' }
    $process = Start-Process -FilePath $SetupPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(60000)) { throw 'Installer timeout; inspect the isolated test process and log.' }
    return $process.ExitCode
}
function Start-Diagnostics {
    $script:diagnosticStartedAt = [DateTimeOffset]::Now
    return Start-Process -FilePath (Join-Path $installDirectory 'Folio.exe') -ArgumentList '--smoke-test' -WindowStyle Hidden -PassThru
}
function Complete-Diagnostics($Process) {
    if (!$Process.WaitForExit(45000)) { throw 'Installed app diagnostics timed out.' }
    $report = Get-Content -LiteralPath (Join-Path $profile 'diagnostics\windows-smoke.json') -Raw | ConvertFrom-Json
    if ($Process.ExitCode -ne 0 -or !$report.passed -or [DateTimeOffset]::Parse($report.timestamp) -lt $script:diagnosticStartedAt) { throw 'Installed app diagnostics failed.' }
}
try {
    if ($PreviousInstallerPath) {
        if ((Run-Setup 'previous-install.log' '' $PreviousInstallerPath) -ne 0) { throw 'Previous version installation failed.' }
        $upgradeDocument = Join-Path $installDirectory '업데이트 보존.md'
        $upgradeSettings = Join-Path $profile 'settings.json'
        [IO.File]::WriteAllText($upgradeDocument, "# 업데이트 보존`n사용자 원문")
        [IO.File]::WriteAllText($upgradeSettings, '{"Theme":"dark","BodyLineHeight":1.65}')
        $upgradeDocumentHash = (Get-FileHash -LiteralPath $upgradeDocument).Hash
        $upgradeSettingsHash = (Get-FileHash -LiteralPath $upgradeSettings).Hash
    }
    if ((Run-Setup 'install.log' '') -ne 0) { throw 'Initial installation failed.' }
    if ($PreviousInstallerPath) {
        if ((Get-FileHash -LiteralPath $upgradeDocument).Hash -ne $upgradeDocumentHash -or (Get-FileHash -LiteralPath $upgradeSettings).Hash -ne $upgradeSettingsHash) { throw 'Version upgrade changed user document or preferences.' }
        $results.Add('Previous release upgrades in place while preserving Markdown and preferences')
    }
    foreach ($key in $associationKeys) { if (Test-Path -LiteralPath $key) { throw 'Unchecked association task registered Markdown.' } }
    $results.Add('Unchecked Markdown association option leaves file registration untouched')
    $registration = Get-ItemProperty -LiteralPath $uninstallKey
    if ($registration.DisplayVersion -ne $expectedVersion -or $registration.InstallLocation.TrimEnd('\') -ne $installDirectory) { throw 'Installed Apps registration mismatch.' }
    $results.Add('Single-file installation into a Korean path; current-user Installed Apps registration')
    if ($preserveShortcut) {
        if ((Get-FileHash -LiteralPath $shortcutPath).Hash -ne $originalShortcutHash) { throw 'Existing shortcut was modified.' }
        $results.Add('Existing user shortcut preserved with isolated NOICONS installation')
    } else {
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
        if ($shortcut.TargetPath -ne (Join-Path $installDirectory 'Folio.exe')) { throw 'Start menu shortcut target mismatch.' }
        $results.Add('Start menu shortcut resolves to the installed executable')
    }
    foreach ($name in @('Folio.exe','Folio.dll','Folio.pri','App.xbf','Web\index.html')) {
        if (!(Test-Path -LiteralPath (Join-Path $installDirectory $name))) { throw "Installed payload missing: $name" }
    }
    if ($manifest.payloadFiles) {
        foreach ($file in $manifest.payloadFiles) {
            $installedFile = Join-Path $installDirectory $file.path
            if (!(Test-Path -LiteralPath $installedFile) -or (Get-FileHash -LiteralPath $installedFile).Hash -ne $file.sha256) { throw "Installed payload hash mismatch: $($file.path)" }
        }
        $results.Add('Installed application, Mermaid Web assets and examples match published SHA-256 hashes')
    }
    if (!(Select-String -LiteralPath (Join-Path $testRoot 'install.log') -SimpleMatch 'bundled prerequisite skipped')) { throw 'Existing WebView2 runtime was not detected.' }
    $results.Add('Required application resources installed; existing WebView2 detected and left installed')
    $document = Join-Path $installDirectory '내 문서.md'
    [IO.File]::WriteAllText($document, "# 제거 후에도 보존`n사용자 문서")
    $documentHash = (Get-FileHash -LiteralPath $document).Hash
    $executableHash = (Get-FileHash -LiteralPath (Join-Path $installDirectory 'Folio.exe')).Hash
    [IO.File]::WriteAllText((Join-Path $installDirectory 'Uninstall-Folio.ps1'), '# Legacy installer fixture')
    if ((Run-Setup 'reinstall.log') -ne 0) { throw 'Reinstallation failed.' }
    $openCommand = '"' + (Join-Path $installDirectory 'Folio.exe') + '" "%1"'
    if ((Read-RegistryValue 'HKCU:\Software\Classes\Folio.Markdown\shell\open\command' '') -ne $openCommand) { throw 'Markdown open command does not quote the app and document paths.' }
    if ((Read-RegistryValue 'HKCU:\Software\Classes\Folio.Markdown\DefaultIcon' '') -ne ('"' + (Join-Path $installDirectory 'Folio.exe') + '",0')) { throw 'Markdown icon registration mismatch.' }
    if ((Read-RegistryValue 'HKCU:\Software\RegisteredApplications' 'Folio') -ne 'Software\Folio\Capabilities') { throw 'Default Apps registration missing.' }
    foreach ($extension in @('.md','.markdown')) {
        if ($null -eq (Read-RegistryValue "HKCU:\Software\Classes\$extension\OpenWithProgids" 'Folio.Markdown')) { throw "Open With registration missing for $extension" }
        if ((Read-RegistryValue 'HKCU:\Software\Folio\Capabilities\FileAssociations' $extension) -ne 'Folio.Markdown') { throw "Default-app capability missing for $extension" }
        if ((Read-RegistryValue "HKCU:\Software\Classes\SystemFileAssociations\$extension\shell\Folio\command" '') -ne $openCommand) { throw "Context menu command missing for $extension" }
    }
    if ((Get-MarkdownDefaults) -ne $originalDefaults) { throw 'Installer changed an existing Markdown default application.' }
    $results.Add('Selected Markdown association registers both extensions, icon, quoted commands and Default Apps without replacing existing defaults')
    if ((Get-FileHash -LiteralPath $document).Hash -ne $documentHash) { throw 'Reinstall modified user document.' }
    if (Test-Path -LiteralPath (Join-Path $installDirectory 'Uninstall-Folio.ps1')) { throw 'Legacy script uninstaller was not retired.' }
    $results.Add('In-place reinstallation preserves user Markdown and one uninstall registration')
    $diagnosticProcess = Start-Diagnostics
    $blockedExit = Run-Setup 'running-upgrade.log'
    if ($blockedExit -eq 0 -or !(Select-String -LiteralPath (Join-Path $testRoot 'running-upgrade.log') -SimpleMatch '설치 대상 Folio가 실행 중')) { throw 'Running-app update guard failed.' }
    Complete-Diagnostics $diagnosticProcess
    if ((Get-FileHash -LiteralPath (Join-Path $installDirectory 'Folio.exe')).Hash -ne $executableHash) { throw 'Blocked update changed the executable.' }
    $results.Add('Update refuses a running target app without terminating it or replacing its executable')
    $results.Add('Installed WinUI/WebView2 application passes all host integration checks, including configuration persistence')
    $uninstaller = Join-Path $installDirectory 'unins000.exe'
    $diagnosticProcess = Start-Diagnostics
    $uninstallArgs = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="' + (Join-Path $testRoot 'running-uninstall.log') + '"'))
    $process = Start-Process -FilePath $uninstaller -ArgumentList $uninstallArgs -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(45000) -or $process.ExitCode -eq 0 -or !(Test-Path -LiteralPath (Join-Path $installDirectory 'Folio.exe'))) { throw 'Running-app uninstall guard failed.' }
    Complete-Diagnostics $diagnosticProcess
    $results.Add('Uninstall refuses a running target app without terminating it')
    $settings = Join-Path $profile 'settings.json'
    $settingsHash = (Get-FileHash -LiteralPath $settings).Hash
    $uninstallArgs = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="' + (Join-Path $testRoot 'uninstall.log') + '"'))
    $process = Start-Process -FilePath $uninstaller -ArgumentList $uninstallArgs -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'Uninstallation failed.' }
    if ((Test-Path -LiteralPath (Join-Path $installDirectory 'Folio.exe')) -or (Test-Path -LiteralPath $uninstallKey) -or (!$preserveShortcut -and (Test-Path -LiteralPath $shortcutPath))) { throw 'Uninstall left application registration or shortcut.' }
    if ($preserveShortcut -and (Get-FileHash -LiteralPath $shortcutPath).Hash -ne $originalShortcutHash) { throw 'Uninstall modified the existing shortcut.' }
    if ((Get-FileHash -LiteralPath $document).Hash -ne $documentHash -or (Get-FileHash -LiteralPath $settings).Hash -ne $settingsHash) { throw 'Uninstall modified user data.' }
    $results.Add('Uninstall removes application, shortcut and registration while preserving document and profile')
    foreach ($key in $associationKeys) { if (Test-Path -LiteralPath $key) { throw "Uninstall left owned association: $key" } }
    if ($null -ne (Read-RegistryValue 'HKCU:\Software\RegisteredApplications' 'Folio')) { throw 'Uninstall left Default Apps registration.' }
    foreach ($extension in @('.md','.markdown')) {
        if ($null -ne (Read-RegistryValue "HKCU:\Software\Classes\$extension\OpenWithProgids" 'Folio.Markdown')) { throw 'Uninstall left Open With registration.' }
    }
    if ((Get-MarkdownDefaults) -ne $originalDefaults) { throw 'Uninstall changed an existing Markdown default application.' }
    $results.Add('Uninstall removes only Folio file associations and preserves original Markdown default apps')
    $report = @{ timestamp=[DateTimeOffset]::Now.ToString('o'); passed=$true; installer=$InstallerPath; sha256=(Get-FileHash -LiteralPath $InstallerPath).Hash; tests=$results; logs=$testRoot }
    $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path (Join-Path $projectRoot 'artifacts') $reportName) -Encoding utf8
    $results | ForEach-Object { Write-Output "PASS $_" }
} catch {
    @{ timestamp=[DateTimeOffset]::Now.ToString('o'); passed=$false; tests=$results; error=$_.ToString(); logs=$testRoot } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path (Join-Path $projectRoot 'artifacts') $reportName) -Encoding utf8
    throw
} finally { $env:FOLIO_DATA_DIRECTORY = $previousProfile }
