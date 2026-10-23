const { test, expect } = require('@playwright/test');
const { emptyBoard, savedGame, seed, readGame } = require('./helpers.cjs');

for (const [name, mutate] of Object.entries({
  'out-of-range color': g => { g.board[7][0] = 4; },
  'negative color': g => { g.board[7][0] = -1; },
  'fractional color': g => { g.board[7][0] = 0.5; },
  'string color': g => { g.board[7][0] = '0'; },
  'object color': g => { g.board[7][0] = {}; },
  'negative score': g => { g.score = -1; },
  'infinite score': g => { g.score = 'Infinity'; },
  'fractional moves': g => { g.moves = 0.5; },
  'prototype difficulty': g => { g.difficulty = '__proto__'; },
  'non-boolean gameOver': g => { g.gameOver = 0; },
  'floating tile': g => { g.board[6][1] = 0; },
  'empty internal column': g => { g.board[7][3] = 0; },
})) {
  test(`rejects ${name}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const board = emptyBoard(); board[6][0] = board[7][0] = 0;
    const game = savedGame(board); mutate(game);
    await seed(page, game);
    await expect(page.locator('#remainingValue')).toHaveText('64');
    await expect(page.locator('#scoreValue')).toHaveText('0');
    expect(errors).toEqual([]);
  });
}

test('resumes valid games without changing the board', async ({ page }) => {
  const board = emptyBoard(); board[6][0] = board[7][0] = 0;
  await seed(page, savedGame(board));
  await expect(page.locator('#remainingValue')).toHaveText('2');
  await expect(page.locator('#scoreValue')).toHaveText('100');
  expect((await readGame(page)).board).toEqual(board);
});

test('settles a terminal unfinished save exactly once', async ({ page }) => {
  const board = emptyBoard(); board[7][0] = 0;
  await seed(page, savedGame(board));
  await expect(page.locator('#modalLayer')).toBeVisible();
  await expect(page.locator('#scoreValue')).toHaveText('2,080');
  expect((await readGame(page)).gameOver).toBe(true);
  await page.reload();
  await expect(page.locator('#bestValue')).toHaveText('2,080');
  await expect(page.locator('#scoreValue')).toHaveText('0');
});

test('sanitizes preferences and best scores', async ({ page }) => {
  await seed(page, undefined, {
    'yipop-prefs-v2': { theme: 'bogus', accent: 'bogus', sound: false },
    'yipop-best-v1': { easy: 'Infinity', medium: -12, hard: 200, expert: {} },
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await expect(page.locator('#bestValue')).toHaveText('0');
  await page.locator('#menuButton').click(); await page.locator('#recordsMenu').click();
  await expect(page.locator('.record-row > strong')).toHaveText(['0', '0', '200', '0']);
});

test('works when storage throws', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      Storage.prototype[method] = () => { throw new DOMException('blocked', 'SecurityError'); };
    }
  });
  await page.goto('/');
  await expect(page.locator('#board .tile')).toHaveCount(64);
  await page.locator('#restartButton').click();
  expect(errors).toEqual([]);
});

test('migrates the legacy sound preference instead of forcing sound back on', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('yipop-prefs-v1', JSON.stringify({ sound: false }));
  });
  await page.goto('/');
  await expect(page.locator('#soundMenu')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#soundSwitch')).not.toHaveClass(/\bon\b/);
});

test('enables sound by default when no preference was ever stored', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#soundMenu')).toHaveAttribute('aria-pressed', 'true');
});

test('starts the next run at the difficulty of the finished save', async ({ page }) => {
  const board = Array.from({ length: 14 }, () => Array(14).fill(0));
  await seed(page, savedGame(board, { difficulty: 'expert', score: 100, moves: 1, gameOver: true }));
  await expect(page.locator('#difficultyCaption')).toHaveText('专家 · 14×14');
  await expect(page.locator('#remainingValue')).toHaveText('196');
});

test('keeps the saved difficulty even when the board itself is rejected', async ({ page }) => {
  const board = emptyBoard(10);
  board[9][0] = 7; // out-of-range colour for the medium board
  await seed(page, savedGame(board, { difficulty: 'medium', score: 100, moves: 1 }));
  await expect(page.locator('#difficultyCaption')).toHaveText('中等 · 10×10');
  await expect(page.locator('#remainingValue')).toHaveText('100');
});
