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
  await expect(page.locator('#scoreValue')).toHaveText('2120');
  await expect(page.locator('#movesValue')).toHaveText('2');
  await page.locator('[data-action="close"]').click();
  await expect(page.locator('#modalLayer')).toBeHidden();
  await page.locator('#undoButton').click();
  await expect(page.locator('#scoreValue')).toHaveText('100');
  expect((await readGame(page)).board).toEqual(board);
  await page.locator('.tile').first().click();
  await expect(page.locator('#scoreValue')).toHaveText('2120');
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

test('score renders as rolling odometer columns with intact accessible text', async ({ page }) => {
  const board = emptyBoard();
  board[6][0] = board[7][0] = 0;
  await seed(page, savedGame(board)); // 存档分 100
  await expect(page.locator('#scoreValue')).toHaveText('100');
  expect(await page.locator('#scoreValue .odo-col').count()).toBe(3);
  await page.locator('.tile').first().click();
  await expect(page.locator('#scoreValue')).toHaveText('2120');
  expect(await page.locator('#scoreValue .odo-col').count()).toBe(4);
  expect(await page.locator('#scoreValue .odo-sep').count()).toBe(0); // 分数不带千分位，无分隔符列
  // 停稳后每位滑带的偏移必须恰好落在目标数字上（pos % 10），且读屏文本与可见值一致。
  await page.waitForTimeout(1200);
  const digits = await page.locator('#scoreValue .odo-col').evaluateAll(cols =>
    cols.map(col => Number(col.dataset.pos) % 10));
  expect(digits).toEqual([2, 1, 2, 0]);
  expect(await page.locator('#scoreValue .sr-only').textContent()).toBe('2120');
});

test('score odometer stays on a single line in a narrow card', async ({ page }) => {
  // 回归：数字列是相邻 inline-block，元素边界天然是断行点；窄屏（280px）里
  // 纯文本数字不会断，滚轮却会折成两行。.odo 必须 nowrap。
  await page.setViewportSize({ width: 280, height: 700 });
  const board = emptyBoard(14);
  board[13][0] = board[13][1] = board[12][0] = board[12][1] = 0; // 保留合法移动，避免加载即结算加成
  await seed(page, savedGame(board, { difficulty: 'expert', score: 102345 }));
  await expect(page.locator('#scoreValue')).toHaveText('102345');
  const layout = await page.locator('#scoreValue').evaluate(sv => {
    const parts = [...sv.querySelectorAll('.odo-col, .odo-sep')];
    const rows = new Set(parts.map(p => Math.round(p.getBoundingClientRect().top)));
    return { rows: rows.size, height: sv.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(sv).fontSize) };
  });
  expect(layout.rows).toBe(1);
  expect(layout.height).toBeLessThan(layout.fontSize * 1.5);
});

test('leftover stars detonate from the rightmost column top-down before the result dialog', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // 右下角 L 形四颗互不相邻的孤星：加载即无步可走，进入结算引爆演出。
  // 顺序应为「最右列自上而下 → 逐列向左」：(6,2)→(7,2)→(7,1)→(7,0)。
  const board = emptyBoard();
  board[6][2] = 3; board[7][2] = 2; board[7][1] = 1; board[7][0] = 0;
  await page.clock.install();
  await page.clock.pauseAt(Date.now()); // 冻结真实走时，演出进度完全由 runFor 驱动
  await seed(page, savedGame(board));

  const exploding = page.locator('.tile.is-exploding');
  await page.clock.runFor(30);
  await expect(exploding).toHaveCount(1);
  await expect(exploding.first()).toHaveAttribute('data-col', '2'); // 最右列先炸
  await expect(exploding.first()).toHaveAttribute('data-row', '6'); // 列内自上而下
  await page.clock.runFor(60);
  await expect(exploding).toHaveCount(2);
  await expect(exploding.nth(1)).toHaveAttribute('data-row', '7');
  await expect(page.locator('#modalLayer')).toBeHidden(); // 演出放完才结算
  await page.clock.runFor(60);
  await expect(exploding).toHaveCount(3); // 已推进到次右列 (7,1)
  expect(await exploding.evaluateAll(tiles => tiles.map(t => t.dataset.col).sort()))
    .toEqual(['1', '2', '2']);
  await page.clock.runFor(1200);
  await expect(page.locator('#modalLayer')).toBeVisible();
  // 「查看棋盘」要按 state 恢复真实残局，而不是演出清空后的空盘。
  await page.locator('[data-action="close"]').click();
  await page.clock.runFor(300);
  await expect(page.locator('#board .tile')).toHaveCount(4);
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
