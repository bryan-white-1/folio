using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;

namespace Folio;

// A same-user pipe queues shell requests until the UI can safely ask about unsaved edits.
public sealed class ActivationBroker : IDisposable
{
    public static string Scope => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(FileStore.DataDirectory).ToUpperInvariant())))[..24];
    private static string PipeName => "Folio.Activation." + Scope;
    private readonly CancellationTokenSource shutdown = new();
    private readonly ConcurrentQueue<string> requests = new();
    private readonly Task listener;
    public ActivationBroker() => listener = Task.Run(Listen);
    public bool TryDequeue(out string path) => requests.TryDequeue(out path!);
    public static async Task Forward(string path)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        await client.ConnectAsync(timeout.Token);
        var bytes = Encoding.UTF8.GetBytes(path);
        if (bytes.Length > 32768) throw new IOException("파일 경로가 너무 깁니다.");
        await client.WriteAsync(BitConverter.GetBytes(bytes.Length), timeout.Token);
        await client.WriteAsync(bytes, timeout.Token);
        await client.FlushAsync(timeout.Token);
        var accepted = new byte[1]; await client.ReadExactlyAsync(accepted, timeout.Token);
        if (accepted[0] != 1) throw new IOException("파일 열기 요청을 전달하지 못했습니다.");
    }
    private async Task Listen()
    {
        while (!shutdown.IsCancellationRequested)
        {
            try
            {
                using var server = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(shutdown.Token);
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token);
                deadline.CancelAfter(TimeSpan.FromSeconds(5));
                var prefix = new byte[4]; await server.ReadExactlyAsync(prefix, deadline.Token);
                var length = BitConverter.ToInt32(prefix);
                if (length < 0 || length > 32768 || requests.Count >= 32) continue;
                var bytes = new byte[length]; await server.ReadExactlyAsync(bytes, deadline.Token);
                requests.Enqueue(Encoding.UTF8.GetString(bytes));
                await server.WriteAsync(new byte[] { 1 }, deadline.Token);
                await server.FlushAsync(deadline.Token);
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
        }
    }
    public void Dispose() { shutdown.Cancel(); try { listener.GetAwaiter().GetResult(); } finally { shutdown.Dispose(); } }
}
