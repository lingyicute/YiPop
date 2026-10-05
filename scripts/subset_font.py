#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nebulove 字体子集化 & 内嵌

  pip install fonttools brotli
  
  python3 scripts/subset_font.py                     # 就地
  python3 scripts/subset_font.py --check             # 只报告，不写入
  python3 scripts/subset_font.py --all-text          # 保守模式：文件里出现的字符全收
  python3 scripts/subset_font.py --extra-chars glyphs.txt
"""
import argparse, base64, io, os, re, sys, urllib.request
FONT_URL = "https://raw.githubusercontent.com/lingyicute/Nebulove/main/Nebulove.woff2"
FALLBACK_URL = "https://nebulove.92li.uk/Nebulove.woff2"   # 页面原有来源，作为回退
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_HTML = os.path.join(os.path.dirname(HERE), "index.html")
ASCII = {chr(c) for c in range(32, 127)}
PUNCT = set("：，。！？；‘’“”（）【】—…·《》×＝÷＋－、")

FONT_FACE_RE = re.compile(r'@font-face\s*\{[^}]*\}', re.S)


def strip_non_render_text(html):
    """剔除不会渲染的文字：HTML 注释、<style>、<script> 里的注释。"""
    html = re.sub(r'<!--.*?-->', '', html, flags=re.S)
    html = re.sub(r'<style\b[^>]*>.*?</style>', '', html, flags=re.S | re.I)

    def _js(m):
        s = re.sub(r'/\*.*?\*/', ' ', m.group(1), flags=re.S)      # 块注释
        s = re.sub(r'(?m)^[ \t]*//.*$', ' ', s)                    # 行注释
        return s

    return re.sub(r'<script\b[^>]*>(.*?)</script>', _js, html, flags=re.S | re.I)


def collect_chars(html, all_text=False, extra=""):
    if all_text:
        chars = set(html)
    else:
        chars = set(strip_non_render_text(html))
    chars |= ASCII | PUNCT | set(extra)
    chars.discard("\n")
    chars.discard("\r")
    chars.discard("\t")
    return chars


def build_subset(chars, ttf_path):
    from fontTools.ttLib import TTFont
    from fontTools.subset import Subsetter, Options

    font = TTFont(ttf_path)
    subsetter = Subsetter(options=Options())
    subsetter.populate(text="".join(sorted(chars)))
    subsetter.subset(font)
    font.flavor = "woff2"
    buf = io.BytesIO()
    font.save(buf)
    data = buf.getvalue()
    covered = set(font.getBestCmap().keys())
    return data, covered


def download(url, path):
    with urllib.request.urlopen(url, timeout=60) as r, open(path, "wb") as f:
        f.write(r.read())


def make_font_face(b64, woff_kb, b64_kb, count, mode):
    return (
        "/* ===== Nebulove 子集（内嵌，离线可用）=====\n"
        "   由 scripts/subset_font.py 生成：只保留本页会用到的 %d 个字形（%s 模式）。\n"
        "   1.25 MB woff2 → %.1f KB woff2（base64 后 %.1f KB），随页面一起加载、无网络请求。\n"
        "   第二阶段 url 是页面原有的远程地址，仅当 data URI 不可用时兜底。 ===== */\n"
        '@font-face {\n'
        "  font-family: 'Nebulove';\n"
        '  src: url("data:font/woff2;charset=utf-8;base64,%s") format("woff2"),\n'
        '       url("%s") format("woff2");\n'
        "  font-weight: normal;\n"
        "  font-style: normal;\n"
        "  font-display: swap;\n"
        "}" % (count, mode, woff_kb, b64_kb, b64, FALLBACK_URL)
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default=DEFAULT_HTML)
    ap.add_argument("--font-url", default=FONT_URL)
    ap.add_argument("--ttf", help="本地字体路径（不下载）；默认下载 Nebulove.woff2")
    ap.add_argument("--extra-chars", help="追加字符集合所在的文本文件")
    ap.add_argument("--all-text", action="store_true", help="保守模式：文件里出现的字符全收")
    ap.add_argument("--check", action="store_true", help="只报告，不写入")
    args = ap.parse_args()

    if not os.path.exists(args.html):
        sys.exit("找不到页面文件：%s" % args.html)
    html = open(args.html, encoding="utf-8").read()
    if not FONT_FACE_RE.search(html):
        sys.exit("页面里没有找到 @font-face 块，无法替换。")

    extra = ""
    if args.extra_chars:
        extra = open(args.extra_chars, encoding="utf-8").read()

    chars = collect_chars(html, all_text=args.all_text, extra=extra)
    mode = "全文本" if args.all_text else "可渲染文本"
    print("需要保留的字符：%d 个（%s）" % (len(chars), mode))

    ttf = args.ttf or "/tmp/Nebulove.woff2"
    if not args.ttf:
        print("下载完整字体：%s" % args.font_url)
        download(args.font_url, ttf)
    print("完整字体：%.0f KB（%s）" % (os.path.getsize(ttf) / 1024, os.path.basename(ttf)))

    wofl, covered = build_subset(chars, ttf)
    missing = {c for c in chars if ord(c) not in covered}
    print("子集：%.2f KB woff2（%.1f%% 于原字体）" % (len(wofl) / 1024, len(wofl) / 1275924 * 100))
    if missing:
        print("⚠️ 字体本身不含这些字符（将回退到系统字体）：%s" %
              " ".join("U+%04X" % ord(c) for c in sorted(missing)))

    keep = os.path.join(HERE, "Nebulove-subset.woff2")
    open(keep, "wb").write(wofl)
    print("子集文件：%s" % keep)

    if args.check:
        print("--check：不写入页面。")
        return
    b64 = base64.b64encode(wofl).decode("ascii")
    new_face = make_font_face(b64, len(wofl) / 1024, len(b64) / 1024, len(covered), mode)
    new_html, n = FONT_FACE_RE.subn(new_face, html, count=1)
    if new_html == html:
        print("页面已经是目标内容，未改动。")
        return
    open(args.html, "w", encoding="utf-8").write(new_html)
    print("已更新 %s（@font-face 替换 %d 处）" % (args.html, n))
    print("页面大小：%.0f KB → %.0f KB" % (len(html.encode()) / 1024, len(new_html.encode()) / 1024))


if __name__ == "__main__":
    main()
