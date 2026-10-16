/* 图片裁剪器（自绘，不引第三方库）。
 *
 * 场景：个人主页背景图这类「展示区比例固定」的图，用户随手传一张手机竖拍照片，
 * 主页会按原图比例把横幅拉得老高（或压得很扁）。这里让用户在定好比例的取景框里
 * 平移 / 缩放，导出成该比例的图再上传。
 *
 * 为什么不用 CSS 滤镜或 object-fit 糊弄过去：主页横幅的比例是**跟着图片真实宽高比**
 * 走的（`.profile-cover` 的 --cover-ratio），不把图真裁好，长宽比永远不受控。
 *
 * 实现要点：
 * - 取景框显示尺寸由容器实测宽度 + 目标比例算出（frameW / frameH）。
 * - 图片以 `cover` 方式填满取景框：base = max(frameW/nw, frameH/nh)，再乘用户缩放。
 * - 平移量 pos 是**图片左上角相对取景框左上角**的偏移，限制在 [frameW-dw, 0]，
 *     保证取景框永远被图片盖满、不出现空白。
 * - 导出时把显示坐标换算回原图像素（除以 scale），画进 canvas，输出 JPEG。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZoomIn, RotateCcw } from 'lucide-react';
import { Dialog, FilledButton, TextButton } from '../ui';
import { useI18n } from '../i18n';

// 常用的横幅比例。3:1 是主页横幅的默认推荐值。
export const BANNER_RATIOS = [3, 2, 16 / 9, 4, 5.8];
const MAX_ZOOM = 4;
const MAX_OUT_W = 1920; // 输出宽度上限，避免一张 8000px 的图裁完还是几 MB

const ratioLabel = (r) => {
  if (Number.isInteger(r)) return `${r}:1`;
  if (Math.abs(r - 16 / 9) < 0.001) return '16:9';
  if (Math.abs(r - 5.8) < 0.001) return '5.8:1';
  return `${r.toFixed(2)}:1`;
};

export default function ImageCropper({ file, onCancel, onDone, busy = false }) {
  const { t } = useI18n();
  const boxRef = useRef(null);
  const dragRef = useRef(null);

  const [url, setUrl] = useState('');
  const [img, setImg] = useState(null);
  const [ratio, setRatio] = useState(3);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [frameW, setFrameW] = useState(0);
  const [err, setErr] = useState('');

  const frameH = frameW / ratio;

  // 文件 → objectURL → 预加载成 <img>（拿 naturalWidth/Height 才能算比例）
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setImg(null);
    setErr('');
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setErr(t('crop.loadFail'));
    el.src = u;
    return () => URL.revokeObjectURL(u);
    // 只在换文件时重建；t 变了不必重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // 实测取景框宽度（弹窗在手机上会变窄，算出来的显示尺寸必须跟着走）
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setFrameW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 图片 / 取景框 / 比例就绪后回到「居中铺满」
  const recenter = useCallback(
    (r = ratio, z = zoom, w = frameW, im = img) => {
      if (!w || !im) return { x: 0, y: 0 };
      const h = w / r;
      const base = Math.max(w / im.naturalWidth, h / im.naturalHeight);
      const s = base * z;
      const dw = im.naturalWidth * s;
      const dh = im.naturalHeight * s;
      return { x: (w - dw) / 2, y: (h - dh) / 2 };
    },
    [ratio, zoom, frameW, img]
  );

  useEffect(() => {
    if (!img || !frameW) return;
    setPos(recenter(ratio, zoom, frameW, img));
    // 换比例/首次就绪时重新居中；拖动中的 zoom 变化由 setZoomKeepCenter 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, frameW, ratio]);

  const baseScale = img && frameW ? Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight) : 0;
  const scale = baseScale * zoom;
  const dw = img ? img.naturalWidth * scale : 0;
  const dh = img ? img.naturalHeight * scale : 0;

  const clamp = useCallback(
    (p, w = frameW, h = frameH, iw = dw, ih = dh) => ({
      x: Math.min(0, Math.max(w - iw, p.x)),
      y: Math.min(0, Math.max(h - ih, p.y)),
    }),
    [frameW, frameH, dw, dh]
  );

  // 缩放时锚住取景框中心，不然图会往左上角跑
  const zoomTo = (next) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    if (!img || !frameW) return setZoom(z);
    const cx = (frameW / 2 - pos.x) / scale;
    const cy = (frameH / 2 - pos.y) / scale;
    const ns = baseScale * z;
    setZoom(z);
    setPos(
      clamp(
        { x: frameW / 2 - cx * ns, y: frameH / 2 - cy * ns },
        frameW,
        frameH,
        img.naturalWidth * ns,
        img.naturalHeight * ns
      )
    );
  };

  const onPointerDown = (e) => {
    if (!img) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setPos(clamp({ x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) }));
  };
  const onPointerUp = (e) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onWheel = (e) => {
    if (!img) return;
    e.preventDefault();
    zoomTo(zoom + (e.deltaY < 0 ? 0.12 : -0.12));
  };

  const confirm = async () => {
    if (!img || !scale) return;
    // 显示坐标 → 原图像素
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    const sw = frameW / scale;
    const sh = frameH / scale;
    const ow = Math.max(1, Math.min(MAX_OUT_W, Math.round(sw)));
    const oh = Math.max(1, Math.round(ow / ratio));

    const canvas = document.createElement('canvas');
    canvas.width = ow;
    canvas.height = oh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 背景填白：源图若是带透明通道的 PNG，输出 JPEG 时透明处会变黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ow, oh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ow, oh);

    canvas.toBlob(
      (blob) => {
        if (blob) onDone(blob, `${ow}x${oh}`);
        else setErr(t('crop.exportFail'));
      },
      'image/jpeg',
      0.92
    );
  };

  return (
    <Dialog open onClose={onCancel} onCancel={onCancel}>
      <div slot="headline">{t('crop.title')}</div>
      <div slot="content" style={{ maxWidth: 560 }}>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 10 }}>
          {t('crop.hint')}
        </div>

        {/* 比例切换 */}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {BANNER_RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              className="crop-ratio"
              aria-pressed={Math.abs(r - ratio) < 0.001}
              onClick={() => setRatio(r)}
            >
              {ratioLabel(r)}
            </button>
          ))}
        </div>

        {/* 取景框：宽度 100%（实测），高度按比例 */}
        <div ref={boxRef} style={{ width: '100%' }}>
          <div
            className="crop-frame"
            style={{ height: frameH || 120, touchAction: 'none', cursor: img ? 'grab' : 'default' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {url && img && dw > 0 && (
              <img
                src={url}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: dw,
                  height: dh,
                  maxWidth: 'none',
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                }}
              />
            )}
            {/* 三分线：4 条 1px 的线，不是渐变 */}
            <i className="crop-line v" style={{ left: '33.333%' }} />
            <i className="crop-line v" style={{ left: '66.666%' }} />
            <i className="crop-line h" style={{ top: '33.333%' }} />
            <i className="crop-line h" style={{ top: '66.666%' }} />
            {!img && !err && (
              <div className="crop-loading muted">{t('common.loading')}</div>
            )}
          </div>
        </div>

        {/* 缩放 */}
        <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 12 }}>
          <ZoomIn size={16} style={{ flexShrink: 0, opacity: img ? 1 : 0.4 }} />
          <input
            type="range"
            min="1"
            max={MAX_ZOOM}
            step="0.01"
            value={zoom}
            disabled={!img}
            aria-label={t('crop.zoom')}
            onChange={(e) => zoomTo(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--md-sys-color-primary)' }}
          />
          <span className="muted" style={{ fontSize: 12, width: 38, textAlign: 'right' }}>{zoom.toFixed(2)}x</span>
          <TextButton type="button" onClick={() => { setZoom(1); setPos(recenter(ratio, 1)); }} disabled={!img}>
            <span slot="icon"><RotateCcw size={14} /></span>{t('crop.reset')}
          </TextButton>
        </div>

        {err && (
          <div className="m3-badge m3-badge--error" style={{ marginTop: 10, padding: '8px 12px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)' }}>
            {err}
          </div>
        )}

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <TextButton type="button" onClick={onCancel} disabled={busy}>{t('common.cancel')}</TextButton>
          <FilledButton type="button" onClick={confirm} disabled={!img || busy}>
            {busy ? t('upload.uploading') : t('crop.confirm')}
          </FilledButton>
        </div>
      </div>
    </Dialog>
  );
}
