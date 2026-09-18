using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Folio;

public sealed partial class MainWindow
{
    private async Task VerifyRecentDocuments(List<string> results, string output)
    {
        var oldRecent = preferences.RecentFiles.ToList();
        var before = await Snapshot();
        var oldPath = filePath; var oldFingerprint = fingerprint; var oldNewline = newline; var oldBom = bom; var oldOriginal = originalText;
        try
        {
            preferences.RecentFiles.Clear();
            var emptyTask = ShowRecentDocuments(); await Task.Delay(200);
            if (!VisualDescendants(recentDocumentsDialog!).OfType<TextBlock>().Any(t => t.Text.StartsWith("최근 문서가 없습니다")) || recentDocumentsDialog!.IsPrimaryButtonEnabled) throw new Exception("Empty recent documents view mismatch");
            recentDocumentsDialog.Hide(); await emptyTask;
            var samples = new List<string>();
            for (var i = 0; i < 23; i++)
            {
                var path = Path.Combine(output, "최근 문서 확인", $"프로젝트 {i:00}", "폴더와 파일명을 모두 확인하는 긴 경로", "동일 이름 문서.md");
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await File.WriteAllTextAsync(path, $"# 최근 문서 {i:00}\n\n전체 경로로 선택한 문서\n");
                Remember(path); samples.Add(path);
            }
            if (FileStore.LoadPreferences().RecentFiles.Count != 20 || preferences.RecentFiles[0] != samples[22]) throw new Exception("Recent history cap or persistence mismatch");
            var dialogTask = ShowRecentDocuments(); await Task.Delay(250);
            var dialog = recentDocumentsDialog!;
            var list = VisualDescendants(dialog).OfType<ListView>().Single(v => v.Name == "RecentDocumentsList");
            if (list.Items.Count != 20) throw new Exception("Recent list does not expose all 20 entries");
            var first = (ListViewItem)list.Items[0];
            var labels = ((StackPanel)first.Content).Children.OfType<TextBlock>().ToArray();
            if (labels[0].Text != "동일 이름 문서.md" || labels[1].Text != samples[22] || labels[1].TextTrimming != TextTrimming.None || labels[1].TextWrapping != TextWrapping.Wrap) throw new Exception("Recent labels truncate filename or full path");
            if (labels[1].ActualWidth > list.ActualWidth || labels[1].ActualHeight <= 16) throw new Exception("Long recent path does not wrap inside the list");
            await CaptureConfiguration(dialog, Path.Combine(output, "windows-recent-documents.png"));
            var search = VisualDescendants(dialog).OfType<TextBox>().Single(t => t.Name == "RecentSearch");
            search.Text = "프로젝트 07"; await Task.Delay(100);
            if (list.Items.Count != 1 || (string)((ListViewItem)list.Items[0]).Tag != samples[7]) throw new Exception("Recent full-path search mismatch");
            search.Text = "검색 결과 없음"; await Task.Delay(100);
            if (list.Items.Count != 0 || dialog.IsPrimaryButtonEnabled) throw new Exception("Empty search permits opening a stale selection");
            dialog.Hide();
            if (await dialogTask is not null || (await Snapshot()).Text != before.Text) throw new Exception("Recent browsing/cancel changed the document");
            results.Add("Recent documents dialog displays 20 full wrapped paths, searches folders, and preserves the document on cancel");

            busy = false;
            var opening = Execute("recent"); await Task.Delay(250);
            dialog = recentDocumentsDialog!;
            search = VisualDescendants(dialog).OfType<TextBox>().Single(t => t.Name == "RecentSearch"); search.Text = "프로젝트 07"; await Task.Delay(100);
            list = VisualDescendants(dialog).OfType<ListView>().Single(v => v.Name == "RecentDocumentsList"); list.SelectedIndex = 0;
            var button = VisualDescendants(dialog).OfType<Button>().Single(b => b.Name == "PrimaryButton");
            var peer = Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer.CreatePeerForElement(button);
            ((Microsoft.UI.Xaml.Automation.Provider.IInvokeProvider)peer.GetPattern(Microsoft.UI.Xaml.Automation.Peers.PatternInterface.Invoke)).Invoke();
            await opening; busy = true;
            if (filePath != samples[7] || !(await Snapshot()).Text.StartsWith("# 최근 문서 07") || preferences.RecentFiles[0] != samples[7]) throw new Exception("Recent selection did not open the exact path or promote its history entry");
            results.Add("Recent document selection opens the correct same-named file and promotes it without duplicates");
        }
        finally
        {
            recentDocumentsDialog?.Hide(); busy = true;
            preferences.RecentFiles = oldRecent; FileStore.SavePreferences(preferences);
            filePath = oldPath; fingerprint = oldFingerprint; newline = oldNewline; bom = oldBom; originalText = oldOriginal;
            LoadDocument(before.Text, before.Dirty); await Snapshot();
        }
    }
}
