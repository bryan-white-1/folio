using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Graphics.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;

namespace Folio;

// Opt-in integration diagnostics; runs only with --smoke-test, using an isolated profile.
public sealed partial class MainWindow
{
    private async Task RunSmokeTest()
    {
        busy = true; recoveryTimer.Stop(); externalTimer.Stop();
        var results = new List<string>();
        var skipped = new List<string>();
        var output = Path.Combine(FileStore.DataDirectory, "diagnostics"); Directory.CreateDirectory(output);
        try
        {
            await Task.Delay(250);
            const string text = "# Windows 연결 검증\n\n본문 한글.\n\n## 하위 제목\n\n* 목록\n\n__강조__\n";
            LoadDocument(text, false);
            var loaded = await Snapshot();
            if (loaded.Text != text || loaded.Dirty) throw new Exception("Initial load changed source");
            if (headings.Count != 2 || tree.RootNodes.Count != 1 || tree.RootNodes[0].Children.Count != 1) throw new Exception("Native outline tree mismatch");
            results.Add("Windows WebView2 ↔ C# document bridge and native heading tree");
            var editorTop = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#editor-scroll').getBoundingClientRect().top");
            var duplicateTitle = await web.CoreWebView2.ExecuteScriptAsync("getComputedStyle(document.querySelector('.editor-header')).display");
            if (editorTop != "48" || duplicateTitle != "\"none\"" || root.RowDefinitions[0].Height.Value != 56) throw new Exception("Compact header layout mismatch");
            results.Add("Filename uses the native 56px app bar; editor starts below a single 48px toolbar");
            await Task.Delay(300);
            tree.UpdateLayout();
            var visibleLabels = VisualDescendants(tree).OfType<TextBlock>().Select(label => label.Text).ToArray();
            if (!visibleLabels.Contains("Windows 연결 검증") || !visibleLabels.Contains("하위 제목") || visibleLabels.Any(label => label.StartsWith("Microsoft.UI.Xaml.Controls.TreeView")))
                throw new Exception("Realized outline text mismatch: " + string.Join(" | ", visibleLabels));
            var treeBitmap = new RenderTargetBitmap();
            var originalBackground = tree.Background;
            tree.Background = root.Background;
            await treeBitmap.RenderAsync(tree);
            tree.Background = originalBackground;
            using (var capture = File.Create(Path.Combine(output, "windows-outline.png")))
            {
                var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, capture.AsRandomAccessStream());
                encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)treeBitmap.PixelWidth, (uint)treeBitmap.PixelHeight, 96, 96, (await treeBitmap.GetPixelsAsync()).ToArray());
                await encoder.FlushAsync();
            }
            results.Add("Realized native tree displays heading labels, with outline pixel capture");
            var configurationTask = ShowConfiguration();
            await Task.Delay(300);
            var bodyControl = VisualDescendants(configurationDialog!).OfType<NumberBox>().Single(control => control.Name == "BodyLineHeight");
            var outlineControl = VisualDescendants(configurationDialog!).OfType<NumberBox>().Single(control => control.Name == "OutlineLineHeight");
            var alignmentControl = VisualDescendants(configurationDialog!).OfType<ComboBox>().Single(control => control.Name == "DocumentAlignment");
            bodyControl.Value = 1.4; outlineControl.Value = 1.2; alignmentControl.SelectedIndex = 0;
            await Snapshot(); await Task.Delay(150); tree.UpdateLayout();
            var lineHeight = await web.CoreWebView2.ExecuteScriptAsync("getComputedStyle(document.querySelector('.ProseMirror')).lineHeight");
            var documentX = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#rendered-editor').getBoundingClientRect().x");
            var realizedItem = VisualDescendants(tree).OfType<TreeViewItem>().First();
            if (lineHeight != "\"21px\"" || documentX != "0" || Math.Abs(realizedItem.ActualHeight - 22.4) > 1) throw new Exception("Live configuration mismatch: " + lineHeight + "/" + documentX + "/" + realizedItem.ActualHeight);
            await CaptureConfiguration(configurationDialog!, Path.Combine(output, "windows-configuration.png"));
            var saveButton = VisualDescendants(configurationDialog!).OfType<Button>().Single(button => button.Name == "PrimaryButton");
            var savePeer = Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer.CreatePeerForElement(saveButton);
            ((Microsoft.UI.Xaml.Automation.Provider.IInvokeProvider)savePeer.GetPattern(Microsoft.UI.Xaml.Automation.Peers.PatternInterface.Invoke)).Invoke();
            await configurationTask;
            var savedConfiguration = FileStore.LoadPreferences();
            if (savedConfiguration.BodyLineHeight != 1.4 || savedConfiguration.OutlineLineHeight != 1.2 || savedConfiguration.DocumentAlignment != "left") throw new Exception("Configuration persistence failed");
            results.Add("Native Configuration dialog previews body/outline spacing and left placement, then saves preferences");
            configurationTask = ShowConfiguration(); await Task.Delay(250);
            VisualDescendants(configurationDialog!).OfType<NumberBox>().Single(control => control.Name == "BodyLineHeight").Value = 2.5;
            configurationDialog!.Hide(); await configurationTask; await Snapshot();
            var afterConfiguration = await Snapshot();
            if (preferences.BodyLineHeight != 1.4 || FileStore.LoadPreferences().BodyLineHeight != 1.4 || afterConfiguration.Text != text || afterConfiguration.Dirty) throw new Exception("Configuration cancellation changed saved settings or Markdown");
            results.Add("Configuration cancellation restores saved appearance without changing Markdown or dirty state");
            await VerifyRecentDocuments(results, output);
            await web.CoreWebView2.ExecuteScriptAsync("window.folio.receive({type:'toggleMode'})");
            await web.CoreWebView2.ExecuteScriptAsync("window.folio.receive({type:'toggleMode'})");
            var switched = await Snapshot();
            if (switched.Text != text || switched.Dirty) throw new Exception("Mode switch changed source");
            results.Add("Untouched source preserved across rendered/source mode switches");
            await web.CoreWebView2.ExecuteScriptAsync("window.folio.receive({type:'renameHeading',id:'h-0',title:'수정된 제목'})");
            var renamed = await Snapshot();
            if (!renamed.Text.StartsWith("# 수정된 제목\n") || !renamed.Dirty || headings[0].Label != "수정된 제목") throw new Exception("Heading edit bridge mismatch");
            results.Add("Heading rename updates source and native tree");
            filePath = Path.Combine(output, "저장 검증.md"); fingerprint = await FileStore.Fingerprint(filePath);
            if (!await Save(false)) throw new Exception("Save failed");
            var saved = await Snapshot();
            var reopened = await FileStore.Read(filePath);
            if (reopened.Text != saved.Text || saved.Dirty) throw new Exception("Save/reopen mismatch");
            results.Add("C# atomic save, save acknowledgement and UTF-8 reopen");
            Post(new { type = "jump", id = headings[1].Id });
            await Snapshot();
            var selected = tree.SelectedNode?.Content as Microsoft.UI.Xaml.Controls.TextBlock;
            if (selected?.Text != "하위 제목") throw new Exception("Outline cursor synchronization failed");
            results.Add("Native outline navigation and active heading synchronization");
            Post(new { type = "undo" }); await Snapshot();
            if (!(await Snapshot()).Text.StartsWith("# Windows 연결 검증")) throw new Exception("Native Undo failed");
            results.Add("Native Undo command restores original Markdown");
            var imageDirectory = Path.Combine(output, "assets"); Directory.CreateDirectory(imageDirectory);
            await File.WriteAllBytesAsync(Path.Combine(imageDirectory, "pixel.png"), Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQifb4DwADFQG/3OBqxQAAAABJRU5ErkJggg=="));
            LoadDocument((await Snapshot()).Text + "\n![이미지](assets/pixel.png)\n", true); await Snapshot();
            await Task.Delay(300);
            var imageWidth = "0";
            for (var attempt = 0; attempt < 20 && imageWidth != "1"; attempt++)
            { imageWidth = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.ProseMirror img')?.naturalWidth"); if (imageWidth != "1") await Task.Delay(200); }
            if (imageWidth != "1")
            {
                var detail = await web.CoreWebView2.ExecuteScriptAsync("JSON.stringify({image:document.querySelector('.ProseMirror img')?.outerHTML,resources:performance.getEntriesByType('resource').map(r=>({name:r.name,status:r.responseStatus}))})");
                throw new Exception("Relative image host mapping failed: " + imageWidth + " " + detail);
            }
            results.Add("Local relative image loads through restricted Windows resource bridge");
            const string mixed = "# 혼합 개행\r\n\n* 보존\r\n";
            fingerprint = await FileStore.Save(filePath, mixed, "\r\n", true, fingerprint, true);
            bom = true; newline = "\r\n"; LoadDocument(mixed, false); await Snapshot();
            await Save(false); await Save(false);
            if (originalText != mixed || (await FileStore.Read(filePath)).Text != mixed) throw new Exception("Repeated save normalized untouched file");
            results.Add("Repeated untouched saves preserve original mixed line endings and BOM");
            const string diagramText = "# Mermaid 검증\n\n```mermaid\nflowchart TB\n A(Excel 업로드) --> B(서버: 셀 JSON 구성)\n B --> C(LLM 구조 탐지)\n C -.-> D(영역 구조 검증)\n```\n\n본문 유지\n";
            LoadDocument(diagramText, false); await Snapshot();
            var diagramState = "";
            for (var attempt = 0; attempt < 50; attempt++)
            {
                diagramState = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.mermaid-card')?.dataset.state");
                if (diagramState == "\"ready\"") break;
                await Task.Delay(100);
            }
            if (diagramState != "\"ready\"") throw new Exception("Bundled Mermaid failed: " + diagramState);
            var diagramFill = await web.CoreWebView2.ExecuteScriptAsync("getComputedStyle(document.querySelector('.mermaid-diagram').shadowRoot.querySelector('.node rect')).fill");
            if (diagramFill == "\"rgb(0, 0, 0)\"") throw new Exception("Mermaid theme was lost");
            var diagramSnapshot = await Snapshot();
            if (diagramSnapshot.Text != diagramText || diagramSnapshot.Dirty) throw new Exception("Mermaid rendering changed Markdown");
            using (var stream = File.Create(Path.Combine(output, "windows-mermaid.png"))) await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream.AsRandomAccessStream());
            results.Add("Bundled Mermaid renders styled Korean SVG in WebView2 without changing document state");
            LoadDocument(diagramText, true); await Snapshot();
            await Save(false);
            if ((await FileStore.Read(filePath!)).Text.Replace("\r\n", "\n") != diagramText || (await Snapshot()).Dirty) throw new Exception("Mermaid save/reopen mismatch");
            results.Add("Mermaid source survives native save acknowledgement and UTF-8 file reopen");
            const string withBreak = "# 렌더링 편집 검증\n\n첫 문단\n\n<br />\n\n마지막 문단\n";
            LoadDocument(withBreak, false); await Snapshot();
            var editable = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('.ProseMirror')?.getAttribute('contenteditable')");
            if (editable != "\"true\"") throw new Exception("HTML break disabled rendered editing");
            results.Add("Rendered body remains editable when document contains HTML blank paragraphs");
            var linkedPath = Path.Combine(output, "한글 공백 연결 문서.md");
            const string linkedText = "# 파일 연결 검증\n\n더블클릭으로 전달한 문서\n";
            await File.WriteAllTextAsync(linkedPath, linkedText);
            var launch = new System.Diagnostics.ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
            launch.ArgumentList.Add(linkedPath);
            using (var forwarded = System.Diagnostics.Process.Start(launch)!)
            { await forwarded.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12)); if (forwarded.ExitCode != 0) throw new Exception("Shell activation forwarding failed"); }
            if ((await Snapshot()).Text != withBreak) throw new Exception("Busy window lost its document to activation");
            busy = false;
            for (var attempt = 0; attempt < 30 && filePath != linkedPath; attempt++) { await ProcessActivation(); await Task.Delay(100); }
            busy = true;
            if ((await Snapshot()).Text != linkedText || filePath != linkedPath || !documentTitle.Text.Contains(Path.GetFileName(linkedPath))) throw new Exception("Forwarded document did not open in the existing window");
            results.Add("A second process forwards a quoted Korean file path to the existing app after it becomes idle");
            await web.CoreWebView2.ExecuteScriptAsync("window.folio.receive({type:'renameHeading',id:'h-0',title:'미저장 제목'})");
            var dirtySnapshot = await Snapshot();
            var anotherPath = Path.Combine(output, "다음 문서.markdown"); await File.WriteAllTextAsync(anotherPath, "# 다음 문서\n");
            await ActivationBroker.Forward(anotherPath);
            busy = false; var opening = ProcessActivation(); await Task.Delay(250);
            var confirmation = VisualTreeHelper.GetOpenPopupsForXamlRoot(root.XamlRoot).SelectMany(popup => VisualDescendants(popup.Child).Prepend(popup.Child)).OfType<ContentDialog>().Single();
            confirmation.Hide(); await opening; busy = true;
            var canceled = await Snapshot();
            if (filePath != linkedPath || canceled.Text != dirtySnapshot.Text || !canceled.Dirty) throw new Exception("Shell activation discarded unsaved edits after cancel");
            results.Add("Opening an associated document retains the save/discard/cancel protection for unsaved changes");
            await VerifyFormatting(results, output);
            await VerifyClipboard(results, skipped, output);
            await VerifySearch(results, output);
            await VerifyImageImport(results, output);
            await CaptureConfiguration(root, Path.Combine(output, "windows-shell.png"));
            await Task.Delay(300);
            using (var stream = File.Create(Path.Combine(output, "windows-editor.png"))) await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream.AsRandomAccessStream());
            await File.WriteAllTextAsync(Path.Combine(output, "windows-smoke.json"), JsonSerializer.Serialize(new { passed = true, tests = results, skipped, timestamp = DateTimeOffset.Now }, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            FileStore.Log(ex); Environment.ExitCode = 1;
            await File.WriteAllTextAsync(Path.Combine(output, "windows-smoke.json"), JsonSerializer.Serialize(new { passed = false, tests = results, skipped, error = ex.ToString(), timestamp = DateTimeOffset.Now }, new JsonSerializerOptions { WriteIndented = true }));
        }
        finally { allowClose = true; Close(); }
    }

    private static IEnumerable<DependencyObject> VisualDescendants(DependencyObject parent)
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(parent); index++)
        {
            var child = VisualTreeHelper.GetChild(parent, index);
            yield return child;
            foreach (var descendant in VisualDescendants(child)) yield return descendant;
        }
    }

    private static async Task CaptureConfiguration(UIElement element, string path)
    {
        var bitmap = new RenderTargetBitmap();
        await bitmap.RenderAsync(element);
        using var capture = File.Create(path);
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, capture.AsRandomAccessStream());
        encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, (await bitmap.GetPixelsAsync()).ToArray());
        await encoder.FlushAsync();
    }
}
