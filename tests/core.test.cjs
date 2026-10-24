const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the shipped single-file code, without adding a production debug API.
// 页面含两个 <script>（head 的主题预置快路径 + 正文主脚本），取最后一个。
const scripts = [...fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)];
let script = scripts[scripts.length - 1][1];
for (const call of ['initAppearance();', 'bindEvents();', 'restoreOrCreateGame();']) script = script.replace(call, '');
script = script.replace('})();', 'globalThis.game = { findGroup, findExplosionOrder, hasMoves, scoreFor, collapseVerticalTracked, shiftColumnsLeftTracked, createBoard }; })();');
const context = vm.createContext({ document: { querySelector: () => null }, localStorage: { getItem: () => null } });
vm.runInContext(script, context);
const game = context.game;
const plain = value => JSON.parse(JSON.stringify(value));

test('groups use orthogonal adjacency, not diagonals; BFS starts at the clicked tile', () => {
  const board = [[0, 1, 0], [0, 0, 1], [1, 0, null]];
  assert.equal(game.findGroup(board, 0, 0).length, 4);
  assert.equal(game.findGroup(board, 0, 2).length, 1);
  assert.equal(game.findGroup(board, 2, 2).length, 0);
  assert.deepEqual(plain(game.findExplosionOrder(board, 0, 0)), [[0, 0], [1, 0], [1, 1], [2, 1]]);
  assert.equal(game.hasMoves([[0, 1], [1, 0]]), false);
  assert.equal(game.hasMoves([[null, null], [null, null]]), false);
  assert.equal(game.scoreFor(12), 720);
});

test('compaction preserves tile identity and stable vertical/column order (500 seeded boards)', () => {
  let seed = 1729;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let sample = 0; sample < 500; sample++) {
    const size = [8, 10, 12, 14][sample % 4];
    const board = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) =>
      random() < 0.7 ? null : { color: Math.floor(random() * 4), id: `${r}-${c}` }));
    const columns = Array.from({ length: size }, (_, c) => board.map(row => row[c]).filter(v => v !== null)).filter(col => col.length);
    game.collapseVerticalTracked(board);
    game.shiftColumnsLeftTracked(board);
    const expected = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) =>
      columns[c]?.[r - (size - columns[c].length)] ?? null));
    assert.deepEqual(board, expected);
    const copy = structuredClone(board);
    game.collapseVerticalTracked(board);
    assert.equal(game.shiftColumnsLeftTracked(board), false);
    assert.deepEqual(board, copy);
  }
});

test('generated boards have valid colors and at least one move', () => {
  for (const [size, colors] of [[8, 4], [10, 5], [12, 6], [14, 6]]) {
    for (let i = 0; i < 25; i++) {
      const board = game.createBoard(size, colors);
      assert.equal(board.length, size);
      assert.ok(board.every(row => row.length === size && row.every(v => Number.isInteger(v) && v >= 0 && v < colors)));
      assert.ok(game.hasMoves(board));
    }
  }
});

// 下面几条都是纯静态检查：不启动浏览器，守住「单文件 + 首帧主题」这两条容易被悄悄破坏的前提。
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('icons are inlined byte-for-byte from assets/', () => {
  // 「单文件」是这个项目的招牌：index.html 单独下载/内嵌时不能再去请求 assets/。
  const inlined = (pattern, file) => {
    const uri = html.match(pattern)?.[1];
    assert.ok(uri, `${file} 没有内联进 index.html`);
    assert.ok(Buffer.from(uri, 'base64').equals(fs.readFileSync(path.join(__dirname, '../assets', file))),
      `${file} 的内联数据与 assets/${file} 不一致（改图标后要同步内联）`);
  };
  inlined(/rel="icon" href="data:image\/svg\+xml;base64,([^"]+)"/, 'icon.svg');
  inlined(/rel="icon" href="data:image\/png;base64,([^"]+)" type="image\/png"/, 'favicon-32.png');
  inlined(/rel="apple-touch-icon" href="data:image\/png;base64,([^"]+)"/, 'apple-touch-icon.png');
  inlined(/rel="shortcut icon" href="data:image\/x-icon;base64,([^"]+)"/, 'favicon.ico');
  // 反过来也成立：页面里不应再出现指向 assets/ 的外链（否则单文件下载会 404）。
  assert.equal(/["']assets\//.test(html), false);
});

test('head prepaint accent whitelist matches the palette swatches', () => {
  // head 里的预绘制快路径必须先知道有哪些配色，而正文的颜色选择器是从 .swatch 的 DOM 读出来的。
  // 两处一旦不同步，新增配色就会在首帧闪一下 violet —— 正是 c540405 想消灭的现象。
  const head = html.slice(0, html.indexOf('<body'));
  const whitelist = head.match(/const accents = \[([^\]]*)\]/)[1]
    .split(',').map(name => name.trim().replace(/^'|'$/g, '')).filter(Boolean);
  const swatches = [...html.matchAll(/class="swatch"[^>]*data-accent="([a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(whitelist, swatches);
});

test('static goal text matches the un-grouped score format', () => {
  // a395fc2 去掉了千分位，但静态标记还写着「目标 2,500」，首帧会闪一下旧文案。
  const goal = html.match(/id="goalText">([^<]*)</)[1];
  assert.equal(goal, '目标 2500');
  assert.equal(/[\d],[\d]/.test(goal), false);
});
