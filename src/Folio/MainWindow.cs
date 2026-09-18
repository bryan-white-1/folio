using System.Diagnostics;
using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Pickers;
using Windows.ApplicationModel.DataTransfer;
using Windows.System;
using Windows.UI;

namespace Folio;

public sealed record Heading(string Id, int Depth, string Label, int From, int To, int SectionEnd, string? ParentId);
public sealed record EditorSnapshot(string Text, long Revision, bool Dirty, string DocumentId, string[]? Images = null);

public sealed partial class MainWindow : Window
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    private readonly Grid root = new();
    private readonly Border editorBorder = new() { CornerRadius = new CornerRadius(8, 0, 0, 0), BorderThickness = new Thickness(1, 1, 0, 0) };
    private Button saveButton = null!;
    private readonly TextBlock documentTitle = new() { Name = "DocumentTitle", Text = "제목 없음.md", FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
    private readonly Button documentPathButton = new() { Name = "DocumentPathButton", HorizontalContentAlignment = HorizontalAlignment.Stretch, Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0), Padding = new Thickness(8, 6, 8, 6), MinWidth = 0 };
    private readonly TextBox documentPathText = new() { Name = "DocumentPathText", IsReadOnly = true, TextWrapping = TextWrapping.Wrap, MinWidth = 280, MaxWidth = 580 };
    private readonly Button copyPathButton = new() { Name = "CopyPathButton", Content = "전체 경로 복사", HorizontalAlignment = HorizontalAlignment.Right };
    private readonly DispatcherTimer activationTimer = new() { Interval = TimeSpan.FromMilliseconds(200) };
    private bool acceptActivations;
    private readonly WebView2 web = new();
    private readonly TreeView tree = new() { SelectionMode = TreeViewSelectionMode.Single, CanDragItems = false, CanReorderItems = false, AllowDrop = false };
    private readonly TextBlock status = new() { FontSize = 11, Text = "편집기 준비 중…" };
    private readonly TextBlock outlineCount = new() { FontSize = 11 };
    private readonly TextBlock emptyOutline = new() { Text = "제목을 쓰면 목차가 나타납니다.\n# 제목으로 시작해보세요.", FontSize = 12, Opacity = .55, Margin = new Thickness(20, 28, 20, 0), TextWrapping = TextWrapping.Wrap };
    private readonly TextBox filter = new() { PlaceholderText = "목차에서 찾기", FontSize = 12, Margin = new Thickness(16, 4, 16, 14) };
    private readonly Dictionary<string, TreeViewNode> nodes = [];
    private readonly Dictionary<string, TaskCompletionSource<EditorSnapshot>> requests = [];
    private readonly Preferences preferences = FileStore.LoadPreferences();
    private readonly DispatcherTimer recoveryTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    private readonly DispatcherTimer externalTimer = new() { Interval = TimeSpan.FromSeconds(4) };
    private readonly string? startupPath;
    private readonly ColumnDefinition sidebarColumn = new();
    private List<Heading> headings = [];
    private string? filePath;
    private string? fingerprint;
    private string newline = "\n";
    private bool bom;
    private string originalText = "";
    private string documentId = "welcome";
    private string assetId = Guid.NewGuid().ToString("N");
    private string ImageDocumentPath => filePath ?? FileStore.DraftDocument(assetId);
    private EditorSnapshot current = new("", 0, false, "welcome");
    private bool ready, busy, allowClose, recovering, checkingExternal;
    private Task recoveryWrite = Task.CompletedTask;
    private string? lastExternalFingerprint;
    private string outlineSignature = "";
    private readonly string webDirectory = Path.Combine(AppContext.BaseDirectory, "Web");

    public MainWindow(string? initialPath)
    {
        startupPath = initialPath;
        Title = "Folio — Markdown Editor";
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Folio.ico"));
        AppWindow.Resize(new Windows.Graphics.SizeInt32(Math.Clamp(preferences.Width, 900, 2400), Math.Clamp(preferences.Height, 620, 1600)));
        if (AppWindow.Presenter is OverlappedPresenter presenter) presenter.PreferredMinimumWidth = 850;
        BuildUi(); ApplyTheme(); Content = root;
        root.Loaded += async (_, _) => await InitializeEditor();
        AppWindow.Closing += (sender, e) => { if (!allowClose) { e.Cancel = true; _ = Execute("close"); } };
        recoveryTimer.Tick += async (_, _) => await WriteRecovery();
        externalTimer.Tick += async (_, _) => await CheckExternalChange();
        activationTimer.Tick += async (_, _) => await ProcessActivation(); activationTimer.Start();
        Closed += (_, _) => { activationTimer.Stop(); recoveryTimer.Stop(); externalTimer.Stop(); web.Close(); };
    }
    private static SolidColorBrush Brush(byte r, byte g, byte b) => new(Color.FromArgb(255, r, g, b));
    private void BuildUi()
    {
        tree.ItemTemplate = (DataTemplate)Application.Current.Resources["OutlineNodeTemplate"];
        root.RowDefinitions.Add(new() { Height = new GridLength(56) }); root.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) });
        var toolbar = new Grid { Padding = new Thickness(24, 0, 20, 0), ColumnSpacing = 12 };
        toolbar.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); toolbar.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); toolbar.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var brand = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        brand.Children.Add(new Border { Background = Brush(28, 91, 72), CornerRadius = new CornerRadius(10), Width = 38, Height = 38, Child = new TextBlock { Text = "f.", FontSize = 28, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Brush(255, 255, 255), HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, -4, 0, 0) } });
        brand.Children.Add(new TextBlock { Text = "Folio", FontSize = 18, VerticalAlignment = VerticalAlignment.Center }); toolbar.Children.Add(brand);
        BuildDocumentPath(); documentPathButton.Content = documentTitle;
        documentPathButton.Margin = new Thickness(8, 0, 4, 0); Grid.SetColumn(documentPathButton, 1); toolbar.Children.Add(documentPathButton);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(ActionButton("새 문서", "\uE710", "new")); actions.Children.Add(ActionButton("열기", "\uE8E5", "open"));
        var recent = ActionButton("최근 문서", "\uE81C", "recent"); recent.Name = "RecentDocumentsButton";
        ToolTipService.SetToolTip(recent, "최근 문서 20개 · Ctrl+Shift+O"); Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(recent, "최근 문서"); actions.Children.Add(recent);
        actions.Children.Add(saveButton = ActionButton("저장", "\uE74E", "save", true)); var settingsButton = new Button { Content = new FontIcon { Glyph = "\uE713", FontSize = 16 }, Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0) }; ToolTipService.SetToolTip(settingsButton, "설정 · Configuration"); Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(settingsButton, "설정 · Configuration"); settingsButton.Click += async (_, _) => await Execute("configuration"); actions.Children.Add(settingsButton);
        var more = new MenuFlyout(); AddMenu(more, "다른 이름으로 저장   Ctrl+Shift+S", "saveAs"); AddMenu(more, "이미지 삽입…", "image"); more.Items.Add(new MenuFlyoutSeparator()); AddMenu(more, "원문 / 렌더링 전환   Ctrl+Shift+M", "toggleMode"); AddMenu(more, "목차 표시 / 숨기기", "sidebar"); AddMenu(more, "밝은 / 어두운 테마", "theme"); more.Items.Add(new MenuFlyoutSeparator()); AddMenu(more, "설정 · Configuration", "configuration");
        actions.Children.Add(new Button { Content = new FontIcon { Glyph = "\uE712", FontSize = 17 }, Flyout = more, Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0) });
        Grid.SetColumn(actions, 2); toolbar.Children.Add(actions); root.Children.Add(toolbar);
        var workspace = new Grid(); sidebarColumn.Width = new GridLength(Math.Clamp(preferences.SidebarWidth, 200, 420)); workspace.ColumnDefinitions.Add(sidebarColumn); workspace.ColumnDefinitions.Add(new() { Width = new GridLength(5) }); workspace.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        var sidebar = new Grid { RowSpacing = 0 }; sidebar.RowDefinitions.Add(new() { Height = new GridLength(58) }); sidebar.RowDefinitions.Add(new() { Height = GridLength.Auto }); sidebar.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) }); sidebar.RowDefinitions.Add(new() { Height = new GridLength(76) });
        var heading = new Grid { Margin = new Thickness(23, 18, 20, 0) }; heading.Children.Add(new TextBlock { Text = "문서 목차", FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold }); outlineCount.HorizontalAlignment = HorizontalAlignment.Right; outlineCount.Opacity = .5; heading.Children.Add(outlineCount); sidebar.Children.Add(heading);
        Grid.SetRow(filter, 1); sidebar.Children.Add(filter); filter.TextChanged += (_, _) => RenderTree(true);
        var outline = new Grid(); outline.Children.Add(tree); outline.Children.Add(emptyOutline); Grid.SetRow(outline, 2); sidebar.Children.Add(outline);
        tree.ItemInvoked += (_, e) => { if (e.InvokedItem is TreeViewNode node && node.Content is TextBlock text && text.Tag is string id) Post(new { type = "jump", id }); };
        tree.Margin = new Thickness(8, 0, 10, 0);
        var bottom = new StackPanel { Margin = new Thickness(23, 15, 12, 15), Spacing = 8 }; bottom.Children.Add(status); bottom.Children.Add(new TextBlock { Text = "LOCAL FIRST  ·  나만의 문서 공간", FontSize = 9, Opacity = .35, CharacterSpacing = 80 }); Grid.SetRow(bottom, 3); sidebar.Children.Add(bottom);
        workspace.Children.Add(sidebar);
        var grip = new Thumb { Background = new SolidColorBrush(Colors.Transparent), HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
        grip.DragDelta += (_, e) => { sidebarColumn.Width = new GridLength(Math.Clamp(sidebarColumn.ActualWidth + e.HorizontalChange, 200, 420)); preferences.SidebarWidth = sidebarColumn.Width.Value; };
        Grid.SetColumn(grip, 1); workspace.Children.Add(grip);
        editorBorder.Child = web; Grid.SetColumn(editorBorder, 2); workspace.Children.Add(editorBorder);
        Grid.SetRow(workspace, 1); root.Children.Add(workspace);
        AddKey(VirtualKey.N, VirtualKeyModifiers.Control, "new"); AddKey(VirtualKey.O, VirtualKeyModifiers.Control, "open"); AddKey(VirtualKey.S, VirtualKeyModifiers.Control, "save"); AddKey(VirtualKey.S, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, "saveAs"); AddKey(VirtualKey.M, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, "toggleMode"); AddKey(VirtualKey.F, VirtualKeyModifiers.Control, "find");
        AddKey(VirtualKey.O, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, "recent");
    }
    private Button ActionButton(string title, string glyph, string command, bool primary = false)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; panel.Children.Add(new FontIcon { Glyph = glyph, FontSize = 14 }); panel.Children.Add(new TextBlock { Text = title, FontSize = 12 });
        var button = new Button { Content = panel, Padding = new Thickness(13, 9, 13, 9), CornerRadius = new CornerRadius(4) };
        if (primary) { button.Background = Brush(28, 91, 72); button.Foreground = Brush(255, 255, 255); button.BorderThickness = new Thickness(0); }
        button.Click += async (_, _) => await Execute(command); return button;
    }
    private void BuildDocumentPath()
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new TextBlock { Text = "파일 전체 경로", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        content.Children.Add(documentPathText); content.Children.Add(copyPathButton);
        var flyout = new Flyout { Content = content, Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft };
        flyout.Opening += (_, _) => { documentPathText.Text = filePath ?? "저장한 문서의 경로가 여기에 표시됩니다."; copyPathButton.IsEnabled = filePath is not null; };
        flyout.Opened += (_, _) => { documentPathText.Focus(FocusState.Programmatic); documentPathText.SelectAll(); };
        documentPathButton.Flyout = flyout;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(documentPathButton, "파일 전체 경로 보기 및 복사");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(documentPathText, "파일 전체 경로");
        copyPathButton.Click += async (_, _) => await CopyDocumentPath();
        var menu = new MenuFlyout(); var copy = new MenuFlyoutItem { Text = "전체 경로 복사", Icon = new SymbolIcon(Symbol.Copy) };
        menu.Items.Add(copy); menu.Opening += (_, _) => copy.IsEnabled = filePath is not null;
        copy.Click += async (_, _) => await CopyDocumentPath(); documentPathButton.ContextFlyout = menu;
    }
    private async Task<bool> CopyDocumentPath()
    {
        if (filePath is null) return false;
        try
        {
            var data = new DataPackage { RequestedOperation = DataPackageOperation.Copy }; data.SetText(filePath);
            var copied = false;
            for (var attempt = 0; attempt < 6; attempt++)
            {
                if (Clipboard.SetContentWithOptions(data, null)) { copied = true; break; }
                await Task.Delay(80);
            }
            if (!copied) { Post(new { type = "toast", message = "클립보드를 사용할 수 없습니다. 잠시 후 다시 복사하세요." }); return false; }
            Clipboard.Flush();
            documentPathButton.Flyout.Hide(); Post(new { type = "toast", message = "전체 경로를 복사했습니다" });
            return true;
        }
        catch (Exception ex) { FileStore.Log(ex); Post(new { type = "toast", message = "전체 경로를 복사하지 못했습니다. 다시 시도하세요." }); return false; }
    }
    private void AddMenu(MenuFlyout menu, string label, string command) { var item = new MenuFlyoutItem { Text = label }; item.Click += async (_, _) => await Execute(command); menu.Items.Add(item); }
    private void AddKey(VirtualKey key, VirtualKeyModifiers modifiers, string command)
    {
        var accelerator = new KeyboardAccelerator { Key = key, Modifiers = modifiers };
        accelerator.Invoked += async (_, e) => { e.Handled = true; await Execute(command); }; root.KeyboardAccelerators.Add(accelerator);
    }
    private async Task InitializeEditor()
    {
        try
        {
            if (!File.Exists(Path.Combine(webDirectory, "index.html"))) throw new IOException("편집기 파일이 없습니다. build.ps1로 앱을 다시 빌드해주세요.");
            await web.EnsureCoreWebView2Async();
            var core = web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("folio.local", webDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.IsStatusBarEnabled = false; core.Settings.AreDefaultScriptDialogsEnabled = false; core.Settings.IsWebMessageEnabled = true;
            core.Settings.AreDevToolsEnabled = false;
            core.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith("https://folio.local/", StringComparison.Ordinal)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.AddWebResourceRequestedFilter("https://document.local/*", CoreWebView2WebResourceContext.Image);
            core.WebResourceRequested += (_, e) => ServeImage(e);
            core.WebMessageReceived += async (_, e) => { if (new Uri(e.Source).GetLeftPart(UriPartial.Authority) == "https://folio.local") await Receive(e.WebMessageAsJson); };
            core.ProcessFailed += async (_, _) => { await WriteRecovery(); status.Text = "편집기 오류 · 앱을 다시 열어 복구하세요"; };
            core.Navigate("https://folio.local/index.html");
        }
        catch (Exception ex) { FileStore.Log(ex); await Error(ex.Message + "\nWebView2 Runtime 설치 여부도 확인해주세요."); }
    }
    private void ServeImage(CoreWebView2WebResourceRequestedEventArgs e)
    {
        e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Cache-Control: no-store");
        try
        {
            var uri = new Uri(e.Request.Uri); if (uri.Host != "document.local") return;
            var directory = Path.GetDirectoryName(ImageDocumentPath)!;
            var relative = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var target = Path.GetFullPath(Path.Combine(directory, relative));
            if (!target.StartsWith(directory.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return;
            var mime = Path.GetExtension(target).ToLowerInvariant() switch { ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".gif" => "image/gif", ".webp" => "image/webp", ".bmp" => "image/bmp", ".svg" => "image/svg+xml", _ => null };
            if (mime is not null && File.Exists(target)) e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(target)).AsRandomAccessStream(), 200, "OK", $"Content-Type: {mime}\r\nCache-Control: no-store");
        }
        catch (Exception ex) { FileStore.Log(ex); }
    }
    private void Post(object packet) { if (web.CoreWebView2 is not null) web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(packet, Json)); }
    private async Task Receive(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json); var message = doc.RootElement; var type = message.GetProperty("type").GetString();
            if (type == "ready")
            {
                try {
                ready = true; ApplyTheme(); ApplyConfiguration(); recoveryTimer.Start(); externalTimer.Start();
                if (startupPath == "--smoke-test") { _ = RunSmokeTest(); return; }
                var recovery = FileStore.ReadRecovery();
                if (recovery is not null)
                {
                    var decision = await Ask("저장하지 않은 문서", $"{recovery.SavedAt:yyyy-MM-dd HH:mm}의 복구본이 있습니다.", "복구", "삭제", "앱 닫기");
                    if (decision == ContentDialogResult.Primary)
                    { filePath = recovery.Path; fingerprint = recovery.Fingerprint; newline = recovery.NewLine; bom = recovery.Bom; LoadDocument(recovery.Text, true, recovery.AssetId); return; }
                    if (decision == ContentDialogResult.Secondary) FileStore.ClearRecovery();
                    else { allowClose = true; Close(); return; }
                }
                if (startupPath is not null && File.Exists(startupPath)) await Execute("openPath", startupPath);
                return;
                } finally { acceptActivations = true; }
            }
            if (message.TryGetProperty("documentId", out var id) && id.GetString() != documentId) return;
            if (type is "changed" or "snapshot")
            {
                var state = JsonSerializer.Deserialize<EditorSnapshot>(json, Json)!;
                if (state.Revision >= current.Revision) { current = state; UpdateStatus(); }
                if (type == "changed" && message.TryGetProperty("headings", out var hs)) { headings = JsonSerializer.Deserialize<List<Heading>>(hs.GetRawText(), Json) ?? []; RenderTree(); }
                if (type == "snapshot" && requests.Remove(message.GetProperty("requestId").GetString()!, out var request)) request.TrySetResult(state);
            }
            else if (type == "cursor") { if (message.TryGetProperty("headingId", out var h) && h.ValueKind == JsonValueKind.String && nodes.TryGetValue(h.GetString()!, out var node)) tree.SelectedNode = node; }
            else if (type == "importImages") await ReceiveImages(message);
            else if (type == "copyTable") await CopyTableSelection(message.GetProperty("text").GetString() ?? "", message.GetProperty("html").GetString() ?? "");
            else if (type == "command")
            {
                var name = message.GetProperty("name").GetString()!;
                if (name == "externalLink")
                {
                    if (Uri.TryCreate(message.GetProperty("url").GetString(), UriKind.Absolute, out var link) && link.Scheme is "http" or "https") Process.Start(new ProcessStartInfo(link.AbsoluteUri) { UseShellExecute = true });
                }
                else await Execute(name, name == "image" && message.TryGetProperty("requestId", out var imageRequest) ? imageRequest.GetString() : null);
            }
        }
        catch (Exception ex) { FileStore.Log(ex); await Error(ex.Message); }
    }
    private async Task<EditorSnapshot> Snapshot()
    {
        var id = Guid.NewGuid().ToString("N"); var request = new TaskCompletionSource<EditorSnapshot>(); requests[id] = request;
        Post(new { type = "snapshot", requestId = id });
        try { return await request.Task.WaitAsync(TimeSpan.FromSeconds(15)); }
        finally { requests.Remove(id); }
    }
    private async Task Execute(string command, string? argument = null)
    {
        if (!ready || busy)
        {
            if (command == "image" && argument is not null) Post(new { type = "insertImages", paths = Array.Empty<string>(), requestId = argument, documentId, error = "다른 작업이 끝난 뒤 이미지를 다시 삽입하세요." });
            return;
        }
        busy = true;
        try
        {
            switch (command)
            {
                case "new": if (await CanLeave()) { await ClearRecovery(); filePath = null; fingerprint = null; newline = "\n"; bom = false; LoadDocument("# 새 문서\n\n", true); } break;
                case "open": case "openPath": case "recent":
                    var recentPath = command == "recent" ? await ShowRecentDocuments() : argument;
                    if (command == "recent" && recentPath is null) break;
                    if (!await CanLeave()) break;
                    var path = recentPath ?? await PickOpen(); if (path is null) break;
                    var opened = await FileStore.Read(path); filePath = opened.Path; fingerprint = opened.Fingerprint; newline = opened.NewLine; bom = opened.Bom; originalText = opened.Text;
                    LoadDocument(opened.Text, false); Remember(opened.Path); await ClearRecovery(); break;
                case "save": await Save(false); break;
                case "saveAs": await Save(true); break;
                case "close":
                    if (!await CanLeave()) break;
                    preferences.Width = AppWindow.Size.Width; preferences.Height = AppWindow.Size.Height; FileStore.SavePreferences(preferences); await ClearRecovery(); allowClose = true; Close(); break;
                case "theme": preferences.Theme = preferences.Theme == "dark" ? "light" : "dark"; ApplyTheme(); FileStore.SavePreferences(preferences); break;
                case "configuration": await ShowConfiguration(); break;
                case "sidebar": sidebarColumn.Width = sidebarColumn.Width.Value > 0 ? new GridLength(0) : new GridLength(preferences.SidebarWidth); break;
                case "image":
                    if (argument is null) Post(new { type = "requestImage" });
                    else await InsertImage(argument);
                    break;
                case "toggleMode": case "undo": case "redo": case "find": Post(new { type = command }); break;
            }
        }
        catch (Exception ex) { FileStore.Log(ex); await Error(ex.Message); }
        finally { busy = false; }
    }
    private void LoadDocument(string text, bool dirty, string? recoveredAssetId = null)
    {
        assetId = Guid.TryParseExact(recoveredAssetId, "N", out _) ? recoveredAssetId! : Guid.NewGuid().ToString("N");
        documentId = Guid.NewGuid().ToString("N"); current = new(text, 0, dirty, documentId); headings.Clear(); outlineSignature = "";
        originalText = dirty ? "" : text; lastExternalFingerprint = fingerprint;
        Post(new { type = "load", text, name = filePath is null ? "제목 없음.md" : Path.GetFileName(filePath), dirty, documentId }); UpdateStatus();
    }
    private async Task<bool> CanLeave()
    {
        current = await Snapshot(); if (!current.Dirty) return true;
        var decision = await Ask("변경 내용을 저장할까요?", filePath is null ? "새 문서에 저장하지 않은 내용이 있습니다." : Path.GetFileName(filePath), "저장", "저장 안 함", "취소");
        if (decision == ContentDialogResult.Primary) return await Save(false) && await CanLeave();
        return decision == ContentDialogResult.Secondary;
    }
    private async Task<bool> Save(bool saveAs, string? destination = null)
    {
        var snapshot = await Snapshot();
        var path = destination ?? (saveAs || filePath is null ? await PickSave() : filePath);
        if (path is null) return false;
        var sameFile = string.Equals(path, filePath, StringComparison.OrdinalIgnoreCase);
        var diskHash = await FileStore.Fingerprint(path);
        if (sameFile && diskHash != fingerprint)
        {
            var decision = await Ask("외부에서 변경된 파일", "디스크의 파일이 변경되었습니다. 덮어쓰거나 다른 파일로 저장할 수 있습니다.", "덮어쓰기", "다른 이름으로 저장", "취소");
            if (decision == ContentDialogResult.Secondary) return await Save(true);
            if (decision != ContentDialogResult.Primary) return false;
        }
        // Preserve exact original bytes, including mixed line endings, when nothing changed.
        if (!(sameFile && !snapshot.Dirty && diskHash == fingerprint))
        {
            if (!sameFile)
            {
                // Keep draft images reachable by Undo/Redo after the first save.
                var draftAssets = Path.Combine(Path.GetDirectoryName(ImageDocumentPath)!, "assets");
                var images = snapshot.Images ?? [];
                if (filePath is null && Directory.Exists(draftAssets)) images = images.Concat(Directory.GetFiles(draftAssets).Select(asset => "assets/" + Path.GetFileName(asset))).Distinct().ToArray();
                await FileStore.CopyImages(ImageDocumentPath, path, images);
            }
            var preserve = !snapshot.Dirty && originalText.Length > 0;
            fingerprint = await FileStore.Save(path, preserve ? originalText : snapshot.Text, newline, bom, diskHash, preserve);
        }
        filePath = path;
        if (snapshot.Dirty || originalText.Length == 0) originalText = snapshot.Text.Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", newline);
        lastExternalFingerprint = fingerprint; Remember(path);
        Post(new { type = "saved", text = snapshot.Text, snapshot.Revision, name = Path.GetFileName(path), documentId });
        if (current.Revision == snapshot.Revision) current = current with { Dirty = false };
        await ClearRecovery(); UpdateStatus(); return true;
    }
    private async Task<string?> PickOpen()
    {
        var picker = new FileOpenPicker(); WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        picker.FileTypeFilter.Add(".md"); picker.FileTypeFilter.Add(".markdown"); picker.FileTypeFilter.Add(".txt"); return (await picker.PickSingleFileAsync())?.Path;
    }
    private async Task<string?> PickSave()
    {
        var picker = new FileSavePicker { SuggestedFileName = filePath is null ? "새 문서" : Path.GetFileNameWithoutExtension(filePath) };
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this)); picker.FileTypeChoices.Add("Markdown 문서", new List<string> { ".md" }); return (await picker.PickSaveFileAsync())?.Path;
    }
    private async Task InsertImage(string requestId)
    {
        string[] paths = [];
        try
        {
            var picker = new FileOpenPicker(); WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
            foreach (var extension in new[] { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp" }) picker.FileTypeFilter.Add(extension);
            var image = await picker.PickSingleFileAsync(); if (image is null) return;
            if ((await image.GetBasicPropertiesAsync()).Size > FileStore.MaxImageBytes) throw new IOException("이미지는 20MB 이하만 삽입할 수 있습니다.");
            paths = await FileStore.ImportImages(ImageDocumentPath, [await File.ReadAllBytesAsync(image.Path)]);
        }
        finally { Post(new { type = "insertImages", paths, requestId, documentId }); }
    }
    private async Task ReceiveImages(JsonElement message)
    {
        var requestId = message.GetProperty("requestId").GetString();
        string[] paths = [];
        if (busy) { Post(new { type = "insertImages", paths, requestId, documentId, error = "다른 작업이 끝난 뒤 이미지를 다시 붙여넣으세요." }); return; }
        busy = true;
        try
        {
            var images = message.GetProperty("images");
            if (images.ValueKind != JsonValueKind.Array || images.GetArrayLength() is < 1 or > 16) throw new IOException("이미지는 한 번에 16개 이하로 삽입하세요.");
            var payloads = images.EnumerateArray().Select(item => item.GetString() ?? "").ToArray();
            if (payloads.Sum(value => (long)value.Length) > (FileStore.MaxImageBytes + 2L) / 3 * 4 + 64) throw new IOException("이미지 합계는 20MB 이하여야 합니다.");
            paths = await FileStore.ImportImages(ImageDocumentPath, payloads.Select(Convert.FromBase64String).ToArray());
            Post(new { type = "insertImages", paths, requestId, documentId });
        }
        catch (Exception ex) { FileStore.Log(ex); Post(new { type = "insertImages", paths, requestId, documentId, error = "이미지를 삽입하지 못했습니다. " + ex.Message }); }
        finally { busy = false; }
    }
    private void RenderTree(bool force = false)
    {
        var signature = JsonSerializer.Serialize(headings, Json) + filter.Text; if (!force && signature == outlineSignature) return; outlineSignature = signature;
        var collapsed = nodes.Where(p => !p.Value.IsExpanded).Select(p => p.Key).ToHashSet(); var selected = tree.SelectedNode?.Content is TextBlock selectedText ? selectedText.Tag as string : null;
        tree.RootNodes.Clear(); nodes.Clear();
        var visible = new HashSet<string>();
        foreach (var h in headings.Where(h => h.Label.Contains(filter.Text, StringComparison.CurrentCultureIgnoreCase)))
        { visible.Add(h.Id); var parent = h.ParentId; while (parent is not null) { visible.Add(parent); parent = headings.Find(x => x.Id == parent)?.ParentId; } }
        foreach (var h in headings.Where(h => visible.Contains(h.Id)))
        {
            var label = new TextBlock { Text = h.Label.Length == 0 ? "(빈 제목)" : h.Label, Tag = h.Id, FontSize = 12, Height = 12 * preferences.OutlineLineHeight + 8, LineHeight = 12 * preferences.OutlineLineHeight, LineStackingStrategy = LineStackingStrategy.BlockLineHeight, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Padding = new Thickness(0, 4, 0, 4) };
            ToolTipService.SetToolTip(label, $"H{h.Depth} · {h.Label}");
            var menu = new MenuFlyout(); var rename = new MenuFlyoutItem { Text = "제목 이름 변경" }; rename.Click += async (_, _) => await Rename(h); menu.Items.Add(rename); label.ContextFlyout = menu;
            var node = new TreeViewNode { Content = label, IsExpanded = !collapsed.Contains(h.Id) || filter.Text.Length > 0 }; nodes[h.Id] = node;
            if (h.ParentId is not null && nodes.TryGetValue(h.ParentId, out var parentNode)) parentNode.Children.Add(node); else tree.RootNodes.Add(node);
        }
        if (selected is not null && nodes.TryGetValue(selected, out var selectedNode)) tree.SelectedNode = selectedNode;
        outlineCount.Text = headings.Count.ToString("00"); emptyOutline.Visibility = nodes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        emptyOutline.Text = filter.Text.Length > 0 ? "일치하는 제목이 없습니다." : "제목을 쓰면 목차가 나타납니다.\n# 제목으로 시작해보세요.";
    }
    private async Task Rename(Heading heading)
    {
        if (busy) return; busy = true;
        try
        {
            var input = new TextBox { Text = heading.Label, MinWidth = 300, AcceptsReturn = false };
            var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Title = "제목 이름 변경", Content = input, PrimaryButtonText = "변경", CloseButtonText = "취소", DefaultButton = ContentDialogButton.Primary, RequestedTheme = root.RequestedTheme };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary && !string.IsNullOrWhiteSpace(input.Text)) Post(new { type = "renameHeading", id = heading.Id, title = input.Text.Trim() });
        }
        finally { busy = false; }
    }
    private void UpdateStatus() { documentTitle.Text = (current.Dirty ? "● " : "") + (filePath is null ? "제목 없음.md" : Path.GetFileName(filePath)); ToolTipService.SetToolTip(documentPathButton, (filePath ?? documentTitle.Text) + "\n클릭: 경로 선택 · 우클릭: 전체 경로 복사"); status.Text = current.Dirty ? "●  저장하지 않은 변경" : "✓  모든 변경 저장됨"; status.Opacity = current.Dirty ? 1 : .6; Title = $"{(current.Dirty ? "● " : "")}{(filePath is null ? "제목 없음" : Path.GetFileName(filePath))} — Folio"; }
    private void ApplyTheme()
    {
        var dark = preferences.Theme == "dark";
        root.RequestedTheme = dark ? ElementTheme.Dark : ElementTheme.Light;
        root.Background = dark ? Brush(25, 34, 30) : Brush(255, 255, 255);
        editorBorder.BorderBrush = dark ? Brush(220, 228, 223) : Brush(229, 231, 235);
        saveButton.Background = dark ? Brush(28, 91, 72) : Brush(55, 65, 81);
        var titleBar = AppWindow.TitleBar;
        titleBar.BackgroundColor = titleBar.InactiveBackgroundColor = dark ? null : Colors.White;
        titleBar.ForegroundColor = dark ? null : Color.FromArgb(255, 31, 41, 55);
        titleBar.InactiveForegroundColor = dark ? null : Color.FromArgb(255, 107, 114, 128);
        titleBar.ButtonBackgroundColor = titleBar.ButtonInactiveBackgroundColor = dark ? null : Colors.White;
        titleBar.ButtonForegroundColor = titleBar.ButtonHoverForegroundColor = titleBar.ButtonPressedForegroundColor = titleBar.ForegroundColor;
        titleBar.ButtonInactiveForegroundColor = titleBar.InactiveForegroundColor;
        titleBar.ButtonHoverBackgroundColor = dark ? null : Color.FromArgb(255, 243, 244, 246);
        titleBar.ButtonPressedBackgroundColor = dark ? null : Color.FromArgb(255, 229, 231, 235);
        Post(new { type = "theme", value = preferences.Theme });
    }
    private void Remember(string path) { preferences.RememberFile(path); FileStore.SavePreferences(preferences); }
    private async Task WriteRecovery()
    {
        if (!current.Dirty || recovering || !ready || busy) return; recovering = true;
        try { recoveryWrite = FileStore.WriteRecovery(new(filePath, current.Text, fingerprint, newline, bom, DateTime.Now, filePath is null ? assetId : null)); await recoveryWrite; }
        catch (Exception ex) { FileStore.Log(ex); status.Text = "복구본 저장 실패 · 직접 저장해주세요"; }
        finally { recovering = false; }
    }
    private async Task ClearRecovery() { await recoveryWrite; FileStore.ClearRecovery(); }
    private async Task CheckExternalChange()
    {
        if (filePath is null || checkingExternal || busy) return; checkingExternal = true;
        try
        {
            var hash = await FileStore.Fingerprint(filePath);
            if (hash != fingerprint && hash != lastExternalFingerprint) { lastExternalFingerprint = hash; Post(new { type = "toast", message = "파일이 외부에서 변경되었습니다. 저장 시 충돌을 확인합니다." }); status.Text = "외부 파일 변경 감지"; }
        }
        catch (Exception ex) { FileStore.Log(ex); }
        finally { checkingExternal = false; }
    }
    private async Task<ContentDialogResult> Ask(string title, string content, string primary, string secondary, string close) => await new ContentDialog { XamlRoot = root.XamlRoot, Title = title, Content = content, PrimaryButtonText = primary, SecondaryButtonText = secondary, CloseButtonText = close, DefaultButton = ContentDialogButton.Primary, RequestedTheme = root.RequestedTheme }.ShowAsync();
    private async Task Error(string message) => await new ContentDialog { XamlRoot = root.XamlRoot, Title = "작업을 완료하지 못했습니다", Content = message, CloseButtonText = "확인", RequestedTheme = root.RequestedTheme }.ShowAsync();
}
