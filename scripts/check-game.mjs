import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const errors = [];
const results = [];
await mkdir('artifacts', { recursive: true });
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 960],
    ['mobile', 390, 844],
    ['small-mobile', 360, 740],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: width < 500,
      hasTouch: width < 500,
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://localhost:3000');
    await page.waitForFunction(() => !!window.__wildwood, { timeout: 60000 });
    await page.evaluate(() => {
      const e = window.__wildwood;
      e.restart();
      e.setAutoWeather(false);
      e.setHour(9);
    });
    await page.waitForTimeout(600);
    const check = await page.evaluate(() => {
      const e = window.__wildwood,
        gl = e.renderer.getContext();
      const data = new Uint8Array(
        gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
      );
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      const colors = new Set();
      for (let i = 0; i < data.length; i += 400)
        colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
      const outside = [...document.querySelectorAll('button')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.x < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1
          );
        })
        .map((el) => el.getAttribute('aria-label'));
      const point = e.hearth.position.clone().project(e.camera);
      return {
        colors: colors.size,
        overflow: document.documentElement.scrollWidth > innerWidth,
        outside,
        home: {
          x: ((point.x + 1) * innerWidth) / 2,
          y: ((1 - point.y) * innerHeight) / 2,
        },
      };
    });
    assert.ok(check.colors > 50, `${name} blank canvas`);
    assert.equal(check.overflow, false);
    assert.deepEqual(check.outside, []);
    assert.ok(check.home.x > width * 0.2 && check.home.x < width * 0.8);
    assert.ok(check.home.y > height * 0.3 && check.home.y < height * 0.7);
    await page.screenshot({ path: `artifacts/${name}.png` });
    const motion = await page.evaluate(async () => {
      const e = window.__wildwood,
        a = e.ripples[0].position.z;
      await new Promise((r) => setTimeout(r, 300));
      return e.ripples[0].position.z !== a;
    });
    assert.ok(motion);
    await page.getByRole('button', { name: '世界设置', exact: true }).click();
    await page.getByRole('button', { name: '雷雨', exact: true }).click();
    await page.getByRole('button', { name: '深夜', exact: false }).click();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    const weather = await page.evaluate(() => ({
      rain: window.__wildwood.rain.visible,
      weather: window.__wildwood.state.weather,
      hour: window.__wildwood.state.hour,
    }));
    assert.ok(weather.rain);
    assert.equal(weather.weather, 'storm');
    assert.ok(weather.hour >= 22);
    await page.screenshot({ path: `artifacts/${name}-night-storm.png` });
    results.push({ name, ...check, motion, weather });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/qa-results.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
