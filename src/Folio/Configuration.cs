using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Folio;

public sealed partial class MainWindow
{
    private ContentDialog? configurationDialog;

    private void ApplyConfiguration()
    {
        preferences.Normalize();
        Post(new { type = "configuration", bodyLineHeight = preferences.BodyLineHeight, documentAlignment = preferences.DocumentAlignment });
        RenderTree(true);
    }

    private async Task ShowConfiguration()
    {
        var originalBody = preferences.BodyLineHeight;
        var originalOutline = preferences.OutlineLineHeight;
        var originalAlignment = preferences.DocumentAlignment;
        var bodySpacing = SpacingInput("본문 · 표 줄 높이", "BodyLineHeight", originalBody);
        var outlineSpacing = SpacingInput("목차 줄 높이", "OutlineLineHeight", originalOutline);
        var alignment = new ComboBox { Header = "문서 영역 배치", Name = "DocumentAlignment", HorizontalAlignment = HorizontalAlignment.Stretch };
        alignment.Items.Add(new ComboBoxItem { Content = "왼쪽", Tag = "left" });
        alignment.Items.Add(new ComboBoxItem { Content = "가운데", Tag = "center" });
        alignment.SelectedIndex = originalAlignment == "left" ? 0 : 1;
        var reset = new Button { Content = "기본값 복원", HorizontalAlignment = HorizontalAlignment.Left };
        var panel = new StackPanel { Spacing = 20, MinWidth = 370 };
        panel.Children.Add(new TextBlock { Text = "읽기 편한 문서 화면", FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        panel.Children.Add(new TextBlock { Text = "변경 사항을 즉시 미리 봅니다. 저장하면 다음 실행에도 유지됩니다.", TextWrapping = TextWrapping.Wrap, Opacity = .65, FontSize = 12 });
        panel.Children.Add(bodySpacing);
        panel.Children.Add(new TextBlock { Text = "1.00–3.00배 · 글자 크기 기준. 제목·문단 여백은 유지됩니다.", FontSize = 12, Opacity = .65 });
        panel.Children.Add(alignment);
        panel.Children.Add(new TextBlock { Text = "문서 영역의 위치를 바꿉니다. 표의 열 정렬은 유지됩니다.", FontSize = 12, Opacity = .65 });
        panel.Children.Add(outlineSpacing);
        panel.Children.Add(new TextBlock { Text = "1.00–3.00배 · 목차 글자 크기 기준, 위아래 여백 포함", FontSize = 12, Opacity = .65 });
        panel.Children.Add(reset);
        var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Title = "설정 · Configuration", Content = new ScrollViewer { Content = panel, MaxHeight = 490 }, PrimaryButtonText = "저장", CloseButtonText = "취소", DefaultButton = ContentDialogButton.Primary, RequestedTheme = root.RequestedTheme };
        configurationDialog = dialog;
        void Preview()
        {
            dialog.IsPrimaryButtonEnabled = double.IsFinite(bodySpacing.Value) && double.IsFinite(outlineSpacing.Value);
            if (!dialog.IsPrimaryButtonEnabled) return;
            preferences.BodyLineHeight = bodySpacing.Value;
            preferences.OutlineLineHeight = outlineSpacing.Value;
            preferences.DocumentAlignment = alignment.SelectedIndex == 0 ? "left" : "center";
            ApplyConfiguration();
        }
        bodySpacing.ValueChanged += (_, _) => Preview();
        outlineSpacing.ValueChanged += (_, _) => Preview();
        alignment.SelectionChanged += (_, _) => Preview();
        reset.Click += (_, _) => { bodySpacing.Value = 1.95; outlineSpacing.Value = 2; alignment.SelectedIndex = 1; };
        var saved = false;
        try
        {
            if (await dialog.ShowAsync() == ContentDialogResult.Primary)
            {
                Preview();
                FileStore.SavePreferences(preferences);
                saved = true;
                Post(new { type = "toast", message = "화면 설정을 저장했습니다" });
            }
        }
        finally
        {
            configurationDialog = null;
            if (!saved)
            {
                preferences.BodyLineHeight = originalBody; preferences.OutlineLineHeight = originalOutline; preferences.DocumentAlignment = originalAlignment;
                ApplyConfiguration();
            }
        }
    }

    private static NumberBox SpacingInput(string header, string name, double value) => new()
    {
        Header = header, Name = name, Value = value, Minimum = 1, Maximum = 3,
        SmallChange = .05, LargeChange = .25, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Inline,
        NumberFormatter = new Windows.Globalization.NumberFormatting.DecimalFormatter { FractionDigits = 2, IntegerDigits = 1 },
        HorizontalAlignment = HorizontalAlignment.Stretch
    };
}
