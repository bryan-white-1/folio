using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Folio;

public sealed record OpenedFile(string Path, string Text, string Fingerprint, string NewLine, bool Bom);
public sealed record Recovery(string? Path, string Text, string? Fingerprint, string NewLine, bool Bom, DateTime SavedAt, string? AssetId = null);
public sealed class Preferences
{
    public const int RecentFileLimit = 20;
    public string Theme { get; set; } = "light";
    public int Width { get; set; } = 1280;
    public int Height { get; set; } = 860;
    public double SidebarWidth { get; set; } = 260;
    public List<string> RecentFiles { get; set; } = [];
    public double BodyLineHeight { get; set; } = 1.95;
    public double OutlineLineHeight { get; set; } = 2;
    public string DocumentAlignment { get; set; } = "center";
    public void Normalize()
    {
        BodyLineHeight = double.IsFinite(BodyLineHeight) ? Math.Clamp(BodyLineHeight, 1, 3) : 1.95;
        OutlineLineHeight = double.IsFinite(OutlineLineHeight) ? Math.Clamp(OutlineLineHeight, 1, 3) : 2;
        DocumentAlignment = DocumentAlignment == "left" ? "left" : "center";
        var recent = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in RecentFiles ?? [])
        {
            if (string.IsNullOrWhiteSpace(path)) continue;
            try
            {
                var fullPath = Path.GetFullPath(path);
                if (seen.Add(fullPath)) recent.Add(fullPath);
                if (recent.Count == RecentFileLimit) break;
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { }
        }
        RecentFiles = recent;
    }
    public void RememberFile(string path)
    {
        var fullPath = Path.GetFullPath(path);
        Normalize();
        RecentFiles.RemoveAll(p => string.Equals(p, fullPath, StringComparison.OrdinalIgnoreCase));
        RecentFiles.Insert(0, fullPath);
        Normalize();
    }
}

public static class FileStore
{
    public static string DataDirectory { get; } = Environment.GetEnvironmentVariable("FOLIO_DATA_DIRECTORY") ?? System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Folio");
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    public static string RecoveryPath => System.IO.Path.Combine(DataDirectory, "recovery.json");
    public const int MaxImageBytes = 20 * 1024 * 1024;
    public static string DraftDocument(string assetId)
    {
        if (!Guid.TryParseExact(assetId, "N", out _)) throw new IOException("잘못된 이미지 보관 위치입니다.");
        return Path.Combine(DataDirectory, "drafts", assetId, "document.md");
    }
    public static string ImageExtension(byte[] bytes)
    {
        if (bytes.Length == 0 || bytes.Length > MaxImageBytes) throw new IOException("이미지는 20MB 이하만 삽입할 수 있습니다.");
        if (bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return ".png";
        if (bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 })) return ".jpg";
        if (bytes.AsSpan().StartsWith("GIF87a"u8) || bytes.AsSpan().StartsWith("GIF89a"u8)) return ".gif";
        if (bytes.Length >= 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return ".webp";
        if (bytes.Length >= 26 && bytes.AsSpan(0, 2).SequenceEqual("BM"u8)) return ".bmp";
        throw new IOException("PNG·JPEG·GIF·WebP·BMP 이미지 파일을 선택하세요.");
    }
    public static async Task<string[]> ImportImages(string documentPath, IReadOnlyList<byte[]> images)
    {
        if (images.Count is < 1 or > 16 || images.Sum(bytes => (long)bytes.Length) > MaxImageBytes)
            throw new IOException("이미지는 한 번에 16개·합계 20MB 이하로 삽입하세요.");
        var extensions = images.Select(ImageExtension).ToArray();
        var directory = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(documentPath))!, "assets");
        Directory.CreateDirectory(directory);
        var written = new List<string>();
        try
        {
            foreach (var (bytes, index) in images.Select((bytes, index) => (bytes, index)))
            {
                var target = Path.Combine(directory, Guid.NewGuid().ToString("N") + extensions[index]);
                await using var stream = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                written.Add(target); await stream.WriteAsync(bytes);
            }
            return written.Select(target => "assets/" + Path.GetFileName(target)).ToArray();
        }
        catch { foreach (var target in written) File.Delete(target); throw; }
    }
    public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    public static async Task<OpenedFile> Read(string path)
    {
        var bytes = await File.ReadAllBytesAsync(path);
        if (bytes.Length > 10 * 1024 * 1024) throw new IOException("현재 버전은 10MB 이하의 문서를 지원합니다.");
        var bom = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
        string text;
        try { text = StrictUtf8.GetString(bytes, bom ? 3 : 0, bytes.Length - (bom ? 3 : 0)); }
        catch (DecoderFallbackException) { throw new IOException("UTF-8 문서만 열 수 있습니다. 파일을 UTF-8로 변환한 후 다시 열어주세요."); }
        if (text.Contains('\0')) throw new IOException("텍스트 Markdown 문서가 아닙니다.");
        return new OpenedFile(System.IO.Path.GetFullPath(path), text, Hash(bytes), text.Contains("\r\n") ? "\r\n" : "\n", bom);
    }
    public static async Task<string?> Fingerprint(string path) => File.Exists(path) ? Hash(await File.ReadAllBytesAsync(path)) : null;
    public static async Task<string> Save(string path, string text, string newline, bool bom, string? expectedFingerprint, bool preserveLineEndings = false)
    {
        var normalized = preserveLineEndings ? text : text.Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", newline);
        var encoding = new UTF8Encoding(bom);
        var bytes = encoding.GetPreamble().Concat(encoding.GetBytes(normalized)).ToArray();
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            { await stream.WriteAsync(bytes); stream.Flush(true); }
            if (await Fingerprint(path) != expectedFingerprint) throw new IOException("저장 직전에 파일이 변경되었습니다. 다시 저장하여 충돌을 확인해주세요.");
            if (File.Exists(path)) File.Replace(temp, path, null);
            else File.Move(temp, path);
            return Hash(bytes);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public static async Task CopyImages(string sourceDocument, string destinationDocument, IEnumerable<string> images)
    {
        var sourceDirectory = Path.GetDirectoryName(Path.GetFullPath(sourceDocument))!;
        var destinationDirectory = Path.GetDirectoryName(Path.GetFullPath(destinationDocument))!;
        if (sourceDirectory.Equals(destinationDirectory, StringComparison.OrdinalIgnoreCase)) return;
        var copies = new List<(string Source, string Target)>();
        foreach (var reference in images.Distinct())
        {
            if (Uri.TryCreate(reference, UriKind.Absolute, out _) || reference.StartsWith('/')) continue;
            var relative = Uri.UnescapeDataString(reference.Split('#', '?')[0]).Replace('/', Path.DirectorySeparatorChar);
            var source = Path.GetFullPath(Path.Combine(sourceDirectory, relative));
            var target = Path.GetFullPath(Path.Combine(destinationDirectory, relative));
            if (!source.StartsWith(sourceDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !target.StartsWith(destinationDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new IOException("상위 폴더를 참조하는 이미지는 자동 복사할 수 없습니다. 문서의 assets 폴더로 옮겨주세요.");
            if (!File.Exists(source)) continue;
            if (File.Exists(target))
            {
                if (await Fingerprint(source) != await Fingerprint(target)) throw new IOException($"이미지 이름 충돌: {reference}. 빈 폴더에 문서를 저장해주세요.");
                continue;
            }
            copies.Add((source, target));
        }
        foreach (var copy in copies) { Directory.CreateDirectory(Path.GetDirectoryName(copy.Target)!); File.Copy(copy.Source, copy.Target, false); }
    }
    public static Preferences LoadPreferences()
    {
        try { var preferences = JsonSerializer.Deserialize<Preferences>(File.ReadAllText(System.IO.Path.Combine(DataDirectory, "settings.json"))) ?? new(); preferences.Normalize(); return preferences; }
        catch { return new(); }
    }
    public static void SavePreferences(Preferences preferences)
    {
        Directory.CreateDirectory(DataDirectory);
        preferences.Normalize();
        var path = System.IO.Path.Combine(DataDirectory, "settings.json");
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temp, JsonSerializer.Serialize(preferences)); File.Move(temp, path, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public static Recovery? ReadRecovery()
    {
        try { return JsonSerializer.Deserialize<Recovery>(File.ReadAllText(RecoveryPath)); }
        catch { return null; }
    }
    public static async Task WriteRecovery(Recovery recovery)
    {
        Directory.CreateDirectory(DataDirectory);
        var temp = RecoveryPath + ".tmp";
        await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(recovery));
        File.Move(temp, RecoveryPath, true);
    }
    public static void ClearRecovery() { if (File.Exists(RecoveryPath)) File.Delete(RecoveryPath); }
    public static void Log(Exception error)
    {
        Directory.CreateDirectory(DataDirectory);
        File.AppendAllText(System.IO.Path.Combine(DataDirectory, "errors.log"), $"{DateTimeOffset.Now:O} {error}\n");
    }
}
