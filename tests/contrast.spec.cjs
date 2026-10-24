const { test, expect } = require('@playwright/test');
const { emptyBoard, savedGame, seed } = require('./helpers.cjs');

const ACCENTS = ['violet', 'blue', 'cyan', 'green', 'amber', 'orange', 'pink', 'coral'];
const THEMES = ['light', 'dark'];
const MIN_CONTRAST = 4.5;
// 14px/13px 的粗体属于正文级字号，必须达到 WCAG AA 的 4.5:1（3:1 只适用于 ≥18.66px 粗体）。

const STATIC_SELECTORS = [
  '.stat-card.primary .stat-label', '.stat-card:not(.primary) .stat-label',
  '.stat-card.primary .stat-value', '.stat-card:not(.primary) .stat-value',
  // 副标题类小字：进度目标（.panel-card 是 color-mix 出来的半透明底）。
  '.progress-note',
];
const RESULT_SELECTORS = ['.modal-lead', '.result-score span', '.result-score strong', '.result-item span', '.result-item strong'];
const HELP_SELECTORS = ['.rule p'];

// 背景取自真实祖先链，而不是 parentElement 的 backgroundColor：
//  - .panel-card 用 color-mix(... 88%, transparent)，底色是半透明的，必须逐层 source-over 合成；
//  - body 叠了两层 radial-gradient，渐变覆盖到的位置会略微提亮/染色。
// 因此这里把每一层的纯色与渐变色标都作为候选背景，最终取「最差的那个组合」来判定 ——
// 只要最差组合仍然 ≥ 4.5:1，任何渲染位置都安全。遇到无法解析的颜色或 url() 背景则直接报错，
// 让用例变红，避免像旧实现那样静默算出一个假通过。
async function measureContrast(page, selector) {
  return page.evaluate(selector => {
    const parse = value => {
      const rgb = value.match(/^rgba?\(([^)]+)\)$/);
      if (rgb) {
        const [r, g, b, a = 1] = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return [r, g, b, a];
      }
      const srgb = value.match(/^color\(srgb ([^)]+)\)$/);
      if (srgb) {
        const [r, g, b, a = 1] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return [r * 255, g * 255, b * 255, a];
      }
      return null;
    };
    const luminance = ([r, g, b]) => {
      const [lr, lg, lb] = [r, g, b].map(channel => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const over = (top, bottom) => top[3] >= 1
      ? [top[0], top[1], top[2]]
      : [top[0] * top[3] + bottom[0] * (1 - top[3]), top[1] * top[3] + bottom[1] * (1 - top[3]), top[2] * top[3] + bottom[2] * (1 - top[3])];

    const element = document.querySelector(selector);
    if (!element) return { error: `${selector} 不存在` };

    // 1) 自下而上收集背景层，直到第一个不透明的纯色层。
    const layers = [];
    let base = null;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const solid = parse(style.backgroundColor);
      if (!solid) return { error: `${selector} 的祖先背景无法解析：${style.backgroundColor}` };
      const stops = [];
      if (style.backgroundImage !== 'none') {
        for (const raw of style.backgroundImage.match(/rgba?\([^)]*\)|color\(srgb [^)]*\)/g) || []) {
          const stop = parse(raw);
          if (!stop) return { error: `${selector} 的祖先渐变无法解析：${style.backgroundImage.slice(0, 60)}` };
          stops.push(stop);
        }
        if (!stops.length) return { error: `${selector} 的祖先背景是图片（${style.backgroundImage.slice(0, 40)}），无法可靠测量` };
      }
      layers.push({ solid, stops });
      if (solid[3] >= 1 && !stops.length) { base = [solid[0], solid[1], solid[2]]; break; }
    }
    if (!base) return { error: `${selector} 找不到不透明的祖先背景` };

    // 2) 从外到内叠加，每个渐变/半透明层都展开成「纯色分支 + 各色标分支」，取候选集合。
    let candidates = [base];
    for (let i = layers.length - 2; i >= 0; i--) {
      const { solid, stops } = layers[i];
      const next = new Set();
      for (const beneath of candidates) {
        if (solid[3] > 0) next.add(over(solid, beneath).map(Math.round).join(','));
        for (const stop of stops) next.add(over(stop, beneath).map(Math.round).join(','));
        if (solid[3] === 0 && !stops.length) next.add(beneath.map(Math.round).join(','));
      }
      candidates = [...next].slice(0, 64).map(key => key.split(',').map(Number));
    }

    // 3) 元素及祖先的 opacity 不体现在 computed color 里，必须按“文字以该透明度合成在背景上”来算，
    //    否则 .stat-label / .combo-bubble small 这类历史 bug 会被漏掉。
    let alpha = 1;
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      alpha *= Number(getComputedStyle(node).opacity);
    }
    const color = parse(getComputedStyle(element).color);
    if (!color) return { error: `${selector} 的前景色无法解析：${getComputedStyle(element).color}` };

    // 4) 取所有候选背景里最差的一个：只要最差组合都达标，任何渲染位置都达标。
    let worst = Infinity;
    for (const background of candidates) {
      const foreground = luminance(color.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha)));
      const back = luminance(background);
      worst = Math.min(worst, (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05));
    }
    return { ratio: worst };
  }, selector);
}

// 入场动画期间 .modal 的 opacity 从 0 开始，此时量出来的前景色几乎是"透明叠加"，
// 会得到 1.0:1 这种假失败。必须等动画停稳再测量。
async function settleModal(page) {
  await expect.poll(() => page.evaluate(() =>
    Number(getComputedStyle(document.querySelector('.modal')).opacity))).toBe(1);
}

async function palettesBelow(page, selectors) {
  const failures = [];
  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      await page.evaluate(({ theme, accent }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.accent = accent;
      }, { theme, accent });
      for (const selector of selectors) {
        const result = await measureContrast(page, selector);
        if (result.error) { failures.push(`${theme}/${accent} ${result.error}`); continue; }
        if (result.ratio < MIN_CONTRAST) failures.push(`${theme}/${accent} ${selector} = ${result.ratio.toFixed(2)}:1`);
      }
    }
  }
  return failures;
}

test('stat card and progress labels keep 4.5:1 on every theme and accent', async ({ page }) => {
  await seed(page);
  expect(await palettesBelow(page, STATIC_SELECTORS)).toEqual([]);
});

test('help dialog body text keeps 4.5:1 on every theme and accent', async ({ page }) => {
  await seed(page);
  await page.locator('#menuButton').click();
  await page.locator('#helpMenu').click();
  await expect(page.locator('.rule p').first()).toBeVisible();
  await settleModal(page);
  expect(await palettesBelow(page, HELP_SELECTORS)).toEqual([]);
});

test('result dialog text keeps 4.5:1 on every theme and accent', async ({ page }) => {
  const board = emptyBoard();
  board[6][0] = board[7][0] = 0;
  await seed(page, savedGame(board));
  await page.locator('.tile').first().click();
  await expect(page.locator('.result-score span')).toBeVisible();
  await settleModal(page);
  expect(await palettesBelow(page, RESULT_SELECTORS)).toEqual([]);
});

test('combo bubble subtitle keeps 4.5:1 on every theme and accent', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // 一次消掉 9 颗（≥8）才会弹连锁气泡，气泡 1.6s 后自动收起，所以用冻结的时钟停在可见窗口内。
  await page.clock.install();
  await page.clock.pauseAt(Date.now());
  // 3×3 同色块贴在左下角：存档要求空列只能在右侧，星星不能悬空，否则会被判为无效存档。
  const board = emptyBoard();
  for (let r = 5; r <= 7; r++) for (let c = 0; c <= 2; c++) board[r][c] = 0;
  await seed(page, savedGame(board));
  await page.locator('.tile[data-row="5"][data-col="0"]').evaluate(tile => tile.click());
  await page.clock.runFor(1600);
  await expect(page.locator('.combo-bubble small')).toBeVisible();
  // comboPop 会在 1.6s 里把 opacity 从 0 拉到 1 再淡出，而时钟被冻结后这段 CSS 动画仍在
  // 真实时间里推进 —— 直接测量会量到半透明中间态。这里只冻结气泡自身的入场动画，
  // 保留 .combo-bubble small 自己的 opacity（那才是要验的东西）。
  await page.addStyleTag({ content: '.combo-bubble { animation: none !important; }' });
  await expect.poll(() => page.evaluate(() =>
    Number(getComputedStyle(document.querySelector('.combo-bubble')).opacity))).toBe(1);
  // .combo-bubble small 曾经叠了 opacity: .92 —— 正是那类“看起来还行、实测跌破 AA”的写法。
  expect(await palettesBelow(page, ['.combo-bubble small'])).toEqual([]);
});
