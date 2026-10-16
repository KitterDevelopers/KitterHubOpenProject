/**
 * 聊天提示音。
 *
 * 为什么用一段短 WAV 而不是 Web Audio 合成：合成要处理 AudioContext 的挂起/恢复，
 * 而且每次都得写一遍振荡器代码；一个 8.7KB 的两音短提示更省事，也不依赖任何外部素材
 * （文件在 frontend/public/sounds/message.wav，由 .forensics/verify/gen_sound.py 生成）。
 *
 * 浏览器的自动播放限制：页面在用户交互之前不允许出声。所以这里：
 * - primeMessageSound() 在首次点击/按键时把 audio 预加载并解锁一次；
 * - playMessageSound() 只在解锁后才真的 play()，失败一律静默吞掉（不能因为没声音就报错）。
 */
const SRC = '/sounds/message.wav';

let audio = null;
let primed = false;
// 当前打开的会话 id：全局提示音据此判断「这条消息是不是就在我眼前」
let activeThreadId = null;

export function setActiveThreadId(id) {
  const n = Number(id);
  activeThreadId = Number.isFinite(n) && n > 0 ? n : null;
}

export function getActiveThreadId() {
  return activeThreadId;
}

function ensure() {
  if (audio) return audio;
  if (typeof Audio === 'undefined') return null;
  audio = new Audio(SRC);
  audio.preload = 'auto';
  audio.volume = 0.6;
  return audio;
}

/** 用户第一次交互时调用：解锁并预加载（不播放）。 */
export function primeMessageSound() {
  const a = ensure();
  if (!a || primed) return;
  primed = true;
  try {
    a.muted = true;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      }).catch(() => { a.muted = false; });
    } else {
      a.pause();
      a.muted = false;
    }
  } catch {
    a.muted = false;
  }
}

/** 播放提示音（调用方负责判断该不该响）。 */
export function playMessageSound() {
  const a = ensure();
  if (!a) return false;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}
