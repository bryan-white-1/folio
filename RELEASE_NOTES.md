Updated: 2026-09-30 09:50 KST (UTC+09:00)

# Folio 0.2.2 — Small installer, practical Markdown

Folio is a lightweight Windows Markdown editor for local notes, specifications, and AI-assisted workflows. This release moves the app to a native Windows host while keeping the familiar rendered and source editing experience.

## What's new since 0.1.11

- **A much smaller package.** The new C++/Win32 host uses the shared Microsoft WebView2 Runtime and removes bundled .NET and Windows App SDK runtimes. The Windows x64 online installer is about **6.3 MB**, compared with about 64.84 MB for the published 0.1.11 installer. Shared WebView2 runtime downloads and disk usage are separate.
- **English and Korean interfaces.** Installer language initializes the app's menus, messages, welcome document, and examples. An explicit app language preference is preserved across reinstalls; changes in Settings apply on the next launch.
- **A refreshed workspace.** A compact toolbar, square controls, a white editing surface and outline in the light theme, and a web-based shell bring document navigation, settings, and recent files together. Dark mode remains available.
- **A clearer project introduction.** The English README explains the purpose and everyday workflow, with five screenshots of the current English interface, download links, and build instructions.
- **Upgrade continuity.** The installer keeps documents and existing settings, and removes recognized, unchanged 0.1.11 runtime files during an upgrade. The legacy C#/WinUI host remains available as an optional source build.

## Everyday features included

| Feature | Workflow |
| --- | --- |
| Mermaid | Render flowcharts, sequence, class, state, and ER diagrams; jump to source or zoom from 25% to 300%. |
| Tables | Drag column boundaries, adjust shared body/table line spacing from 1.00× to 3.00×, and copy or paste cell ranges with Excel. |
| Markdown outline | Navigate H1–H6 and Setext headings; search, collapse, and rename headings in the sidebar. |
| Images | Resize with a handle or pixel width. Insert files or paste screenshots, then save images beside the Markdown in an `assets` folder. |
| AI-friendly file references | View and copy the full document path for prompts or tools with local file access. |
| Recent files | Search and reopen up to 20 documents by filename or folder with `Ctrl+Shift+O`. |
| Editing and recovery | Switch between rendered and source views, search formatted text, use shared undo/redo, detect save conflicts, and recover periodic snapshots. |

## Download and upgrade

1. Download **Folio-Setup-0.2.2-win-x64-online.exe** from the release assets.
2. Save your work and close any running Folio window, then run the installer. The app installs per user.
3. Launch **Folio** from the Start menu. Try **More → Example documents** to explore tables, images, and Mermaid.

For portable use, extract **Folio-0.2.2-native-win-x64.zip** and run `Folio.exe`. Keep the extracted files together; install Microsoft WebView2 Runtime separately if it is missing. GitHub's automatic “Source code” archives contain source files rather than a runnable app.

The release includes SHA-256 files for both downloads and a JSON installer manifest with exact byte size and component hashes. When sharing a document, include its adjacent image assets.

## Validation

The release passed the TypeScript/Vite production build, **33 web unit tests**, **70 production UI tests**, native C++ storage checks, and **11 real WebView2 integration scenarios**. An isolated installer run also verified the **0.1.11 → 0.2.2 upgrade**, reinstallation, English/Korean startup, installed-app integration, and uninstallation while preserving user documents and the existing production installation.

## Compatibility and limits

- Windows 11 x64 is the primary tested environment. Windows 10 and ARM64 remain unverified.
- The online installer downloads WebView2 only when needed; local editing works offline after setup.
- Current packages are unsigned; Windows may show an unknown-publisher or SmartScreen notice.
- Documents must be UTF-8 and no larger than 10 MB. External images are not loaded automatically.
- Table widths and image sizes use Markdown-adjacent HTML comments; other viewers may show default sizes.
- Physical IME input, the real Excel application, screen readers, and first-time setup on a PC without WebView2 still require broader manual coverage.

See [validation records](TEST_RESULTS.md), [installation details](INSTALLER.md), and the [README](README.md). Folio is available under the [Apache License 2.0](LICENSE); report problems through [GitHub Issues](https://github.com/bryan-white-1/folio/issues).
