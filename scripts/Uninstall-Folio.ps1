$ErrorActionPreference = 'Stop'
$expectedTarget = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\Folio')).TrimEnd('\')
$actualTarget = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
if ($actualTarget -ne $expectedTarget -or !(Test-Path -LiteralPath (Join-Path $actualTarget 'Folio.exe'))) { throw 'Run this script only from the installed Folio directory.' }
if (Get-Process Folio -ErrorAction SilentlyContinue) { throw 'Save your document and close Folio before uninstalling.' }
$shortcutShell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Folio.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Folio.lnk'))) {
    if (Test-Path -LiteralPath $shortcutPath) {
        $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
        if ($shortcut.TargetPath -eq (Join-Path $actualTarget 'Folio.exe')) { Remove-Item -LiteralPath $shortcutPath }
    }
}
Remove-Item -LiteralPath $actualTarget -Recurse -Force
Write-Output 'Folio was uninstalled. Documents, settings, and recovery data were preserved.'
