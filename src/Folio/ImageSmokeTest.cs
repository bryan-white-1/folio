using System.Text.Json;

namespace Folio;

public sealed partial class MainWindow
{
    private async Task VerifyImageImport(List<string> results, string output)
    {
        const string encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQifb4DwADFQG/3OBqxQAAAABJRU5ErkJggg==";
        filePath = null; fingerprint = null; LoadDocument("앞뒤\n", false); await Snapshot();
        await FocusFormattingElement(".ProseMirror p");
        await web.CoreWebView2.ExecuteScriptAsync("getSelection().collapse(document.querySelector('.ProseMirror p').firstChild, 1); document.dispatchEvent(new Event('selectionchange'))");
        busy = false;
        try
        {
            await web.CoreWebView2.ExecuteScriptAsync($$"""
                (() => {
                  const bytes = Uint8Array.from(atob('{{encoded}}'), c => c.charCodeAt(0));
                  const data = new DataTransfer();
                  data.items.add(new File([bytes], '잘라낸 이미지.png', {type: 'image/png'}));
                  document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
                })()
                """);
            var loaded = false;
            for (var attempt = 0; attempt < 40; attempt++)
            {
                if (await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.ProseMirror img')?.naturalWidth") == "1") { loaded = true; break; }
                await Task.Delay(100);
            }
            if (!loaded) throw new Exception("Pasted image did not render through the WebView2/native asset store");
        }
        finally { busy = true; }
        var inserted = await Snapshot();
        var reference = inserted.Images!.Single();
        var draftImage = Path.Combine(Path.GetDirectoryName(ImageDocumentPath)!, reference);
        if (filePath is not null || !inserted.Dirty || !inserted.Text.Contains("앞![이미지](" + reference + ")뒤") ||
            !File.ReadAllBytes(draftImage).SequenceEqual(Convert.FromBase64String(encoded))) throw new Exception("Unsaved image import changed the destination, caret or bytes");
        Post(new { type = "undo" }); if ((await Snapshot()).Text != "앞뒤\n") throw new Exception("Image paste is not one undo step");
        var destination = Path.Combine(output, "image-save", "붙여넣기 이미지.md");
        if (!await Save(false, destination) || !File.Exists(Path.Combine(Path.GetDirectoryName(destination)!, reference))) throw new Exception("First save did not carry an image retained by Undo/Redo");
        Post(new { type = "redo" }); if ((await Snapshot()).Text != inserted.Text) throw new Exception("Image redo after first save failed");
        if (!await Save(false)) throw new Exception("Image Markdown save failed");
        LoadDocument((await FileStore.Read(destination)).Text, false); await Snapshot();
        for (var attempt = 0; attempt < 20 && await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.ProseMirror img')?.naturalWidth") != "1"; attempt++) await Task.Delay(100);
        if (await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.ProseMirror img')?.naturalWidth") != "1") throw new Exception("Saved image did not render after disk reopen");
        results.Add("Image file paste travels through WebView2 to draft assets, renders at the original caret, and survives Undo/Redo, first save and disk reopen");

        var recoveryAssetId = Guid.NewGuid().ToString("N");
        var recoveredPaths = await FileStore.ImportImages(FileStore.DraftDocument(recoveryAssetId), [Convert.FromBase64String(encoded)]);
        filePath = null; fingerprint = null;
        LoadDocument($"![복구]({recoveredPaths[0]})\n", true, recoveryAssetId); await Snapshot();
        for (var attempt = 0; attempt < 20 && await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.ProseMirror img')?.naturalWidth") != "1"; attempt++) await Task.Delay(100);
        if (await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.ProseMirror img')?.naturalWidth") != "1") throw new Exception("Recovered draft image is missing");
        results.Add("Unsaved document recovery restores its persisted draft image directory");
    }
}
