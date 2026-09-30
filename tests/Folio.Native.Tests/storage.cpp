#include "../../src/Folio.Native/platform.h"
#include <iostream>
void require(bool value, const char *message) {
  if (!value)
    throw std::runtime_error(message);
}
template <class F> void rejects(F f) {
  bool failed = false;
  try {
    f();
  } catch (...) {
    failed = true;
  }
  require(failed, "Expected rejection");
}
int main() {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  fs::path root =
      fs::temp_directory_path() / wide("folio-native-test-" + guid());
  try {
    fs::create_directories(root);
    SetEnvironmentVariableW(L"FOLIO_DATA_DIRECTORY", root.c_str());
    auto j = Json::parse("{\"한글\":\"\\ud83d\\ude00\\n\\\"\",\"n\":1.5e2,"
                         "\"a\":[true,null,false]}");
    require(j["n"].num() == 150, "JSON number");
    require(Json::parse(j.dump())["한글"].str() == "😀\n\"",
            "JSON Unicode roundtrip");
    for (auto s : {"{\"a\":1,\"a\":2}", "[1,]", "01", "1e", "\"\\ud800\"",
                   "\"\\udc00\"", "true false", "1e9999"})
      rejects([&] { Json::parse(s); });
    auto file = root / L"한글 공백.md";
    std::string original = "\xef\xbb\xbf# 한글\r\n본문\n끝\r";
    writeNew(file, original);
    auto doc = openDocument(file);
    require(doc.bom && doc.newline == "\r\n", "Encoding detection");
    saveDocument(file, doc.text, doc.newline, doc.bom, doc.fingerprint, true);
    require(readBytes(file) == original, "Untouched mixed newline bytes");
    saveDocument(file, "# 수정\n본문\n", doc.newline, doc.bom,
                 fingerprint(file));
    require(readBytes(file) == "\xef\xbb\xbf# 수정\r\n본문\r\n",
            "Edited newline and BOM");
    auto before = readBytes(file);
    rejects([&] { saveDocument(file, "lost", "\n", false, "stale"); });
    require(readBytes(file) == before, "Conflict preserves disk");
    auto bad = root / L"invalid.md";
    writeNew(bad, std::string("\xc0\xaf", 2));
    rejects([&] { openDocument(bad); });
    auto nul = root / L"nul.md";
    writeNew(nul, std::string("a\0b", 3));
    rejects([&] { openDocument(nul); });
    auto p = Json::parse("{\"BodyLineHeight\":9,\"OutlineLineHeight\":0,"
                         "\"DocumentAlignment\":\"wrong\",\"RecentFiles\":[]}");
    normalizePreferences(p);
    require(p["BodyLineHeight"].num() == 3 &&
                p["OutlineLineHeight"].num() == 1 &&
                p["DocumentAlignment"].str() == "center",
            "Legacy settings normalization");
    require(p["Language"].str() == defaultLanguage(),
            "Legacy settings inherit installation or OS language");
    p["Language"] = "invalid";
    normalizePreferences(p);
    require(p["Language"].str() == defaultLanguage(),
            "Invalid language uses the installation or OS default");
    for (auto language : {"ko", "en"}) {
      p["Language"] = language;
      normalizePreferences(p);
      require(p["Language"].str() == language &&
                  p["BodyLineHeight"].num() == 3 &&
                  p["OutlineLineHeight"].num() == 1,
              "Explicit language preserves existing layout settings");
    }
    remember(p, file);
    remember(p, file);
    savePreferences(p);
    auto restored = loadPreferences();
    require(restored["RecentFiles"].array().size() == 1,
            "Recent deduplication and settings persistence");
    require(restored["Language"].str() == "en",
            "Explicit language persists across preference reload");
    rejects([&] { contained(root, "../outside.png"); });
    rejects([&] { contained(root, "%2e%2e/outside.png"); });
    rejects([&] { contained(root, "C:/outside.png"); });
    rejects([&] { contained(root, "assets/a.png%00"); });
    auto png = base64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
                      "2mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
    auto images = importImages(root / L"draft" / L"document.md", {png});
    auto source = contained(root / L"draft", images.array()[0].str());
    require(fs::exists(source), "Image import");
    fs::create_directories(root / L"saved");
    copyImages(root / L"draft" / L"document.md",
               root / L"saved" / L"document.md", images);
    require(readBytes(contained(root / L"saved", images.array()[0].str())) ==
                png,
            "Save-as image copy");
    auto target = contained(root / L"saved", images.array()[0].str());
    atomicWrite(target, "different");
    rejects([&] {
      copyImages(root / L"draft" / L"document.md",
                 root / L"saved" / L"document.md", images);
    });
    require(readBytes(target) == "different",
            "Image collision never overwrites");
    rejects([&] { importImages(root / L"document.md", {"not an image"}); });
    std::cout
        << "PASS JSON, UTF-8, BOM/newlines, conflict-safe save, preferences, "
           "recent files, image containment/import/copy/collision\n";
    // Only this test's fresh, verified temporary directory is eligible for
    // cleanup.
    if (root.parent_path() == fs::temp_directory_path() &&
        root.filename().wstring().starts_with(L"folio-native-test-"))
      fs::remove_all(root);
    return 0;
  } catch (const std::exception &e) {
    std::cerr << e.what() << " (fixtures: " << utf8(root.wstring()) << ")\n";
    return 1;
  }
}
