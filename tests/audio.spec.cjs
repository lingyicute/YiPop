const { test, expect } = require('@playwright/test');
const { emptyBoard, savedGame, seed } = require('./helpers.cjs');

async function fakeAudio(page) {
  await page.addInitScript(() => {
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const node = () => ({ connect() { return this; }, disconnect() { this.disconnected = true; } });
    window.tones = [];
    window.AudioContext = class {
      state = 'running'; currentTime = 0; sampleRate = 48000; destination = node();
      createGain() { return { ...node(), gain: param() }; }
      createDynamicsCompressor() {
        return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() };
      }
      createBuffer() { return {}; }
      createBufferSource() { return { ...node(), start() {} }; }
      createOscillator() {
        const tone = { ...node(), frequency: param(), stops: [], start() {}, stop(time) { this.stops.push(time ?? 0); } };
        window.tones.push(tone); return tone;
      }
    };
  });
}

async function soundingGame(page) {
  await fakeAudio(page);
  // 这些用例只关心音频图的生命周期。真实连锁动画会分批、跨帧地创建振荡器，
  // 让“结算后是否还留有未释放的音”变成时序竞争，所以固定为减少动效模式。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const board = emptyBoard();
  board[6][0] = board[7][0] = 0;
  board[6][1] = board[7][1] = 1;
  await seed(page, savedGame(board), { 'yipop-prefs-v2': { sound: true } });
  await page.locator('.tile').first().click();
}

test('muting stops already scheduled tones, not only future calls', async ({ page }) => {
  await soundingGame(page);
  await page.locator('#menuButton').click();
  await page.locator('#soundMenu').click();
  const stopped = await page.evaluate(() => tones.length > 0 && tones.every(t => t.stops.includes(0) && t.disconnected));
  expect(stopped).toBe(true);
});

test('finished tones release their audio graph connections', async ({ page }) => {
  await soundingGame(page);
  const disconnected = await page.evaluate(() => {
    tones.forEach(t => t.onended?.());
    return tones.length > 0 && tones.every(t => t.disconnected);
  });
  expect(disconnected).toBe(true);
});

test('restarting stops sounds from the old action', async ({ page }) => {
  await soundingGame(page);
  await page.locator('#restartButton').click();
  expect(await page.evaluate(() => tones.length > 0 && tones.every(t => t.stops.includes(0)))).toBe(true);
});
