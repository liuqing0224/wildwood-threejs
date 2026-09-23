import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseline = process.argv.includes('--baseline');
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const results = [],
  errors = [];
await mkdir('artifacts', { recursive: true });
try {
  for (const [name, width, height] of baseline
    ? [['desktop', 1200, 800]]
    : [
        ['desktop', 1200, 800],
        ['mobile', 390, 844],
      ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (e) => errors.push(e.message));
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    await page.goto('http://localhost:3000');
    await page.waitForFunction(() => !!window.__wildwood);
    const initialNavigations = navigations;
    // Run the actual frame loop at a fixed delta to test multiple storm cycles quickly.
    const trace = await page.evaluate(() => {
      const e = window.__wildwood;
      cancelAnimationFrame(e.frame);
      e.setAutoWeather(false);
      e.setHour(7.2);
      e.setWeather('storm');
      e.state.nextRaid = 1000;
      e.clock.getDelta = () => 1 / 30;
      const realRender = e.renderer.render.bind(e.renderer);
      e.renderer.render = () => {};
      const sun = [],
        ambient = [];
      for (let i = 0; i < 720; i++) {
        e.state.hour = 7.2;
        e.animate();
        cancelAnimationFrame(e.frame);
        if (i >= 180) {
          sun.push(e.sun.intensity);
          ambient.push(e.ambient.intensity);
        }
      }
      const maxStep = (values) =>
        Math.max(...values.slice(1).map((v, i) => Math.abs(v - values[i])));
      e.renderer.render = realRender;
      realRender(e.scene, e.camera);
      const canvas = e.renderer.domElement,
        gl = e.renderer.getContext(),
        pixels = new Uint8Array(
          gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
        );
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 400)
        colors.add(
          `${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`,
        );
      return {
        sunMin: Math.min(...sun),
        sunMax: Math.max(...sun),
        maxSunStep: maxStep(sun),
        maxAmbientStep: maxStep(ambient),
        canvasColors: colors.size,
        canvasCount: document.querySelectorAll('canvas').length,
        rainVisible: e.rain.visible,
        weather: e.state.weather,
        canvasWidth: canvas.width,
      };
    });
    if (!baseline) {
      assert.ok(trace.sunMax < 1.3);
      assert.ok(trace.maxSunStep < 0.02);
      assert.ok(trace.maxAmbientStep < 0.02);
      assert.equal(trace.canvasCount, 1);
      assert.ok(trace.canvasColors > 50);
      assert.ok(trace.rainVisible);
      assert.equal(navigations - initialNavigations, 0);
    }
    await page.screenshot({
      path: `artifacts/flicker-${baseline ? 'before' : 'after'}-${name}.png`,
    });
    const reloadsDuringSampling = navigations - initialNavigations;
    let defeat;
    if (!baseline) {
      defeat = await page.evaluate(() => {
        const e = window.__wildwood;
        e.state.health = 0;
        e.state.paused = false;
        e.state.nextRaid = 0;
        const hour = e.state.hour;
        let messages = 0;
        e.notify = () => messages++;
        const render = e.renderer.render;
        e.renderer.render = () => {};
        for (let i = 0; i < 60; i++) {
          e.animate();
          cancelAnimationFrame(e.frame);
        }
        e.renderer.render = render;
        e.togglePause();
        e.save();
        return {
          hourUnchanged: e.state.hour === hour,
          messages,
          paused: e.state.paused,
        };
      });
      assert.ok(defeat.hourUnchanged);
      assert.equal(defeat.messages, 0);
      assert.ok(defeat.paused);
      await page.reload();
      await page.waitForFunction(() => !!window.__wildwood);
      assert.equal(
        await page.evaluate(() => window.__wildwood.state.paused),
        true,
      );
    }
    results.push({
      name,
      initialNavigations,
      reloadsDuringSampling,
      defeat,
      ...trace,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  const report = { baseline, results, errors };
  await writeFile(
    `artifacts/flicker-${baseline ? 'before' : 'after'}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
