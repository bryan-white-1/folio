param([switch]$DesktopShortcut)
$ErrorActionPreference = 'Stop'
$sourceDirectory = $PSScriptRoot
if (!(Test-Path -LiteralPath (Join-Path $sourceDirectory 'Folio.exe'))) { throw 'Run this installer from the published Folio folder.' }
$destinationDirectory = Join-Path $env:LOCALAPPDATA 'Programs\Folio'
if ([IO.Path]::GetFullPath($sourceDirectory).TrimEnd('\') -eq [IO.Path]::GetFullPath($destinationDirectory).TrimEnd('\')) { throw 'Folio is already in the installation folder.' }
$runningFolio = Get-Process Folio -ErrorAction SilentlyContinue
if ($runningFolio) { throw 'Save your document and close Folio before installing.' }
New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $sourceDirectory | Copy-Item -Destination $destinationDirectory -Recurse -Force
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcutPaths = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Folio.lnk'))
if ($DesktopShortcut) { $shortcutPaths += Join-Path ([Environment]::GetFolderPath('Desktop')) 'Folio.lnk' }
foreach ($shortcutPath in $shortcutPaths) {
    $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $destinationDirectory 'Folio.exe'
    $shortcut.WorkingDirectory = $destinationDirectory
    $shortcut.Description = 'Folio Markdown Editor'
    $shortcut.Save()
}
Write-Output "Installed: $destinationDirectory\Folio.exe"
Write-Output 'Folio is available in the Start menu. Existing Markdown file associations were preserved.'
