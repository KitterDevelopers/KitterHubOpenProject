/**
 * 播放器 + 下方操作行（保持原有版面：按钮在播放器下面一排，不悬浮在画面里）。
 *
 * ⚠️ 内嵌播放器（/kn/player）本身**不做任何改动** —— iframe src 改写、sandbox、
 *    referrerPolicy、加载态逻辑全部照搬既有可用实现。
 */
import { useEffect, useState } from 'react';
import { Maximize, RotateCcw, ExternalLink } from 'lucide-react';
import { TextButton, CircularProgress } from '../../ui';
import { useI18n } from '../../i18n';

/**
 * KN（KittenN）播放器是否走本站 /kn/ 中转。
 *
 * false（当前）= KittenN 作品与其它编辑器一样，**由用户浏览器直连 kn.codemao.cn 播放**。
 * true          = 走本站 /kn/ 反向代理（当年为绕过跨域 iframe 拦截加的）。
 *
 * 这套中转机制**保留不删**：nginx 里的 `location /kn/`（含独立限流）与下面这段改写都在，
 * 需要时把这里改回 true 就能立刻恢复，不用重新开发。
 */
const KN_VIA_PROXY = false;

/** 解析 iframe 的 src：非 KN 地址原样返回 */
function resolveSrc(playUrl) {
  if (!playUrl) return '';
  if (!playUrl.includes('kn.codemao.cn/player')) return playUrl;
  if (!KN_VIA_PROXY) return playUrl;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return playUrl;
  return playUrl.replace(/^https?:\/\/kn\.codemao\.cn\/player/, '/kn/player');
}

export default function Player({ playUrl, title, playKey, playerRef, onReload, onFullscreen }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const src = resolveSrc(playUrl);

  useEffect(() => { setLoaded(false); }, [playKey]);

  return (
    <>
      <div className="work-player" ref={playerRef}>
        {src ? (
          <>
            {!loaded && (
              <div className="work-player-loading">
                <CircularProgress indeterminate />
                <div>{t('work.playerLoading')}</div>
                <div className="work-player-loading-hint">{t('work.playerLoadingHint')}</div>
              </div>
            )}
            <iframe
              key={playKey}
              src={src}
              title={title}
              allowFullScreen
              /* Scratch 走 TurboWarp 跨域播放：autoplay 让作品开始跑，fullscreen/gamepad 是
                 播放器会用到的能力（麦克风与摄像头故意不放行）。 */
              allow="autoplay; fullscreen; gamepad"
              /* TurboWarp 内嵌页在舞台之外是「透明」的，好让父页面决定底色。
                 但父页面一旦是深色模式（本站 data-theme="dark"），浏览器会给 iframe 套上
                 深色 color-scheme，它的透明背景就失效、自己铺一层白 —— 于是深色模式下
                 播放器变成一大块白，特别难看。TurboWarp 文档给的解法就是给 iframe 写
                 color-scheme: auto，这里连同 allowtransparency 一起加上。 */
              allowTransparency
              style={{ colorScheme: 'auto' }}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-orientation-lock allow-presentation"
              onLoad={() => setLoaded(true)}
            />
          </>
        ) : (
          <div style={{ color: '#fff', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>{t('work.noPlayUrl')}</div>
        )}
      </div>

      {/* 无边框文字按钮：播放器才是主角，这一行只是辅助操作，不该抢视线 */}
      <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
        <TextButton onClick={onFullscreen}>
          <span slot="icon"><Maximize size={16} /></span>{t('work.fullscreen')}
        </TextButton>
        <TextButton onClick={onReload}>
          <span slot="icon"><RotateCcw size={16} /></span>{t('work.reload')}
        </TextButton>
        {playUrl && (
          <a href={playUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <TextButton>
              <span slot="icon"><ExternalLink size={16} /></span>{t('work.playOnOfficial')}
            </TextButton>
          </a>
        )}
      </div>
    </>
  );
}
