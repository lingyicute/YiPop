const { test, expect } = require('@playwright/test');
const { emptyBoard, savedGame, seed } = require('./helpers.cjs');

async function twoGroups(page) {
  const board = emptyBoard();
  board[6][0] = board[7][0] = 0;
  board[6][1] = board[7][1] = 1;
  await seed(page, savedGame(board));
}

test('board has valid rows and a single tab stop; arrows update it', async ({ page }) => {
  await twoGroups(page);
  await expect(page.locator('#board > [role="row"]')).toHaveCount(8);
  await expect(page.locator('#board .tile[tabindex="0"]')).toHaveCount(1);
  await page.locator('#board .tile[tabindex="0"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tile[data-row="7"][data-col="0"]')).toBeFocused();
  await expect(page.locator('#board .tile[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('#board') === null)).toBe(true);
});

test('keyboard play preserves focus on a surviving tile after compaction', async ({ page }) => {
  await twoGroups(page);
  await page.locator('.tile').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#remainingValue')).toHaveText('2');
  await expect(page.locator('#board .tile:focus')).toHaveCount(1);
  await expect(page.locator('#scorePreview')).toHaveText('2 颗 · +20');
});

test('modal traps Tab, blocks background, and restores a visible opener', async ({ page }) => {
  await seed(page);
  await page.locator('#menuButton').click(); await page.locator('#helpMenu').click();
  await expect(page.locator('#modal button')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#modal button')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#modal button')).toBeFocused();
  expect(await page.locator('main').evaluate(el => el.inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modalLayer')).toBeHidden();
  await expect(page.locator('#menuButton')).toBeFocused();
  expect(await page.locator('main').evaluate(el => el.inert)).toBe(false);
});

test('Tab wraps correctly with multiple modal buttons', async ({ page }) => {
  await seed(page);
  await page.locator('#menuButton').click(); await page.locator('#clearMenu').click();
  await expect(page.locator('[data-action="cancel"]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-action="confirm"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-action="cancel"]')).toBeFocused();
});

test('palette supports radio keyboard navigation and Escape returns focus', async ({ page }) => {
  await seed(page);
  await page.locator('#paletteButton').click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.swatch[data-accent="violet"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.swatch[data-accent="blue"]')).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  await page.keyboard.press('Escape');
  await expect(page.locator('#paletteButton')).toBeFocused();
  await expect(page.locator('#palettePopover')).toBeHidden();
});

test('reopening a closing popover cancels its old hide timer', async ({ page }) => {
  await seed(page);
  await page.clock.install();
  const button = page.locator('#menuButton');
  await button.evaluate(b => b.click());
  await button.evaluate(b => b.click());
  await button.evaluate(b => b.click());
  await page.clock.runFor(500);
  await expect(page.locator('#menuPopover')).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
});

test('restart clears stale score preview', async ({ page }) => {
  await twoGroups(page);
  await page.locator('.tile').first().focus();
  await expect(page.locator('#scorePreview')).toHaveClass(/show/);
  await page.locator('#restartButton').click();
  await expect(page.locator('#scorePreview')).not.toHaveClass(/show/);
});

for (const leaveBoard of [false, true]) {
  test(`animated compaction ${leaveBoard ? 'does not steal focus from menu' : 'restores keyboard focus'}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await twoGroups(page);
    await page.clock.install();
    await page.locator('.tile').first().focus();
    await page.keyboard.press('Enter');
    if (leaveBoard) await page.locator('#menuButton').focus();
    await page.clock.runFor(2000);
    if (leaveBoard) await expect(page.locator('#menuButton')).toBeFocused();
    else await expect(page.locator('#board .tile:focus')).toHaveCount(1);
  });
}

test('replacing a closing modal cannot be hidden by the old close callback', async ({ page }) => {
  const board = emptyBoard(); board[6][0] = board[7][0] = 0;
  await seed(page, savedGame(board));
  await page.clock.install();
  await page.locator('#helpMenu').evaluate(b => b.click());
  await page.locator('[data-action="close"]').evaluate(b => b.click());
  // A finishing move can replace a help dialog while its fade-out is pending.
  await page.locator('.tile').first().evaluate(tile => tile.click());
  await page.clock.runFor(500);
  await expect(page.locator('#modalLayer')).toBeVisible();
  await expect(page.locator('#modalTitle')).toHaveText('完美清场!');
  expect(await page.locator('main').evaluate(el => el.inert)).toBe(true);
  await page.locator('[data-action="close"]').evaluate(b => b.click());
  await page.clock.runFor(500);
  expect(await page.locator('main').evaluate(el => el.inert)).toBe(false);
});
