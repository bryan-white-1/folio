    std::string documentName() const {
        return path.empty() ? tr(textMode ? "제목 없음.txt" : "제목 없음.md") : utf8(path.filename().wstring());
    }
    void park() {
        if (documentId == "welcome" && !current["dirty"].boolean()) return;
        if (!documents.contains(documentId)) tabOrder.push_back(documentId);
        documents[documentId] = static_cast<DocumentState &>(*this);
    }
    Json tabs() {
        Json::Array result;
        for (const auto &id : tabOrder) {
            auto &d = documents.at(id);
            result.push_back(Json::object({{"id", id}, {"path", utf8(d.path.wstring())},
                {"name", d.path.empty() ? tr(d.textMode ? "제목 없음.txt" : "제목 없음.md") : utf8(d.path.filename().wstring())},
                {"dirty", d.current["dirty"]}, {"kind", d.textMode ? "text" : "markdown"},
                {"external", d.fileHash != d.lastExternal}}));
        }
        return result;
    }
    void displayDocument(bool resume, std::function<void()> next = {}) {
        loaded = std::move(next); loadDeadline = GetTickCount64() + 15000;
        Json message = current;
        message["type"] = "load"; message["documentId"] = documentId; message["name"] = documentName();
        message["kind"] = textMode ? "text" : "markdown"; message["session"] = true; message["resume"] = resume;
        message["bom"] = bom; message["newline"] = newline;
        post(message); status();
    }
    void activate(const std::string &id, std::function<void()> next = {}) {
        if (id == documentId) { if (next) next(); else busy = false; return; }
        park();
        auto it = documents.find(id);
        if (it == documents.end()) { busy = false; return; }
        static_cast<DocumentState &>(*this) = it->second;
        displayDocument(true, std::move(next));
    }
    void removeActive() {
        const auto id = documentId;
        auto it = std::find(tabOrder.begin(), tabOrder.end(), id);
        const auto index = size_t(it - tabOrder.begin());
        if (it != tabOrder.end()) tabOrder.erase(it);
        documents.erase(id);
        if (tabOrder.empty()) {
            static_cast<DocumentState &>(*this) = DocumentState{};
            textMode = true; load("", false);
        } else {
            const auto next = tabOrder[std::min(index, tabOrder.size() - 1)];
            static_cast<DocumentState &>(*this) = documents.at(next); displayDocument(true);
        }
        post(Json::object({{"type", "discardSession"}, {"id", id}}));
        recovery();
    }
    void processDocuments(std::vector<std::string> ids, size_t index, bool exiting, std::string originalId) {
        if (index == ids.size()) {
            if (exiting) {
                RECT r; GetWindowRect(hwnd, &r); prefs["Width"] = r.right-r.left; prefs["Height"] = r.bottom-r.top; savePreferences(prefs);
                std::error_code ec; fs::remove(dataDirectory() / L"recovery.json", ec);
                if (ec) { busy = false; error("복구 기록 정리 실패"); return; }
                closing = true; DestroyWindow(hwnd);
            } else activate(originalId);
            return;
        }
        auto id = ids[index];
        if (!documents.contains(id) || !documents.at(id).current["dirty"].boolean()) {
            processDocuments(ids, index + 1, exiting, originalId); return;
        }
        activate(id, [this, ids, index, exiting, originalId] {
            auto next = [this, ids, index, exiting, originalId] {
                snapshot([this, ids, index, exiting, originalId](Json) { park(); processDocuments(ids, index + 1, exiting, originalId); });
            };
            if (exiting) canLeave(next);
            else save(false, [this, next](bool ok) { if (ok) next(); else busy = false; });
        });
    }
    void recoverDocuments(Json recoveryData, std::function<void()> next) {
        ask("저장하지 않은 문서", tr("이전 실행에서 저장하지 않은 문서가 있습니다."), {"복구", "삭제", "앱 닫기"},
            [this, recoveryData, next](int choice) { safe([&] {
                if (choice == 0) {
                    workspaceRoot = wide(recoveryData["Root"].str());
                    for (const auto &r : recoveryData["Documents"].array()) {
                        DocumentState d; d.documentId = guid(); d.path = wide(r["Path"].str());
                        d.fileHash = r["Fingerprint"].str(); d.lastExternal = d.fileHash; d.newline = r["NewLine"].str("\n"); d.bom = r["Bom"].boolean();
                        d.textMode = r["TextMode"].boolean(); d.current = r["Snapshot"];
                        d.current["text"] = r["Text"]; d.current["dirty"] = true; d.current["documentId"] = d.documentId; d.current["revision"] = 0;
                        auto asset = r["AssetId"].str();
                        if (asset.size() == 32 && asset.find_first_not_of("0123456789abcdefABCDEF") == std::string::npos) d.assetId = asset;
                        documents[d.documentId] = d; tabOrder.push_back(d.documentId);
                    }
                    if (!tabOrder.empty()) { static_cast<DocumentState &>(*this) = documents.at(tabOrder.back()); busy = true; displayDocument(false, [this, next] { busy = false; next(); }); }
                    else next();
                } else if (choice == 1) {
                    std::error_code ec; fs::remove(dataDirectory() / L"recovery.json", ec);
                    if (ec) throw std::runtime_error("복구 기록 정리 실패"); next();
                } else { closing = true; DestroyWindow(hwnd); }
            }); });
    }
    std::optional<fs::path> pickFolder() {
        Com<IFileOpenDialog> dialog;
        hrcheck(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, __uuidof(IFileOpenDialog), (void **)dialog.put()), "열기 창 생성 실패");
        DWORD flags; dialog->GetOptions(&flags); dialog->SetOptions(flags | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR);
        dialog->SetTitle(wide(tr("폴더 열기")).c_str());
        if (!workspaceRoot.empty()) { Com<IShellItem> dir; if (SUCCEEDED(SHCreateItemFromParsingName(workspaceRoot.c_str(), nullptr, __uuidof(IShellItem), (void **)dir.put()))) dialog->SetFolder(dir.get()); }
        auto result = dialog->Show(hwnd); if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return {};
        hrcheck(result, "파일 선택 실패"); Com<IShellItem> item; hrcheck(dialog->GetResult(item.put()), "파일 선택 실패"); CoString p; hrcheck(item->GetDisplayName(SIGDN_FILESYSPATH, p.put()), "파일 경로 확인 실패"); return full(p.p);
    }
    void listFolder(const Json &request) {
        Json::Array entries; std::string errorText;
        try {
            if (workspaceRoot.empty()) throw std::runtime_error("폴더를 먼저 열어주세요.");
            auto dir = full(wide(request["path"].str()));
            auto root = fs::canonical(workspaceRoot), resolved = fs::canonical(dir);
            auto prefix = upper(root.wstring()); if (!prefix.ends_with(L"\\")) prefix += L"\\";
            if (!same(root, resolved) && !upper(resolved.wstring()).starts_with(prefix)) throw std::runtime_error("프로젝트 폴더 밖은 탐색할 수 없습니다.");
            for (const auto &entry : fs::directory_iterator(resolved)) {
                auto name = entry.path().filename().wstring(); auto attrs = GetFileAttributesW(entry.path().c_str());
                if (attrs == INVALID_FILE_ATTRIBUTES) continue;
                bool directory = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0, link = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
                auto upperName = upper(name);
                bool excluded = directory && (upperName == L".GIT" || upperName == L"NODE_MODULES" || upperName == L"DIST" || upperName == L"BUILD" || upperName == L".TOOLS" || upperName == L"BIN" || upperName == L"OBJ");
                if (excluded && !request["showExcluded"].boolean()) continue;
                entries.push_back(Json::object({{"name", utf8(name)}, {"path", utf8(entry.path().wstring())}, {"directory", directory}, {"link", link}}));
                if (entries.size() == 5000) { errorText = tr("항목 5,000개까지만 표시합니다."); break; }
            }
            std::sort(entries.begin(), entries.end(), [](const Json &a, const Json &b) {
                if (a["directory"].boolean() != b["directory"].boolean()) return a["directory"].boolean();
                return upper(wide(a["name"].str())) < upper(wide(b["name"].str()));
            });
        } catch (const std::exception &e) { errorText = tr(e.what()); }
        post(Json::object({{"type", "folderEntries"}, {"path", request["path"]}, {"requestId", request["requestId"]}, {"root", utf8(workspaceRoot.wstring())}, {"entries", entries}, {"error", errorText}}));
    }
