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
