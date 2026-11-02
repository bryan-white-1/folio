#pragma once
// Active and parked documents share the same storage contract.
struct DocumentState {
    Json current = Json::object({{"text", ""}, {"revision", 0}, {"dirty", false}, {"documentId", "welcome"}});
    Json headings = Json::Array{};
    fs::path path;
    std::string fileHash, lastExternal, newline = "\n", original, documentId = "welcome", assetId = guid();
    bool bom = false, textMode = false;
};
inline bool markdownPath(const fs::path &path) {
    auto ext = upper(path.extension().wstring());
    return ext == L".MD" || ext == L".MARKDOWN";
}
