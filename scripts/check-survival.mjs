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
    ['desktop', 1440, 960],
    ['mobile', 390, 844],
    ['small-mobile', 360, 740],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:3000');
    await page.waitForFunction(() => !!window.__wildwood);
    await page.evaluate(() => {
      const e = window.__wildwood;
      cancelAnimationFrame(e.frame);
      window.step = (seconds) => {
        const render = e.renderer.render;
        e.renderer.render = () => {};
        e.clock.getDelta = () => 0.05;
        for (let i = 0; i < seconds * 20; i++) {
          e.animate();
          cancelAnimationFrame(e.frame);
        }
        e.renderer.render = render;
        e.renderer.render(e.scene, e.camera);
        e.publish();
      };
      window.cleanWorld = () => {
        e.restart();
        e.setHour(9);
        e.setAutoWeather(false);
        e.setWeather('clear');
        e.state.nextRaid = 10000;
      };
      window.cleanWorld();
    });
    await page.getByRole('button', { name: '自动托管', exact: true }).click();
    await page
      .locator('.world')
      .click({ position: { x: width / 2, y: height / 2 }, force: true });
    // Real keyboard events, with fixed simulation steps for reproducibility.
    const before = await page.evaluate(() => {
      const e = window.__wildwood;
      e.setAgent(true);
      return { x: e.resident.root.position.x, z: e.resident.root.position.z };
    });
    await page.keyboard.down('d');
    await page.evaluate(() => window.step(1));
    await page.keyboard.up('d');
    const keyboard = await page.evaluate(() => {
      const e = window.__wildwood;
      const p = e.resident.root.position.clone();
      window.step(1);
      return {
        x: p.x,
        z: p.z,
        auto: e.state.agentEnabled,
        stopped: p.distanceTo(e.resident.root.position) < 0.1,
      };
    });
    assert.ok(Math.hypot(keyboard.x - before.x, keyboard.z - before.z) > 0.5);
    assert.equal(keyboard.auto, false);
    assert.ok(keyboard.stopped);
    await page.keyboard.down('d');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.evaluate(() => window.__wildwood.heldKeys.size), 0);
    await page.keyboard.up('d');
    await page.evaluate(() => {
      const e = window.__wildwood;
      window.cleanWorld();
      e.resident.root.position.set(2, 0, 2);
      e.controls.target.set(0, 0, 0);
      e.camera.position.set(0, 30, 30);
    });
    await page.keyboard.down('w');
    await page.evaluate(() => window.step(5));
    await page.keyboard.up('w');
    const collision = await page.evaluate(
      () => window.__wildwood.resident.root.position.z,
    );
    assert.ok(
      collision >= -2.8 && collision < 0,
      `wall collision: ${collision}`,
    );

    await page.evaluate(() => {
      const e = window.__wildwood;
      e.resident.root.position.set(0, 0, 2);
      e.state.health = 70;
      e.state.wood = 240;
    });
    await page.keyboard.press('c');
    await page.keyboard.press('e');
    const repair = await page.evaluate(() => {
      window.step(3);
      const e = window.__wildwood;
      return { health: e.state.health, wood: e.state.wood };
    });
    assert.deepEqual(repair, { health: 90, wood: 236 });

    const development = await page.evaluate(() => {
      window.cleanWorld();
      const e = window.__wildwood;
      e.setAgent(true, 'develop');
      window.step(170);
      return {
        built: e.state.built,
        harvested: e.state.harvested,
        wood: e.state.wood,
        stone: e.state.stone,
        status: e.state.agentStatus,
        task: e.agentTask,
        route: e.residentRoute,
        position: e.currentCell(),
      };
    });
    assert.ok(development.harvested >= 3, JSON.stringify(development));
    assert.ok(development.built >= 3, JSON.stringify(development));
    assert.ok(development.wood >= 0 && development.stone >= 0);

    const shelter = await page.evaluate(() => {
      window.cleanWorld();
      const e = window.__wildwood;
      e.setAgent(true, 'harvest');
      window.step(1);
      const harvested = e.state.harvested;
      e.setWeather('storm');
      window.step(35);
      const roof = e.blocks.find(
        (b) => b.kind === 'roof' && b.x === 0 && b.z === 0,
      );
      const door = e.blocks.find((b) => b.kind === 'door');
      return {
        sheltered: e.state.sheltered,
        defending: e.state.defending,
        comfort: e.state.comfort,
        position: e.currentCell(),
        roofHidden: !e.blockMeshes.get(roof.id).visible,
        doorAngle: e.blockMeshes.get(door.id).getObjectByName('door-leaf')
          .rotation.y,
        noHarvestInStorm: harvested === e.state.harvested,
        umbrellaVisible: e.resident.umbrella.visible,
      };
    });
    assert.ok(
      shelter.sheltered &&
        shelter.defending &&
        shelter.roofHidden &&
        shelter.noHarvestInStorm,
      JSON.stringify(shelter),
    );
    assert.ok(Math.abs(shelter.doorAngle) < 0.1);
    assert.equal(shelter.comfort, 100);
    assert.equal(shelter.umbrellaVisible, false);
    assert.ok(
      await page.evaluate(() => {
        const e = window.__wildwood;
        const p = e.rain.geometry.attributes.position;
        p.setXYZ(0, 0, 1, 2);
        p.setXYZ(1, 0, 0.2, 2);
        window.step(0.05);
        return p.getY(0) >= 4.6 && p.getY(1) >= 3.8;
      }),
    );

    const defense = await page.evaluate(() => {
      const e = window.__wildwood;
      e.startRaid();
      const enemy = e.enemies[0];
      const door = e.blocks.find((b) => b.kind === 'door');
      enemy.mesh.position.set(0, 0, 5.5);
      enemy.target = door.id;
      enemy.repath = 999;
      enemy.cooldown = 0;
      e.defenseTimer = 0;
      const hp = door.hp;
      window.step(0.1);
      return { damage: hp - door.hp, enemyHp: enemy.hp };
    });
    assert.equal(defense.damage, 9);
    assert.equal(defense.enemyHp, 78);
    await page.evaluate(() => {
      const e = window.__wildwood;
      for (const enemy of [...e.enemies]) e.damageEnemy(enemy, 1000);
      e.state.nextRaid = 10000;
      e.setWeather('rain');
      window.step(2);
    });
    assert.equal(
      await page.evaluate(() => window.__wildwood.state.agentStatus),
      '屋内避雨',
    );
    const resumed = await page.evaluate(() => {
      const e = window.__wildwood;
      const count = e.state.harvested;
      e.setWeather('clear');
      window.step(60);
      return {
        harvested: e.state.harvested - count,
        status: e.state.agentStatus,
      };
    });
    assert.ok(resumed.harvested > 0, JSON.stringify(resumed));

    await page.keyboard.press('h');
    await page.evaluate(() => window.step(35));
    assert.ok(await page.evaluate(() => window.__wildwood.state.sheltered));
    const pixels = await page.evaluate(() => {
      const e = window.__wildwood;
      e.focusResident();
      window.step(0.1);
      const gl = e.renderer.getContext();
      const bytes = new Uint8Array(
        gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
      );
      e.renderer.render(e.scene, e.camera);
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
      return colors.size;
    });
    assert.ok(pixels > 50);
    await page.screenshot({ path: `artifacts/survival-${name}.png` });
    const layout = await page.evaluate(() => {
      const elements = ['.resident-card', '.right-hud', '.build-dock']
        .map((s) => document.querySelector(s))
        .filter(Boolean)
        .map((e) => {
          const b = e.getBoundingClientRect();
          return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
        });
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        elements,
      };
    });
    assert.equal(layout.overflow, false);
    for (const b of layout.elements)
      assert.ok(
        b.x >= 0 && b.right <= width + 1 && b.y >= 0 && b.bottom <= height + 1,
        JSON.stringify(layout),
      );
    const blockedEntry = await page.evaluate(() => {
      window.cleanWorld();
      const e = window.__wildwood;
      e.resident.root.position.set(0, 0, 6);
      const object = [...e.resources.values()][0];
      const original = object.position.clone();
      object.position.set(0, 0, 4);
      e.setWeather('storm');
      e.setAgent(true);
      window.step(4);
      const blocked =
        !e.state.sheltered && e.state.agentStatus.startsWith('无可达');
      object.position.copy(original);
      window.step(10);
      return { blocked, recovered: e.state.sheltered };
    });
    assert.ok(
      blockedEntry.blocked && blockedEntry.recovered,
      JSON.stringify(blockedEntry),
    );
    const roofLoss = await page.evaluate(() => {
      const e = window.__wildwood;
      e.setWeather('storm');
      e.setAgent(true);
      for (const b of [...e.blocks]) if (b.kind === 'roof') e.removeBlock(b);
      window.step(4);
      return {
        sheltered: e.state.sheltered,
        comfort: e.state.comfort,
        status: e.state.agentStatus,
      };
    });
    assert.equal(roofLoss.sheltered, false);
    assert.ok(roofLoss.comfort < 100);
    assert.match(roofLoss.status, /无可达安全屋/);

    const random = await page.evaluate(() => {
      const e = window.__wildwood;
      e.setAutoWeather(true);
      const before = e.state.weather;
      e.state.weatherRemaining = 0.1;
      window.step(0.2);
      e.state.hour = 23.999;
      const day = e.state.day;
      window.step(0.2);
      e.setAgent(true, 'repair');
      e.save();
      return {
        changed: e.state.weather !== before,
        duration: e.state.weatherRemaining,
        dayAdvanced: e.state.day === day + 1,
        daySeconds: e.state.daySeconds,
      };
    });
    assert.ok(random.changed && random.dayAdvanced);
    assert.ok(random.duration >= 44 && random.duration <= 120);
    assert.ok(random.daySeconds >= 240 && random.daySeconds <= 360);
    await page.reload();
    await page.waitForFunction(() => !!window.__wildwood);
    const persisted = await page.evaluate(() => {
      const e = window.__wildwood;
      cancelAnimationFrame(e.frame);
      return { enabled: e.state.agentEnabled, goal: e.state.agentGoal };
    });
    assert.deepEqual(persisted, { enabled: true, goal: 'repair' });
    results.push({
      name,
      keyboard,
      collision,
      repair,
      development,
      shelter,
      defense,
      resumed,
      pixels,
      layout,
      roofLoss,
      blockedEntry,
      random,
      persisted,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/survival-qa.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
