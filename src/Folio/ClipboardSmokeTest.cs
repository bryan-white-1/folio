using Microsoft.UI.Xaml;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics.Imaging;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;

namespace Folio;

public sealed partial class MainWindow
{
    private async Task VerifyClipboard(List<string> results, List<string> skipped, string output)
    {
        var before = await Snapshot();
        var skipSystemClipboard = Environment.GetEnvironmentVariable("FOLIO_TEST_SKIP_SYSTEM_CLIPBOARD") == "1";
        var previous = skipSystemClipboard ? null : Clipboard.GetContent();
        var restore = new DataPackage();
        if (previous is not null) foreach (var format in previous.AvailableFormats) restore.SetData(format, await previous.GetDataAsync(format));
        try
        {
            documentPathButton.Flyout.ShowAt(documentPathButton); await Task.Delay(150);
            if (documentPathText.Text != filePath || !documentPathText.IsReadOnly || !copyPathButton.IsEnabled || documentPathText.SelectedText != filePath)
                throw new Exception("Full path selection flyout mismatch");
            var flyoutContent = ((Microsoft.UI.Xaml.Controls.Flyout)documentPathButton.Flyout).Content;
            var bitmap = new RenderTargetBitmap(); await bitmap.RenderAsync(flyoutContent);
            using (var capture = File.Create(Path.Combine(output, "windows-copy-path.png")))
            {
                var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, capture.AsRandomAccessStream());
                encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, (await bitmap.GetPixelsAsync()).ToArray());
                await encoder.FlushAsync();
            }
            if (!skipSystemClipboard)
            {
                if (!await CopyDocumentPath() || await Clipboard.GetContent().GetTextAsync() != filePath) throw new Exception("Full path clipboard mismatch");
                results.Add("Full Korean/spaced path is copied to the Windows system clipboard");
            }
            else skipped.Add("System clipboard write/read: explicitly skipped because this execution environment denies OpenClipboard (Win32 error 5)");
            var after = await Snapshot();
            if (after.Text != before.Text || after.Revision != before.Revision || after.Dirty != before.Dirty || after.DocumentId != before.DocumentId)
                throw new Exception("Full path clipboard or document invariant mismatch");
            results.Add("Native filename flyout selects the full Korean/spaced path, exposes copy controls and preserves the document state");
            if (!skipSystemClipboard)
            {
                documentPathButton.Flyout.Hide();
                LoadDocument("| 이름 | 값 |\n| --- | --- |\n| 한글 | **001** |\n", false); await Snapshot();
                await FocusFormattingElement(".ProseMirror th p");
                await OpenTableContextMenu(); await FormattingClick("[data-action='select-table']");
                var tableBefore = await Snapshot();
                await OpenTableContextMenu(); await FormattingClick("[data-action='copy']");
                var copiedText = "";
                for (var attempt = 0; attempt < 20; attempt++)
                {
                    var copied = Clipboard.GetContent();
                    if (copied.Contains(StandardDataFormats.Text)) copiedText = await copied.GetTextAsync();
                    if (copiedText == "이름\t값\r\n한글\t001") break;
                    await Task.Delay(50);
                }
                var clipboard = Clipboard.GetContent();
                if (copiedText != "이름\t값\r\n한글\t001" || !clipboard.Contains(StandardDataFormats.Html)) throw new Exception("Table Copy menu system clipboard mismatch");
                var html = HtmlFormatHelper.GetStaticFragment(await clipboard.GetHtmlFormatAsync());
                if (!html.Contains("<th") || !html.Contains("<strong>001</strong>")) throw new Exception("Table clipboard HTML lost headers or formatting");
                var tableAfter = await Snapshot();
                if (tableAfter.Text != tableBefore.Text || tableAfter.Revision != tableBefore.Revision || tableAfter.Dirty != tableBefore.Dirty)
                    throw new Exception("Table Copy menu edited the document");
                results.Add("Table context Copy writes HTML headers/formatting and tab-separated text to the Windows clipboard without editing Markdown");
            }
        }
        finally
        {
            for (var attempt = 0; !skipSystemClipboard && attempt < 6; attempt++)
            {
                if (Clipboard.SetContentWithOptions(restore, null)) { Clipboard.Flush(); break; }
                await Task.Delay(80);
            }
            documentPathButton.Flyout.Hide();
        }

        LoadDocument("", false); await Snapshot();
        await web.CoreWebView2.ExecuteScriptAsync("""
            (() => {
              document.querySelector('.ProseMirror').focus();
              const clipboardData = new DataTransfer();
              clipboardData.setData('text/html', '<table><tr><td>머리</td><td>값</td></tr><tr><td>엑셀</td><td>001</td></tr></table>');
              document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
            })()
            """);
        var pasted = await Snapshot();
        if (!pasted.Text.Contains("엑셀") || !pasted.Text.Contains("001") || !pasted.Dirty || await web.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.ProseMirror th').length") != "2")
            throw new Exception("WebView2 Excel table paste failed");
        Post(new { type = "undo" }); if ((await Snapshot()).Text != "") throw new Exception("Table paste undo failed");
        LoadDocument("```js\n# literal\nconst x = 1;\n```\n", false); await Snapshot();
        await FocusFormattingElement(".ProseMirror pre code"); await FormattingClick("[data-command='code']");
        if (await web.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.ProseMirror pre, .ProseMirror h1').length") != "0" || !(await Snapshot()).Text.Contains("literal"))
            throw new Exception("WebView2 code block removal failed");
        if (System.Text.Json.JsonSerializer.Deserialize<string>(await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-command=image]').getAttribute('aria-label')")) != "이미지 삽입")
            throw new Exception("Image toolbar button missing");
        results.Add("Windows WebView2 Excel table paste, independent Undo, code block removal and image toolbar availability");
        LoadDocument("**할 일**\n", false); await Snapshot();
        await FocusFormattingElement(".ProseMirror > p"); await FormattingClick("[data-command='task']");
        if (await web.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.ProseMirror input[type=checkbox]').length") != "1" || !(await Snapshot()).Text.Contains("[ ] **할 일**"))
            throw new Exception("WebView2 checklist toolbar conversion failed");
        await FormattingClick(".ProseMirror input[type=checkbox]");
        if (!(await Snapshot()).Text.Contains("[x] **할 일**")) throw new Exception("WebView2 checklist completion failed");
        await FocusFormattingElement(".ProseMirror li p"); await FormattingClick("[data-command='task']");
        if (await web.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.ProseMirror input[type=checkbox]').length") != "0") throw new Exception("WebView2 checklist removal failed");
        Post(new { type = "undo" });
        if (!(await Snapshot()).Text.Contains("[x] **할 일**")) throw new Exception("WebView2 checklist undo failed");
        results.Add("Checklist toolbar preserves inline formatting, completion state and independent Undo through the Windows document bridge");
    }
}
