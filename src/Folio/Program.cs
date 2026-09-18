using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Folio;

public static class Program
{
    private static Mutex? instance;
    public static ActivationBroker? Activations { get; private set; }
    [STAThread]
    public static void Main(string[] args)
    {
        Directory.CreateDirectory(FileStore.DataDirectory);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => FileStore.Log(e.ExceptionObject as Exception ?? new Exception(e.ExceptionObject.ToString()));
        var isolated = Environment.GetEnvironmentVariable("FOLIO_DATA_DIRECTORY") is not null;
        instance = new Mutex(true, isolated ? "Local\\Folio.MarkdownEditor.Diagnostics." + ActivationBroker.Scope : "Local\\Folio.MarkdownEditor", out var first);
        if (!first)
        {
            try { ActivationBroker.Forward(args.FirstOrDefault() is string path ? Path.GetFullPath(path) : "").GetAwaiter().GetResult(); }
            catch (Exception ex) { FileStore.Log(ex); Environment.ExitCode = 1; if (!isolated) ShowActivationError(IntPtr.Zero, "실행 중인 Folio로 문서를 전달하지 못했습니다. 기존 창을 저장하고 종료한 뒤 다시 열어주세요.", "Folio", 0x10); }
            return;
        }
        using var broker = new ActivationBroker(); Activations = broker;
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Directory.CreateDirectory(FileStore.DataDirectory);
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", System.IO.Path.Combine(FileStore.DataDirectory, "WebView2"));
        Application.Start(initialization =>
        {
            SynchronizationContext.SetSynchronizationContext(new Microsoft.UI.Dispatching.DispatcherQueueSynchronizationContext(Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread()));
            _ = new FolioApp(args.FirstOrDefault());
        });
        GC.KeepAlive(instance);
    }
    [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "MessageBoxW", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int ShowActivationError(IntPtr window, string text, string caption, uint flags);
}

public sealed partial class FolioApp : Application
{
    private Window? window;
    private readonly string? initialPath;
    public FolioApp(string? path)
    {
        initialPath = path;
        UnhandledException += (_, e) => FileStore.Log(e.Exception);
        InitializeComponent();
    }
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        window = new MainWindow(initialPath);
        window.Activate();
    }
}
