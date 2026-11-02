Updated: 2026-11-02 17:57 KST (UTC+09:00)

# Folio 0.2.5 — Project tabs and Text editing

- **Project browsing:** open a folder, expand children on demand, and toggle excluded dependency/build directories. Linked directories are not expanded.
- **Document tabs:** independent undo, selection and scroll positions; `Ctrl+W` to close, `Ctrl+Tab` to switch, and **Save all** / **Reload from disk** commands. Recovery and external-change checks cover all open documents.
- **Text editing:** Python, JSON, Java, C, C++ and plain UTF-8 text with syntax highlighting, language selection, indentation, word wrap and `Ctrl+G`. Text saves preserve BOM, untouched mixed line endings, whitespace and missing final newlines. Syntax highlighting does not execute code.
- **Editor contrast:** coordinated light/dark backgrounds for active tabs, Text, Markdown source and rendered documents, with clearer syntax colors.

**Downloads:** Windows x64 online MSI and portable ZIP, SHA-256 checksums and MSI package manifest. MSI upgrades the previous MSI installation; close Folio before updating. Existing EXE installations must first be uninstalled. WebView2 is required; the online MSI downloads it only when missing. Packages are unsigned.

**Validation:** 36 unit tests, native storage checks and 13 real-WebView2 integration scenarios passed, including system clipboard. Six refresh checks and six workspace scenarios passed. Isolated MSI installation, upgrade, repair, downgrade protection, installed-app integration and removal passed. The initial UI run passed 83/85; the complete 85/85 suite passed without code changes on rerun. Full results and installer coverage are recorded in [TEST_RESULTS.md](TEST_RESULTS.md).

**Scope:** Native host; Legacy retains single-document Markdown editing. UTF-8 files up to 10 MiB; binary and unsupported encodings are rejected. Normal-exit session restoration is not included. See [test evidence](TEST_RESULTS.md) and [installation details](INSTALLER.md).

[Changes since 0.2.4](https://github.com/bryan-white-1/folio/compare/v0.2.4...v0.2.5)

---

# Folio 0.2.4 — Windows MSI installer

- **MSI installation:** double-click `Folio-Setup-0.2.4-win-x64-online.msi`. Installs for the current user, with a Start menu shortcut, optional desktop shortcut and Markdown integration. Downloads WebView2 only when missing. No developer tools or .NET runtime are needed on the target PC.
- **Updates and removal:** Windows Installer repair, MSI major upgrades and downgrade protection. Uninstallation preserves user documents, settings, recovery data and shared WebView2.
- **Heading navigation:** improved caret/focus placement when selecting a heading, including repeated selection, without changing document content.
- **First-table editing:** insert a paragraph before a document's first table using the keyboard or the top boundary, with shared Undo/Redo.
- **Korean fonts:** choose a locally installed document font, preview changes, save or cancel, and restore the default.

**Switching from EXE to MSI:** save your work and close Folio; uninstall the existing Folio EXE edition in Windows Settings, then run the MSI. The MSI detects an existing EXE installation and explains this requirement. Documents and `%LOCALAPPDATA%\Folio` settings are retained. Subsequent MSI releases upgrade the installed MSI directly.

**Downloads:** MSI, SHA-256 checksum and JSON package manifest. The online MSI needs internet only if WebView2 is missing. The build also supports an offline MSI using `./build.ps1 -Msi -RuntimeMode Offline`.

**Platform:** Windows x64; Windows 11 is the tested environment. The installer UI is English; the editor supports Korean and English. Packages are unsigned. First-time WebView2 deployment on a clean PC and Windows 10 require separate environment validation. See [installation details](INSTALLER.md) and [test evidence](TEST_RESULTS.md).

[Changes since 0.2.3](https://github.com/bryan-white-1/folio/compare/v0.2.3...v0.2.4)

---

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
