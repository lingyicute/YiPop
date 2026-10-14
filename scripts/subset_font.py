#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Nebulove 字体子集化 & 内嵌（页面保持离线、无运行时网络请求）。

  pip install -r requirements-dev.txt
  python3 scripts/subset_font.py                     # 原子更新页面
  python3 scripts/subset_font.py --check             # 报告，不写页面或子集文件
  python3 scripts/subset_font.py --all-text          # 保守模式
  python3 scripts/subset_font.py --extra-chars glyphs.txt
  python3 scripts/subset_font.py --ttf Nebulove.woff2 # 本地完整字体，不下载
"""
import argparse
import base64
from html.parser import HTMLParser
import io
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.request

FONT_URL = "https://raw.githubusercontent.com/lingyicute/Nebulove/main/Nebulove.woff2"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_HTML = os.path.join(os.path.dirname(HERE), "index.html")
ASCII = {chr(c) for c in range(32, 127)}
PUNCT = set("：，。！？；‘’“”（）【】—…·《》×＝÷＋－、")
FONT_FACE_RE = re.compile(r'@font-face\s*\{[^}]*\}', re.S | re.I)
FAMILY_RE = re.compile(r"font-family\s*:\s*(['\"]?)Nebulove\1\s*;", re.I)
GENERATED_COMMENT_RE = re.compile(
    r'/\* ===== Nebulove 子集（内嵌，离线可用）=====(?:(?!\*/).)*\*/\s*$', re.S
)
# 先匹配字符串，避免把 URL 或文案里的 /* ... */ 当成注释。
JS_TOKEN_RE = re.compile(
    r'''("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|/\*.*?\*/|//[^\r\n]*''',
    re.S,
)


class RenderTextParser(HTMLParser):
    """保守收集文本与属性；JS 字符串采用词法近似，可用 --all-text 兜底。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.mode = None
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script"):
            self.mode = tag
        self.parts.extend(value for _, value in attrs if value)

    def handle_endtag(self, tag):
        if tag == self.mode:
            self.mode = None

    def handle_data(self, data):
        if self.mode == "style":
            # CSS 生成内容也可能包含需要内嵌的字形。
            self.parts.extend(re.findall(r'''content\s*:\s*["'](.*?)["']''', data, re.S))
        elif self.mode == "script":
            self.parts.append(JS_TOKEN_RE.sub(lambda m: m.group(1) or " ", data))
        else:
            self.parts.append(data)


def strip_non_render_text(html):
    parser = RenderTextParser()
    parser.feed(html)
    parser.close()
    return "".join(parser.parts)


def collect_chars(html, all_text=False, extra=""):
    text = html if all_text else strip_non_render_text(html)
    chars = set(text) | ASCII | PUNCT | set(extra)
    return chars - set("\n\r\t")


def build_subset(chars, font_path):
    from fontTools.ttLib import TTFont
    from fontTools.subset import Subsetter, Options

    # 保留源字体时间戳，确保同一输入在重复运行时产生相同字节。
    with TTFont(font_path, recalcTimestamp=False) as font:
        subsetter = Subsetter(options=Options())
        subsetter.populate(text="".join(sorted(chars)))
        subsetter.subset(font)
        font.flavor = "woff2"
        buf = io.BytesIO()
        font.save(buf)
        return buf.getvalue(), set(font.getBestCmap())


def download(url, path):
    with urllib.request.urlopen(url, timeout=60) as response, open(path, "wb") as output:
        output.write(response.read())


def find_font_face(html):
    faces = [m for m in FONT_FACE_RE.finditer(html) if FAMILY_RE.search(m.group())]
    if len(faces) != 1:
        raise ValueError("页面必须包含且仅包含一个 Nebulove @font-face 块。")
    return faces[0]


def make_font_face(data, covered, source_size, mode):
    b64 = base64.b64encode(data).decode("ascii")
    return (
        "/* ===== Nebulove 子集（内嵌，离线可用）=====\n"
        f"   由 scripts/subset_font.py 生成：覆盖 {len(covered)} 个 Unicode 码点（{mode} 模式）。\n"
        f"   {source_size / 1024:.1f} KB → {len(data) / 1024:.1f} KB woff2"
        f"（base64 后 {len(b64) / 1024:.1f} KB）。\n"
        "   仅使用内嵌字体；不可用或缺字时回退到系统字体，不请求远程资源。 ===== */\n"
        "@font-face {\n"
        "  font-family: 'Nebulove';\n"
        f'  src: url("data:font/woff2;charset=utf-8;base64,{b64}") format("woff2");\n'
        "  font-weight: normal;\n"
        "  font-style: normal;\n"
        "  font-display: swap;\n"
        "}"
    )


def replace_font_face(html, new_face):
    face = find_font_face(html)
    prefix = html[:face.start()]
    # 同时清理旧版脚本反复运行后累积的生成注释，不触碰其他字体。
    while (comment := GENERATED_COMMENT_RE.search(prefix)):
        prefix = prefix[:comment.start()]
    return prefix + new_face + html[face.end():]


def atomic_write(path, content):
    """同目录临时文件 + replace：失败时不留下截断的页面，并保留权限。"""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as output:
            temporary = Path(output.name)
            output.write(content.encode("utf-8"))
        os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--html", default=DEFAULT_HTML)
    ap.add_argument("--font-url", default=FONT_URL)
    ap.add_argument("--ttf", help="本地完整字体路径（TTF/WOFF2），不下载")
    ap.add_argument("--extra-chars", help="追加字符集合所在的 UTF-8 文本文件")
    ap.add_argument("--all-text", action="store_true", help="保守模式：收集文件里的所有字符")
    ap.add_argument("--check", action="store_true", help="只报告；不写页面或子集文件")
    args = ap.parse_args()

    path = Path(args.html).resolve()
    try:
        html = path.read_text(encoding="utf-8")
        find_font_face(html)
        extra = Path(args.extra_chars).read_text(encoding="utf-8") if args.extra_chars else ""
        chars = collect_chars(replace_font_face(html, ""), all_text=args.all_text, extra=extra)
        mode = "全文本" if args.all_text else "可渲染文本"
        print(f"需要保留的字符：{len(chars)} 个（{mode}）")

        # 下载使用独立、自动清理的临时目录，避免固定 /tmp 路径的并发覆盖。
        with tempfile.TemporaryDirectory(prefix="yipop-font-") as temporary:
            source = Path(args.ttf) if args.ttf else Path(temporary) / "Nebulove.woff2"
            if not args.ttf:
                print(f"下载完整字体：{args.font_url}")
                download(args.font_url, source)
            source_size = source.stat().st_size
            data, covered = build_subset(chars, source)

        print(f"子集：{len(data) / 1024:.2f} KB woff2（{len(data) / source_size:.1%} 于原字体）")
        missing = {ord(c) for c in chars} - covered
        if missing:
            print("⚠️ 原字体缺字（回退到系统字体）：" + " ".join(f"U+{c:04X}" for c in sorted(missing)))
        if args.check:
            print("--check：未写入页面或子集文件。")
            return
        updated = replace_font_face(html, make_font_face(data, covered, source_size, mode))
        if updated == html:
            print("页面已经是目标内容，未改动。")
            return
        atomic_write(path, updated)
        print(f"已更新 {path}：{len(html.encode()) / 1024:.1f} KB → {len(updated.encode()) / 1024:.1f} KB")
    except (OSError, ValueError, ImportError) as error:
        sys.exit(f"字体子集化失败：{error}")


if __name__ == "__main__":
    main()
