using Microsoft.Web.WebView2.Core;
using System.Runtime.InteropServices.WindowsRuntime;

namespace Folio;

public sealed partial class MainWindow
{
    private async Task VerifyFormatting(List<string> results, string output)
    {
        const string text = "Windows 서식 검증\n\n<!-- folio:table:v1 widths=140,220 -->\n\n| 이름 | 값 |\n| :--- | ---: |\n| 첫째 | 10 |\n| 둘째 | 20 |\n";
        LoadDocument(text, false); await Snapshot();
        await FocusFormattingElement(".ProseMirror > p");
        for (var level = 1; level <= 6; level++)
        {
            await FormattingClick("#heading-picker");
            await FormattingClick($"[data-level='{level}']");
            if (!(await Snapshot()).Text.StartsWith(new string('#', level) + " Windows 서식 검증") || headings.Single().Depth != level)
                throw new Exception("Heading dropdown/native outline mismatch at H" + level);
        }
        await FormattingClick("#heading-picker"); await FormattingClick("[data-level='0']");
        if ((await Snapshot()).Text.StartsWith('#') || headings.Count != 0) throw new Exception("Body conversion failed");
        Post(new { type = "undo" }); await Snapshot();
        if (headings.Single().Depth != 6) throw new Exception("Heading undo/native outline mismatch");
        results.Add("H1-H6/body dropdown updates the WebView2 document and native outline; host Undo restores H6");

        await FocusFormattingElement(".ProseMirror td p");
        await OpenTableContextMenu(); await FormattingClick("[data-action='row-after']");
        await OpenTableContextMenu(); await FormattingClick("[data-action='col-after']");
        await OpenTableContextMenu(); await FormattingClick("[data-action='center']");
        var edited = await Snapshot();
        if (!edited.Text.Contains("widths=140,0,220") || !edited.Dirty || await web.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.ProseMirror tr').length") != "4")
            throw new Exception("Table structure/width mutation failed");
        Post(new { type = "undo" }); await Snapshot(); Post(new { type = "redo" }); await Snapshot();
        if ((await Snapshot()).Text != edited.Text) throw new Exception("Table shared history mismatch");
        filePath = Path.Combine(output, "표 제목 편집 저장.md"); fingerprint = await FileStore.Fingerprint(filePath);
        if (!await Save(false)) throw new Exception("Formatting native save failed");
        var reopened = await FileStore.Read(filePath);
        if (reopened.Text.Replace("\r\n", "\n") != edited.Text || (await Snapshot()).Dirty) throw new Exception("Formatting disk reopen mismatch");
        LoadDocument(reopened.Text, false); await Snapshot();
        if (await web.CoreWebView2.ExecuteScriptAsync("getComputedStyle(document.querySelectorAll('.ProseMirror th')[1]).textAlign") != "\"center\"")
            throw new Exception("Column alignment did not survive disk reopen");
        await FocusFormattingElement(".ProseMirror td p");
        await OpenTableContextMenu();
        using (var capture = File.Create(Path.Combine(output, "windows-formatting.png")))
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, capture.AsRandomAccessStream());
        results.Add("Table row/column editing retains widths and alignment through shared Undo/Redo, native atomic save and disk reopen");
    }

    private async Task OpenTableContextMenu()
    {
        await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.ProseMirror').dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))");
        await Task.Delay(75); await Snapshot();
    }

    private async Task FormattingClick(string selector)
    {
        await web.CoreWebView2.ExecuteScriptAsync($"document.querySelector({System.Text.Json.JsonSerializer.Serialize(selector)}).click()");
        await Task.Delay(75); await Snapshot();
    }

    private async Task FocusFormattingElement(string selector)
    {
        await web.CoreWebView2.ExecuteScriptAsync($$"""
            (() => {
              const el = document.querySelector({{System.Text.Json.JsonSerializer.Serialize(selector)}});
              document.querySelector('.ProseMirror').focus();
              const range = document.createRange(); range.selectNodeContents(el); range.collapse(true);
              const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
              document.dispatchEvent(new Event('selectionchange'));
            })()
            """);
        await Task.Delay(100); await Snapshot();
    }
}
