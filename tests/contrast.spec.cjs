const { test, expect } = require('@playwright/test');
const { emptyBoard, savedGame, seed } = require('./helpers.cjs');

const ACCENTS = ['violet', 'blue', 'cyan', 'green', 'amber', 'orange', 'pink', 'coral'];
const THEMES = ['light', 'dark'];
const MIN_CONTRAST = 4.5;

// 14px/13px 的粗体属于正文级字号，必须达到 WCAG AA 的 4.5:1（3:1 只适用于 ≥18.66px 粗体）。
function measureContrast(page, selector) {
  return page.evaluate(selector => {
    const toRgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = ([r, g, b]) => {
      const [lr, lg, lb] = [r, g, b].map(channel => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const element = document.querySelector(selector);
    if (!element) return null;
    const card = element.parentElement;
    const background = toRgb(getComputedStyle(card).backgroundColor);
    // 元素自身的 opacity 不体现在 computed color 里，必须按“文字以该透明度合成在卡片上”来算，
    // 否则 .stat-label { opacity: .78 } 这类历史 bug 会被漏掉。
    let alpha = 1;
    for (let node = element; node && node !== card.parentElement; node = node.parentElement) {
      alpha *= Number(getComputedStyle(node).opacity);
    }
    const color = toRgb(getComputedStyle(element).color);
    const foreground = luminance(color.map((channel, index) => channel * alpha + background[index] * (1 - alpha)));
    const back = luminance(background);
    return (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05);
  }, selector);
}

async function palettesBelow(page, selector, minimum = MIN_CONTRAST) {
  const failures = [];
  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      await page.evaluate(({ theme, accent }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.accent = accent;
      }, { theme, accent });
      const ratio = await measureContrast(page, selector);
      if (ratio === null) return [`${selector} 不存在`];
      if (ratio < minimum) failures.push(`${theme}/${accent} = ${ratio.toFixed(2)}:1`);
    }
  }
  return failures;
}

test('stat card labels keep 4.5:1 on every theme and accent', async ({ page }) => {
  await seed(page);
  expect(await palettesBelow(page, '.stat-card.primary .stat-label')).toEqual([]);
  expect(await palettesBelow(page, '.stat-card:not(.primary) .stat-label')).toEqual([]);
  expect(await palettesBelow(page, '.stat-card.primary .stat-value')).toEqual([]);
  expect(await palettesBelow(page, '.stat-card:not(.primary) .stat-value')).toEqual([]);
});

test('result score label keeps 4.5:1 on every theme and accent', async ({ page }) => {
  const board = emptyBoard();
  board[6][0] = board[7][0] = 0;
  await seed(page, savedGame(board));
  await page.locator('.tile').first().click();
  await expect(page.locator('.result-score span')).toBeVisible();
  // 透明度叠加曾把深色 cyan/green/amber 的标签压到 3.5~3.8:1。
  expect(await palettesBelow(page, '.result-score span')).toEqual([]);
});
