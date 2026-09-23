import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const results = [],
  errors = [];
await mkdir('artifacts', { recursive: true });
try {
  for (const [name, width, height] of [
    ['character-desktop', 1440, 960],
    ['character-mobile', 390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: width < 500,
      hasTouch: width < 500,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:3000');
    await page.waitForFunction(() => !!window.__wildwood);
    await page.evaluate(() => {
      const e = window.__wildwood;
      e.restart();
      e.setAutoWeather(false);
    });
    const point = async (x, y, z) =>
      page.evaluate(
        ({ x, y, z }) => {
          const e = window.__wildwood,
            p = e.camera.position.clone().set(x, y, z).project(e.camera);
          return {
            x: ((p.x + 1) * innerWidth) / 2,
            y: ((1 - p.y) * innerHeight) / 2,
          };
        },
        { x, y, z },
      );
    await page.getByRole('button', { name: '带阿木散步', exact: true }).click();
    const destination = await point(0, 0, 10);
    await page.mouse.click(destination.x, destination.y);
    await page.waitForFunction(
      () =>
        Math.hypot(
          window.__wildwood.resident.root.position.x,
          window.__wildwood.resident.root.position.z - 10,
        ) < 0.15,
      {},
      { timeout: 20000 },
    );
    const walking = await page.evaluate(() => ({
      position: window.__wildwood.resident.root.position.toArray(),
      speech: window.__wildwood.resident.speech,
    }));
    await page.getByRole('button', { name: '选择木墙', exact: true }).click();
    const build = await point(8, 0, 6);
    await page.mouse.click(build.x, build.y);
    await page.waitForFunction(
      () => window.__wildwood.resident.hammer.visible,
      {},
      { timeout: 20000 },
    );
    const work = await page.evaluate(async () => {
      const e = window.__wildwood,
        arm = e.resident.root.getObjectByName('armRight');
      const a = arm.rotation.x;
      await new Promise((r) => setTimeout(r, 180));
      return {
        built: e.state.built,
        tool: e.resident.hammer.visible,
        armMoves: arm.rotation.x !== a,
        route: e.residentRoute.length,
      };
    });
    assert.equal(work.built, 1);
    assert.ok(work.tool);
    assert.ok(work.armMoves);
    assert.equal(work.route, 0);
    await page.getByRole('button', { name: '看看阿木', exact: true }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `artifacts/${name}.png` });
    const canvas = await page.evaluate(() => {
      const e = window.__wildwood,
        gl = e.renderer.getContext(),
        bytes = new Uint8Array(
          gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
        );
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bytes,
      );
      const colors = new Set();
      for (let i = 0; i < bytes.length; i += 400)
        colors.add(
          `${bytes[i] >> 4},${bytes[i + 1] >> 4},${bytes[i + 2] >> 4}`,
        );
      const p = e.resident.root.position.clone();
      p.y = 1.5;
      p.project(e.camera);
      return {
        colors: colors.size,
        position: {
          x: ((p.x + 1) * innerWidth) / 2,
          y: ((1 - p.y) * innerHeight) / 2,
        },
        overflow: document.documentElement.scrollWidth > innerWidth,
        buttonsOutside: [...document.querySelectorAll('button')].filter((b) => {
          const r = b.getBoundingClientRect();
          return (
            r.left < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1
          );
        }).length,
      };
    });
    assert.ok(canvas.colors > 70);
    assert.equal(canvas.overflow, false);
    assert.equal(canvas.buttonsOutside, 0);
    assert.ok(
      canvas.position.y > height * 0.3 && canvas.position.y < height * 0.7,
    );
    await page.getByRole('button', { name: '世界设置', exact: true }).click();
    await page.getByRole('button', { name: '小雨', exact: true }).click();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.waitForFunction(
      () => window.__wildwood.resident.umbrella.visible,
    );
    assert.equal(
      await page.evaluate(() => window.__wildwood.resident.mood),
      'rainy',
    );
    await page.screenshot({ path: `artifacts/${name}-rain.png` });
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    const paused = await page.evaluate(async () => {
      const e = window.__wildwood,
        t = e.resident.time;
      await new Promise((r) => setTimeout(r, 200));
      return e.resident.time === t;
    });
    assert.ok(paused);
    await page.getByRole('button', { name: '继续游戏', exact: true }).click();
    await page.getByRole('button', { name: '保存家园', exact: true }).click();
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wildwood-save-v1')),
    );
    assert.ok(save.resident);
    await page.reload();
    await page.waitForFunction(() => !!window.__wildwood);
    const restored = await page.evaluate(() => ({
      x: window.__wildwood.resident.root.position.x,
      z: window.__wildwood.resident.root.position.z,
    }));
    assert.deepEqual(restored, save.resident);
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('wildwood-save-v1'));
      delete data.resident;
      delete data.state.residentMood;
      delete data.state.residentActivity;
      localStorage.setItem('wildwood-save-v1', JSON.stringify(data));
    });
    // Navigation does not overwrite the old-format fixture as a pagehide autosave would.
    await page.evaluate(() =>
      window.removeEventListener('pagehide', window.__wildwood.pageHide),
    );
    await page.reload();
    await page.waitForFunction(() => !!window.__wildwood);
    const oldSave = await page.evaluate(() => ({
      wood: window.__wildwood.state.wood,
      built: window.__wildwood.state.built,
      mood: window.__wildwood.state.residentMood,
    }));
    assert.equal(oldSave.wood, save.state.wood);
    assert.equal(oldSave.built, 1);
    assert.ok(oldSave.mood);
    results.push({ name, walking, work, canvas, paused, restored, oldSave });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/character-qa.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
