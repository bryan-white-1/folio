param(
    [Parameter(Mandatory)][string]$AppDirectory,
    [ValidateSet('Online','Offline')][string]$RuntimeMode = 'Online',
    [switch]$Qa,
    [string]$PackageVersion
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$payload = (Resolve-Path -LiteralPath $AppDirectory).Path
$metadata = Get-Content -LiteralPath (Join-Path $payload 'folio-build.json') -Raw | ConvertFrom-Json
if ($metadata.host -ne 'native') { throw 'MSI requires a native publish directory.' }
$version = [string]$metadata.version
if ((Get-Item -LiteralPath (Join-Path $payload 'Folio.exe')).VersionInfo.FileVersion -ne "$version.0") { throw 'Executable version does not match build metadata.' }
foreach ($required in @('Web/index.html','WebView2Loader.dll','Assets/Folio.ico','LICENSE','locales/en.json')) {
    if (!(Test-Path -LiteralPath (Join-Path $payload $required))) { throw "Missing payload: $required" }
}
if ($PackageVersion) {
    if (!$Qa) { throw 'Version override is restricted to isolated QA packages.' }
    $version = ([version]$PackageVersion).ToString(3)
}
$dotnet = Join-Path $projectRoot '.tools/dotnet/dotnet.exe'
if (!(Test-Path -LiteralPath $dotnet)) {
    $installed = Get-Command dotnet -ErrorAction SilentlyContinue
    if (!$installed) { throw 'Install .NET 8 SDK to build MSI packages. The installed app does not require .NET.' }
    $dotnet = $installed.Source
}
$env:DOTNET_ROOT = Split-Path -Parent $dotnet
$wixDirectory = Join-Path $projectRoot '.tools/wix'
$wix = Join-Path $wixDirectory 'wix.exe'
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed: $LASTEXITCODE" }
}
if (!(Test-Path -LiteralPath $wix)) { Invoke-Checked $dotnet @('tool','install','wix','--version','5.0.2','--tool-path',$wixDirectory) }
if ((& $wix --version) -notlike '5.0.2*') { throw 'Expected WiX 5.0.2 in .tools/wix.' }
Invoke-Checked $wix @('extension','add','-g','WixToolset.UI.wixext/5.0.2')
$cache = Join-Path $projectRoot '.tools/installer'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$runtimeName = if ($RuntimeMode -eq 'Offline') { 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe' } else { 'MicrosoftEdgeWebview2Setup.exe' }
$runtime = Join-Path $cache $runtimeName
if (!(Test-Path -LiteralPath $runtime)) {
    $url = if ($RuntimeMode -eq 'Offline') { 'https://go.microsoft.com/fwlink/?linkid=2124701' } else { 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' }
    Invoke-WebRequest $url -OutFile $runtime
}
$signature = Get-AuthenticodeSignature -LiteralPath $runtime
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*') { throw 'Invalid WebView2 installer signature.' }
$stage = Join-Path $cache ('msi-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$product = if ($Qa) { 'Folio MSI QA' } else { 'Folio' }
$registry = if ($Qa) { 'FolioMsiQA' } else { 'Folio' }
$legacyKey = if ($Qa) { 'FolioMsiQA_Legacy' } else { '{A5B41CCB-9B45-467E-9748-621958D995B9}_is1' }
$upgradeCode = if ($Qa) { 'D6B112CB-9205-41CD-A6AF-27E82CB90536' } else { '0D4513A8-8287-40A2-ABCD-3DDB0C3DCD73' }
function Escape-Xml([string]$Value) { [Security.SecurityElement]::Escape($Value) }
function Stable-Id([string]$Value) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { 'I' + ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())))).Replace('-','').Substring(0,32) }
    finally { $hash.Dispose() }
}
$components = [Collections.Generic.List[string]]::new()
function Write-Directory([string]$Path, [string]$Relative, [string]$DirectoryId) {
    $xml = [Text.StringBuilder]::new()
    $folderId = Stable-Id ('folder:' + $Relative)
    $components.Add($folderId)
    [void]$xml.Append("<Component Id='$folderId' Directory='$DirectoryId'><RemoveFolder Id='R$folderId' On='uninstall'/><RegistryValue Root='HKCU' Key='Software\$registry\MSI\Folders' Name='$folderId' Type='integer' Value='1' KeyPath='yes'/></Component>")
    foreach ($file in Get-ChildItem -LiteralPath $Path -File | Sort-Object Name) {
        $id = Stable-Id ($Relative + '/' + $file.Name)
        $guid = ([guid]::ParseExact((Stable-Id ($registry + ':' + $Relative + '/' + $file.Name)).Substring(1), 'N')).ToString('D')
        $components.Add($id)
        [void]$xml.Append("<Component Id='$id' Guid='$guid' Directory='$DirectoryId'><File Id='F$id' Source='$(Escape-Xml $file.FullName)'/><RegistryValue Root='HKCU' Key='Software\$registry\MSI\Files' Name='$id' Type='integer' Value='1' KeyPath='yes'/></Component>")
    }
    foreach ($folder in Get-ChildItem -LiteralPath $Path -Directory | Sort-Object Name) {
        $relativeChild = $Relative + '/' + $folder.Name
        $id = Stable-Id ('dir:' + $relativeChild)
        [void]$xml.Append("<Directory Id='$id' Name='$(Escape-Xml $folder.Name)'>")
        [void]$xml.Append((Write-Directory $folder.FullName $relativeChild $id))
        [void]$xml.Append('</Directory>')
    }
    $xml.ToString()
}
$tree = Write-Directory $payload '' 'INSTALLFOLDER'
$refs = ($components | ForEach-Object { "<ComponentRef Id='$_'/>" }) -join ''
$generated = "<Wix xmlns='http://wixtoolset.org/schemas/v4/wxs'><Fragment><DirectoryRef Id='INSTALLFOLDER'>$tree</DirectoryRef><ComponentGroup Id='PayloadFiles'>$refs</ComponentGroup></Fragment></Wix>"
$filesSource = Join-Path $stage 'Payload.wxs'
[IO.File]::WriteAllText($filesSource, $generated)
$license = Join-Path $stage 'License.rtf'
$licenseText = [IO.File]::ReadAllText((Join-Path $payload 'LICENSE')).Replace('\','\\').Replace('{','\{').Replace('}','\}').Replace("`r",'').Replace("`n",'\par ')
[IO.File]::WriteAllText($license, ('{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\fs18 ' + $licenseText + '}'))
$suffix = if ($Qa) { '-qa' } else { '' }
$name = "Folio-Setup-$version-win-x64-$($RuntimeMode.ToLowerInvariant())$suffix.msi"
$stagedMsi = Join-Path $stage $name
$arguments = @('build',(Join-Path $projectRoot 'installer/Folio.wxs'),$filesSource,'-arch','x64','-ext','WixToolset.UI.wixext/5.0.2','-out',$stagedMsi,
    '-d',"Version=$version",'-d',"Payload=$payload",'-d',"Runtime=$runtime",'-d',"License=$license",'-d',"ProductName=$product",'-d',"InstallName=$product",'-d',"RegistryName=$registry",'-d',"UpgradeCode=$upgradeCode",'-d',"LegacyKey=$legacyKey")
Invoke-Checked $wix $arguments
$outputDirectory = Join-Path $projectRoot 'artifacts'
$output = Join-Path $outputDirectory $name
if (Test-Path -LiteralPath $output) {
    $archive = Join-Path $cache ('previous-msi-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $archive | Out-Null
    foreach ($ext in @('','.sha256','.json')) { if (Test-Path -LiteralPath ($output + $ext)) { Move-Item -LiteralPath ($output + $ext) -Destination $archive } }
}
Move-Item -LiteralPath $stagedMsi -Destination $output
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($output + '.sha256'), "$hash  $name`n")
@{ generatedAt=[DateTimeOffset]::Now.ToString('o'); version=$version; host='native'; format='msi'; scope='perUser'; runtimeMode=$RuntimeMode; bytes=(Get-Item -LiteralPath $output).Length; sha256=$hash; runtimeSha256=(Get-FileHash -LiteralPath $runtime).Hash; wix='5.0.2'; qa=[bool]$Qa } | ConvertTo-Json | Set-Content -LiteralPath ($output + '.json') -Encoding utf8
Write-Output "Ready: $output"
