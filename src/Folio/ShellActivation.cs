using Microsoft.UI.Windowing;

namespace Folio;

public sealed partial class MainWindow
{
    private async Task ProcessActivation()
    {
        if (!ready || busy || !acceptActivations || Program.Activations is null || !Program.Activations.TryDequeue(out var path)) return;
        if (AppWindow.Presenter is OverlappedPresenter presenter && presenter.State == OverlappedPresenterState.Minimized) presenter.Restore();
        Activate();
        if (path.Length == 0) return;
        // Execute retains the normal save/discard/cancel workflow before changing documents.
        if (!File.Exists(path))
        {
            busy = true;
            try { await Error("문서를 찾을 수 없습니다: " + path); }
            finally { busy = false; }
            return;
        }
        if (string.Equals(filePath, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase)) return;
        await Execute("openPath", path);
    }
}
