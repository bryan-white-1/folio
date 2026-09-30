param([switch]$SkipTests, [switch]$SkipWebBuild, [switch]$Zip, [switch]$Installer, [ValidateSet('Online','Offline')][string]$RuntimeMode = 'Online')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nativeTools = Join-Path $projectRoot '.tools/native'
New-Item -ItemType Directory -Path $nativeTools -Force | Out-Null
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed: $LASTEXITCODE" }
}
$toolchain = Join-Path $nativeTools 'llvm-mingw-20260922-ucrt-x86_64'
$compiler = Join-Path $toolchain 'bin/clang++.exe'
if (!(Test-Path -LiteralPath $compiler)) {
    $archive = Join-Path $nativeTools 'llvm-mingw-20260922-ucrt-x86_64.zip'
    if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest 'https://github.com/mstorsjo/llvm-mingw/releases/download/20260922/llvm-mingw-20260922-ucrt-x86_64.zip' -OutFile $archive }
    if ((Get-FileHash -LiteralPath $archive).Hash -ne 'E3AD77D117A4BEA19A7A3B333341824D79A5A371004A10E25B8504E7B3047666') { throw 'C++ compiler SHA-256 mismatch' }
    Expand-Archive -LiteralPath $archive -DestinationPath $nativeTools -Force
}
$sdk = Join-Path $env:USERPROFILE '.nuget/packages/microsoft.web.webview2/1.0.3179.45'
if (!(Test-Path -LiteralPath (Join-Path $sdk 'build/native/include/WebView2.h'))) {
    $sdk = Join-Path $nativeTools 'webview2-1.0.3179.45'
    if (!(Test-Path -LiteralPath (Join-Path $sdk 'build/native/include/WebView2.h'))) {
        $archive = Join-Path $nativeTools 'webview2-1.0.3179.45.zip'
        Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3179.45/microsoft.web.webview2.1.0.3179.45.nupkg' -OutFile $archive
        if ((Get-FileHash -LiteralPath $archive).Hash -ne '70BD381C5D67F97A6A80294001CDE125AB5B24B6D36098AD901D8E15EFD752D0') { throw 'WebView2 SDK SHA-256 mismatch' }
        Expand-Archive -LiteralPath $archive -DestinationPath $sdk -Force
    }
}
$loader = Join-Path $sdk 'build/native/x64/WebView2Loader.dll'
$signature = Get-AuthenticodeSignature -LiteralPath $loader
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*') { throw 'Invalid WebView2 loader signature' }
# The official MIDL header needs UUID specializations when compiled with MinGW.
$header = Get-Content -LiteralPath (Join-Path $sdk 'build/native/include/WebView2.h') -Raw
$uuids = [regex]::Matches($header, 'MIDL_INTERFACE\("([0-9a-fA-F-]+)"\)\s*(\w+)\s*:') | ForEach-Object {
    $g = $_.Groups[1].Value.Split('-')
    $tail = $g[3] + $g[4]
    $parts = @(('0x' + $g[0]), ('0x' + $g[1]), ('0x' + $g[2])) + @(0..7 | ForEach-Object { '0x' + $tail.Substring($_*2,2) })
    '__CRT_UUID_DECL(' + $_.Groups[2].Value + ', ' + ($parts -join ', ') + ')'
}
Set-Content -LiteralPath (Join-Path $nativeTools 'webview-uuid.h') -Value $uuids -Encoding utf8
Push-Location (Join-Path $projectRoot 'web')
try {
    if (!$SkipWebBuild -or !(Test-Path node_modules)) { Invoke-Checked 'npm.cmd' @('ci','--no-fund','--no-audit') }
    if (!$SkipWebBuild) { Invoke-Checked 'npm.cmd' @('run','build') }
    if (!(Test-Path dist/index.html)) { throw 'Missing web build' }
    if (!$SkipTests) { Invoke-Checked 'npm.cmd' @('test'); Invoke-Checked 'npm.cmd' @('run','test:ui') }
} finally { Pop-Location }
$version = '0.2.2'
$publish = Join-Path $projectRoot "artifacts/Folio-$version-native-win-x64"
if (Test-Path -LiteralPath $publish) { $publish += '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
New-Item -ItemType Directory -Path $publish -Force | Out-Null
$resource = Join-Path $nativeTools 'Folio.res.o'
Push-Location (Join-Path $projectRoot 'src/Folio.Native')
try { Invoke-Checked (Join-Path $toolchain 'bin/llvm-windres.exe') @('-I.','Folio.rc','-O','coff','-o',$resource) } finally { Pop-Location }
$flags = @('-std=c++20','-fms-extensions','-DUNICODE','-D_UNICODE','-D_WIN32_WINNT=0x0A00','-Os','-static','-I',(Join-Path $sdk 'build/native/include'),'-I',$nativeTools)
$libraries = @('-lole32','-loleaut32','-lshell32','-lshlwapi','-lbcrypt','-lcrypt32','-luuid','-ldwmapi','-luser32','-ladvapi32','-lgdi32')
Invoke-Checked $compiler ($flags + @('-municode','-mwindows',(Join-Path $projectRoot 'src/Folio.Native/main.cpp'),$resource,'-o',(Join-Path $publish 'Folio.exe'),'-Wl,--strip-all') + $libraries)
Copy-Item -LiteralPath $loader -Destination $publish
Copy-Item -LiteralPath (Join-Path $projectRoot 'web/dist') -Destination (Join-Path $publish 'Web') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'src/Folio/Assets') -Destination $publish -Recurse
foreach ($name in @('LICENSE','THIRD-PARTY-NOTICES.md','README.md','RELEASE_NOTES.md','SPEC.md','NATIVE_MIGRATION.md','TEST_RESULTS.md','INSTALLER.md','docs','examples')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $publish -Recurse }
New-Item -ItemType Directory -Path (Join-Path $publish 'locales'),(Join-Path $publish 'examples/ko') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'web/src/locales/en.json') -Destination (Join-Path $publish 'locales/en.json')
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'examples') -Filter '*.md' -File | Copy-Item -Destination (Join-Path $publish 'examples/ko')
Copy-Item -LiteralPath (Join-Path $projectRoot 'examples/assets') -Destination (Join-Path $publish 'examples/ko/assets') -Recurse
Copy-Item -LiteralPath (Join-Path $toolchain 'LICENSE.txt') -Destination (Join-Path $publish 'LLVM-MinGW-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $toolchain 'x86_64-w64-mingw32/share/mingw32') -Destination (Join-Path $publish 'native-runtime-licenses') -Recurse
@{ version=$version; host='native'; generatedAt=[DateTimeOffset]::Now.ToString('o'); compiler='llvm-mingw-20260922'; webviewSdk='1.0.3179.45' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $publish 'folio-build.json') -Encoding utf8
if (!$SkipTests) {
    $testExe = Join-Path $nativeTools 'storage-tests.exe'
    Invoke-Checked $compiler ($flags + @((Join-Path $projectRoot 'tests/Folio.Native.Tests/storage.cpp'),'-o',$testExe) + $libraries)
    Invoke-Checked $testExe @()
    Invoke-Checked 'node' @((Join-Path $projectRoot 'web/tests/native-host.mjs'),$publish)
}
if ($Zip) { Compress-Archive -LiteralPath $publish -DestinationPath ($publish + '.zip') }
if ($Installer) { & (Join-Path $PSScriptRoot 'Build-Installer.ps1') -AppDirectory $publish -RuntimeMode $RuntimeMode }
$bytes = (Get-ChildItem -LiteralPath $publish -File -Recurse | Measure-Object Length -Sum).Sum
Write-Output "Ready: $publish\Folio.exe ($([math]::Round($bytes/1MB,2)) MiB)"
