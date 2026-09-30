#pragma once
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include "json.h"
#include <algorithm>
#include <bcrypt.h>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <wincrypt.h>
namespace fs = std::filesystem;
inline void check(BOOL ok, const char *message) {
    if (!ok)
        throw std::runtime_error(std::string(message) + " (" + std::to_string(GetLastError()) + ")");
}
inline std::wstring wide(const std::string &s) {
    if (s.empty())
        return {};
    int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), int(s.size()), nullptr, 0);
    check(n, "UTF-8 문서만 지원합니다");
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), int(s.size()), w.data(), n);
    return w;
}
inline std::string utf8(const std::wstring &w) {
    if (w.empty())
        return {};
    int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, w.data(), int(w.size()), nullptr, 0, nullptr,
                                nullptr);
    check(n, "잘못된 문자입니다");
    std::string s(n, 0);
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, w.data(), int(w.size()), s.data(), n, nullptr,
                        nullptr);
    return s;
}
struct Handle {
    HANDLE h = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE v = INVALID_HANDLE_VALUE) : h(v) {}
    ~Handle() {
        if (h != INVALID_HANDLE_VALUE && h)
            CloseHandle(h);
    }
    Handle(const Handle &) = delete;
    Handle &operator=(const Handle &) = delete;
    operator HANDLE() const { return h; }
    void close() {
        if (h != INVALID_HANDLE_VALUE && h)
            CloseHandle(h);
        h = INVALID_HANDLE_VALUE;
    }
};
inline std::wstring upper(std::wstring s) {
    if (!s.empty())
        CharUpperBuffW(s.data(), DWORD(s.size()));
    return s;
}
inline fs::path full(const fs::path &p) { return fs::absolute(p).lexically_normal(); }
inline bool same(const fs::path &a, const fs::path &b) {
    return CompareStringOrdinal(full(a).c_str(), -1, full(b).c_str(), -1, TRUE) == CSTR_EQUAL;
}
inline std::string guid() {
    GUID g;
    CoCreateGuid(&g);
    wchar_t b[40];
    StringFromGUID2(g, b, 40);
    std::wstring w(b);
    w.erase(std::remove_if(w.begin(), w.end(), [](wchar_t c) { return c == '{' || c == '}' || c == '-'; }),
            w.end());
    return utf8(w);
}
inline std::string hash(const std::string &bytes) {
    unsigned char digest[32];
    if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, (PUCHAR)bytes.data(), ULONG(bytes.size()), digest,
                   32) < 0)
        throw std::runtime_error("SHA-256 실패");
    std::string s;
    for (auto c : digest) {
        s += "0123456789ABCDEF"[c >> 4];
        s += "0123456789ABCDEF"[c & 15];
    }
    return s;
}
inline std::string readBytes(const fs::path &p, size_t limit = 32 * 1024 * 1024) {
    Handle h(CreateFileW(p.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                         nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    check(h.h != INVALID_HANDLE_VALUE, "파일을 열지 못했습니다");
    LARGE_INTEGER n;
    check(GetFileSizeEx(h, &n), "파일 크기 확인 실패");
    if (n.QuadPart < 0 || static_cast<unsigned long long>(n.QuadPart) > limit)
        throw std::runtime_error("파일 크기 제한을 초과했습니다");
    std::string s(size_t(n.QuadPart), 0);
    DWORD got = 0;
    check(ReadFile(h, s.data(), DWORD(s.size()), &got, nullptr), "파일 읽기 실패");
    if (got != s.size())
        throw std::runtime_error("파일을 읽는 동안 크기가 변경되었습니다");
    return s;
}
inline std::string fingerprint(const fs::path &p) {
    if (!fs::exists(p))
        return {};
    return hash(readBytes(p));
}
inline void writeNew(const fs::path &p, const std::string &s) {
    Handle h(CreateFileW(p.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                         FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr));
    check(h.h != INVALID_HANDLE_VALUE, "파일 생성 실패");
    DWORD done;
    check(WriteFile(h, s.data(), DWORD(s.size()), &done, nullptr) && done == s.size(), "파일 쓰기 실패");
    check(FlushFileBuffers(h), "디스크 기록 실패");
}
inline void atomicWrite(const fs::path &p, const std::string &s,
                        std::optional<std::string> expected = std::nullopt) {
    auto temp = p;
    temp += L"." + wide(guid()) + L".tmp";
    try {
        if (expected && fingerprint(p) != *expected)
            throw std::runtime_error("저장 전에 파일이 변경되었습니다");
        writeNew(temp, s);
        if (expected && fingerprint(p) != *expected)
            throw std::runtime_error("저장 직전에 파일이 변경되었습니다");
        if (fs::exists(p))
            check(ReplaceFileW(p.c_str(), temp.c_str(), nullptr, 0, nullptr, nullptr), "파일 교체 실패");
        else
            check(MoveFileExW(temp.c_str(), p.c_str(), MOVEFILE_WRITE_THROUGH), "파일 저장 실패");
    } catch (...) {
        std::error_code ec;
        fs::remove(temp, ec);
        throw;
    }
}
inline std::string normalize(const std::string &s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\r') {
            out += '\n';
            if (i + 1 < s.size() && s[i + 1] == '\n')
                i++;
        } else
            out += s[i];
    }
    return out;
}
struct Opened {
    fs::path path;
    std::string text, fingerprint, newline;
    bool bom;
};
inline Opened openDocument(const fs::path &p) {
    auto bytes = readBytes(p, 10 * 1024 * 1024);
    bool bom = bytes.starts_with("\xef\xbb\xbf");
    auto text = bytes.substr(bom ? 3 : 0);
    wide(text);
    if (text.find('\0') != std::string::npos)
        throw std::runtime_error("텍스트 Markdown 문서가 아닙니다");
    return {full(p), text, hash(bytes), text.find("\r\n") != std::string::npos ? "\r\n" : "\n", bom};
}
inline std::string saveDocument(const fs::path &p, const std::string &text, const std::string &newline,
                                bool bom, const std::string &expected, bool preserve = false) {
    auto s = preserve ? text : normalize(text);
    if (!preserve && newline == "\r\n") {
        std::string t;
        for (char c : s) {
            if (c == '\n')
                t += '\r';
            t += c;
        }
        s = std::move(t);
    }
    if (bom)
        s = "\xef\xbb\xbf" + s;
    atomicWrite(p, s, expected);
    return hash(s);
}
inline fs::path dataDirectory() {
    wchar_t b[32768];
    DWORD n = GetEnvironmentVariableW(L"FOLIO_DATA_DIRECTORY", b, 32768);
    if (n && n < 32768)
        return full(b);
    PWSTR folder = nullptr;
    check(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &folder)),
          "프로필 경로 확인 실패");
    fs::path p = fs::path(folder) / L"Folio";
    CoTaskMemFree(folder);
    return p;
}
inline fs::path executableDirectory() {
    wchar_t b[32768];
    GetModuleFileNameW(nullptr, b, 32768);
    return fs::path(b).parent_path();
}
inline std::string defaultLanguage() {
    try {
        auto selected = readBytes(executableDirectory() / L"install-language.txt", 64);
        if (selected == "english" || selected == "en") return "en";
        if (selected == "korean" || selected == "ko") return "ko";
    } catch (...) {}
    return PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_KOREAN ? "ko" : "en";
}
inline std::string uiLanguage = "ko";
inline Json englishMessages;
inline void initializeLocalization(const std::string &language) {
    uiLanguage = language == "en" ? "en" : "ko";
    if (uiLanguage == "en") {
        englishMessages = Json::parse(readBytes(executableDirectory() / L"locales" / L"en.json", 1024 * 1024));
    }
}
inline std::string tr(const std::string &text) {
    if (uiLanguage != "en") return text;
    const auto &messages = static_cast<const Json &>(englishMessages);
    if (!messages[text].null()) return messages[text].str();
    // Win32 and HRESULT diagnostics append a numeric code to an application message.
    auto suffix = text.find(" (");
    if (suffix != std::string::npos && !messages[text.substr(0, suffix)].null())
        return messages[text.substr(0, suffix)].str() + text.substr(suffix);
    return text;
}
inline std::string timestamp() {
    SYSTEMTIME t;
    GetLocalTime(&t);
    char b[40];
    std::snprintf(b, sizeof(b), "%04u-%02u-%02uT%02u:%02u:%02u", t.wYear, t.wMonth, t.wDay, t.wHour,
                  t.wMinute, t.wSecond);
    return b;
}
inline void logError(const std::string &message) {
    try {
        auto p = dataDirectory() / L"errors.log";
        Handle h(CreateFileW(p.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, OPEN_ALWAYS,
                             FILE_ATTRIBUTE_NORMAL, nullptr));
        auto s = timestamp() + " " + message + "\r\n";
        DWORD done;
        WriteFile(h, s.data(), DWORD(s.size()), &done, nullptr);
    } catch (...) {
    }
}
inline Json defaults() {
    return Json::object({{"Theme", "light"},
                         {"Language", defaultLanguage()},
                         {"Width", 1280},
                         {"Height", 860},
                         {"SidebarWidth", 260},
                         {"RecentFiles", Json::Array{}},
                         {"BodyLineHeight", 1.95},
                         {"OutlineLineHeight", 2},
                         {"DocumentAlignment", "center"}});
}
inline void normalizePreferences(Json &p) {
    p["Theme"] = p["Theme"].str() == "dark" ? "dark" : "light";
    if (p["Language"].str() != "en" && p["Language"].str() != "ko") p["Language"] = defaultLanguage();
    p["Width"] = std::clamp(p["Width"].num(1280), 900., 2400.);
    p["Height"] = std::clamp(p["Height"].num(860), 620., 1600.);
    p["SidebarWidth"] = std::clamp(p["SidebarWidth"].num(260), 200., 420.);
    p["BodyLineHeight"] = std::clamp(p["BodyLineHeight"].num(1.95), 1., 3.);
    p["OutlineLineHeight"] = std::clamp(p["OutlineLineHeight"].num(2), 1., 3.);
    p["DocumentAlignment"] = p["DocumentAlignment"].str() == "left" ? "left" : "center";
    Json::Array recent;
    for (auto &v : p["RecentFiles"].array()) {
        try {
            if (v.str().empty())
                continue;
            auto path = full(wide(v.str()));
            bool found = false;
            for (auto &x : recent)
                if (same(path, wide(x.str())))
                    found = true;
            if (!found)
                recent.push_back(utf8(path.wstring()));
            if (recent.size() == 20)
                break;
        } catch (...) {
        }
    }
    p["RecentFiles"] = recent;
}
inline Json loadPreferences() {
    try {
        auto p = Json::parse(readBytes(dataDirectory() / L"settings.json", 1024 * 1024));
        normalizePreferences(p);
        return p;
    } catch (...) {
        return defaults();
    }
}
inline void savePreferences(Json &p) {
    normalizePreferences(p);
    atomicWrite(dataDirectory() / L"settings.json", p.dump());
}
inline void remember(Json &p, const fs::path &path) {
    Json::Array list{utf8(full(path).wstring())};
    for (auto &v : p["RecentFiles"].array())
        if (!same(path, wide(v.str())))
            list.push_back(v);
    p["RecentFiles"] = list;
    normalizePreferences(p);
    savePreferences(p);
}
inline std::string percentDecode(std::string s) {
    std::string out;
    auto hex = [](char c) -> int {
        if (c >= '0' && c <= '9')
            return c - '0';
        if (c >= 'a' && c <= 'f')
            return c - 'a' + 10;
        if (c >= 'A' && c <= 'F')
            return c - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '%') {
            if (i + 2 >= s.size() || hex(s[i + 1]) < 0 || hex(s[i + 2]) < 0)
                throw std::runtime_error("잘못된 이미지 경로");
            char c = char(hex(s[i + 1]) * 16 + hex(s[i + 2]));
            if (!c)
                throw std::runtime_error("잘못된 이미지 경로");
            out += c;
            i += 2;
        } else
            out += s[i];
    }
    return out;
}
inline fs::path contained(const fs::path &root, const std::string &reference) {
    auto decoded = percentDecode(reference.substr(0, reference.find_first_of("?#")));
    if (decoded.find(':') != std::string::npos)
        throw std::runtime_error("잘못된 이미지 경로");
    fs::path relative = wide(decoded);
    if (relative.is_absolute() || relative.has_root_name() || relative.has_root_directory())
        throw std::runtime_error("상위 폴더 이미지는 사용할 수 없습니다");
    auto base = fs::weakly_canonical(root);
    auto target = fs::weakly_canonical(root / relative);
    auto b = upper(base.wstring());
    if (!b.ends_with(L"\\"))
        b += L"\\";
    if (!upper(target.wstring()).starts_with(b))
        throw std::runtime_error("문서 폴더 밖의 이미지는 사용할 수 없습니다");
    return target;
}
inline std::string imageExtension(const std::string &b) {
    if (b.empty() || b.size() > 20 * 1024 * 1024)
        throw std::runtime_error("이미지는 20MB 이하로 삽입하세요");
    if (b.starts_with("\x89PNG\r\n\x1a\n"))
        return ".png";
    if (b.starts_with("\xff\xd8\xff"))
        return ".jpg";
    if (b.starts_with("GIF87a") || b.starts_with("GIF89a"))
        return ".gif";
    if (b.size() >= 12 && b.starts_with("RIFF") && b.substr(8, 4) == "WEBP")
        return ".webp";
    if (b.size() >= 26 && b.starts_with("BM"))
        return ".bmp";
    throw std::runtime_error("PNG·JPEG·GIF·WebP·BMP 이미지만 지원합니다");
}
inline Json importImages(const fs::path &doc, const std::vector<std::string> &images) {
    size_t bytes = 0;
    std::vector<std::string> extensions;
    for (auto &b : images) {
        bytes += b.size();
        extensions.push_back(imageExtension(b));
    }
    if (images.empty() || images.size() > 16 || bytes > 20 * 1024 * 1024)
        throw std::runtime_error("이미지는 16개·합계 20MB 이하로 삽입하세요");
    auto dir = doc.parent_path() / L"assets";
    fs::create_directories(dir);
    std::vector<fs::path> written;
    Json::Array paths;
    try {
        for (size_t i = 0; i < images.size(); i++) {
            auto name = guid() + extensions[i];
            auto path = contained(doc.parent_path(), "assets/" + name);
            writeNew(path, images[i]);
            written.push_back(path);
            paths.push_back("assets/" + name);
        }
        return paths;
    } catch (...) {
        for (auto &p : written) {
            std::error_code ec;
            fs::remove(p, ec);
        }
        throw;
    }
}
inline void copyImages(const fs::path &src, const fs::path &dst, const Json &images) {
    if (same(src.parent_path(), dst.parent_path()))
        return;
    std::vector<std::pair<fs::path, fs::path>> copies;
    for (auto &v : images.array()) {
        auto ref = v.str();
        if (ref.empty() || ref.find(':') != std::string::npos || ref.starts_with('/'))
            continue;
        auto s = contained(src.parent_path(), ref), d = contained(dst.parent_path(), ref);
        if (!fs::exists(s))
            continue;
        if (fs::exists(d)) {
            if (fingerprint(s) != fingerprint(d))
                throw std::runtime_error("이미지 이름 충돌: 빈 폴더에 저장해주세요");
        } else
            copies.emplace_back(s, d);
    }
    for (auto &[s, d] : copies) {
        fs::create_directories(d.parent_path());
        if (!fs::exists(d))
            check(CopyFileW(s.c_str(), d.c_str(), TRUE), "이미지 복사 실패");
    }
}
inline std::string base64(const std::string &s) {
    DWORD n = 0;
    check(CryptStringToBinaryA(s.data(), DWORD(s.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, nullptr,
                               &n, nullptr, nullptr),
          "잘못된 이미지 데이터");
    if (n > 20 * 1024 * 1024)
        throw std::runtime_error("이미지가 너무 큽니다");
    std::string b(n, 0);
    check(CryptStringToBinaryA(s.data(), DWORD(s.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT,
                               (BYTE *)b.data(), &n, nullptr, nullptr),
          "이미지 읽기 실패");
    return b;
}
