#pragma once
#include <charconv>
#include <cmath>
#include <cstdio>
#include <map>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

// Deliberately small JSON value for the existing host protocol and profile
// files. Parsing is bounded and rejects malformed numbers, duplicate keys and
// surrogates.
struct Json {
    using Object = std::map<std::string, Json>;
    using Array = std::vector<Json>;
    std::variant<std::nullptr_t, bool, double, std::string, Array, Object> value = nullptr;
    Json() = default;
    Json(std::nullptr_t) {}
    Json(bool v) : value(v) {}
    Json(int v) : value(double(v)) {}
    Json(long v) : value(double(v)) {}
    Json(long long v) : value(double(v)) {}
    Json(double v) : value(v) {}
    Json(const char *v) : value(std::string(v)) {}
    Json(std::string v) : value(std::move(v)) {}
    Json(Array v) : value(std::move(v)) {}
    Json(Object v) : value(std::move(v)) {}
    static Json object(std::initializer_list<Object::value_type> v) { return Object(v); }
    bool null() const { return std::holds_alternative<std::nullptr_t>(value); }
    std::string str(std::string fallback = {}) const {
        auto p = std::get_if<std::string>(&value);
        return p ? *p : fallback;
    }
    double num(double fallback = 0) const {
        auto p = std::get_if<double>(&value);
        return p ? *p : fallback;
    }
    bool boolean(bool fallback = false) const {
        auto p = std::get_if<bool>(&value);
        return p ? *p : fallback;
    }
    const Array &array() const {
        static const Array empty;
        auto p = std::get_if<Array>(&value);
        return p ? *p : empty;
    }
    const Json &operator[](const std::string &key) const {
        static const Json empty;
        auto p = std::get_if<Object>(&value);
        if (p) {
            auto i = p->find(key);
            if (i != p->end())
                return i->second;
        }
        return empty;
    }
    Json &operator[](const std::string &key) {
        if (!std::holds_alternative<Object>(value))
            value = Object{};
        return std::get<Object>(value)[key];
    }
    static void utf8(std::string &out, unsigned cp) {
        if (cp < 0x80)
            out += char(cp);
        else if (cp < 0x800) {
            out += char(0xc0 | (cp >> 6));
            out += char(0x80 | (cp & 63));
        } else if (cp < 0x10000) {
            out += char(0xe0 | (cp >> 12));
            out += char(0x80 | ((cp >> 6) & 63));
            out += char(0x80 | (cp & 63));
        } else {
            out += char(0xf0 | (cp >> 18));
            out += char(0x80 | ((cp >> 12) & 63));
            out += char(0x80 | ((cp >> 6) & 63));
            out += char(0x80 | (cp & 63));
        }
    }
    std::string dump() const {
        if (null())
            return "null";
        if (auto p = std::get_if<bool>(&value))
            return *p ? "true" : "false";
        if (auto p = std::get_if<double>(&value)) {
            if (!std::isfinite(*p))
                throw std::runtime_error("Non-finite JSON number");
            char b[64];
            auto r = std::to_chars(b, b + 64, *p);
            return std::string(b, r.ptr);
        }
        if (auto p = std::get_if<std::string>(&value)) {
            std::string s = "\"";
            for (unsigned char c : *p) {
                if (c == '"' || c == '\\') {
                    s += '\\';
                    s += char(c);
                } else if (c < 32) {
                    char b[7];
                    std::snprintf(b, 7, "\\u%04x", c);
                    s += b;
                } else
                    s += char(c);
            }
            return s + '"';
        }
        std::string s;
        if (auto p = std::get_if<Array>(&value)) {
            s = "[";
            for (auto &v : *p) {
                if (s.size() > 1)
                    s += ',';
                s += v.dump();
            }
            return s + "]";
        }
        s = "{";
        for (auto &[k, v] : std::get<Object>(value)) {
            if (s.size() > 1)
                s += ',';
            s += Json(k).dump() + ":" + v.dump();
        }
        return s + "}";
    }
    static Json parse(const std::string &input) {
        struct Parser {
            const std::string &s;
            size_t i = 0;
            [[noreturn]] void fail() { throw std::runtime_error("Invalid JSON"); }
            void ws() {
                while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t'))
                    i++;
            }
            bool take(char c) {
                ws();
                if (i < s.size() && s[i] == c) {
                    i++;
                    return true;
                }
                return false;
            }
            unsigned hex() {
                unsigned v = 0;
                for (int n = 0; n < 4; n++) {
                    if (i >= s.size())
                        fail();
                    char c = s[i++];
                    v <<= 4;
                    if (c >= '0' && c <= '9')
                        v += c - '0';
                    else if (c >= 'a' && c <= 'f')
                        v += c - 'a' + 10;
                    else if (c >= 'A' && c <= 'F')
                        v += c - 'A' + 10;
                    else
                        fail();
                }
                return v;
            }
            std::string string() {
                if (!take('"'))
                    fail();
                std::string out;
                while (i < s.size()) {
                    unsigned char c = s[i++];
                    if (c == '"')
                        return out;
                    if (c < 32)
                        fail();
                    if (c != '\\') {
                        out += char(c);
                        continue;
                    }
                    if (i >= s.size())
                        fail();
                    switch (s[i++]) {
                    case '"':
                        out += '"';
                        break;
                    case '\\':
                        out += '\\';
                        break;
                    case '/':
                        out += '/';
                        break;
                    case 'b':
                        out += '\b';
                        break;
                    case 'f':
                        out += '\f';
                        break;
                    case 'n':
                        out += '\n';
                        break;
                    case 'r':
                        out += '\r';
                        break;
                    case 't':
                        out += '\t';
                        break;
                    case 'u': {
                        unsigned cp = hex();
                        if (cp >= 0xd800 && cp <= 0xdbff) {
                            if (i + 2 > s.size() || s[i++] != '\\' || s[i++] != 'u')
                                fail();
                            unsigned lo = hex();
                            if (lo < 0xdc00 || lo > 0xdfff)
                                fail();
                            cp = 0x10000 + ((cp - 0xd800) << 10) + lo - 0xdc00;
                        } else if (cp >= 0xdc00 && cp <= 0xdfff)
                            fail();
                        Json::utf8(out, cp);
                        break;
                    }
                    default:
                        fail();
                    }
                }
                fail();
            }
            Json read(int depth = 0) {
                if (depth > 64)
                    fail();
                ws();
                if (i >= s.size())
                    fail();
                if (s[i] == '"')
                    return string();
                if (take('{')) {
                    Object o;
                    if (take('}'))
                        return o;
                    do {
                        auto k = string();
                        if (!take(':'))
                            fail();
                        if (!o.emplace(k, read(depth + 1)).second)
                            fail();
                    } while (take(','));
                    if (!take('}'))
                        fail();
                    return o;
                }
                if (take('[')) {
                    Array a;
                    if (take(']'))
                        return a;
                    do {
                        a.push_back(read(depth + 1));
                    } while (take(','));
                    if (!take(']'))
                        fail();
                    return a;
                }
                for (auto [lit, v] :
                     {std::pair<const char *, Json>{"true", true}, {"false", false}, {"null", nullptr}}) {
                    size_t n = std::char_traits<char>::length(lit);
                    if (s.compare(i, n, lit) == 0) {
                        i += n;
                        return v;
                    }
                }
                size_t start = i;
                if (s[i] == '-')
                    i++;
                if (i >= s.size())
                    fail();
                if (s[i] == '0')
                    i++;
                else {
                    if (s[i] < '1' || s[i] > '9')
                        fail();
                    while (i < s.size() && s[i] >= '0' && s[i] <= '9')
                        i++;
                }
                if (i < s.size() && s[i] == '.') {
                    i++;
                    size_t b = i;
                    while (i < s.size() && s[i] >= '0' && s[i] <= '9')
                        i++;
                    if (i == b)
                        fail();
                }
                if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
                    i++;
                    if (i < s.size() && (s[i] == '+' || s[i] == '-'))
                        i++;
                    size_t b = i;
                    while (i < s.size() && s[i] >= '0' && s[i] <= '9')
                        i++;
                    if (i == b)
                        fail();
                }
                double v = 0;
                auto r = std::from_chars(s.data() + start, s.data() + i, v);
                if (r.ec != std::errc() || !std::isfinite(v))
                    fail();
                return v;
            }
        } p{input};
        auto v = p.read();
        p.ws();
        if (p.i != input.size())
            p.fail();
        return v;
    }
};
