Updated: 2026-10-19 16:24 KST (UTC+09:00)

# Folio 0.2.3 — Preserve your document on refresh

Windows x64 Native maintenance release. The Markdown editor and local file format remain compatible with 0.2.2.

## Fixes

- **Refresh no longer replaces an open document with the welcome README.** The Windows host blocks editor-page reloads after initial navigation, including F5, Ctrl+R and forced reload attempts. The open file, unsaved text, document identity and Undo/Redo history stay intact.
- **Save and close remain responsive after refresh attempts.** Preventing the editor/host document-ID mismatch removes the resulting snapshot timeout. The same fix is included in the optional Legacy WinUI source build; downloadable binaries use the Native host.
- **Compatible hard line breaks.** Shift+Enter in rendered mode saves Markdown hard breaks as two trailing spaces followed by a newline. Existing backslash hard breaks normalize when edited; code and preserved HTML retain their literal backslashes.

## Downloads

- **Folio-Setup-0.2.3-win-x64-online.exe**: per-user Windows installer. Save your work, close Folio, then run the installer to upgrade. Shared WebView2 is downloaded only if missing.
- **Folio-0.2.3-native-win-x64.zip**: portable app. Extract the whole folder and run Folio.exe; keep its supporting files together. WebView2 must already be installed.
- SHA-256 checksum files and the installer JSON manifest accompany the downloads. GitHub's automatic source archives contain source code, not the runnable app.

## Validation and compatibility

The release passed 33 web unit tests, native storage checks, 11 real-WebView2 integration scenarios and six refresh regression checks. The production UI suite passed 71 of 75 tests initially; all four timed-out tests passed when rerun with one worker and the same timeout. The refresh fix also passed six checks on the Legacy host. See [validation records](TEST_RESULTS.md) for evidence and limitations.

Windows 11 x64 is the tested platform. Packages are unsigned. Physical keyboard/IME, Excel, screen readers, Windows 10 and first-time WebView2 installation remain outside this release's automated coverage.

[README](README.md) · [Installation](INSTALLER.md) · [Changes since 0.2.2](https://github.com/bryan-white-1/folio/compare/v0.2.2...v0.2.3)
