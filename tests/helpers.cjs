const emptyBoard = (size = 8) => Array.from({ length: size }, () => Array(size).fill(null));
function savedGame(board, overrides = {}) {
  return { difficulty: 'easy', board, score: 100, moves: 1, gameOver: false, ...overrides };
}
async function seed(page, game, other = {}) {
  // Only seed once: reloads must exercise what the game itself persisted.
  await page.addInitScript(({ game, other }) => {
    if (sessionStorage.getItem('test-seeded')) return;
    localStorage.clear();
    localStorage.setItem('yipop-prefs-v2', JSON.stringify({ sound: false }));
    if (game !== undefined) localStorage.setItem('yipop-game-v1', JSON.stringify(game));
    for (const [key, value] of Object.entries(other)) localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem('test-seeded', '1');
  }, { game, other });
  await page.goto('/');
}
const readGame = page => page.evaluate(() => JSON.parse(localStorage.getItem('yipop-game-v1')));
module.exports = { emptyBoard, savedGame, seed, readGame };
