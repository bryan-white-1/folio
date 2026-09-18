using System.Text;
using Folio;

var temp = Path.Combine(Path.GetTempPath(), "folio-storage-test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
Environment.SetEnvironmentVariable("FOLIO_DATA_DIRECTORY", Path.Combine(temp, "profile"));
void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); }
try
{
    var path = Path.Combine(temp, "문서.md");
    var hash = await FileStore.Save(path, "# 한글\n\n본문 😀\n", "\r\n", true, null);
    var opened = await FileStore.Read(path);
    Check(opened.Bom && opened.NewLine == "\r\n" && opened.Text.Contains("본문 😀") && opened.Fingerprint == hash, "UTF-8 BOM, Korean, emoji, CRLF round trip");
    var original = "# Mixed\r\n\n* keep\r\n";
    hash = await FileStore.Save(path, original, "\r\n", false, hash, true);
    Check((await FileStore.Read(path)).Text == original, "Unedited mixed newlines preserved");
    await File.WriteAllTextAsync(path, "external edit");
    var rejected = false;
    try { await FileStore.Save(path, "wrong overwrite", "\n", false, hash); } catch (IOException) { rejected = true; }
    Check(rejected && await File.ReadAllTextAsync(path) == "external edit", "External edit blocks stale save without data loss");
    Check(Directory.GetFiles(temp, "*.tmp").Length == 0, "Failed save cleans temporary file");
    await File.WriteAllBytesAsync(path, [0xFF, 0xFE, 0x31, 0x00]);
    rejected = false; try { await FileStore.Read(path); } catch (IOException) { rejected = true; }
    Check(rejected, "Unsupported encoding rejected without conversion");
    var sourceDir = Path.Combine(temp, "source"); var destinationDir = Path.Combine(temp, "copy");
    Directory.CreateDirectory(Path.Combine(sourceDir, "assets")); Directory.CreateDirectory(destinationDir);
    await File.WriteAllBytesAsync(Path.Combine(sourceDir, "assets", "test.png"), [1, 2, 3]);
    await FileStore.CopyImages(Path.Combine(sourceDir, "a.md"), Path.Combine(destinationDir, "b.md"), ["assets/test.png"]);
    Check(File.Exists(Path.Combine(destinationDir, "assets", "test.png")), "Save As carries relative image assets");
    await File.WriteAllBytesAsync(Path.Combine(destinationDir, "assets", "test.png"), [4, 5]);
    rejected = false; try { await FileStore.CopyImages(Path.Combine(sourceDir, "a.md"), Path.Combine(destinationDir, "b.md"), ["assets/test.png"]); } catch (IOException) { rejected = true; }
    Check(rejected, "Existing image with different content is not overwritten");
    FileStore.SavePreferences(new Preferences { BodyLineHeight = 1.4, OutlineLineHeight = 1.25, DocumentAlignment = "left", Theme = "dark" });
    var preferences = FileStore.LoadPreferences();
    Check(preferences.BodyLineHeight == 1.4 && preferences.OutlineLineHeight == 1.25 && preferences.DocumentAlignment == "left" && preferences.Theme == "dark", "Configuration persists without losing existing preferences");
    await File.WriteAllTextAsync(Path.Combine(FileStore.DataDirectory, "settings.json"), "{\"Theme\":\"dark\"}");
    preferences = FileStore.LoadPreferences();
    Check(preferences.BodyLineHeight == 1.95 && preferences.OutlineLineHeight == 2 && preferences.DocumentAlignment == "center", "Older settings migrate with default configuration");
    FileStore.SavePreferences(new Preferences { BodyLineHeight = double.NaN, OutlineLineHeight = 20, DocumentAlignment = "invalid" });
    preferences = FileStore.LoadPreferences();
    Check(preferences.BodyLineHeight == 1.95 && preferences.OutlineLineHeight == 3 && preferences.DocumentAlignment == "center", "Invalid configuration values are bounded safely");
    for (var i = 0; i < 25; i++) preferences.RememberFile(Path.Combine(temp, $"폴더 {i:00}", "동일 문서.md"));
    FileStore.SavePreferences(preferences);
    preferences = FileStore.LoadPreferences();
    Check(preferences.RecentFiles.Count == 20 && preferences.RecentFiles[0].Contains("폴더 24") && preferences.RecentFiles[^1].Contains("폴더 05"), "Recent documents retain the latest 20 full paths across reload");
    var promoted = preferences.RecentFiles[12];
    preferences.RememberFile(promoted.ToUpperInvariant());
    preferences.RememberFile(Path.Combine(Path.GetDirectoryName(promoted)!, ".", Path.GetFileName(promoted)));
    Check(preferences.RecentFiles.Count == 20 && preferences.RecentFiles[0] == promoted && preferences.RecentFiles.Count(p => p.Equals(promoted, StringComparison.OrdinalIgnoreCase)) == 1, "Reopening promotes a canonical path without case-insensitive duplicates");
    var legacyPaths = preferences.RecentFiles.Take(8).ToList();
    await File.WriteAllTextAsync(Path.Combine(FileStore.DataDirectory, "settings.json"), System.Text.Json.JsonSerializer.Serialize(new { Theme = "dark", RecentFiles = legacyPaths }));
    Check(FileStore.LoadPreferences().RecentFiles.SequenceEqual(legacyPaths), "Older eight-document history migrates without dropping paths");
    preferences.RecentFiles = [null!, "", "  ", "bad\0path", .. legacyPaths, legacyPaths[0]];
    FileStore.SavePreferences(preferences);
    Check(FileStore.LoadPreferences().RecentFiles.SequenceEqual(legacyPaths), "Invalid recent entries are removed while missing files remain available");
    await File.WriteAllTextAsync(Path.Combine(FileStore.DataDirectory, "settings.json"), "{\"Theme\":\"dark\",\"RecentFiles\":null}");
    Check(FileStore.LoadPreferences().RecentFiles.Count == 0 && FileStore.LoadPreferences().Theme == "dark", "Null recent history does not reset other preferences");
    var pixel = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQifb4DwADFQG/3OBqxQAAAABJRU5ErkJggg==");
    var assetId = Guid.NewGuid().ToString("N"); var draft = FileStore.DraftDocument(assetId);
    var imported = await FileStore.ImportImages(draft, [pixel, pixel]);
    Check(imported.Length == 2 && imported[0] != imported[1] && File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(draft)!, imported[0])).SequenceEqual(pixel), "Draft images retain bytes under unique relative assets paths");
    var assets = Path.Combine(Path.GetDirectoryName(draft)!, "assets");
    rejected = false; try { await FileStore.ImportImages(draft, [pixel, [1, 2, 3]]); } catch (IOException) { rejected = true; }
    Check(rejected && Directory.GetFiles(assets).Length == 2, "Invalid image batches are rejected before any file is written");
    rejected = false; try { await FileStore.ImportImages(draft, Enumerable.Repeat(pixel, 17).ToArray()); } catch (IOException) { rejected = true; }
    Check(rejected, "Image batch count is bounded");
    var savedDocument = Path.Combine(temp, "image-save", "이미지.md");
    await FileStore.CopyImages(draft, savedDocument, imported);
    Check(imported.All(reference => File.Exists(Path.Combine(Path.GetDirectoryName(savedDocument)!, reference))), "First save copies all draft image assets to the document directory");
    await FileStore.WriteRecovery(new(null, $"![이미지]({imported[0]})", null, "\n", false, DateTime.Now, assetId));
    var recovery = FileStore.ReadRecovery()!;
    Check(recovery.AssetId == assetId && File.Exists(Path.Combine(Path.GetDirectoryName(FileStore.DraftDocument(recovery.AssetId!))!, imported[0])), "Unsaved image assets survive recovery and resolve from their original draft");
    rejected = false; try { FileStore.DraftDocument("../escape"); } catch (IOException) { rejected = true; }
    Check(rejected, "Draft asset identifiers cannot escape the profile directory");
    Console.WriteLine("21 storage tests passed.");
}
finally { Directory.Delete(temp, true); }
