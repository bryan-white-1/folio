#pragma once
#include <memory>
inline std::wstring previewMime(const fs::path &path) {
    auto ext = upper(path.extension().wstring());
    if (ext == L".PNG") return L"image/png";
    if (ext == L".JPG" || ext == L".JPEG" || ext == L".JFIF") return L"image/jpeg";
    if (ext == L".GIF") return L"image/gif";
    if (ext == L".WEBP") return L"image/webp";
    if (ext == L".SVG") return L"image/svg+xml";
    return {};
}
// Active and parked documents share the same storage contract.
struct DocumentState {
    Json current = Json::object({{"text", ""}, {"revision", 0}, {"dirty", false}, {"documentId", "welcome"}});
    Json headings = Json::Array{};
    fs::path path;
    std::string fileHash, lastExternal, newline = "\n", original, documentId = "welcome", assetId = guid();
    bool bom = false, textMode = false;
    std::shared_ptr<const std::string> preview;
    const char *kind() const { return preview ? "image" : textMode ? "text" : "markdown"; }
    std::string previewUrl() const { return "https://document.local/.folio-preview/" + documentId + "/" + fileHash; }
    void readPreview(const fs::path &file) {
        auto data = std::make_shared<const std::string>(readBytes(file));
        auto digest = hash(*data);
        preview = std::move(data); fileHash = lastExternal = digest;
    }
};
inline bool markdownPath(const fs::path &path) {
    auto ext = upper(path.extension().wstring());
    return ext == L".MD" || ext == L".MARKDOWN";
}
