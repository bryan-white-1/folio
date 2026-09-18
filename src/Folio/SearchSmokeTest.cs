using Microsoft.Web.WebView2.Core;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;

namespace Folio;

public sealed partial class MainWindow
{
    private async Task VerifySearch(List<string> results, string output)
    {
        LoadDocument("# 찾기 검증\n\n한글 **검색**\n\n| 제목 | 값 |\n| --- | --- |\n| 한글 검색 | 값 |\n", false);
        var before = await Snapshot();
        Post(new { type = "find" }); await Task.Delay(100);
        await web.CoreWebView2.ExecuteScriptAsync("""
            (() => {
              const input = document.querySelector('#search-query');
              input.value = '한글 검색'; input.dispatchEvent(new Event('input', {bubbles: true}));
            })()
            """);
        await Task.Delay(200);
        var status = JsonSerializer.Deserialize<string>(await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#search-count').textContent"));
        if (status != "1 / 2" || await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#rendered-editor').hidden") != "false")
            throw new Exception("Rendered Find changed modes or failed to count marked/table text");
        await FormattingClick("#search-next");
        if (JsonSerializer.Deserialize<string>(await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#search-count').textContent")) != "2 / 2")
            throw new Exception("Rendered Find navigation failed");
        using (var stream = File.Create(Path.Combine(output, "windows-search.png")))
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream.AsRandomAccessStream());
        await FormattingClick("#search-close");
        var after = await Snapshot();
        if (after.Text != before.Text || after.Revision != before.Revision || after.Dirty != before.Dirty ||
            await web.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.folio-search-match').length") != "0")
            throw new Exception("Rendered Find modified the document or retained closed highlights");
        results.Add("Windows Find keeps rendered mode, counts marked/table text, navigates matches and closes without editing Markdown");
        if (editorBorder.CornerRadius.TopLeft != 8 || saveButton.CornerRadius.TopLeft != 4 ||
            JsonSerializer.Deserialize<string>(await web.CoreWebView2.ExecuteScriptAsync("getComputedStyle(document.querySelector('#find')).borderRadius")) != "4px")
            throw new Exception("Reduced native/web corner radius mismatch");
        results.Add("Native editor frame/button and WebView2 toolbar use reduced corner radii");
    }
}
