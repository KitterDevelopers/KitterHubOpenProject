import { createContext, useContext, useEffect, useState } from 'react';
import { applyBgVars, applyThemeColor, applyUiAlpha, readThemeColor } from '../appearance';

const ThemeModeContext = createContext({ mode: 'light', toggle: () => {}, cycle: () => {} });

function applyTheme(mode) {
  const resolved = mode === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  // 自定义主题色是**分照明暗两套值**算出来的（暗色要更亮的主色），
  // 所以明暗切换后必须按新主题重算一遍，否则暗色下会出现浅色主色那种刺眼组合。
  applyThemeColor(readThemeColor());
  // 界面透明度同理：它包的是「当前主题的 surface 原值」，切主题后要重新取原值再包
  applyUiAlpha();
  // 背景图那条「滚动条槽颜色」= 图右边缘 × 当前 surface 的压暗，切主题必须重算
  applyBgVars();
  return resolved;
}

function initialMode() {
  const saved = localStorage.getItem('nimao_theme') || 'light';
  applyTheme(saved);
  return saved;
}

export function ThemeModeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setAndSave = (next) => {
    localStorage.setItem('nimao_theme', next);
    applyTheme(next);
    setMode(next);
  };

  // 循环切换：亮 -> 暗 -> 跟随系统 -> 亮
  const cycle = () => {
    const order = { light: 'dark', dark: 'system', system: 'light' };
    setAndSave(order[mode] || 'light');
  };

  // 设置页的「界面设置」要三个平铺选项，得能直接指定某一个（而不是只能循环）
  return (
    <ThemeModeContext.Provider value={{ mode, setMode: setAndSave, toggle: cycle, cycle }}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeModeContext);
}
