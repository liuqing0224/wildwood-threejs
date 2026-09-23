'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Axe,
  BedDouble,
  Armchair,
  Table2,
  Archive,
  Lamp,
  RectangleHorizontal,
  Layers,
  Bot,
  Box,
  CloudRain,
  CloudSun,
  Crosshair,
  Flag,
  Footprints,
  Grid2X2,
  Hammer,
  Heart,
  House,
  Leaf,
  Maximize,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Save,
  Settings2,
  Shield,
  Sparkles,
  Sun,
  Swords,
  Trees,
  UserRound,
  Volume2,
  VolumeX,
  Wind,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { GameEngine } from './game/engine';
import {
  CATALOG,
  BUILDINGS,
  FURNITURE,
  isFurniture,
  furnitureRecipeError,
  initialSnapshot,
  type Kind,
  type Snapshot,
  type Mode,
  type Weather,
  type AgentGoal,
} from './game/model';

const furnitureIcons = {
  bed: BedDouble,
  table: Table2,
  chair: Armchair,
  chest: Archive,
  lamp: Lamp,
  rug: RectangleHorizontal,
};

export default function Home() {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<GameEngine | null>(null);
  const [state, setState] = useState<Snapshot>(initialSnapshot());
  const [selected, setSelected] = useState<Kind>('wall');
  const [mode, setMode] = useState<Mode>('build');
  const [category, setCategory] = useState<'buildings' | 'furniture'>(
    'buildings',
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [grid, setGrid] = useState(false);
  const [sound, setSound] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (text: string) => {
    setToast(text);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(''), 3600);
  };
  useEffect(() => {
    let disposed = false;
    import('./game/engine')
      .then(({ GameEngine }) => {
        if (disposed || !container.current) return;
        try {
          engine.current = new GameEngine(container.current, setState, notify);
          if (process.env.NODE_ENV === 'development')
            (window as unknown as { __wildwood: GameEngine }).__wildwood =
              engine.current;
          setReady(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : '3D 场景未能启动');
        }
      })
      .catch(() => setError('游戏加载失败，请刷新重试。'));
    return () => {
      disposed = true;
      engine.current?.dispose();
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, []);
  function choose(kind: Kind) {
    setCategory(isFurniture(kind) ? 'furniture' : 'buildings');
    setSelected(kind);
    setMode('build');
    engine.current?.select(kind, 'build', true);
  }
  function tool(next: Mode) {
    setMode(next);
    engine.current?.select(selected, next);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          'input, textarea, select, [contenteditable="true"]',
        ) ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const kind = (Object.keys(BUILDINGS) as Kind[])[Number(event.key) - 1];
      if (kind) choose(kind);
      if (event.code === 'KeyQ') {
        event.preventDefault();
        tool('rotate');
        return;
      }
      const modes: Record<string, Mode> = {
        b: 'build',
        v: 'harvest',
        c: 'repair',
        m: 'walk',
        q: 'rotate',
      };
      if (modes[event.key.toLowerCase()]) tool(modes[event.key.toLowerCase()]);
      if (event.key.toLowerCase() === 'g')
        setGrid((current) => {
          engine.current?.toggleGrid(!current);
          return !current;
        });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);
  const item = CATALOG[selected];
  const furnishing = isFurniture(selected);
  const recipeError = furnishing ? furnitureRecipeError(state, selected) : null;
  const hours = Math.floor(state.hour).toString().padStart(2, '0');
  const mins = (Math.floor(((state.hour % 1) * 60) / 5) * 5)
    .toString()
    .padStart(2, '0');
  const night = state.hour < 6 || state.hour >= 19;
  const activeRotation =
    mode === 'rotate' ? state.editRotation : state.buildRotation;
  const rotationDegrees =
    (Math.round(((activeRotation ?? 0) * 2) / Math.PI) * 90) % 360;
  const rotationDisabled = mode === 'rotate' && activeRotation === null;
  return (
    <main
      className={`game-shell ${category === 'furniture' ? 'furnishing' : ''}`}
    >
      <div
        ref={container}
        className="world"
        aria-label="可交互的 3D 建造场景"
      />
      {!ready && (
        <div className="loading-screen">
          <Trees size={38} />
          <h1>林间筑梦</h1>
          <p>{error || '正在走进森林…'}</p>
          {error && <button onClick={() => location.reload()}>重新加载</button>}
        </div>
      )}
      <div className="vignette" />
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <House size={25} />
          </div>
          <div>
            <h1>
              林间筑梦<span>WILDWOOD</span>
            </h1>
            <p>
              <span className="live-dot" /> 自由建造 · 生存世界
            </p>
          </div>
        </div>
        <div className="resources">
          <div title="木材">
            <Trees />
            <span>
              <small>木材</small>
              <b>{state.wood}</b>
            </span>
          </div>
          <div title="石料">
            <Box />
            <span>
              <small>石料</small>
              <b>{state.stone}</b>
            </span>
          </div>
          <div title="家园核心生命值">
            <Heart className="heart" />
            <span>
              <small>家园</small>
              <b>
                {state.health}
                <em>/ 100</em>
              </b>
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="icon-button save-button"
            title="保存家园"
            aria-label="保存家园"
            onClick={() => engine.current?.save(true)}
          >
            <Save />
          </button>
          <button
            className={`icon-button ${settings ? 'active' : ''}`}
            title="世界设置"
            aria-label="世界设置"
            onClick={() => setSettings(!settings)}
          >
            <Settings2 />
          </button>
        </div>
      </header>
      <aside className="left-hud">
        <div className="resident-card">
          <button
            className="resident-portrait"
            aria-label="看看阿木"
            title="看看阿木"
            onClick={() => {
              tool('walk');
              engine.current?.focusResident();
            }}
          >
            <UserRound size={23} />
          </button>
          <div className="resident-identity">
            <small>松风谷地 · 小屋主人</small>
            <h2>
              阿木 <span>{state.residentActivity}</span>
            </h2>
          </div>
          <button
            className={`resident-walk ${mode === 'walk' ? 'selected' : ''}`}
            title="散步：点击营地前往"
            aria-label="带阿木散步"
            aria-pressed={mode === 'walk'}
            onClick={() => tool('walk')}
          >
            <Footprints size={18} />
          </button>
          <p>{state.residentMood}</p>
          <div className="agent-controls">
            <button
              className={`resident-walk ${state.agentEnabled ? 'selected' : ''}`}
              title="自动托管（T）"
              aria-label="自动托管"
              aria-pressed={state.agentEnabled}
              onClick={() => engine.current?.setAgent(!state.agentEnabled)}
            >
              <Bot size={18} />
            </button>
            <select
              aria-label="自动任务目标"
              value={state.agentGoal}
              onChange={(event) =>
                engine.current?.setAgent(true, event.target.value as AgentGoal)
              }
            >
              <option value="develop">发展家园</option>
              <option value="harvest">持续采集</option>
              <option value="repair">维修巡查</option>
            </select>
            <button
              className="resident-walk"
              title="回屋避险（H）"
              aria-label="回屋避险"
              onClick={() => engine.current?.seekShelter()}
            >
              <House size={17} />
            </button>
          </div>
          <div className="resident-condition">
            <span>
              {state.defending
                ? '屋内防御'
                : state.sheltered
                  ? '屋内安全'
                  : '户外'}{' '}
              · 舒适 {Math.round(state.comfort)}
            </span>
            <progress aria-label="阿木舒适度" value={state.comfort} max={100} />
          </div>
          <div className="resident-actions">
            <button
              title="就近操作（E）"
              aria-label="就近操作"
              onClick={() => engine.current?.interactNearby()}
            >
              <Hammer size={15} />
            </button>
            <button
              title="攻击附近怪物（F）"
              aria-label="攻击附近怪物"
              onClick={() => engine.current?.attackNearby()}
            >
              <Swords size={15} />
            </button>
            <span>{state.agentEnabled ? '自动托管中' : '手动控制'}</span>
          </div>
        </div>
        <section className="objectives">
          <div className="section-label">
            <Flag size={14} /> 家园手记{' '}
            <span>
              0
              {Math.min(
                3,
                Number(state.built >= 3) +
                  Number(state.harvested >= 3) +
                  Number(state.defeated > 0),
              )}{' '}
              / 03
            </span>
          </div>
          <div className={state.built >= 3 ? 'complete' : ''}>
            <i>{state.built >= 3 ? '✓' : '1'}</i>
            <span>
              添一处新居<small>搭建 3 个建筑部件</small>
            </span>
            <b>{Math.min(3, state.built)}/3</b>
          </div>
          <div className={state.harvested >= 3 ? 'complete' : ''}>
            <i>{state.harvested >= 3 ? '✓' : '2'}</i>
            <span>
              向森林借一点材料<small>采集 3 次木材或石料</small>
            </span>
            <b>{Math.min(3, state.harvested)}/3</b>
          </div>
          <div className={state.defeated > 0 ? 'complete' : ''}>
            <i>{state.defeated > 0 ? '✓' : '3'}</i>
            <span>
              守住这一盏灯<small>击退一只来袭的怪物</small>
            </span>
            <Shield size={15} />
          </div>
        </section>
        <div className={`raid-status ${state.monsters ? 'danger' : ''}`}>
          <div className="raid-icon">
            {state.monsters ? <Swords size={18} /> : <Shield size={18} />}
          </div>
          <div>
            <strong>
              {state.monsters
                ? `有 ${state.monsters} 只怪物正在来袭`
                : '森林暂时很安静'}
            </strong>
            <p>
              {state.monsters
                ? '守卫塔正在防御 · 点击怪物攻击'
                : `下次来袭 ${Math.floor(state.nextRaid / 60)
                    .toString()
                    .padStart(2, '0')}:${Math.floor(state.nextRaid % 60)
                    .toString()
                    .padStart(2, '0')}`}
            </p>
          </div>
        </div>
      </aside>
      <aside className="right-hud">
        <section className="clock-widget">
          <div className="day-label">
            <span>第 {state.day} 天</span>
            <span>
              {night ? '静谧之夜' : state.hour > 16 ? '日暮时分' : '林间好时光'}
            </span>
          </div>
          <div className="clock-main">
            {night ? <Moon /> : <Sun />}
            <b>
              {hours}
              <span>:</span>
              {mins}
            </b>
            <button
              className="icon-button"
              aria-label={state.paused ? '继续游戏' : '暂停游戏'}
              title={state.paused ? '继续游戏' : '暂停游戏'}
              onClick={() => engine.current?.togglePause()}
            >
              {state.paused ? <Play size={17} /> : <Pause size={17} />}
            </button>
          </div>
          <div className="day-track">
            <span style={{ left: `${(state.hour / 24) * 100}%` }} />
          </div>
          <div className="weather-line">
            {state.weather === 'clear' ? (
              <CloudSun size={18} />
            ) : state.weather === 'rain' ? (
              <CloudRain size={18} />
            ) : (
              <Wind size={18} />
            )}
            <span>
              {state.weather === 'clear'
                ? '晴朗'
                : state.weather === 'rain'
                  ? '小雨'
                  : '雷雨'}
              <em>{state.weather === 'clear' ? '23°' : '16°'}</em>
            </span>
            <Leaf size={14} />
            <small>{state.weather === 'storm' ? '强风' : '微风'}</small>
          </div>
          <div className="weather-cycle">
            {state.autoWeather
              ? `天气变化 · 约 ${Math.ceil(state.weatherRemaining)} 秒`
              : '天气已锁定'}
          </div>
        </section>
        <div className="view-tools">
          <button
            aria-label="放大"
            title="放大"
            onClick={() => engine.current?.zoom(0.85)}
          >
            <ZoomIn />
          </button>
          <button
            aria-label="缩小"
            title="缩小"
            onClick={() => engine.current?.zoom(1.18)}
          >
            <ZoomOut />
          </button>
          <span />
          <button
            aria-label="回到家园"
            title="回到家园"
            onClick={() => engine.current?.resetCamera()}
          >
            <Crosshair />
          </button>
          <button
            aria-label="切换全屏"
            title="切换全屏"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else
                void document.documentElement
                  .requestFullscreen()
                  .catch(() => notify('当前窗口不支持全屏'));
            }}
          >
            <Maximize />
          </button>
        </div>
      </aside>
      {settings && (
        <section className="settings-panel">
          <div className="panel-title">
            <h2>世界设置</h2>
            <button
              className="icon-button"
              aria-label="关闭设置"
              onClick={() => setSettings(false)}
            >
              <X size={18} />
            </button>
          </div>
          <label>天气</label>
          <div className="segmented">
            {(['clear', 'rain', 'storm'] as Weather[]).map((w, i) => (
              <button
                key={w}
                className={state.weather === w ? 'selected' : ''}
                onClick={() => engine.current?.setWeather(w)}
              >
                {['晴天', '小雨', '雷雨'][i]}
              </button>
            ))}
          </div>
          <label>时刻</label>
          <div className="segmented">
            <button onClick={() => engine.current?.setHour(9)}>
              <Sun size={14} /> 清晨
            </button>
            <button onClick={() => engine.current?.setHour(17.5)}>黄昏</button>
            <button onClick={() => engine.current?.setHour(22)}>
              <Moon size={14} /> 深夜
            </button>
          </div>
          <label className="switch-label">
            自然天气变化
            <input
              type="checkbox"
              checked={state.autoWeather}
              onChange={(e) => engine.current?.setAutoWeather(e.target.checked)}
            />
          </label>
          <button
            className="setting-command"
            onClick={() => engine.current?.startRaid()}
          >
            <Swords size={16} /> 召唤一波怪物
          </button>
          <button
            className="setting-command"
            onClick={() => {
              if (confirm('重新开始将覆盖这台设备上的家园存档，确定吗？'))
                engine.current?.restart();
            }}
          >
            <RotateCcw size={16} /> 重新开始
          </button>
        </section>
      )}
      <div className="bottom-hud">
        {toast && (
          <div className="toast" role="status">
            <Sparkles size={15} />
            {toast}
          </div>
        )}
        <div className="selection-info">
          <span className="mode-dot" />
          <strong>
            {mode === 'walk'
              ? '阿木的林间漫步'
              : mode === 'build'
                ? item.name
                : mode === 'harvest'
                  ? '采集材料'
                  : mode === 'repair'
                    ? '修理建筑'
                    : mode === 'rotate'
                      ? state.rotatingName || '未选中部件'
                      : '拆除建筑'}
          </strong>
          <span>
            {mode === 'walk'
              ? state.residentMood
              : mode === 'build'
                ? item.description
                : mode === 'harvest'
                  ? '树木 +24 木材 / 6 纤维 · 岩石 +18 石料'
                  : mode === 'repair'
                    ? '每次消耗 4 木材，恢复 45 耐久'
                    : mode === 'rotate'
                      ? '不消耗材料'
                      : '建筑返还材料 · 家具收回成品'}
          </span>
          {mode === 'build' && !furnishing && (
            <em>
              <Trees size={13} />
              {item.wood} <Box size={13} />
              {item.stone}
            </em>
          )}
          {mode === 'build' && furnishing && (
            <div className="furniture-recipe">
              <div className="recipe-materials" aria-label="家具配方">
                {(['wood', 'stone', 'fiber'] as const)
                  .filter((key) => FURNITURE[selected][key] > 0)
                  .map((key) => {
                    const Icon =
                      key === 'wood' ? Trees : key === 'stone' ? Box : Leaf;
                    const label =
                      key === 'wood'
                        ? '木材'
                        : key === 'stone'
                          ? '石料'
                          : '纤维';
                    return (
                      <span
                        key={key}
                        className={
                          state[key] < FURNITURE[selected][key]
                            ? 'shortage'
                            : ''
                        }
                        title={`${label}：持有 / 需要`}
                      >
                        <Icon size={12} />
                        {label} {state[key]}/{FURNITURE[selected][key]}
                      </span>
                    );
                  })}
              </div>
              <div className="recipe-actions">
                <small>
                  {recipeError || '材料齐备'} · 成品{' '}
                  {state.furnitureStock[selected]}
                </small>
                <button
                  aria-label={`制作${item.name}`}
                  title={recipeError || `制作${item.name}`}
                  disabled={
                    !!recipeError ||
                    state.paused ||
                    state.health <= 0 ||
                    state.furnitureStock[selected] >= 999
                  }
                  onClick={() => engine.current?.craft(selected)}
                >
                  <Hammer size={14} />
                  制作
                </button>
              </div>
            </div>
          )}
          {(mode === 'build' || mode === 'rotate') && (
            <div
              className="orientation-tools"
              role="group"
              aria-label="建筑方向"
            >
              <button
                aria-label="向左旋转 90 度"
                disabled={rotationDisabled}
                title="向左旋转 90°"
                onClick={() => engine.current?.rotateByQuarter(-1)}
              >
                <RotateCcw size={17} />
              </button>
              <button
                className="rotation-step"
                aria-label="当前方向，点击向右旋转 90 度"
                title="点击右转 · 滚轮切换方向"
                disabled={rotationDisabled}
                onClick={() => engine.current?.rotateByQuarter(1)}
                onWheel={(event) => {
                  event.preventDefault();
                  engine.current?.rotateByQuarter(event.deltaY < 0 ? -1 : 1);
                }}
              >
                {rotationDisabled ? '先点击部件' : `${rotationDegrees}°`}
              </button>
              <button
                aria-label="向右旋转 90 度"
                disabled={rotationDisabled}
                title="向右旋转 90°"
                onClick={() => engine.current?.rotateByQuarter(1)}
              >
                <RotateCw size={17} />
              </button>
              <button
                aria-label={mode === 'rotate' ? '返回建造' : '旋转已建部件'}
                aria-pressed={mode === 'rotate'}
                title="旋转已建部件（Q）：点击右转，Shift 点击左转"
                onClick={() => tool(mode === 'rotate' ? 'build' : 'rotate')}
              >
                {mode === 'rotate' ? <Hammer size={17} /> : <RotateCw size={17} />}
              </button>
            </div>
          )}
        </div>
        <div className="build-dock">
          <div className="dock-tools">
            <button
              className={mode === 'build' ? 'selected' : ''}
              title="建造"
              aria-label="建造"
              onClick={() => tool('build')}
            >
              <Hammer size={20} />
            </button>
            <button
              className={mode === 'harvest' ? 'selected' : ''}
              title="采集树木和岩石"
              aria-label="采集"
              onClick={() => tool('harvest')}
            >
              <Axe size={20} />
            </button>
            <button
              className={mode === 'repair' ? 'selected' : ''}
              title="修理建筑"
              aria-label="修理"
              onClick={() => tool('repair')}
            >
              <Wrench size={20} />
            </button>
            <button
              className={mode === 'remove' ? 'selected' : ''}
              title="拆除建筑"
              aria-label="拆除"
              onClick={() => tool('remove')}
            >
              <X size={20} />
            </button>
          </div>
          <span className="dock-divider" />
          <div className="catalog-section">
            <div className="catalog-tabs">
              <div role="tablist" aria-label="制作分类">
                <button
                  role="tab"
                  aria-selected={category === 'buildings'}
                  onClick={() => {
                    choose('wall');
                    engine.current?.setInteriorView(false);
                  }}
                >
                  <House size={14} />
                  建筑
                </button>
                <button
                  role="tab"
                  aria-selected={category === 'furniture'}
                  onClick={() => {
                    choose('bed');
                    engine.current?.setInteriorView(true);
                  }}
                >
                  <Armchair size={14} />
                  家具
                </button>
              </div>
              <span className="fiber-stock" title="采集树木获得纤维">
                <Leaf size={12} />
                纤维 {state.fiber}
              </span>
              <button
                className="interior-button"
                title="查看室内"
                aria-label="查看室内"
                aria-pressed={state.interiorView}
                onClick={() =>
                  engine.current?.setInteriorView(!state.interiorView)
                }
              >
                <Layers size={16} />
              </button>
            </div>
            <div className="catalog">
              {(
                Object.keys(
                  category === 'buildings' ? BUILDINGS : FURNITURE,
                ) as Kind[]
              ).map((kind, index) => {
                const Icon = isFurniture(kind) ? furnitureIcons[kind] : null;
                return (
                  <button
                    key={kind}
                    className={`catalog-item ${selected === kind && mode === 'build' ? 'chosen' : ''}`}
                    onClick={() => choose(kind)}
                    title={`${CATALOG[kind].name} · ${CATALOG[kind].wood} 木材 / ${CATALOG[kind].stone} 石料${isFurniture(kind) ? ` / ${FURNITURE[kind].fiber} 纤维` : ''}`}
                    aria-label={`选择${CATALOG[kind].name}`}
                  >
                    {isFurniture(kind) ? (
                      <small className="stock-count">
                        {state.furnitureStock[kind]}
                      </small>
                    ) : (
                      <kbd>{index + 1}</kbd>
                    )}
                    {Icon ? (
                      <Icon
                        className="furniture-icon"
                        size={31}
                        strokeWidth={1.5}
                      />
                    ) : (
                      <div className={`miniature ${kind}`}>
                        <i />
                        <b />
                        <span />
                      </div>
                    )}
                    <span>{CATALOG[kind].name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <span className="dock-divider extra" />
          <div className="dock-extras">
            <button
              aria-label="旋转部件"
              title="旋转部件 (R)"
              onClick={() => engine.current?.rotate()}
            >
              <RotateCw size={18} />
            </button>
            <button
              className={grid ? 'selected' : ''}
              aria-label="显示网格"
              title="显示网格 (G)"
              onClick={() => {
                setGrid(!grid);
                engine.current?.toggleGrid(!grid);
              }}
            >
              <Grid2X2 size={18} />
            </button>
          </div>
        </div>
        <footer>
          <span>
            <span className="live-dot" />{' '}
            {state.saved ? '家园已存于此设备' : '本地自动保存'}
          </span>
          <span>
            松风谷地 <i /> {state.blocks} 个建筑部件
          </span>
          <button
            title={sound ? '关闭音效' : '开启音效'}
            aria-label={sound ? '关闭音效' : '开启音效'}
            onClick={() => {
              setSound(!sound);
              engine.current?.setSound(!sound);
            }}
          >
            {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
        </footer>
      </div>
      {state.health <= 0 && (
        <div className="game-over">
          <div>
            <Heart size={32} />
            <h2>这一夜，家园失守了</h2>
            <p>
              你在松风谷地度过了 {state.day} 天，击退了 {state.defeated}{' '}
              只怪物。
            </p>
            <button onClick={() => engine.current?.restart()}>
              <RotateCcw size={16} /> 重建家园
            </button>
          </div>
        </div>
      )}
      {state.paused && state.health > 0 && (
        <div className="paused-label">
          <Pause size={14} /> 世界已暂停
        </div>
      )}
    </main>
  );
}
