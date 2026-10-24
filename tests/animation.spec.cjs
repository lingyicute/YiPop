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

  // 在页面内按墙上时钟连续采样：既不受协议往返时序影响（浮字 850ms 后就被移除），
  // 也能覆盖整段飞行过程，而不是只取某一瞬间。不用 rAF 采样：软件渲染引擎
  // （如无头 WebKit）整段飞行只产出两三帧，样本量与引擎帧率解耦才稳定；
  // getBoundingClientRect 会强制取当前动画时刻的位置，无需等帧。
  const samples = await page.evaluate(() => new Promise(resolve => {
    const collected = [];
    const start = performance.now();
    const timer = setInterval(() => {
      const float = document.querySelector('.score-float');
      if (!float || performance.now() - start > 2000) { clearInterval(timer); resolve(collected); return; }
      const rect = float.getBoundingClientRect();
      collected.push(rect.left + rect.width / 2);
    }, 40);
    document.querySelector('.tile').click();
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

test('a popover opened mid-explosion is closed when the result dialog opens', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // 消掉这 3 颗后棋盘无步可走：本局会在连锁动画结束后直接结算。
  const board = emptyBoard();
  board[7][0] = 0; board[7][1] = 0; board[7][2] = 0; board[7][3] = 1; board[7][4] = 2;
  await seed(page, savedGame(board));
  await page.locator('.tile[data-row="7"][data-col="0"]').click();
  await page.locator('#menuButton').click();
  await expect(page.locator('#menuPopover')).toBeVisible();
  await page.waitForSelector('#modalLayer:not([hidden])');
  // 弹窗打开期间浮层必须已收起，不能留在遮罩背后（含 160ms 退出动画）。
  await expect(page.locator('#menuPopover')).toBeHidden();
  await expect(page.locator('#menuButton')).toHaveAttribute('aria-expanded', 'false');
});

test('combo bubble stays on screen through the longer window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await page.clock.pauseAt(Date.now()); // 冻结真实走时，runFor 才是唯一的时钟来源
  await seed(page, fullGame());
  await page.locator('.tile').first().evaluate(tile => tile.click());
  // 64 颗连锁约 3.7s 后结算并弹出提示；旧的 1080ms 停留会在 ~4.8s 就把它藏掉。
  await page.clock.runFor(4900);
  await expect(page.locator('#comboLayer')).toBeVisible();
  await page.clock.runFor(600); // ~5.5s：1.6s 动画淡出完毕后才移除
  await expect(page.locator('#comboLayer')).toBeHidden();
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
