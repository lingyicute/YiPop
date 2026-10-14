import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('subset_font', Path(__file__).resolve().parents[1] / 'scripts/subset_font.py')
font_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(font_script)


class FontTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.font = self.root / 'source.ttf'
        # A tiny local fixture: no external font/network needed by the tests.
        from fontTools.fontBuilder import FontBuilder
        from fontTools.pens.ttGlyphPen import TTGlyphPen
        fb = FontBuilder(1000, isTTF=True)
        fb.setupGlyphOrder(['.notdef', 'A'])
        fb.setupCharacterMap({65: 'A'})
        fb.setupGlyf({name: TTGlyphPen(None).glyph() for name in ['.notdef', 'A']})
        fb.setupHorizontalMetrics({name: (600, 0) for name in ['.notdef', 'A']})
        fb.setupHorizontalHeader(ascent=800, descent=-200)
        fb.setupNameTable({'familyName': 'Test', 'styleName': 'Regular'})
        fb.setupOS2()
        fb.setupPost()
        fb.setupMaxp()
        fb.save(self.font)
        self.html = self.root / 'index.html'
        self.html.write_text('<style>@font-face { font-family: "Nebulove"; src: url(old); }</style><p>A</p>', encoding='utf-8')

    def run_main(self, *args):
        with patch.object(sys, 'argv', ['subset_font.py', '--html', str(self.html), '--ttf', str(self.font), *args]), \
                patch.object(font_script, 'HERE', str(self.root)), contextlib.redirect_stdout(io.StringIO()):
            font_script.main()

    def test_check_does_not_write_files(self):
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()}
        self.run_main('--check')
        after = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()}
        self.assertEqual(before, after)

    def test_repeated_generation_is_byte_identical(self):
        self.run_main()
        first = self.html.read_bytes()
        self.run_main()
        self.assertEqual(first, self.html.read_bytes())
        self.assertEqual(self.html.read_text().count('/* ===== Nebulove'), 1)

    def test_only_replaces_nebulove_face(self):
        other = '@font-face { font-family: "Other"; src: url(other.woff2); }'
        self.html.write_text('<style>' + other + '</style>' + self.html.read_text())
        self.run_main()
        self.assertIn(other, self.html.read_text())
        self.assertNotIn('url(old)', self.html.read_text())

    def test_generated_face_never_requests_remote_fonts(self):
        self.run_main()
        self.assertNotIn('https://', self.html.read_text())
        self.assertIn('data:font/woff2', self.html.read_text())

    def test_collects_entities_and_does_not_strip_comment_syntax_in_strings(self):
        chars = font_script.collect_chars('<p>&#x661F;</p><script>const text = "/*新*/";</script>')
        self.assertIn('星', chars)
        self.assertIn('新', chars)

    def test_all_text_mode_is_idempotent(self):
        self.run_main('--all-text')
        first = self.html.read_bytes()
        self.run_main('--all-text')
        self.assertEqual(first, self.html.read_bytes())

    def test_removes_accumulated_legacy_headers(self):
        header = '/* ===== Nebulove 子集（内嵌，离线可用）===== old */\n'
        self.html.write_text(self.html.read_text().replace('@font-face', header * 3 + '@font-face'))
        self.run_main()
        self.assertEqual(self.html.read_text().count('/* ===== Nebulove'), 1)

    def test_failed_atomic_replace_leaves_original_intact_and_cleans_temporary_file(self):
        before = self.html.read_bytes()
        names = {p.name for p in self.root.iterdir()}
        with patch.object(font_script.os, 'replace', side_effect=OSError('simulated failure')):
            with self.assertRaises(SystemExit):
                self.run_main()
        self.assertEqual(before, self.html.read_bytes())
        self.assertEqual(names, {p.name for p in self.root.iterdir()})

    def test_ambiguous_font_faces_are_not_overwritten(self):
        self.html.write_text(self.html.read_text() * 2)
        before = self.html.read_bytes()
        with self.assertRaises(SystemExit):
            self.run_main()
        self.assertEqual(before, self.html.read_bytes())

    def test_download_uses_cleaned_unique_temporary_paths(self):
        paths = []

        def download(_url, path):
            paths.append(Path(path))
            Path(path).write_bytes(self.font.read_bytes())

        for _ in range(2):
            with patch.object(sys, 'argv', ['subset_font.py', '--html', str(self.html), '--check']), \
                    patch.object(font_script, 'download', side_effect=download), \
                    contextlib.redirect_stdout(io.StringIO()):
                font_script.main()
        self.assertNotEqual(paths[0], paths[1])
        self.assertTrue(all(not p.parent.exists() for p in paths))

    def test_preserves_file_mode(self):
        self.html.chmod(0o640)
        self.run_main()
        self.assertEqual(self.html.stat().st_mode & 0o777, 0o640)


if __name__ == '__main__':
    unittest.main()
