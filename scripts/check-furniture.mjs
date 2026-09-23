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
    page.setDefaultTimeout(60000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://localhost:3000');
    await page.waitForFunction(() => !!window.__wildwood);
    await page.evaluate(() => {
      const e = window.__wildwood;
      cancelAnimationFrame(e.frame);
      e.restart();
      e.setHour(10);
      e.setAutoWeather(false);
      window.renderGame = () => {
        e.controls.update();
        e.scene.updateMatrixWorld(true);
        e.renderer.render(e.scene, e.camera);
      };
      window.renderGame();
    });
    await page.getByRole('tab', { name: '家具', exact: true }).click();
    assert.ok(
      await page
        .getByRole('button', { name: '制作木床', exact: true })
        .isDisabled(),
    );
    assert.match(
      await page.locator('.furniture-recipe').innerText(),
      /12 纤维/,
    );

    // Exercise the shared gathering transaction used by pointer and agent work.
    const gathered = await page.evaluate(() => {
      const e = window.__wildwood;
      const trees = [...e.resources.entries()]
        .filter(([, m]) => m.userData.resourceType === 'wood')
        .slice(0, 4);
      const before = e.state.wood;
      trees.forEach(([key]) => e.harvestResource(key));
      const repeat = e.harvestResource(trees[0][0]);
      return {
        wood: e.state.wood - before,
        fiber: e.state.fiber,
        harvested: e.state.harvested,
        repeat,
      };
    });
    assert.deepEqual(gathered, {
      wood: 96,
      fiber: 24,
      harvested: 4,
      repeat: false,
    });
    await page.getByRole('button', { name: '制作木床', exact: true }).click();
    const crafted = await page.evaluate(() => {
      const e = window.__wildwood;
      return {
        wood: e.state.wood,
        stone: e.state.stone,
        fiber: e.state.fiber,
        stock: e.state.furnitureStock.bed,
        crafted: e.state.crafted,
      };
    });
    assert.deepEqual(crafted, {
      wood: 312,
      stone: 120,
      fiber: 12,
      stock: 1,
      crafted: 1,
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
    await page.evaluate(() => window.renderGame());
    const clickWorld = async (x, y, z) => {
      const p = await point(x, y, z);
      await page.mouse.click(p.x, p.y);
    };
    await page.getByLabel('旋转角度', { exact: true }).fill('90');
    await clickWorld(-2, 0, -2);
    const placed = await page.evaluate(() => {
      const e = window.__wildwood,
        b = e.blocks.find((b) => b.kind === 'bed');
      window.renderGame();
      return {
        block: b,
        stock: e.state.furnitureStock.bed,
        wood: e.state.wood,
        fiber: e.state.fiber,
        meshRotation: b && e.blockMeshes.get(b.id).rotation.y,
        roofsHidden: e.blocks
          .filter((b) => b.kind === 'roof')
          .every((b) => !e.blockMeshes.get(b.id).visible),
      };
    });
    assert.ok(placed.block, `${name}: bed pointer placement failed`);
    assert.deepEqual([placed.block.x, placed.block.z], [-1, -1]);
    assert.equal(placed.block.rotation, Math.PI / 2);
    assert.equal(placed.meshRotation, Math.PI / 2);
    assert.equal(placed.stock, 0);
    assert.equal(placed.wood, crafted.wood);
    assert.equal(placed.fiber, crafted.fiber);
    assert.ok(placed.roofsHidden);

    await page.getByRole('button', { name: '选择木椅', exact: true }).click();
    await page.getByRole('button', { name: '制作木椅', exact: true }).click();
    const door = await page.evaluate(() => {
      const e = window.__wildwood;
      return {
        error: e.placementError(0, 1, 'chair'),
        built: e.buildTarget('chair', { x: 0, z: 1 }, 0),
        stock: e.state.furnitureStock.chair,
        noFloor: e.placementError(5, 5, 'chair'),
      };
    });
    assert.match(door.error, /通道/);
    assert.equal(door.built, false);
    assert.equal(door.stock, 1);
    assert.match(door.noFloor, /木地板/);
    await clickWorld(2, 0, -2);
    assert.ok(
      await page.evaluate(() =>
        window.__wildwood.blocks.some(
          (b) => b.kind === 'chair' && b.x === 1 && b.z === -1,
        ),
      ),
    );

    await page
      .getByRole('button', { name: '选择编织地毯', exact: true })
      .click();
    await page
      .getByRole('button', { name: '制作编织地毯', exact: true })
      .click();
    await clickWorld(-2, 0, -2);
    assert.ok(
      await page.evaluate(() =>
        window.__wildwood.blocks.some(
          (b) => b.kind === 'rug' && b.x === -1 && b.z === -1,
        ),
      ),
    );

    // Inspect the real rendered bed, rotate it, and pack it through pointer actions.
    await page.evaluate(() => window.renderGame());
    await page
      .getByRole('button', { name: '旋转已建部件', exact: true })
      .click();
    await clickWorld(-2, 0.95, -2);
    assert.equal(
      await page.evaluate(() => window.__wildwood.state.rotatingName),
      '木床',
    );
    await page.getByLabel('旋转角度', { exact: true }).fill('359');
    await page.getByRole('button', { name: '拆除', exact: true }).click();
    await clickWorld(-2, 0.95, -2);
    const packed = await page.evaluate(() => ({
      stock: window.__wildwood.state.furnitureStock.bed,
      bed: window.__wildwood.blocks.some((b) => b.kind === 'bed'),
      wood: window.__wildwood.state.wood,
    }));
    assert.deepEqual(packed, { stock: 1, bed: false, wood: 304 });
    await page.getByRole('button', { name: '选择木床', exact: true }).click();
    await page.getByLabel('旋转角度', { exact: true }).fill('359');
    await clickWorld(-2, 0, -2);

    // Resource-rich fixtures cover remaining models without bypassing recipes or inventory placement.
    const rest = await page.evaluate(() => {
      const e = window.__wildwood;
      e.state.fiber = 10;
      for (const [kind, x, z] of [
        ['table', -1, 1],
        ['chest', 1, 1],
        ['lamp', 0, -1],
      ]) {
        e.craft(kind);
        if (!e.buildTarget(kind, { x, z }, 0))
          throw new Error(`Could not place ${kind}`);
      }
      e.residentRoute = [];
      e.agentTask = null;
      e.residentJob = null;
      e.resident.root.position.set(-2, 0, 0);
      e.state.comfort = 40;
      e.updateAgent(1);
      const comfort = e.state.comfort;
      e.state.paused = true;
      const before = e.state.wood;
      e.craft('table');
      const pausedUnchanged = e.state.wood === before;
      e.state.paused = false;
      e.save();
      window.renderGame();
      return {
        comfort,
        pausedUnchanged,
        kinds: e.blocks
          .filter((b) =>
            ['bed', 'chair', 'table', 'chest', 'lamp', 'rug'].includes(b.kind),
          )
          .map((b) => b.kind),
        saved: JSON.parse(localStorage.getItem('wildwood-save-v1')),
      };
    });
    assert.equal(rest.comfort, 47);
    assert.ok(rest.pausedUnchanged);
    assert.equal(rest.kinds.length, 6);
    assert.equal(rest.saved.state.crafted, 6);
    assert.equal(
      rest.saved.blocks.find((b) => b.kind === 'bed').rotation,
      (359 * Math.PI) / 180,
    );

    await page.getByRole('button', { name: '拆除', exact: true }).click();
    await page.evaluate(() => {
      window.__wildwood.blocks.find((b) => b.kind === 'bed').hp = 70;
      window.renderGame();
    });
    await clickWorld(-2, 0.95, -2);
    assert.equal(
      await page.evaluate(
        () => window.__wildwood.blocks.find((b) => b.kind === 'bed')?.hp,
      ),
      70,
    );
    assert.match(await page.getByRole('status').innerText(), /先修好/);
    await page.getByRole('button', { name: '修理', exact: true }).click();
    await clickWorld(-2, 0.95, -2);
    assert.equal(
      await page.evaluate(
        () => window.__wildwood.blocks.find((b) => b.kind === 'bed')?.hp,
      ),
      100,
    );
    await page.getByRole('button', { name: '拆除', exact: true }).click();
    await clickWorld(2.88, 0.25, 2.88);
    assert.match(await page.getByRole('status').innerText(), /先收起/);
    await page.getByRole('button', { name: '选择木床', exact: true }).click();

    const visuals = await page.evaluate(() => {
      const e = window.__wildwood;
      e.ghost.visible = false;
      window.renderGame();
      const c = document.createElement('canvas');
      c.width = 120;
      c.height = 90;
      const ctx = c.getContext('2d');
      ctx.drawImage(e.renderer.domElement, 0, 0, 120, 90);
      const data = ctx.getImageData(0, 0, 120, 90).data,
        colors = new Set();
      for (let i = 0; i < data.length; i += 4)
        colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
      const bounds = [
        ...document.querySelectorAll(
          '.bottom-hud button, .bottom-hud input, .furniture-recipe, .left-hud, .right-hud, .selection-info',
        ),
      ]
        .map((el) => ({
          label: el.getAttribute('aria-label') || el.className,
          ...el.getBoundingClientRect().toJSON(),
        }))
        .filter((r) => r.width && r.height);
      // Each model must contribute visible pixels, not just exist in the scene graph.
      const sample = () => {
        e.renderer.render(e.scene, e.camera);
        ctx.drawImage(e.renderer.domElement, 0, 0, 120, 90);
        return ctx.getImageData(0, 0, 120, 90).data;
      };
      const modelPixels = {};
      const baseline = sample();
      for (const block of e.blocks.filter((b) =>
        ['bed', 'chair', 'table', 'chest', 'lamp', 'rug'].includes(b.kind),
      )) {
        const mesh = e.blockMeshes.get(block.id);
        mesh.visible = false;
        const hidden = sample();
        mesh.visible = true;
        let changed = 0;
        for (let i = 0; i < baseline.length; i += 4)
          if (
            Math.abs(baseline[i] - hidden[i]) +
              Math.abs(baseline[i + 1] - hidden[i + 1]) +
              Math.abs(baseline[i + 2] - hidden[i + 2]) >
            12
          )
            changed++;
        modelPixels[block.kind] = changed;
      }
      window.renderGame();
      return {
        colors: colors.size,
        modelPixels,
        overflow: document.documentElement.scrollWidth > innerWidth,
        bounds,
      };
    });
    assert.ok(visuals.colors > 40);
    assert.equal(visuals.overflow, false);
    for (const [kind, pixels] of Object.entries(visuals.modelPixels))
      assert.ok(
        pixels >= 2,
        `${name}: ${kind} has no visible pixels (${pixels})`,
      );
    for (const r of visuals.bounds)
      assert.ok(
        r.x >= -1 &&
          r.y >= -1 &&
          r.right <= width + 1 &&
          r.bottom <= height + 1,
        `${name} bounds ${JSON.stringify(r)}`,
      );
    const info = visuals.bounds.find((b) => b.label === 'selection-info');
    const right = visuals.bounds.find((b) => b.label === 'right-hud');
    assert.ok(
      info.y >= right.bottom || info.right <= right.x,
      `${name}: crafting panel overlaps right HUD ${info.y} < ${right.bottom}`,
    );
    await page.screenshot({ path: `artifacts/furniture-${name}.png` });

    await page.reload();
    await page.waitForFunction(() => !!window.__wildwood);
    const restored = await page.evaluate(() => {
      const e = window.__wildwood;
      cancelAnimationFrame(e.frame);
      return {
        stock: e.state.furnitureStock,
        fiber: e.state.fiber,
        crafted: e.state.crafted,
        bed: e.blocks.find((b) => b.kind === 'bed'),
      };
    });
    assert.deepEqual(restored.stock, rest.saved.state.furnitureStock);
    assert.equal(restored.fiber, rest.saved.state.fiber);
    assert.equal(restored.bed.rotation, (359 * Math.PI) / 180);
    // Old v1 saves get complete empty stocks instead of undefined counts.
    await page.evaluate(() => {
      const e = window.__wildwood;
      const save = JSON.parse(localStorage.getItem('wildwood-save-v1'));
      delete save.state.fiber;
      delete save.state.furnitureStock;
      delete save.state.crafted;
      e.save = () => {};
      localStorage.setItem('wildwood-save-v1', JSON.stringify(save));
    });
    await page.reload();
    await page.waitForFunction(() => !!window.__wildwood);
    assert.deepEqual(
      await page.evaluate(() => {
        const e = window.__wildwood;
        cancelAnimationFrame(e.frame);
        return [
          e.state.fiber,
          e.state.crafted,
          Object.values(e.state.furnitureStock),
        ];
      }),
      [0, 0, [0, 0, 0, 0, 0, 0]],
    );
    results.push({
      name,
      gathered,
      crafted,
      placed,
      door,
      packed,
      rest: { comfort: rest.comfort, kinds: rest.kinds },
      restored,
      visuals,
    });
    console.log(`${name} passed`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/furniture-qa.json',
    JSON.stringify({ results, errors }, null, 2),
  );
} finally {
  await browser.close();
}
