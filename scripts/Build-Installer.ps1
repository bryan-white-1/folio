param([Parameter(Mandatory)][string]$AppDirectory, [ValidateSet('Online','Offline')][string]$RuntimeMode = 'Online')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$payload = (Resolve-Path -LiteralPath $AppDirectory).Path
$cacheDirectory = Join-Path $projectRoot '.tools\installer'
New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
foreach ($relativePath in @('Folio.exe','Folio.dll','Folio.pri','App.xbf','Assets\Folio.ico','Web\index.html')) {
    if (!(Test-Path -LiteralPath (Join-Path $payload $relativePath))) { throw "Incomplete publish directory: $relativePath" }
}
function Assert-Publisher([string]$Path, [string]$Publisher) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike "*$Publisher*") {
        throw "Invalid Authenticode signature or unexpected publisher: $Path"
    }
}
$compilerVersion = '7.1.0'
$compilerDirectory = Join-Path $cacheDirectory 'inno'
$compiler = Join-Path $compilerDirectory 'ISCC.exe'
$compilerUrl = 'https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe'
if (!(Test-Path -LiteralPath $compiler)) {
    $compilerSetup = Join-Path $cacheDirectory 'innosetup-7.1.0-x64.exe'
    if (!(Test-Path -LiteralPath $compilerSetup)) { Invoke-WebRequest $compilerUrl -OutFile $compilerSetup }
    Assert-Publisher $compilerSetup 'Pyrsys B.V.'
    $process = Start-Process -FilePath $compilerSetup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER','/NOICONS',('/DIR="' + $compilerDirectory + '"')) -WindowStyle Hidden -PassThru
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Inno Setup compiler installation failed: $($process.ExitCode)" }
}
Assert-Publisher $compiler 'Pyrsys B.V.'
$offline = $RuntimeMode -eq 'Offline'
$runtimeName = if ($offline) { 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe' } else { 'MicrosoftEdgeWebview2Setup.exe' }
$runtime = Join-Path $cacheDirectory $runtimeName
$runtimeUrl = if ($offline) { 'https://go.microsoft.com/fwlink/?linkid=2124701' } else { 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' }
if (!(Test-Path -LiteralPath $runtime)) { Invoke-WebRequest $runtimeUrl -OutFile $runtime }
Assert-Publisher $runtime 'Microsoft Corporation'
$runtimeBytes = (Get-Item -LiteralPath $runtime).Length
if ($offline -and $runtimeBytes -lt 50MB) { throw 'Expected a full standalone WebView2 runtime, not an online bootstrapper.' }
if (!$offline -and ($runtimeBytes -lt 100KB -or $runtimeBytes -gt 10MB)) { throw 'Expected the small WebView2 bootstrapper.' }
$projectXml = [xml](Get-Content -LiteralPath (Join-Path $projectRoot 'src\Folio\Folio.csproj') -Raw)
$appVersion = [string]$projectXml.Project.PropertyGroup.Version
$payloadVersion = [version](Get-Item -LiteralPath (Join-Path $payload 'Folio.dll')).VersionInfo.FileVersion
if ($payloadVersion.ToString(3) -ne $appVersion) { throw "Payload version $payloadVersion does not match installer version $appVersion. Publish the current application first." }
$outputDirectory = Join-Path $projectRoot 'artifacts'
$suffix = if ($offline) { '' } else { '-online' }
$installerPath = Join-Path $outputDirectory "Folio-Setup-$appVersion-win-x64$suffix.exe"
$stageDirectory = Join-Path $cacheDirectory ('setup-stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null
& $compiler '/Qp' "/DAppVersion=$appVersion" "/DPayloadDir=$payload" "/DRuntimeInstaller=$runtime" "/DOfflineRuntime=$([int]$offline)" "/DOutputPath=$stageDirectory" (Join-Path $projectRoot 'installer\Folio.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed: $LASTEXITCODE" }
$stagedInstaller = Join-Path $stageDirectory ([IO.Path]::GetFileName($installerPath))
if (!(Test-Path -LiteralPath $stagedInstaller)) { throw "Compiler did not produce the expected $RuntimeMode installer. Previous releases were preserved." }
if (Test-Path -LiteralPath $installerPath) {
    $archiveDirectory = Join-Path $cacheDirectory ('previous-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null
    foreach ($extension in @('', '.sha256', '.json')) {
        $previousFile = $installerPath + $extension
        if (Test-Path -LiteralPath $previousFile) { Move-Item -LiteralPath $previousFile -Destination $archiveDirectory }
    }
}
Move-Item -LiteralPath $stagedInstaller -Destination $installerPath
$hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($installerPath + '.sha256'), "$hash  $([IO.Path]::GetFileName($installerPath))`n")
$manifest = [ordered]@{
    generatedAt = [DateTimeOffset]::Now.ToString('o')
    version = $appVersion
    runtimeMode = $RuntimeMode
    installer = [IO.Path]::GetFileName($installerPath)
    sha256 = $hash
    bytes = (Get-Item -LiteralPath $installerPath).Length
    compiler = @{ version = $compilerVersion; source = $compilerUrl; publisher = 'Pyrsys B.V.' }
    webview2 = @{ source = $runtimeUrl; sha256 = (Get-FileHash -LiteralPath $runtime).Hash; publisher = 'Microsoft Corporation'; offline = $offline; bytes = $runtimeBytes }
    signed = ((Get-AuthenticodeSignature -LiteralPath $installerPath).Status -eq 'Valid')
    payloadFiles = @(
        foreach ($file in Get-ChildItem -LiteralPath $payload -File -Recurse) {
            $relative = [IO.Path]::GetRelativePath($payload, $file.FullName)
            if ($relative -in @('Folio.exe','Folio.dll','Folio.pri','App.xbf','Assets\Folio.ico') -or $relative.StartsWith('Web\') -or $relative.StartsWith('examples\')) {
                @{ path = $relative; sha256 = (Get-FileHash -LiteralPath $file.FullName).Hash }
            }
        }
    )
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ($installerPath + '.json') -Encoding utf8
Write-Output "Ready: $installerPath"
