param([Parameter(Mandatory)][string]$AppDirectory)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$payload = (Resolve-Path -LiteralPath $AppDirectory).Path
$version = (Get-Content (Join-Path $payload 'folio-build.json') -Raw | ConvertFrom-Json).version
$qaRoot = Join-Path $root ('.tools/installer/msi-qa-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $qaRoot '한글 설치 폴더'
New-Item -ItemType Directory -Path $qaRoot | Out-Null
$results = [Collections.Generic.List[string]]::new()
function Check([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
    $results.Add($Message)
    Write-Output "PASS $Message"
}
function Run-Msi([string[]]$Arguments, [string]$Name, [int]$Expected = 0) {
    $log = Join-Path $qaRoot ($Name + '.log')
    $process = Start-Process msiexec.exe -ArgumentList ($Arguments + @('/qn','/norestart','/L*v',('"' + $log + '"'))) -WindowStyle Hidden -PassThru
    $process.WaitForExit()
    if ($process.ExitCode -ne $Expected) { throw "MSI $Name returned $($process.ExitCode), expected $Expected. Log: $log" }
    $results.Add("$Name exit $Expected")
}
function Read-MsiProperty([string]$File, [string]$Name) {
    $engine = New-Object -ComObject WindowsInstaller.Installer
    $database = $engine.OpenDatabase($File, 0)
    $view = $database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property``='$Name'")
    $view.Execute()
    $record = $view.Fetch()
    $value = $record.StringData(1)
    $view.Close()
    foreach ($object in @($record,$view,$database,$engine)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object) }
    $value
}
$previous = '0.2.3'
& (Join-Path $PSScriptRoot 'Build-Msi.ps1') -AppDirectory $payload -Qa -PackageVersion $previous
& (Join-Path $PSScriptRoot 'Build-Msi.ps1') -AppDirectory $payload -Qa
$old = Join-Path $root "artifacts/Folio-Setup-$previous-win-x64-online-qa.msi"
$current = Join-Path $root "artifacts/Folio-Setup-$version-win-x64-online-qa.msi"
$oldCode = Read-MsiProperty $old 'ProductCode'
$currentCode = Read-MsiProperty $current 'ProductCode'
$registered = $false
try {
    Run-Msi @('/i',('"' + $current + '"'),'LEGACYINSTALL=1') 'legacy-block' 1603
    Run-Msi @('/i',('"' + $old + '"'),('INSTALLFOLDER="' + $install + '"'),'ADDLOCAL=ALL') 'install-previous'
    $registered = $true
    Check (Test-Path (Join-Path $install 'Folio.exe')) 'Installed executable in Korean path'
    $document = Join-Path $install 'user-document.md'
    [IO.File]::WriteAllText($document, '# Keep this document')
    Run-Msi @('/i',('"' + $current + '"'),('INSTALLFOLDER="' + $install + '"'),'ADDLOCAL=ALL') 'major-upgrade'
    Check (!(Test-Path "HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/$oldCode")) 'Previous MSI product removed on upgrade'
    foreach ($file in Get-ChildItem -LiteralPath $payload -File -Recurse) {
        $relative = [IO.Path]::GetRelativePath($payload, $file.FullName)
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $install $relative)).Hash) { throw "Installed file mismatch: $relative" }
    }
    $results.Add('Every installed payload file matches SHA-256')
    $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Folio MSI QA/Folio MSI QA.lnk'
    Check (Test-Path $shortcut) 'Start menu shortcut registered'
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Folio MSI QA.lnk'
    Check (Test-Path $desktop) 'Optional desktop shortcut registered'
    $commandKey = 'HKCU:/Software/Classes/FolioMsiQA.Markdown/shell/open/command'
    Check ((Get-Item $commandKey).GetValue('') -eq ('"' + (Join-Path $install 'Folio.exe') + '" "%1"')) 'Quoted file-open command registered'
    Remove-Item -LiteralPath (Join-Path $install 'Web/index.html')
    Run-Msi @('/fa',$currentCode) 'repair'
    Check (Test-Path (Join-Path $install 'Web/index.html')) 'Repair restores missing file'
    Run-Msi @('/i',('"' + $old + '"')) 'downgrade-block' 1603
    & node (Join-Path $root 'web/tests/native-host.mjs') $install
    if ($LASTEXITCODE -ne 0) { throw 'Installed app integration failed.' }
    $results.Add('Installed app real WebView2 integration passed')
    Run-Msi @('/x',$currentCode) 'uninstall'
    $registered = $false
    Check (!(Test-Path (Join-Path $install 'Folio.exe'))) 'Uninstall removes app binary'
    Check ((Get-Content -LiteralPath $document -Raw) -eq '# Keep this document') 'Uninstall preserves user document'
    Check (!(Test-Path $shortcut) -and !(Test-Path $desktop)) 'Uninstall removes shortcuts'
    Check (!(Test-Path $commandKey) -or !(Get-Item $commandKey).GetValue('')) 'Uninstall removes file-open registration'
    @{ generatedAt=[DateTimeOffset]::Now.ToString('o'); passed=$results; logDirectory=$qaRoot } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'artifacts/msi-tests.json') -Encoding utf8
} finally {
    if ($registered) {
        # Only these generated QA product codes may be removed, never the user's Folio installation.
        foreach ($code in @($currentCode,$oldCode)) {
            if (Test-Path "HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/$code") { Run-Msi @('/x',$code) 'cleanup' }
        }
    }
}
