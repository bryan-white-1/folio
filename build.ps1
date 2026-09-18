param([switch]$SkipTests, [switch]$Zip, [switch]$Installer, [ValidateSet('Online','Offline')][string]$RuntimeMode = 'Online')
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$projectXml = [xml](Get-Content -LiteralPath (Join-Path $projectRoot 'src\Folio\Folio.csproj') -Raw)
$appVersion = [string]$projectXml.Project.PropertyGroup.Version
$dotnetExecutable = Join-Path $projectRoot '.tools\dotnet\dotnet.exe'
if (!(Test-Path -LiteralPath $dotnetExecutable)) {
    $installedDotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($installedDotnet) { $dotnetExecutable = $installedDotnet.Source }
    else {
        $installer = Join-Path $env:TEMP 'folio-dotnet-install.ps1'
        Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installer
        & $installer -Version '8.0.425' -InstallDir (Join-Path $projectRoot '.tools\dotnet') -NoPath
        if (!(Test-Path -LiteralPath $dotnetExecutable)) { throw '.NET SDK installation failed.' }
    }
}
function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
Push-Location (Join-Path $projectRoot 'web')
try {
    Invoke-Checked 'npm.cmd' @('ci', '--no-fund', '--no-audit')
    Invoke-Checked 'npm.cmd' @('run', 'build')
    if (!$SkipTests) {
        Invoke-Checked 'npm.cmd' @('test')
        Invoke-Checked 'npm.cmd' @('run', 'test:ui')
    }
} finally { Pop-Location }
Push-Location $projectRoot
try {
    if (!$SkipTests) { Invoke-Checked $dotnetExecutable @('run', '--project', 'tests/Folio.Storage.Tests/Folio.Storage.Tests.csproj', '-c', 'Release') }
    $publishPath = Join-Path $projectRoot "artifacts\Folio-$appVersion-win-x64"
    if (Test-Path -LiteralPath $publishPath) { $publishPath += '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
    $buildOutput = Join-Path $projectRoot ".tools\build\$appVersion\"
    Invoke-Checked $dotnetExecutable @('publish', 'src/Folio/Folio.csproj', '-c', 'Release', "-p:BaseOutputPath=$buildOutput", '-o', $publishPath)
    Invoke-Checked 'node' @('scripts/Collect-Licenses.mjs')
    Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\Install-Folio.ps1') -Destination $publishPath -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\Uninstall-Folio.ps1') -Destination $publishPath -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $publishPath -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $publishPath -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'docs') -Destination $publishPath -Recurse -Force
    foreach ($documentName in @('SPEC.md', 'TEST_RESULTS.md', 'INSTALLER.md')) { Copy-Item -LiteralPath (Join-Path $projectRoot $documentName) -Destination $publishPath -Force }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD-PARTY-NOTICES.md') -Destination $publishPath -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'examples') -Destination $publishPath -Recurse -Force
    if ($Zip) { Compress-Archive -Path $publishPath -DestinationPath ($publishPath + '.zip') }
    if ($Installer) { & (Join-Path $projectRoot 'scripts\Build-Installer.ps1') -AppDirectory $publishPath -RuntimeMode $RuntimeMode }
    Write-Output "Ready: $publishPath\Folio.exe"
} finally { Pop-Location }
