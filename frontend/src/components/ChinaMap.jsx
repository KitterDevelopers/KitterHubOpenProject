/**
 * 中国省域用户分布图（行政区划填色 / choropleth）。
 *
 * 站长 2026-09-26：「管理员后台数据分布的用户属地分布，给我做成地图，各省颜色深度代表用户数」。
 *
 * 数据：`public/geo/china-provinces.json`（同源静态资源，运行时 fetch，不进主包）。
 *   它是 DataV 全国省界 GeoJSON 离线抽稀后的产物 —— 34 个省级区划 + 九段线，
 *   生成脚本见 `.forensics/verify/build_china_geo.mjs`（Douglas-Peucker 0.02° + 2 位小数，582KB → 142KB）。
 * 投影：Albers 等积圆锥（标准纬线 25°N / 47°N、中央经线 105°E），就是常见中国地图那个形状。
 * 填色：五档，人越多颜色越重。**深色主题另配一套由暗到亮的阶梯** ——
 *   在深底上继续「越多人越深」会直接看不见，所以深色下改成「越多人越亮」，方向感一致。
 * 交互：每个省有原生 title 提示（「江苏省 - 6 人」）；面积小到看不清的区划（澳门、香港）
 *   额外点一个小圆点，否则那几个省的用户数在地图上永远是个看不见的像素。
 * 无外部依赖、无 emoji；圆角/描边沿用站点 token。
 */
import { useEffect, useMemo, useState } from 'react';
import { CircularProgress, TextButton } from '../ui';

const GEO_URL = '/geo/china-provinces.json';
const VIEW_W = 720;
const PAD = 8;

let geoPromise = null;
/** 省界数据只取一次，多个组件实例共用同一个 promise */
function loadGeo() {
  if (!geoPromise) {
    geoPromise = fetch(GEO_URL).then((r) => {
      if (!r.ok) throw new Error(`省界数据加载失败（${r.status}）`);
      return r.json();
    });
  }
  return geoPromise;
}

const D2R = Math.PI / 180;
/** Albers 等积圆锥投影：经纬度 → 平面坐标。
 *  ⚠️ y 要**翻过来**：数学上 Albers 的 y 向上为正，而 SVG 的 y 向下增大，
 *  照抄公式会得到一张上下颠倒的中国地图（第一版就是这么错的，截图才看出来）。 */
function albers(lon, lat) {
  const p1 = 25 * D2R;
  const p2 = 47 * D2R;
  const p0 = 35 * D2R;
  const l0 = 105 * D2R;
  const n = (Math.sin(p1) + Math.sin(p2)) / 2;
  const C = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
  const rho = Math.sqrt(C - 2 * n * Math.sin(lat * D2R)) / n;
  const theta = n * (lon * D2R - l0);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(p0)) / n;
  return [rho * Math.sin(theta), rho * Math.cos(theta) - rho0];
}

/** 平面坐标下的环面积（鞋带公式），用来区分「大陆/大岛」和「几个像素的小礁」 */
function ringAreaFlat(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    s += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  }
  return Math.abs(s / 2);
}

/** 属地名的归一化 key：省 / 市 / 自治区 / 特别行政区 这些后缀全去掉，两边都过一遍就能对上 */
export function regionKey(name) {
  return String(name || '').replace(/(特别行政区|自治区|壮族|回族|维吾尔|省|市)/g, '').trim();
}

/** 折叠状态存本机的 key（后台用户属地地图） */
const MAP_COLLAPSED_KEY = 'nimao_admin_map_collapsed';

const LEVELS = 5;

/**
 * 分档阈值（站长 2026-09-27 反馈：「每省最多六人太不合理了」）。
 *
 * 原来是**按当前最大值**分 5 档（`ceil(count / max * 5)`）—— 站点早期只有个位数用户时，
 * 图例会写成「单省最多 6 人」，而且 1 人和 6 人被拉成五档，看着像差距很大，其实没有可比性。
 * 现在改成**固定人数区间**，图例直接标出区间（1 / 2-3 / 4-9 / 10-24 / ≥25），
 * 不管数据多少，颜色含义都一样，也不会出现"最多 6 人"这种尴尬图例。
 */
export const LEVEL_STOPS = [1, 4, 10, 25];   // l1: 1；l2: 2-3；l3: 4-9；l4: 10-24；l5: ≥25

/** 按**固定区间**分档（0 人 = 单独一档「无数据」） */
function bucketOf(count) {
  if (!count) return 0;
  if (count >= LEVEL_STOPS[3]) return 5;
  if (count >= LEVEL_STOPS[2]) return 4;
  if (count >= LEVEL_STOPS[1]) return 3;
  if (count >= LEVEL_STOPS[0]) return 2;
  return 1;
}

/** 图例上每一档的文字（例如「2-3」「10-24」「25+」） */
function levelLabel(lv) {
  if (lv <= 1) return '1';
  if (lv === 2) return '2-3';
  if (lv === 3) return '4-9';
  if (lv === 4) return '10-24';
  return '25+';
}

/**
 * 中国省域地图（两种用法）：
 * - variant="density"（默认）：后台「用户属地分布」的行政区划填色图，颜色深浅 = 用户数；
 * - variant="lit"：国庆活动「锦绣山河 - 点亮中国」——只有「已点亮 / 未点亮」两态，
 *     点亮的省填国庆红（`--map-lit`），未点亮的中性灰（`--map-unlit`）。
 */
export default function ChinaMap({ items = [], unknown = 0, total = 0, variant = 'density' }) {
  const litMode = variant === 'lit';
  const [geo, setGeo] = useState(null);
  const [err, setErr] = useState('');
  // 折叠状态记在本机：站长说这张图占地方，收起来之后下次进来还是收着的
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(MAP_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed((v) => {
    const next = !v;
    try { localStorage.setItem(MAP_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* 无痕模式写不了也不影响 */ }
    return next;
  });

  useEffect(() => {
    let alive = true;
    loadGeo()
      .then((d) => { if (alive) setGeo(d); })
      .catch((e) => { if (alive) setErr(e.message || '省界数据加载失败'); });
    return () => { alive = false; };
  }, []);

  const { provinces, inset, dots, unmatched, viewH } = useMemo(() => {
    if (!geo) return { provinces: [], inset: null, dots: [], unmatched: 0, viewH: 560 };
    const ps = geo.provinces || [];

    // 投影所有点
    const proj = ps.map((p) => ({
      name: p.name,
      adcode: p.adcode,
      rings: p.rings.map((flat) => {
        const out = [];
        for (let i = 0; i < flat.length; i += 2) {
          const [x, y] = albers(flat[i], flat[i + 1]);
          out.push(x, y);
        }
        return out;
      }),
    }));

    // 主图包围盒**只按大陆与大岛算**：海南省图里带着南海一堆小礁，
    // 全算进去地图会被拉成竖长条、大陆缩成一小块。
    // 阈值取「全国最大环的 0.4%」——比写死一个面积数字稳（换数据也不用重调）。
    let maxRingArea = 0;
    for (const p of proj) {
      if (!p.name) continue;
      for (const r of p.rings) maxRingArea = Math.max(maxRingArea, ringAreaFlat(r));
    }
    const areaFloor = maxRingArea * 0.004;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of proj) {
      if (!p.name) continue; // 九段线走右下角小图，不参与主图范围
      for (const r of p.rings) {
        if (ringAreaFlat(r) < areaFloor) continue;
        for (let i = 0; i < r.length; i += 2) {
          if (r[i] < minX) minX = r[i];
          if (r[i] > maxX) maxX = r[i];
          if (r[i + 1] < minY) minY = r[i + 1];
          if (r[i + 1] > maxY) maxY = r[i + 1];
        }
      }
    }
    const scale = (VIEW_W - PAD * 2) / (maxX - minX);
    const viewH = Math.round((maxY - minY) * scale + PAD * 2);
    const tx = (x) => (x - minX) * scale + PAD;
    const ty = (y) => (y - minY) * scale + PAD;

    const byKey = new Map();
    for (const it of items) {
      const k = regionKey(it.region);
      if (k) byKey.set(k, (byKey.get(k) || 0) + (it.count || 0));
    }
    // 点亮模式：不看人数，只看「在不在 items 里」（items = 已点亮的省）
    const litKeys = new Set(items.map((it) => regionKey(it.region)).filter(Boolean));
    let seen = 0;

    const built = proj.filter((p) => p.name).map((p) => {
      const key = regionKey(p.name);
      const count = byKey.get(key) || 0;
      seen += count;
      let d = '';
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (const r of p.rings) {
        for (let i = 0; i < r.length; i += 2) {
          const x = tx(r[i]);
          const y = ty(r[i + 1]);
          d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
          if (x < bMinX) bMinX = x;
          if (x > bMaxX) bMaxX = x;
          if (y < bMinY) bMinY = y;
          if (y > bMaxY) bMaxY = y;
        }
        d += 'Z';
      }
      const w = bMaxX - bMinX;
      const h = bMaxY - bMinY;
      return {
        name: p.name,
        count,
        lit: litKeys.has(key),
        d,
        // 太小看不清的区划（澳门、香港）另画一个点，否则永远只是一个看不见的像素
        dot: w < 9 && h < 9 ? { x: (bMinX + bMaxX) / 2, y: (bMinY + bMaxY) / 2, r: 4.5 } : null,
      };
    });

    // 九段线 + 主图窗口装不下的南海碎岛：按中国地图的惯例放**右下角小图**里
    const outRings = [];
    for (const p of proj) {
      if (!p.name) continue;
      for (const r of p.rings) {
        if (ringAreaFlat(r) >= areaFloor) continue; // 大块已经在主图里了
        let inside = false;
        for (let i = 0; i < r.length; i += 2) {
          if (r[i] >= minX && r[i] <= maxX && r[i + 1] >= minY && r[i + 1] <= maxY) { inside = true; break; }
        }
        if (!inside) outRings.push(r);
      }
    }
    const jd = proj.find((p) => !p.name);
    const insetRings = [...(jd ? jd.rings : []), ...outRings];
    let inset = null;
    if (insetRings.length) {
      let ix0 = Infinity, iy0 = Infinity, ix1 = -Infinity, iy1 = -Infinity;
      for (const r of insetRings) {
        for (let i = 0; i < r.length; i += 2) {
          if (r[i] < ix0) ix0 = r[i];
          if (r[i] > ix1) ix1 = r[i];
          if (r[i + 1] < iy0) iy0 = r[i + 1];
          if (r[i + 1] > iy1) iy1 = r[i + 1];
        }
      }
      const bw = Math.max(1e-6, ix1 - ix0);
      const bh = Math.max(1e-6, iy1 - iy0);
      const boxW = 92;
      const boxH = 132;
      // ⚠️ 小图原来贴在主图右下角里 —— 会**压住台湾省**（站长反馈）。
      // 现在改成：整个 svg 高度多留一条 150px 的底栏，小图放进这条底栏里，
      // 和主图完全不重叠（也是正式中国地图的做法：南海诸岛单独框在角上）。
      const stripH = 150;
      const totalH = viewH + stripH;
      const bx = VIEW_W - PAD - boxW;
      const by = viewH + 8;
      const s = Math.min((boxW - 12) / bw, (boxH - 12) / bh);
      const ox = bx + (boxW - bw * s) / 2;
      const oy = by + (boxH - bh * s) / 2;
      inset = {
        box: { x: bx, y: by, w: boxW, h: boxH },
        paths: insetRings.map((r) => {
          let d = '';
          for (let i = 0; i < r.length; i += 2) {
            d += `${i === 0 ? 'M' : 'L'}${(ox + (r[i] - ix0) * s).toFixed(1)} ${(oy + (r[i + 1] - iy0) * s).toFixed(1)}`;
          }
          return d + 'Z';
        }),
      };
    }

    const sum = items.reduce((n, it) => n + (it.count || 0), 0);
    return {
      provinces: built,
      inset,
      dots: built.filter((p) => p.dot),
      unmatched: Math.max(0, sum - seen),
      viewH: viewH + (inset ? 150 : 0),   // 有小图时底下留出 150 的底栏（见上）
    };
  }, [geo, items]);

  const max = useMemo(() => provinces.reduce((m, p) => Math.max(m, p.count), 0), [provinces]);

  if (err) return <div className="muted" style={{ fontSize: 13, padding: '12px 0' }}>{err}</div>;
  if (!geo) {
    return (
      <div className="row" style={{ gap: 10, alignItems: 'center', padding: '16px 0' }}>
        <CircularProgress indeterminate style={{ width: 22, height: 22 }} />
        <span className="muted" style={{ fontSize: 13 }}>省界数据加载中…</span>
      </div>
    );
  }

  const top = [...provinces].filter((p) => p.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);
  const located = (items || []).reduce((n, it) => n + (it.count || 0), 0);
  const litList = provinces.filter((p) => p.lit);
  const covered = litMode ? litList.length : provinces.filter((p) => p.count > 0).length;
  const fillOf = (p) => (litMode
    ? (p.lit ? 'var(--map-lit)' : 'var(--map-unlit)')
    : `var(--map-l${bucketOf(p.count)})`);
  const titleOf = (p) => (litMode
    ? `${p.name} - ${p.lit ? '已点亮' : '未点亮'}`
    : (p.count ? `${p.name} - ${p.count} 人` : `${p.name} - 暂无用户`));

  return (
    <div>
      {/* 顶部一行：摘要 + 折叠开关（状态记在本机，站长不想每次都看这么大一张图） */}
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {litMode
            ? `已点亮 ${covered} / ${provinces.length} 个省`
            : `已定位 ${located} 人 - 覆盖 ${covered} 个省 - 归属地未识别 ${unknown || 0} 人`}
        </span>
        {litMode ? null : (
          <TextButton style={{ marginLeft: 'auto', fontSize: 13 }} onClick={toggleCollapsed}>
            {collapsed ? '展开地图' : '收起地图'}
          </TextButton>
        )}
      </div>
      {collapsed && !litMode ? null : (
    <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: litMode ? '1 1 100%' : '1 1 420px', minWidth: 280, maxWidth: litMode ? 820 : 760 }}>
        <svg viewBox={`0 0 ${VIEW_W} ${viewH}`} style={{ width: '100%', height: 'auto', display: 'block' }}
          role="img" aria-label={litMode ? '点亮中国地图' : '用户属地分布地图'}>
          {provinces.map((p) => (
            <path
              key={p.name}
              d={p.d}
              fill={fillOf(p)}
              stroke="var(--md-sys-color-outline-variant)"
              strokeWidth="0.7"
              strokeLinejoin="round"
            >
              <title>{titleOf(p)}</title>
            </path>
          ))}
          {/* 底栏小图：九段线 + 南海诸岛（只描线/填碎块，不填省份色；位置见上面的 stripH 说明） */}
          {inset && (
            <g>
              <rect x={inset.box.x} y={inset.box.y} width={inset.box.w} height={inset.box.h} rx="3"
                fill="none" stroke="var(--md-sys-color-outline-variant)" strokeWidth="0.8" />
              {inset.paths.map((d, i) => (
                <path key={i} d={d} fill="var(--md-sys-color-outline)" stroke="var(--md-sys-color-outline)" strokeWidth="0.4" />
              ))}
              <text x={inset.box.x} y={inset.box.y - 4} fontSize="10" fill="var(--md-sys-color-on-surface-variant)">南海诸岛</text>
            </g>
          )}
          {dots.map((p) => (
            <circle key={p.name} cx={p.dot.x} cy={p.dot.y} r={p.dot.r}
              fill={fillOf(p)} stroke="var(--md-sys-color-outline-variant)" strokeWidth="0.8">
              <title>{titleOf(p)}</title>
            </circle>
          ))}
        </svg>

        {/* 图例：分布图是五档固定区间（1 / 2-3 / 4-9 / 10-24 / 25+）+ 无用户；
            点亮图只有两态：已点亮（国庆红）/ 未点亮 */}
        {litMode ? (
          <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
            <span className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span style={{ width: 20, height: 12, background: 'var(--map-lit)', border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: 2 }} />
              <span className="muted">已点亮（{covered} 个省）</span>
            </span>
            <span className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span style={{ width: 20, height: 12, background: 'var(--map-unlit)', border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: 2 }} />
              <span className="muted">未点亮（{provinces.length - covered} 个省）</span>
            </span>
          </div>
        ) : (
          <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
            <span className="muted">少</span>
            {[1, 2, 3, 4, 5].map((lv) => (
              <span key={lv} className="row" style={{ gap: 4, alignItems: 'center' }}>
                <span style={{ width: 20, height: 12, background: `var(--map-l${lv})`, border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: 2 }} />
                <span className="muted">{levelLabel(lv)}{lv === 5 ? '' : ' 人'}</span>
              </span>
            ))}
            <span className="muted">多</span>
            <span style={{ width: 20, height: 12, background: 'var(--map-l0)', border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: 2, marginLeft: 6 }} />
            <span className="muted">无用户</span>
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {litMode
            ? '活动期间有该省的人来访问，这个省就会被点亮'
            : `已定位 ${located} 人 - 归属地未识别 ${unknown || 0} 人 - 共 ${total || 0} 人${unmatched > 0 ? `（其中 ${unmatched} 人的属地没能落到省份）` : ''}`}
        </div>
      </div>

      {/* 人数排行：小面积区划（香港/澳门/上海…）在地图上看不清，这里补上（点亮图不需要） */}
      {litMode ? null : (
      <div style={{ flex: '0 0 190px' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>人数最多</div>
        {top.length ? top.map((p) => {
          const pct = max ? Math.round((p.count / max) * 100) : 0;
          return (
            <div key={p.name} style={{ marginBottom: 7 }}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5, gap: 8 }}>
                <span>{p.name}</span>
                <span style={{ fontWeight: 700 }}>{p.count}</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--md-sys-color-surface-container-highest)', marginTop: 3 }}>
                <div style={{ width: `${Math.max(4, pct)}%`, height: '100%', borderRadius: 3, background: `var(--map-l${bucketOf(p.count)})` }} />
              </div>
            </div>
          );
        }) : <div className="muted" style={{ fontSize: 12.5 }}>还没有识别出属地的用户</div>}
      </div>
      )}
    </div>
      )}
    </div>
  );
}
