import assert from 'node:assert/strict';
import { chromium } from 'playwright';
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
    ['desktop', 1440, 960],
    ['mobile', 390, 844],
    ['small-mobile', 360, 740],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://localhost:3000');
    await page.waitForFunction(() => !!window.__wildwood);
    await page.evaluate(() => {
      const e = window.__wildwood;
      cancelAnimationFrame(e.frame);
      e.restart();
      e.setHour(9);
      e.setAutoWeather(false);
      e.setBuildRotation(0);
      // Keep gameplay frozen without setting paused: pointer building is still enabled.
      window.renderGame = () => {
        e.controls.update();
        e.scene.updateMatrixWorld(true);
        e.renderer.render(e.scene, e.camera);
      };
      window.renderGame();
    });
    const point = (x, y, z) =>
      page.evaluate(
        ({ x, y, z }) => {
          const e = window.__wildwood;
          const p = e.camera.position.clone().set(x, y, z).project(e.camera);
          return {
            x: ((p.x + 1) * innerWidth) / 2,
            y: ((1 - p.y) * innerHeight) / 2,
          };
        },
        { x, y, z },
      );
    await page.getByRole('button', { name: '选择木墙', exact: true }).click();
    const site = await point(8, 0, 6);
    await page.mouse.move(site.x, site.y);
    await page.getByRole('button', { name: '纵向放置', exact: true }).click();
    const preview = await page.evaluate(() => {
      const e = window.__wildwood;
      window.renderGame();
      return {
        visible: e.ghost.visible,
        rotation: e.ghost.rotation.y,
        angle: e.state.buildRotation,
        cell: e.previewCell,
      };
    });
    assert.ok(preview.visible, `${name}: build preview is hidden at ${JSON.stringify(site)}`);
    assert.equal(preview.rotation, Math.PI / 2);
    assert.equal(await page.getByLabel('旋转角度').inputValue(), '90');
    await page.getByRole('button', { name: '选择木门', exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.__wildwood.ghost.rotation.y),
      Math.PI / 2,
    );
    await page.getByRole('button', { name: '选择木墙', exact: true }).click();
    await page.mouse.click(site.x, site.y);
    const placed = await page.evaluate(() => {
      const e = window.__wildwood;
      const block = e.blocks.find(
        (b) => b.kind === 'wall' && b.x === 4 && b.z === 3,
      );
      window.renderGame();
      const mesh = e.blockMeshes.get(block.id);
      // A side wall's horizontal footprint is long along Z, not X.
      const positions = [];
      mesh.traverse((o) => {
        if (!o.isMesh) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++)
          positions.push(
            mesh.position
              .clone()
              .set(a.getX(i), a.getY(i), a.getZ(i))
              .applyMatrix4(o.matrixWorld),
          );
      });
      const extent = (axis) =>
        Math.max(...positions.map((p) => p[axis])) -
        Math.min(...positions.map((p) => p[axis]));
      return {
        id: block.id,
        rotation: block.rotation,
        meshRotation: mesh.rotation.y,
        xSize: extent('x'),
        zSize: extent('z'),
        wood: e.state.wood,
        hp: block.hp,
        count: e.blocks.length,
      };
    });
    assert.equal(placed.rotation, Math.PI / 2);
    assert.equal(placed.meshRotation, Math.PI / 2);
    assert.ok(placed.zSize > placed.xSize * 3, JSON.stringify(placed));
    assert.equal(placed.wood, 230);

    await page
      .getByRole('button', { name: '旋转已建部件', exact: true })
      .click();
    const wall = await point(8, 1.5, 6);
    await page.mouse.move(wall.x, wall.y);
    assert.equal(
      await page.evaluate(() => window.__wildwood.hoveredBlockId),
      placed.id,
    );
    await page.mouse.click(wall.x, wall.y);
    const rotated = await page.evaluate((id) => {
      const e = window.__wildwood;
      window.renderGame();
      const b = e.blocks.find((b) => b.id === id);
      return {
        rotation: b.rotation,
        meshRotation: e.blockMeshes.get(id).rotation.y,
        wood: e.state.wood,
        hp: b.hp,
        count: e.blocks.length,
      };
    }, placed.id);
    assert.equal(rotated.rotation, Math.PI);
    assert.equal(rotated.meshRotation, Math.PI);
    assert.equal(rotated.wood, placed.wood);
    assert.equal(rotated.hp, placed.hp);
    assert.equal(rotated.count, placed.count);
    await page.getByLabel('旋转角度', { exact: true }).fill('225');
    const wallBack = await page.evaluate((id) => {
      const e = window.__wildwood;
      window.renderGame();
      const mesh = e.blockMeshes.get(id);
      const front = mesh.position
        .clone()
        .set(0, 0, 1)
        .transformDirection(mesh.matrixWorld);
      return {
        rotation: e.blocks.find((b) => b.id === id).rotation,
        front: front.toArray(),
      };
    }, placed.id);
    assert.equal(wallBack.rotation, (225 * Math.PI) / 180);
    assert.ok(wallBack.front[0] < -0.7 && wallBack.front[2] < -0.7);
    await page.getByRole('slider', { name: '自由旋转' }).press('End');
    assert.equal(await page.getByLabel('旋转角度').inputValue(), '359');
    await page.getByLabel('旋转角度').fill('180');
    await page.getByRole('button', { name: '选择木墙', exact: true }).click();
    await page.getByRole('button', { name: '横向放置', exact: true }).click();
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Process',
          code: 'KeyR',
          bubbles: true,
        }),
      ),
    );
    assert.equal(await page.getByLabel('旋转角度').inputValue(), '90');
    await page.keyboard.press('r');
    await page.keyboard.press('r');
    await page.keyboard.press('r');
    assert.equal(await page.getByLabel('旋转角度').inputValue(), '0');
    await page.getByRole('button', { name: '旋转部件', exact: true }).click();
    assert.equal(await page.getByLabel('旋转角度').inputValue(), '90');
    await page.getByRole('button', { name: '转到背面' }).click();
    assert.equal(await page.getByLabel('旋转角度').inputValue(), '270');
    await page.getByRole('button', { name: '选择木栅栏', exact: true }).click();
    await page.getByLabel('旋转角度').fill('135');
    await page.evaluate(() => {
      const e = window.__wildwood;
      const delta = e.controls.target.clone().set(10, 1.5, 8).sub(e.controls.target);
      e.controls.target.add(delta);
      e.camera.position.add(delta);
      window.renderGame();
    });
    const fenceSite = await point(10, 0, 8);
    await page.mouse.click(fenceSite.x, fenceSite.y);
    await page.evaluate(() => window.renderGame());
    const fenceId = await page.evaluate(
      () =>
        window.__wildwood.blocks.find(
          (b) => b.kind === 'fence' && b.x === 5 && b.z === 4,
        )?.id,
    );
    assert.ok(fenceId, JSON.stringify({ name, fenceSite }));
    assert.equal(
      await page.evaluate(
        (id) => window.__wildwood.blockMeshes.get(id).rotation.y,
        fenceId,
      ),
      (135 * Math.PI) / 180,
    );
    await page
      .getByRole('button', { name: '旋转已建部件', exact: true })
      .click();
    const fencePoint = await point(10, 1.03, 8);
    await page.mouse.move(fencePoint.x, fencePoint.y);
    assert.equal(
      await page.evaluate(() => window.__wildwood.hoveredBlockId),
      fenceId,
    );
    await page.mouse.click(fencePoint.x, fencePoint.y);
    await page.getByLabel('旋转角度').fill('270');
    await page.getByRole('slider', { name: '自由旋转' }).press('End');
    const fenceRotation = await page.evaluate(
      (id) => window.__wildwood.blocks.find((b) => b.id === id).rotation,
      fenceId,
    );
    assert.equal(fenceRotation, (359 * Math.PI) / 180);

    const roof = await page.evaluate(() => {
      const e = window.__wildwood;
      const b = e.blocks.find(
        (b) => b.kind === 'roof' && b.x === 0 && b.z === 1,
      );
      e.rotateBlock(b.id);
      e.setBuildRotation(Math.PI / 2);
      e.save();
      return {
        id: b.id,
        rotation: b.rotation,
        meshRotation: e.blockMeshes.get(b.id).rotation.y,
      };
    });
    assert.equal(roof.rotation, Math.PI / 2);
    assert.equal(roof.meshRotation, Math.PI / 2);
    const visual = await page.evaluate(() => {
      const e = window.__wildwood;
      window.renderGame();
      const gl = e.renderer.getContext();
      const pixels = new Uint8Array(
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
      const outside = [...document.querySelectorAll('button')]
        .filter((button) => {
          const b = button.getBoundingClientRect();
          return (
            b.width &&
            (b.x < 0 ||
              b.right > innerWidth + 1 ||
              b.y < 0 ||
              b.bottom > innerHeight + 1)
          );
        })
        .map((b) => b.getAttribute('aria-label'));
      return {
        colors: colors.size,
        outside,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(visual.colors > 50);
    assert.deepEqual(visual.outside, []);
    assert.equal(visual.overflow, false);
    await page.screenshot({ path: `artifacts/rotation-${name}.png` });
    await page.reload();
    await page.waitForFunction(() => !!window.__wildwood);
    const restored = await page.evaluate(
      ({ wallId, roofId, fenceId }) => {
        const e = window.__wildwood;
        cancelAnimationFrame(e.frame);
        return {
          wall: e.blockMeshes.get(wallId).rotation.y,
          roof: e.blockMeshes.get(roofId).rotation.y,
          next: e.state.buildRotation,
          wood: e.state.wood,
          fence: e.blockMeshes.get(fenceId).rotation.y,
        };
      },
      { wallId: placed.id, roofId: roof.id, fenceId },
    );
    assert.deepEqual(restored, {
      wall: Math.PI,
      roof: Math.PI / 2,
      next: Math.PI / 2,
      wood: 222,
      fence: (359 * Math.PI) / 180,
    });
    results.push({
      name,
      preview,
      placed,
      rotated,
      wallBack,
      fenceRotation,
      roof,
      visual,
      restored,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/rotation-qa.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
