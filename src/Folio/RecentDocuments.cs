using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.System;

namespace Folio;

public sealed partial class MainWindow
{
    private ContentDialog? recentDocumentsDialog;

    private async Task<string?> ShowRecentDocuments()
    {
        var paths = preferences.RecentFiles.ToArray();
        var search = new TextBox { Name = "RecentSearch", PlaceholderText = "파일명 또는 폴더 경로로 찾기", Margin = new Thickness(0, 0, 0, 12) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(search, "최근 문서 검색");
        var count = new TextBlock { FontSize = 12, Opacity = .65, Margin = new Thickness(0, 0, 0, 8) };
        var list = new ListView { Name = "RecentDocumentsList", SelectionMode = ListViewSelectionMode.Single, HorizontalContentAlignment = HorizontalAlignment.Stretch };
        ScrollViewer.SetHorizontalScrollBarVisibility(list, ScrollBarVisibility.Disabled);
        var empty = new TextBlock { TextWrapping = TextWrapping.Wrap, Opacity = .65, Margin = new Thickness(12, 28, 12, 28), HorizontalAlignment = HorizontalAlignment.Center };
        var body = new Grid { Height = Math.Clamp(root.ActualHeight - 310, 180, 460) };
        body.Children.Add(list); body.Children.Add(empty);
        var panel = new Grid { Width = Math.Clamp(root.ActualWidth - 110, 360, 760) };
        panel.RowDefinitions.Add(new() { Height = GridLength.Auto });
        panel.RowDefinitions.Add(new() { Height = GridLength.Auto });
        panel.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) });
        panel.Children.Add(search); Grid.SetRow(count, 1); panel.Children.Add(count); Grid.SetRow(body, 2); panel.Children.Add(body);
        var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Title = "최근 문서", Content = panel, PrimaryButtonText = "열기", CloseButtonText = "닫기", IsPrimaryButtonEnabled = false, DefaultButton = ContentDialogButton.Primary, RequestedTheme = root.RequestedTheme };
        dialog.Resources["ContentDialogMaxWidth"] = 840d;
        recentDocumentsDialog = dialog;
        string? chosen = null;
        void Choose(string path) { chosen = path; dialog.Hide(); }
        void Filter()
        {
            list.Items.Clear(); dialog.IsPrimaryButtonEnabled = false;
            var query = search.Text.Trim();
            foreach (var path in paths.Where(path => path.Contains(query, StringComparison.OrdinalIgnoreCase)))
            {
                var text = new StackPanel { Spacing = 5, Margin = new Thickness(4, 9, 4, 9) };
                text.Children.Add(new TextBlock { Text = Path.GetFileName(path), FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
                text.Children.Add(new TextBlock { Text = path, FontSize = 12, Opacity = .7, TextWrapping = TextWrapping.Wrap, TextTrimming = TextTrimming.None });
                var item = new ListViewItem { Content = text, Tag = path, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(10, 0, 10, 0) };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(item, path);
                item.DoubleTapped += (_, e) => { e.Handled = true; Choose(path); };
                item.KeyDown += (_, e) => { if (e.Key == VirtualKey.Enter) { e.Handled = true; Choose(path); } };
                list.Items.Add(item);
            }
            count.Text = $"최근 열었던 순서 · {list.Items.Count} / {paths.Length}개 · 최대 {Preferences.RecentFileLimit}개";
            empty.Text = paths.Length == 0 ? "최근 문서가 없습니다.\n문서를 열거나 저장하면 여기에 표시됩니다." : "파일명이나 경로가 일치하는 문서가 없습니다.";
            empty.Visibility = list.Items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        list.SelectionChanged += (_, _) => dialog.IsPrimaryButtonEnabled = list.SelectedItem is ListViewItem;
        search.TextChanged += (_, _) => Filter();
        Filter();
        try
        {
            var result = await dialog.ShowAsync();
            return result == ContentDialogResult.Primary ? (list.SelectedItem as ListViewItem)?.Tag as string : chosen;
        }
        finally { recentDocumentsDialog = null; }
    }
}
