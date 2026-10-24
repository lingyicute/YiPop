const { test, expect } = require('@playwright/test');
const { emptyBoard, savedGame, seed, readGame } = require('./helpers.cjs');

function fullGame(size = 8, difficulty = 'easy') {
  return savedGame(Array.from({ length: size }, () => Array(size).fill(0)), { difficulty, score: 0, moves: 0 });
}

test('reduced motion commits even a 196-star move without animation timers or particles', async ({ page }) => {
  // 全局配置已不再强制 reducedMotion，需要这条语义的用例自己声明系统偏好。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page, fullGame(14, 'expert'));
  const saved = await page.locator('.tile').first().evaluate(tile => {
    tile.click();
    return JSON.parse(localStorage.getItem('yipop-game-v1'));
  });
  expect(saved.gameOver).toBe(true);
  expect(saved.score).toBe(194080);
  expect(await page.locator('.particle, .blast-ring, .score-float').count()).toBe(0);
});

test('score float keeps the tile centre while it flies up', async ({ page }) => {
  const board = emptyBoard();
  board[6][0] = board[7][0] = 0;
  board[6][1] = board[7][1] = 1;
  await seed(page, savedGame(board));
  const tile = await page.locator('.tile').first().boundingBox();
  const originCentre = tile.x + tile.width / 2;

  // 在页面内用 rAF 连续采样：既不受协议往返时序影响（浮字 850ms 后就被移除），
  // 也能覆盖整段飞行过程，而不是只取某一瞬间。
  const samples = await page.evaluate(() => new Promise(resolve => {
    const collected = [];
    const start = performance.now();
    document.querySelector('.tile').click();
    const loop = () => {
      document.querySelectorAll('.score-float').forEach(float => {
        const rect = float.getBoundingClientRect();
        collected.push(rect.left + rect.width / 2);
      });
      if (performance.now() - start < 520) requestAnimationFrame(loop);
      else resolve(collected);
    };
    requestAnimationFrame(loop);
  }));

  expect(samples.length).toBeGreaterThan(5);
  // 关键帧里改用 transform 的旧写法会让浮字整段飞行都向右偏半个自身宽度。
  expect(Math.max(...samples.map(centre => Math.abs(centre - originCentre)))).toBeLessThan(1.5);
});

for (const action of ['undo', 'restart', 'difficulty']) {
  test(`${action} cancels an in-flight explosion and its stale callbacks`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await seed(page, fullGame());
    await page.clock.install();
    await page.locator('.tile').first().evaluate(tile => tile.click());
    await page.clock.runFor(500);
    await expect(page.locator('#board')).toHaveClass(/locked/);
    if (action === 'undo') {
      expect(await page.locator('#undoButton').isEnabled()).toBe(true);
      await page.locator('#undoButton').evaluate(button => button.click());
    } else if (action === 'restart') {
      await page.locator('#restartButton').evaluate(button => button.click());
    } else {
      await page.locator('[data-difficulty="expert"]').evaluate(button => button.click());
    }
    const snapshot = await readGame(page);
    expect(await page.locator('.particle, .blast-ring, .score-float').count()).toBe(0);
    await page.clock.runFor(12000);
    expect(await readGame(page)).toEqual(snapshot);
    await expect(page.locator('#remainingValue')).toHaveText(action === 'difficulty' ? '196' : '64');
    await expect(page.locator('#scoreValue')).toHaveText('0');
    await expect(page.locator('#board')).not.toHaveClass(/locked/);
  });
}

test('settles bonus once, undo restores pre-move state, and redo is deterministic', async ({ page }) => {
  const board = emptyBoard(); board[6][0] = board[7][0] = 0;
  await seed(page, savedGame(board));
  await page.locator('.tile').first().click();
  await expect(page.locator('#scoreValue')).toHaveText('2,120');
  await expect(page.locator('#movesValue')).toHaveText('2');
  await page.locator('[data-action="close"]').click();
  await expect(page.locator('#modalLayer')).toBeHidden();
  await page.locator('#undoButton').click();
  await expect(page.locator('#scoreValue')).toHaveText('100');
  expect((await readGame(page)).board).toEqual(board);
  await page.locator('.tile').first().click();
  await expect(page.locator('#scoreValue')).toHaveText('2,120');
});

test('persists an in-progress record across restart and reload', async ({ page }) => {
  const board = emptyBoard();
  board[6][0] = board[7][0] = 0;
  board[6][1] = board[7][1] = 1;
  await seed(page, savedGame(board, { score: 0, moves: 0 }));
  await page.locator('.tile').first().click();
  await expect(page.locator('#scoreValue')).toHaveText('20');
  await page.locator('#restartButton').click();
  await page.reload();
  await expect(page.locator('#bestValue')).toHaveText('20');
});

for (const [stage, elapsed] of [['fall', 500], ['column shift', 950]]) {
  test(`undo cancels ${stage} without a late score or save`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const board = emptyBoard();
    board[6][0] = board[7][0] = 0;
    board[6][1] = board[7][1] = 1;
    await seed(page, savedGame(board));
    await page.clock.install();
    await page.locator('.tile').first().evaluate(tile => tile.click());
    await page.clock.runFor(elapsed);
    expect(await page.locator('#board').getAttribute('aria-busy')).toBe('true');
    await page.locator('#undoButton').evaluate(button => button.click());
    await page.clock.runFor(2000);
    expect(await readGame(page)).toEqual(savedGame(board));
  });
}
