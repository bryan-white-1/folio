#pragma once
#include "platform.h"
#include <WebView2.h>
#include <atomic>
#ifdef __MINGW32__
#include "webview-uuid.h"
#endif
template <class T> class Com {
    T *p = nullptr;

  public:
    Com() = default;
    explicit Com(T *v) : p(v) {
        if (p)
            p->AddRef();
    }
    ~Com() {
        if (p)
            p->Release();
    }
    Com(const Com &) = delete;
    Com &operator=(const Com &) = delete;
    Com(Com &&v) noexcept : p(v.p) { v.p = nullptr; }
    T *get() const { return p; }
    T *operator->() const { return p; }
    explicit operator bool() const { return p != nullptr; }
    T **put() {
        if (p)
            p->Release();
        p = nullptr;
        return &p;
    }
    void set(T *v) {
        if (v)
            v->AddRef();
        if (p)
            p->Release();
        p = v;
    }
    void reset() {
        if (p)
            p->Release();
        p = nullptr;
    }
    template <class U> void query(Com<U> &out) {
        if (p)
            p->QueryInterface(__uuidof(U), (void **)out.put());
    }
};
template <class I, class F, class Signature> struct Callback;
template <class I, class F, class... A> struct Callback<I, F, HRESULT (STDMETHODCALLTYPE I::*)(A...)> : I {
    std::atomic<ULONG> refs{1};
    F fn;
    explicit Callback(F f) : fn(std::move(f)) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void **p) override {
        if (!p)
            return E_POINTER;
        if (id == __uuidof(I) || id == __uuidof(IUnknown)) {
            *p = static_cast<I *>(this);
            AddRef();
            return S_OK;
        }
        *p = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs; }
    ULONG STDMETHODCALLTYPE Release() override {
        auto n = --refs;
        if (!n)
            delete this;
        return n;
    }
    HRESULT STDMETHODCALLTYPE Invoke(A... a) override {
        try {
            return fn(a...);
        } catch (const std::exception &e) {
            logError(e.what());
            return E_FAIL;
        } catch (...) {
            return E_FAIL;
        }
    }
};
template <class I, class F> Com<I> callback(F fn) {
    auto p = new Callback<I, F, decltype(&I::Invoke)>(std::move(fn));
    Com<I> out(p);
    p->Release();
    return out;
}
struct CoString {
    LPWSTR p = nullptr;
    ~CoString() { CoTaskMemFree(p); }
    LPWSTR *put() { return &p; }
    std::string str() const { return p ? utf8(p) : ""; }
};
inline void hrcheck(HRESULT hr, const char *text) {
    if (FAILED(hr))
        throw std::runtime_error(std::string(text) + " (HRESULT " + std::to_string(hr) + ")");
}
