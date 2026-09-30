#include "activation.h"
#include "com.h"
#include <deque>
#include <dwmapi.h>
#include <fstream>
constexpr UINT DispatchMessageId = WM_APP + 2;
struct App {
    Activation &broker;
    HWND hwnd = nullptr;
    Com<ICoreWebView2Environment> env;
    Com<ICoreWebView2Controller> controller;
    Com<ICoreWebView2> web;
    Json prefs = loadPreferences(),
         current = Json::object({{"text", ""}, {"revision", 0}, {"dirty", false}, {"documentId", "welcome"}}),
         headings = Json::Array{};
    fs::path path;
    std::string fileHash, lastExternal, newline = "\n", original, documentId = "welcome", assetId = guid();
    bool bom = false, ready = false, busy = false, closing = false, startupComplete = false;
    std::wstring startup;
    std::deque<std::wstring> activations;
    struct Pending {
        ULONGLONG expires;
        std::function<void(Json)> done;
    };
    std::map<std::string, Pending> snapshots, dialogs;
    explicit App(std::wstring p, Activation &a) : broker(a), startup(std::move(p)) {}
    void defer(std::function<void()> fn) {
        auto p = std::make_unique<std::function<void()>>(std::move(fn));
        check(PostMessageW(hwnd, DispatchMessageId, 0, (LPARAM)p.get()), "작업 예약 실패");
        p.release();
    }
    void safe(std::function<void()> fn) {
        try {
            fn();
        } catch (const std::exception &e) {
            busy = false;
            error(e.what());
        }
    }
    void post(Json j) {
        if (web)
            hrcheck(web->PostWebMessageAsJson(wide(j.dump()).c_str()), "편집기 통신 실패");
    }
    void toast(const std::string &text) { post(Json::object({{"type", "toast"}, {"message", tr(text)}})); }
    void error(const std::string &text) {
        logError(text);
        if (ready)
            ask("작업을 완료하지 못했습니다", tr(text), {"확인"}, [](int) {});
        else
            MessageBoxW(hwnd, wide(tr(text)).c_str(), L"Folio", MB_OK | MB_ICONERROR);
    }
    void ask(std::string title, std::string message, Json::Array buttons, std::function<void(int)> done) {
        for (auto &button : buttons) button = tr(button.str());
        auto id = guid();
        dialogs.emplace(id, Pending{0, [done](Json j) { done(int(j["choice"].num(-1))); }});
        post(Json::object({{"type", "hostDialog"},
                           {"id", id},
                           {"title", tr(title)},
                           {"message", message},
                           {"buttons", buttons}}));
    }
    void snapshot(std::function<void(Json)> done) {
        auto id = guid();
        snapshots.emplace(id, Pending{GetTickCount64() + 15000, std::move(done)});
        post(Json::object({{"type", "snapshot"}, {"requestId", id}, {"documentId", documentId}}));
    }
    fs::path imageDocument() {
        return path.empty() ? dataDirectory() / L"drafts" / wide(assetId) / L"document.md" : path;
    }
    void status() {
        auto name = path.empty() ? tr("제목 없음.md") : utf8(path.filename().wstring());
        SetWindowTextW(hwnd, wide((current["dirty"].boolean() ? "● " : "") + name + " — Folio").c_str());
        post(Json::object({{"type", "hostState"},
                           {"path", utf8(path.wstring())},
                           {"name", name},
                           {"dirty", current["dirty"]},
                           {"headings", headings},
                           {"preferences", prefs}}));
    }
    void configuration() {
        post(Json::object({{"type", "theme"}, {"value", prefs["Theme"]}}));
        post(Json::object({{"type", "configuration"},
                           {"bodyLineHeight", prefs["BodyLineHeight"]},
                           {"documentAlignment", prefs["DocumentAlignment"]}}));
        BOOL dark = prefs["Theme"].str() == "dark";
        DwmSetWindowAttribute(hwnd, 20, &dark, sizeof(dark));
        status();
    }
    void load(std::string text, bool dirty) {
        documentId = guid();
        assetId = guid();
        current =
            Json::object({{"text", text}, {"revision", 0}, {"dirty", dirty}, {"documentId", documentId}});
        headings = Json::Array{};
        post(Json::object({{"type", "load"},
                           {"text", text},
                           {"dirty", dirty},
                           {"documentId", documentId},
                           {"name", path.empty() ? tr("제목 없음.md") : utf8(path.filename().wstring())}}));
        status();
    }
    void clearRecovery() {
        std::error_code ec;
        fs::remove(dataDirectory() / L"recovery.json", ec);
        if (ec)
            throw std::runtime_error("복구 기록 정리 실패");
    }
    void recovery() {
        if (!ready || !current["dirty"].boolean())
            return;
        auto j = Json::object({{"Path", path.empty() ? Json() : Json(utf8(path.wstring()))},
                               {"Text", current["text"]},
                               {"Fingerprint", fileHash.empty() ? Json() : Json(fileHash)},
                               {"NewLine", newline},
                               {"Bom", bom},
                               {"SavedAt", timestamp()},
                               {"AssetId", path.empty() ? Json(assetId) : Json()}});
        atomicWrite(dataDirectory() / L"recovery.json", j.dump());
    }
    void begin() {
        configuration();
        if (startup == L"--smoke-test") {
            startupComplete = true;
            return;
        }
        Json r;
        try {
            r = Json::parse(readBytes(dataDirectory() / L"recovery.json"));
        } catch (...) {
        }
        auto next = [this] {
            startupComplete = true;
            if (!startup.empty())
                execute("openPath", utf8(startup));
        };
        if (!r["Text"].null())
            ask("저장하지 않은 문서", tr("이전 실행에서 저장하지 않은 문서가 있습니다."),
                {"복구", "삭제", "앱 닫기"}, [this, r, next](int choice) {
                    safe([&] {
                        if (choice == 0) {
                            path = wide(r["Path"].str());
                            fileHash = r["Fingerprint"].str();
                            newline = r["NewLine"].str("\n");
                            bom = r["Bom"].boolean();
                            original = "";
                            load(r["Text"].str(), true);
                            auto a = r["AssetId"].str();
                            if (a.size() == 32 &&
                                a.find_first_not_of("0123456789abcdefABCDEF") == std::string::npos)
                                assetId = a;
                            startupComplete = true;
                        } else if (choice == 1) {
                            clearRecovery();
                            next();
                        } else {
                            closing = true;
                            DestroyWindow(hwnd);
                        }
                    });
                });
        else
            next();
    }
    void open(const std::string &name) {
        auto f = openDocument(wide(name));
        path = f.path;
        fileHash = f.fingerprint;
        lastExternal = fileHash;
        newline = f.newline;
        bom = f.bom;
        original = f.text;
        load(f.text, false);
        remember(prefs, path);
        clearRecovery();
        status();
    }
    std::optional<fs::path> pick(bool save, bool image = false) {
        Com<IFileDialog> dialog;
        if (save)
            hrcheck(CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER,
                                     __uuidof(IFileSaveDialog), (void **)dialog.put()),
                    "저장 창 생성 실패");
        else
            hrcheck(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                     __uuidof(IFileOpenDialog), (void **)dialog.put()),
                    "열기 창 생성 실패");
        auto docLabel = wide(tr("Markdown 문서")), allLabel = wide(tr("모든 파일")), imageLabel = wide(tr("이미지"));
        COMDLG_FILTERSPEC docs[] = {{docLabel.c_str(), L"*.md;*.markdown;*.txt"}, {allLabel.c_str(), L"*.*"}};
        COMDLG_FILTERSPEC images[] = {{imageLabel.c_str(), L"*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp"}};
        dialog->SetTitle(wide(tr(save ? "다른 이름으로 저장" : image ? "이미지 삽입" : "열기")).c_str());
        dialog->SetOkButtonLabel(wide(tr(save ? "저장" : "열기")).c_str());
        dialog->SetFileTypes(image ? 1 : 2, image ? images : docs);
        DWORD options;
        dialog->GetOptions(&options);
        dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR |
                           (save ? FOS_OVERWRITEPROMPT : FOS_FILEMUSTEXIST));
        if (save) {
            dialog->SetDefaultExtension(L"md");
            dialog->SetFileName(path.empty() ? wide(tr("새 문서.md")).c_str() : path.filename().c_str());
        }
        if (!path.empty()) {
            Com<IShellItem> dir;
            if (SUCCEEDED(SHCreateItemFromParsingName(path.parent_path().c_str(), nullptr,
                                                      __uuidof(IShellItem), (void **)dir.put())))
                dialog->SetFolder(dir.get());
        }
        auto hr = dialog->Show(hwnd);
        if (hr == HRESULT_FROM_WIN32(ERROR_CANCELLED))
            return {};
        hrcheck(hr, "파일 선택 실패");
        Com<IShellItem> result;
        hrcheck(dialog->GetResult(result.put()), "파일 선택 실패");
        CoString p;
        hrcheck(result->GetDisplayName(SIGDN_FILESYSPATH, p.put()), "파일 경로 확인 실패");
        return full(p.p);
    }
    void save(bool saveAs, std::function<void(bool)> done) {
        snapshot([this, saveAs, done](Json s) {
            safe([&] {
                auto chosen = (saveAs || path.empty()) ? pick(true) : std::optional<fs::path>(path);
                if (!chosen) {
                    done(false);
                    return;
                }
                auto target = *chosen;
                auto disk = fingerprint(target);
                bool sameFile = !path.empty() && same(path, target);
                auto commit = [this, s, target, disk, sameFile, done] {
                    safe([&] {
                        if (!(sameFile && !s["dirty"].boolean() && disk == fileHash)) {
                            if (!sameFile) {
                                Json images = s["images"];
                                Json::Array list = images.array();
                                auto dir = imageDocument().parent_path() / L"assets";
                                if (path.empty() && fs::exists(dir))
                                    for (auto &entry : fs::directory_iterator(dir))
                                        if (entry.is_regular_file())
                                            list.push_back("assets/" +
                                                           utf8(entry.path().filename().wstring()));
                                copyImages(imageDocument(), target, list);
                            }
                            bool preserve = !s["dirty"].boolean() && !original.empty();
                            fileHash = saveDocument(target, preserve ? original : s["text"].str(), newline,
                                                    bom, disk, preserve);
                        }
                        path = target;
                        if (s["dirty"].boolean() || original.empty()) {
                            original = normalize(s["text"].str());
                            if (newline == "\r\n") {
                                std::string t;
                                for (char c : original) {
                                    if (c == '\n')
                                        t += '\r';
                                    t += c;
                                }
                                original = t;
                            }
                        }
                        lastExternal = fileHash;
                        remember(prefs, path);
                        post(Json::object({{"type", "saved"},
                                           {"text", s["text"]},
                                           {"revision", s["revision"]},
                                           {"name", utf8(path.filename().wstring())},
                                           {"documentId", documentId}}));
                        if (current["revision"].num() == s["revision"].num())
                            current["dirty"] = false;
                        if (current["dirty"].boolean())
                            recovery();
                        else
                            clearRecovery();
                        status();
                        done(true);
                    });
                };
                if (sameFile && disk != fileHash)
                    ask("외부에서 변경된 파일", tr("덮어쓰거나 다른 이름으로 저장할 수 있습니다."),
                        {"덮어쓰기", "다른 이름으로 저장", "취소"}, [this, commit, done](int n) {
                            if (n == 0)
                                commit();
                            else if (n == 1)
                                save(true, done);
                            else
                                done(false);
                        });
                else
                    commit();
            });
        });
    }
    void canLeave(std::function<void()> next) {
        snapshot([this, next](Json s) {
            if (!s["dirty"].boolean()) {
                next();
                return;
            }
            ask("변경 내용을 저장할까요?",
                path.empty() ? tr("새 문서에 저장하지 않은 내용이 있습니다.") : utf8(path.filename().wstring()),
                {"저장", "저장 안 함", "취소"}, [this, next](int n) {
                    if (n == 0)
                        save(false, [this, next](bool ok) {
                            if (ok)
                                canLeave(next);
                            else
                                busy = false;
                        });
                    else if (n == 1)
                        next();
                    else
                        busy = false;
                });
        });
    }
    bool clipboard(const std::wstring &text, const std::string &html = {}) {
        bool opened = false;
        for (int i = 0; i < 6; i++) {
            if (OpenClipboard(hwnd)) {
                opened = true;
                break;
            }
            Sleep(20);
        }
        if (!opened)
            return false;
        bool ok = EmptyClipboard();
        auto put = [](UINT format, const void *data, size_t bytes) {
            HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if (!h)
                return false;
            void *p = GlobalLock(h);
            if (!p) {
                GlobalFree(h);
                return false;
            }
            memcpy(p, data, bytes);
            GlobalUnlock(h);
            if (!SetClipboardData(format, h)) {
                GlobalFree(h);
                return false;
            }
            return true;
        };
        ok = ok && put(CF_UNICODETEXT, text.c_str(), (text.size() + 1) * sizeof(wchar_t));
        if (!html.empty()) {
            std::string header = "Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:"
                                 "0000000000\r\nStartFragment:"
                                 "0000000000\r\nEndFragment:0000000000\r\n";
            std::string prefix = "<html><body><!--StartFragment-->",
                        suffix = "<!--EndFragment--></body></html>";
            auto number = [&](const char *key, size_t n) {
                char b[11];
                std::snprintf(b, 11, "%010zu", n);
                header.replace(header.find(key) + strlen(key), 10, b);
            };
            number("StartHTML:", header.size());
            number("EndHTML:", header.size() + prefix.size() + html.size() + suffix.size());
            number("StartFragment:", header.size() + prefix.size());
            number("EndFragment:", header.size() + prefix.size() + html.size());
            auto data = header + prefix + html + suffix;
            ok = ok && put(RegisterClipboardFormatW(L"HTML Format"), data.c_str(), data.size() + 1);
        }
        CloseClipboard();
        return ok;
    }
    void images(Json message, bool picker) {
        auto id = message["requestId"].str();
        Json paths = Json::Array{};
        std::string errorText;
        try {
            std::vector<std::string> bytes;
            if (picker) {
                auto chosen = pick(false, true);
                if (chosen)
                    bytes.push_back(readBytes(*chosen, 20 * 1024 * 1024));
            } else {
                auto items = message["images"].array();
                if (items.empty() || items.size() > 16)
                    throw std::runtime_error("이미지는 16개 이하로 삽입하세요");
                size_t total = 0;
                for (auto &b : items) {
                    total += b.str().size();
                    if (total > 28 * 1024 * 1024)
                        throw std::runtime_error("이미지 합계는 20MB 이하입니다");
                    bytes.push_back(base64(b.str()));
                }
            }
            if (!bytes.empty())
                paths = importImages(imageDocument(), bytes);
        } catch (const std::exception &e) {
            errorText = tr(e.what());
        }
        post(Json::object({{"type", "insertImages"},
                           {"requestId", id},
                           {"documentId", documentId},
                           {"paths", paths},
                           {"error", errorText}}));
        busy = false;
    }
    void execute(std::string name, std::string arg = {}) {
        if (!ready || busy) {
            if (name == "image" && !arg.empty())
                post(Json::object({{"type", "insertImages"},
                                   {"requestId", arg},
                                   {"documentId", documentId},
                                   {"paths", Json::Array{}},
                                   {"error", tr("다른 작업이 끝난 뒤 다시 삽입하세요")}}));
            return;
        }
        if (name == "openExample") {
            if (arg != "formatting" && arg != "layout" && arg != "mermaid") return;
            name = "openPath";
            arg = utf8((executableDirectory() / L"examples" / wide(uiLanguage) / wide(arg + ".md")).wstring());
        }
        busy = true;
        safe([&] {
            if (name == "save" || name == "saveAs")
                save(name == "saveAs", [this](bool) { busy = false; });
            else if (name == "new" || name == "open" || name == "openPath" || name == "close")
                canLeave([this, name, arg] {
                    safe([&] {
                        if (name == "close") {
                            RECT r;
                            GetWindowRect(hwnd, &r);
                            prefs["Width"] = r.right - r.left;
                            prefs["Height"] = r.bottom - r.top;
                            savePreferences(prefs);
                            clearRecovery();
                            closing = true;
                            DestroyWindow(hwnd);
                            return;
                        }
                        if (name == "new") {
                            path.clear();
                            fileHash = "";
                            newline = "\n";
                            bom = false;
                            original = "";
                            load(tr("# 새 문서\n\n"), true);
                            clearRecovery();
                        } else {
                            auto chosen =
                                name == "openPath" ? std::optional<fs::path>(wide(arg)) : pick(false);
                            if (chosen)
                                open(utf8(chosen->wstring()));
                        }
                        busy = false;
                    });
                });
            else if (name == "image") {
                if (arg.empty()) {
                    post(Json::object({{"type", "requestImage"}}));
                    busy = false;
                } else
                    images(Json::object({{"requestId", arg}}), true);
            } else if (name == "copyPath") {
                toast(clipboard(path.wstring()) ? "전체 경로를 복사했습니다"
                                                : "클립보드를 사용할 수 없습니다");
                busy = false;
            } else if (name == "theme") {
                prefs["Theme"] = prefs["Theme"].str() == "dark" ? "light" : "dark";
                savePreferences(prefs);
                configuration();
                busy = false;
            } else if (name == "recent" || name == "configuration" || name == "sidebar") {
                post(Json::object({{"type", "hostAction"}, {"name", name}}));
                busy = false;
            } else if (name == "find" || name == "toggleMode" || name == "undo" || name == "redo") {
                post(Json::object({{"type", name}}));
                busy = false;
            } else
                busy = false;
        });
    }
    void receive(Json m) {
        auto type = m["type"].str();
        if (type == "ready") {
            ready = true;
            begin();
            return;
        }
        if (type == "hostDialogResult") {
            auto it = dialogs.find(m["id"].str());
            if (it != dialogs.end()) {
                auto done = std::move(it->second.done);
                dialogs.erase(it);
                done(m);
            }
            return;
        }
        if (!m["documentId"].null() && m["documentId"].str() != documentId)
            return;
        if (type == "changed" || type == "snapshot") {
            if (m["revision"].num() >= current["revision"].num())
                current = m;
            if (type == "changed") {
                headings = m["headings"];
                status();
            } else {
                auto it = snapshots.find(m["requestId"].str());
                if (it != snapshots.end()) {
                    auto done = std::move(it->second.done);
                    snapshots.erase(it);
                    done(m);
                }
            }
        } else if (type == "cursor")
            post(Json::object({{"type", "hostCursor"}, {"headingId", m["headingId"]}}));
        else if (type == "command") {
            if (m["name"].str() == "externalLink") {
                auto url = m["url"].str();
                auto lower = url;
                std::transform(lower.begin(), lower.end(), lower.begin(),
                               [](unsigned char c) { return char(std::tolower(c)); });
                if (lower.starts_with("http://") || lower.starts_with("https://"))
                    ShellExecuteW(hwnd, L"open", wide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            } else
                execute(m["name"].str(), m["name"].str() == "image" ? m["requestId"].str() : m["path"].str());
        } else if (type == "importImages") {
            if (busy) {
                post(Json::object({{"type", "insertImages"},
                                   {"documentId", documentId},
                                   {"requestId", m["requestId"]},
                                   {"paths", Json::Array{}},
                                   {"error", tr("다른 작업이 끝난 뒤 다시 붙여넣으세요")}}));
            } else {
                busy = true;
                images(m, false);
            }
        } else if (type == "copyTable") {
            auto text = m["text"].str(), html = m["html"].str();
            if (text.size() + html.size() <= 10'000'000)
                toast(clipboard(wide(text), html) ? "선택한 셀을 복사했습니다"
                                                  : "클립보드를 사용할 수 없습니다");
        } else if (type == "hostPreferences") {
            for (auto key : {"BodyLineHeight", "OutlineLineHeight", "DocumentAlignment", "SidebarWidth", "Language"})
                if (!m["preferences"][key].null())
                    prefs[key] = m["preferences"][key];
            normalizePreferences(prefs);
            if (m["save"].boolean())
                savePreferences(prefs);
            configuration();
        }
    }
    void serve(ICoreWebView2WebResourceRequestedEventArgs *args) {
        Com<ICoreWebView2WebResourceRequest> req;
        args->get_Request(req.put());
        CoString uri;
        req->get_Uri(uri.put());
        auto url = uri.str();
        Com<ICoreWebView2WebResourceResponse> response;
        env->CreateWebResourceResponse(nullptr, 404, L"Not Found", L"Cache-Control: no-store",
                                       response.put());
        try {
            std::string prefix = "https://document.local/";
            if (url.starts_with(prefix)) {
                auto target = contained(imageDocument().parent_path(), url.substr(prefix.size()));
                auto ext = upper(target.extension().wstring());
                std::wstring mime = ext == L".PNG"                      ? L"image/png"
                                    : ext == L".JPG" || ext == L".JPEG" ? L"image/jpeg"
                                    : ext == L".GIF"                    ? L"image/gif"
                                    : ext == L".WEBP"                   ? L"image/webp"
                                    : ext == L".BMP"                    ? L"image/bmp"
                                    : ext == L".SVG"                    ? L"image/svg+xml"
                                                                        : L"";
                if (!mime.empty()) {
                    auto data = readBytes(target, 20 * 1024 * 1024);
                    Com<IStream> stream;
                    *stream.put() = SHCreateMemStream((BYTE *)data.data(), UINT(data.size()));
                    env->CreateWebResourceResponse(
                        stream.get(), 200, L"OK",
                        (L"Content-Type: " + mime +
                         L"\r\nCache-Control: no-store\r\nContent-Security-Policy: "
                         L"default-src 'none'; style-src "
                         L"'unsafe-inline'\r\nX-Content-Type-Options: nosniff")
                            .c_str(),
                        response.put());
                }
            }
        } catch (const std::exception &e) {
            logError(e.what());
        }
        args->put_Response(response.get());
    }
    void resize() {
        if (controller) {
            RECT r;
            GetClientRect(hwnd, &r);
            controller->put_Bounds(r);
        }
    }
    void initWeb() {
        auto dll = LoadLibraryExW((executableDirectory() / L"WebView2Loader.dll").c_str(), nullptr,
                                  LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
        check(dll != nullptr, "WebView2Loader.dll을 찾을 수 없습니다");
        using Create =
            HRESULT(STDMETHODCALLTYPE *)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *,
                                         ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);
        auto create = (Create)GetProcAddress(dll, "CreateCoreWebView2EnvironmentWithOptions");
        check(create != nullptr, "WebView2 초기화 실패");
        hrcheck(
            create(
                nullptr, (dataDirectory() / L"WebView2").c_str(), nullptr,
                callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                    [this](HRESULT hr, ICoreWebView2Environment *e) {
                        if (FAILED(hr)) {
                            defer([this] { error("WebView2 Runtime을 설치한 뒤 다시 실행해주세요"); });
                            return hr;
                        }
                        env.set(e);
                        return env->CreateCoreWebView2Controller(
                            hwnd,
                            callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                                [this](HRESULT hr, ICoreWebView2Controller *c) {
                                    if (FAILED(hr)) {
                                        defer([this] { error("편집기 창 생성 실패: 앱을 다시 실행해주세요"); });
                                        return hr;
                                    }
                                    controller.set(c);
                                    hrcheck(c->get_CoreWebView2(web.put()), "편집기 연결 실패");
                                    resize();
                                    Com<ICoreWebView2_3> web3;
                                    web.query(web3);
                                    if (!web3)
                                        throw std::runtime_error("WebView2 Runtime을 업데이트해주세요");
                                    hrcheck(web3->SetVirtualHostNameToFolderMapping(
                                                L"folio.local", (executableDirectory() / L"Web").c_str(),
                                                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS),
                                            "웹 자산 연결 실패");
                                    Com<ICoreWebView2Settings> settings;
                                    web->get_Settings(settings.put());
                                    settings->put_IsStatusBarEnabled(FALSE);
                                    settings->put_AreDefaultScriptDialogsEnabled(FALSE);
                                    settings->put_AreDevToolsEnabled(FALSE);
                                    settings->put_IsWebMessageEnabled(TRUE);
                                    EventRegistrationToken token;
                                    web->add_NavigationStarting(
                                        callback<ICoreWebView2NavigationStartingEventHandler>(
                                            [](ICoreWebView2 *, ICoreWebView2NavigationStartingEventArgs *a) {
                                                CoString u;
                                                a->get_Uri(u.put());
                                                if (!u.str().starts_with("https://folio.local/"))
                                                    a->put_Cancel(TRUE);
                                                return S_OK;
                                            })
                                            .get(),
                                        &token);
                                    web->add_NewWindowRequested(
                                        callback<ICoreWebView2NewWindowRequestedEventHandler>(
                                            [](ICoreWebView2 *, ICoreWebView2NewWindowRequestedEventArgs *a) {
                                                a->put_Handled(TRUE);
                                                return S_OK;
                                            })
                                            .get(),
                                        &token);
                                    web->add_PermissionRequested(
                                        callback<ICoreWebView2PermissionRequestedEventHandler>(
                                            [](ICoreWebView2 *,
                                               ICoreWebView2PermissionRequestedEventArgs *a) {
                                                a->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
                                                return S_OK;
                                            })
                                            .get(),
                                        &token);
                                    web->add_WebMessageReceived(
                                        callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                            [this](ICoreWebView2 *,
                                                   ICoreWebView2WebMessageReceivedEventArgs *a) {
                                                CoString src, body;
                                                a->get_Source(src.put());
                                                a->get_WebMessageAsJson(body.put());
                                                if (src.str().starts_with("https://folio.local/") &&
                                                    body.str().size() <= 30 * 1024 * 1024) {
                                                    auto text = body.str();
                                                    defer([this, text] {
                                                        safe([&] { receive(Json::parse(text)); });
                                                    });
                                                }
                                                return S_OK;
                                            })
                                            .get(),
                                        &token);
                                    web->AddWebResourceRequestedFilter(
                                        L"https://document.local/*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
                                    web->add_WebResourceRequested(
                                        callback<ICoreWebView2WebResourceRequestedEventHandler>(
                                            [this](ICoreWebView2 *,
                                                   ICoreWebView2WebResourceRequestedEventArgs *a) {
                                                serve(a);
                                                return S_OK;
                                            })
                                            .get(),
                                        &token);
                                    web->add_ProcessFailed(
                                        callback<ICoreWebView2ProcessFailedEventHandler>(
                                            [this](ICoreWebView2 *, ICoreWebView2ProcessFailedEventArgs *) {
                                                recovery();
                                                ready = false;
                                                defer([this] {
                                                    error("편집기 오류가 발생했습니다. "
                                                          "앱을 다시 열어 복구하세요.");
                                                });
                                                return S_OK;
                                            })
                                            .get(),
                                        &token);
                                    Com<ICoreWebView2_4> web4;
                                    web.query(web4);
                                    if (web4)
                                        web4->add_DownloadStarting(
                                            callback<ICoreWebView2DownloadStartingEventHandler>(
                                                [](ICoreWebView2 *,
                                                   ICoreWebView2DownloadStartingEventArgs *a) {
                                                    a->put_Cancel(TRUE);
                                                    return S_OK;
                                                })
                                                .get(),
                                            &token);
                                    return web->Navigate(wide("https://folio.local/index.html?native=1&lang=" + uiLanguage).c_str());
                                })
                                .get());
                    })
                    .get()),
            "WebView2 초기화 실패");
    }
    void tick() {
        auto now = GetTickCount64();
        for (auto it = snapshots.begin(); it != snapshots.end();) {
            if (now > it->second.expires) {
                it = snapshots.erase(it);
                busy = false;
                error("편집기 응답 시간이 초과되었습니다. 문서는 유지됩니다.");
            } else
                ++it;
        }
        static ULONGLONG lastRecovery = 0, lastCheck = 0;
        if (ready && !busy) {
            if (now - lastRecovery >= 3000) {
                lastRecovery = now;
                recovery();
            }
            if (!path.empty() && now - lastCheck >= 4000) {
                lastCheck = now;
                auto f = fingerprint(path);
                if (f != fileHash && f != lastExternal) {
                    lastExternal = f;
                    toast("파일이 외부에서 변경되었습니다. 저장 시 충돌을 확인합니다.");
                }
            }
        }
        if (startupComplete && !busy && !activations.empty()) {
            auto p = activations.front();
            activations.pop_front();
            broker.completed();
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
            if (!p.empty() && (path.empty() || !same(path, p)))
                execute("openPath", utf8(p));
        }
    }
};
LRESULT CALLBACK windowProc(HWND w, UINT m, WPARAM wp, LPARAM lp) {
    auto app = (App *)GetWindowLongPtrW(w, GWLP_USERDATA);
    if (m == WM_NCCREATE) {
        app = (App *)((CREATESTRUCTW *)lp)->lpCreateParams;
        app->hwnd = w;
        SetWindowLongPtrW(w, GWLP_USERDATA, (LONG_PTR)app);
    }
    if (!app)
        return DefWindowProcW(w, m, wp, lp);
    try {
        switch (m) {
        case WM_SIZE:
            app->resize();
            return 0;
        case WM_DPICHANGED: {
            auto r = (RECT *)lp;
            SetWindowPos(w, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top,
                         SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_GETMINMAXINFO:
            ((MINMAXINFO *)lp)->ptMinTrackSize = {850, 620};
            return 0;
        case WM_SETFOCUS:
            if (app->controller)
                app->controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            return 0;
        case WM_CLOSE:
            if (!app->ready) {
                DestroyWindow(w);
            } else
                app->execute("close");
            return 0;
        case WM_TIMER:
            app->safe([&] { app->tick(); });
            return 0;
        case ActivationMessage: {
            std::unique_ptr<std::wstring> p((std::wstring *)lp);
            if (app->activations.size() < 32)
                app->activations.push_back(*p);
            else
                app->broker.completed();
            return 0;
        }
        case DispatchMessageId: {
            std::unique_ptr<std::function<void()>> f((std::function<void()> *)lp);
            app->safe(*f);
            return 0;
        }
        case WM_DESTROY:
            KillTimer(w, 1);
            if (app->controller)
                app->controller->Close();
            PostQuitMessage(0);
            return 0;
        }
    } catch (const std::exception &e) {
        app->error(e.what());
    }
    return DefWindowProcW(w, m, wp, lp);
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
    try {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        hrcheck(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED), "COM 초기화 실패");
        fs::create_directories(dataDirectory());
        initializeLocalization(loadPreferences()["Language"].str());
        int argc = 0;
        LPWSTR *args = CommandLineToArgvW(GetCommandLineW(), &argc);
        std::wstring initial = argc > 1 ? args[1] : L"";
        LocalFree(args);
        if (!initial.empty() && initial != L"--smoke-test")
            initial = full(initial).wstring();
        Activation activation;
        bool isolated = GetEnvironmentVariableW(L"FOLIO_DATA_DIRECTORY", nullptr, 0) > 0;
        std::wstring mutexName = isolated ? L"Local\\Folio.MarkdownEditor.Diagnostics." + activation.scope
                                          : L"Local\\Folio.MarkdownEditor";
        Handle mutex(CreateMutexW(nullptr, TRUE, mutexName.c_str()));
        if (GetLastError() == ERROR_ALREADY_EXISTS)
            return activation.forward(initial) ? 0 : 1;
        App app(initial, activation);
        WNDCLASSEXW wc{sizeof(wc)};
        wc.lpfnWndProc = windowProc;
        wc.hInstance = instance;
        wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
        wc.hIconSm = wc.hIcon;
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.hbrBackground = (HBRUSH)GetStockObject(WHITE_BRUSH);
        wc.lpszClassName = L"Folio.Native.Window";
        check(RegisterClassExW(&wc), "창 등록 실패");
        HWND window = CreateWindowExW(0, wc.lpszClassName, L"Folio — Markdown Editor", WS_OVERLAPPEDWINDOW,
                                      CW_USEDEFAULT, CW_USEDEFAULT, int(app.prefs["Width"].num(1280)),
                                      int(app.prefs["Height"].num(860)), nullptr, nullptr, instance, &app);
        check(window != nullptr, "창 생성 실패");
        DWM_WINDOW_CORNER_PREFERENCE corners = DWMWCP_DONOTROUND;
        DwmSetWindowAttribute(window, DWMWA_WINDOW_CORNER_PREFERENCE, &corners, sizeof(corners));
        activation.start(window);
        ShowWindow(window, show);
        SetTimer(window, 1, 200, nullptr);
        app.initWeb();
        MSG msg;
        while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        return int(msg.wParam);
    } catch (const std::exception &e) {
        logError(e.what());
        MessageBoxW(nullptr, wide(tr(e.what())).c_str(), L"Folio", MB_OK | MB_ICONERROR);
        return 1;
    }
}
