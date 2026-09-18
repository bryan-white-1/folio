using Windows.ApplicationModel.DataTransfer;

namespace Folio;

public sealed partial class MainWindow
{
    private async Task<bool> CopyTableSelection(string text, string html)
    {
        try
        {
            if ((long)text.Length + html.Length > 10_000_000 || string.IsNullOrEmpty(html))
            {
                Post(new { type = "toast", message = "복사할 표의 크기는 최대 10MB입니다. 범위를 줄여주세요." });
                return false;
            }
            var data = new DataPackage { RequestedOperation = DataPackageOperation.Copy };
            data.SetText(text);
            data.SetHtmlFormat(HtmlFormatHelper.CreateHtmlFormat(html));
            for (var attempt = 0; attempt < 6; attempt++)
            {
                if (Clipboard.SetContentWithOptions(data, null))
                {
                    Clipboard.Flush();
                    Post(new { type = "toast", message = "선택한 셀을 복사했습니다" });
                    return true;
                }
                await Task.Delay(80);
            }
        }
        catch (Exception ex) { FileStore.Log(ex); }
        Post(new { type = "toast", message = "클립보드를 사용할 수 없습니다. 잠시 후 다시 복사하세요." });
        return false;
    }
}
