#pragma once
#include "platform.h"
#include <atomic>
#include <sddl.h>
#include <thread>
constexpr UINT ActivationMessage = WM_APP + 1;
class Activation {
    std::wstring pipe;
    Handle stop{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    std::thread worker;
    HWND window = nullptr;
    std::atomic<unsigned> pending{0};
    bool transfer(HANDLE h, void *p, DWORD n, bool write, DWORD timeout) {
        DWORD offset = 0;
        const auto deadline = GetTickCount64() + timeout;
        while (offset < n) {
            Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
            OVERLAPPED op{};
            op.hEvent = event;
            DWORD done = 0;
            BOOL ok = write ? WriteFile(h, (BYTE *)p + offset, n - offset, &done, &op)
                            : ReadFile(h, (BYTE *)p + offset, n - offset, &done, &op);
            if (!ok && GetLastError() == ERROR_IO_PENDING) {
                HANDLE events[]{stop.h, event.h};
                const auto now = GetTickCount64();
                if (WaitForMultipleObjects(2, events, FALSE, now < deadline ? DWORD(deadline - now) : 0) !=
                    WAIT_OBJECT_0 + 1) {
                    CancelIoEx(h, &op);
                    GetOverlappedResult(h, &op, &done, TRUE);
                    return false;
                }
                ok = GetOverlappedResult(h, &op, &done, FALSE);
            }
            if (!ok || !done)
                return false;
            offset += done;
        }
        return true;
    }

  public:
    void completed() { --pending; }
    std::wstring scope;
    Activation() {
        scope = wide(hash(utf8(upper(full(dataDirectory()).wstring()))).substr(0, 24));
        pipe = L"\\\\.\\pipe\\Folio.Activation." + scope;
    }
    ~Activation() {
        SetEvent(stop);
        if (worker.joinable())
            worker.join();
    }
    bool forward(const std::wstring &path) {
        for (int i = 0; i < 80; i++) {
            Handle h(CreateFileW(pipe.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
                                 FILE_FLAG_OVERLAPPED, nullptr));
            if (h.h != INVALID_HANDLE_VALUE) {
                auto s = utf8(path);
                DWORD n = DWORD(s.size());
                BYTE ack = 0;
                return n <= 32768 && transfer(h, &n, 4, true, 2000) && transfer(h, s.data(), n, true, 2000) &&
                       transfer(h, &ack, 1, false, 2000) && ack == 1;
            }
            Sleep(100);
        }
        return false;
    }
    void start(HWND w) {
        window = w;
        worker = std::thread([this] {
            try {
                Handle token;
                check(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token.h), "사용자 확인 실패");
                DWORD n = 0;
                GetTokenInformation(token, TokenUser, nullptr, 0, &n);
                std::vector<BYTE> data(n);
                check(GetTokenInformation(token, TokenUser, data.data(), n, &n), "사용자 확인 실패");
                LPWSTR sid = nullptr;
                check(ConvertSidToStringSidW(((TOKEN_USER *)data.data())->User.Sid, &sid),
                      "사용자 확인 실패");
                std::wstring dacl = L"D:P(A;;GA;;;" + std::wstring(sid) + L")";
                LocalFree(sid);
                PSECURITY_DESCRIPTOR sd = nullptr;
                check(ConvertStringSecurityDescriptorToSecurityDescriptorW(dacl.c_str(), SDDL_REVISION_1, &sd,
                                                                           nullptr),
                      "사용자 파이프 보안 설정 실패");
                SECURITY_ATTRIBUTES sa{sizeof(sa), sd, FALSE};
                while (WaitForSingleObject(stop, 0) != WAIT_OBJECT_0) {
                    Handle h(CreateNamedPipeW(pipe.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
                                              PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT |
                                                  PIPE_REJECT_REMOTE_CLIENTS,
                                              1, 32768, 32768, 0, &sa));
                    if (h.h == INVALID_HANDLE_VALUE)
                        break;
                    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
                    OVERLAPPED op{};
                    op.hEvent = event;
                    BOOL connected = ConnectNamedPipe(h, &op);
                    DWORD error = GetLastError();
                    if (!connected && error == ERROR_IO_PENDING) {
                        HANDLE events[]{stop.h, event.h};
                        if (WaitForMultipleObjects(2, events, FALSE, INFINITE) == WAIT_OBJECT_0) {
                            CancelIoEx(h, &op);
                            DWORD done;
                            GetOverlappedResult(h, &op, &done, TRUE);
                            break;
                        }
                        DWORD done;
                        connected = GetOverlappedResult(h, &op, &done, FALSE);
                    } else if (error == ERROR_PIPE_CONNECTED)
                        connected = TRUE;
                    DWORD len = 0;
                    if (connected && transfer(h, &len, 4, false, 5000) && len <= 32768) {
                        std::string bytes(len, 0);
                        if (transfer(h, bytes.data(), len, false, 5000)) {
                            try {
                                auto request = std::make_unique<std::wstring>(wide(bytes));
                                if (pending.load() >= 32)
                                    continue;
                                ++pending;
                                if (PostMessageW(window, ActivationMessage, 0, (LPARAM)request.get())) {
                                    request.release();
                                    BYTE ack = 1;
                                    transfer(h, &ack, 1, true, 1000);
                                    // Wait for the client to consume ACK/close before disconnecting.
                                    BYTE end;
                                    transfer(h, &end, 1, false, 1000);
                                } else
                                    --pending;
                            } catch (...) {
                            }
                        }
                    }
                    DisconnectNamedPipe(h);
                }
                LocalFree(sd);
            } catch (const std::exception &error) {
                logError(error.what());
            }
        });
    }
};
