param([string]$AppDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectXml = [xml](Get-Content -LiteralPath (Join-Path $projectRoot 'src\Folio\Folio.csproj') -Raw)
$executable = if ($AppDirectory) { Join-Path $AppDirectory 'Folio.exe' } else { Join-Path $projectRoot "artifacts\Folio-$($projectXml.Project.PropertyGroup.Version)-win-x64\Folio.exe" }
if (!(Test-Path -LiteralPath $executable)) { throw 'Run build.ps1 first.' }
$previousProfile = $env:FOLIO_DATA_DIRECTORY
try {
    $env:FOLIO_DATA_DIRECTORY = Join-Path $projectRoot '.tools\qa-profile'
    $startedAt = [DateTimeOffset]::Now
    $process = Start-Process -FilePath $executable -ArgumentList '--smoke-test' -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(45000)) { Stop-Process -Id $process.Id; throw 'Windows integration test timed out.' }
    $report = Join-Path $env:FOLIO_DATA_DIRECTORY 'diagnostics\windows-smoke.json'
    $result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    if ([DateTimeOffset]::Parse($result.timestamp) -lt $startedAt) { throw "The app exited before generating a fresh integration report (exit $($process.ExitCode))." }
    if (!$result.passed -or $process.ExitCode -ne 0) { throw ($result | ConvertTo-Json -Depth 4) }
    $result.tests | ForEach-Object { Write-Output "PASS $_" }
    $result.skipped | ForEach-Object { Write-Output "SKIP $_" }
} finally { $env:FOLIO_DATA_DIRECTORY = $previousProfile }
