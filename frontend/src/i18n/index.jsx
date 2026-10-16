/* 轻量国际化（不引第三方库，避免多一份运行时依赖）。
 *
 * 用法：
 *   const { t, lang, setLang, isEn } = useI18n();
 *   t('common.save')                  // 取词条
 *   t('auth.welcomeBack', { name })   // 带占位符：词条里写 {name}
 *
 * 词条来源：./dict/*.js —— 每个文件导出 { zh: {...}, en: {...} }。
 * 用 import.meta.glob 自动收集，新增词条文件**不需要**改这个文件，
 * 也就不存在多人/多轮编辑同一个注册表造成的冲突。
 *
 * 缺词条时的回退顺序：当前语言 → 中文 → key 本身（页面上会直接显示 key，
 * 方便一眼看出漏翻的地方）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const MODULES = import.meta.glob('./dict/*.js', { eager: true });

const DICTS = { zh: {}, en: {} };
for (const mod of Object.values(MODULES)) {
  for (const loc of ['zh', 'en']) {
    if (mod[loc]) Object.assign(DICTS[loc], mod[loc]);
  }
}

export const LANGS = [
  { code: 'zh', label: '中文', htmlLang: 'zh-CN' },
  { code: 'en', label: 'English', htmlLang: 'en' },
];

const STORAGE_KEY = 'nimao_lang';

function readInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch (e) {
    /* 隐私模式下 localStorage 可能抛异常，忽略即可 */
  }
  return 'zh';
}

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(readInitialLang);

  const setLang = useCallback((next) => {
    if (next !== 'zh' && next !== 'en') return;
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      /* 存不进去也不影响本次会话 */
    }
  }, []);

  useEffect(() => {
    const meta = LANGS.find((l) => l.code === lang) || LANGS[0];
    document.documentElement.lang = meta.htmlLang;
  }, [lang]);

  const t = useCallback(
    (key, vars) => {
      const primary = DICTS[lang] || {};
      let text = primary[key];
      if (text === undefined) text = DICTS.zh[key];
      if (text === undefined) return key;
      if (vars) {
        text = String(text).replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
      }
      return text;
    },
    [lang]
  );

  const value = useMemo(
    () => ({ lang, setLang, t, isEn: lang === 'en', isZh: lang === 'zh' }),
    [lang, setLang, t]
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LangContext);
  if (!ctx) {
    // 极少数组件在 Provider 之外被渲染（例如独立的测试入口）时给个安全兜底
    return { lang: 'zh', setLang: () => {}, t: (k) => k, isEn: false, isZh: true };
  }
  return ctx;
}

/** 只要 t 的简写。 */
export function useT() {
  return useI18n().t;
}

/**
 * GitHub OAuth 回调的错误短码 → 词条 key。
 * 后端只回短码（`?gh_error=state`），文案放前端，这样中英文界面各自显示对的语言。
 */
const GH_ERR_KEYS = {
  state: 'auth.ghErrState',
  taken: 'auth.ghErrTaken',
  banned: 'auth.ghErrBanned',
  notconf: 'auth.ghErrNotconf',
  fail: 'auth.ghErrFail',
  denied: 'auth.ghErrDenied',
  expired: 'auth.ghErrExpired',
  need_en: 'auth.ghErrNeedEn',
  gh_down: 'auth.ghErrDown',
};

export function ghErrorKey(code) {
  return GH_ERR_KEYS[code] || 'auth.ghErrFail';
}

/** 语言切换按钮：中英互切，样式跟随传入的 variant。 */
export function LangToggle({ variant = 'text', style }) {
  const { lang, setLang } = useI18n();
  const next = lang === 'en' ? 'zh' : 'en';
  const label = lang === 'en' ? '中文' : 'English';
  const base = {
    border: '1px solid var(--border-soft)',
    background: 'transparent',
    color: 'var(--md-sys-color-primary)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 13,
    padding: '6px 12px',
    borderRadius: 'var(--radius)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
  if (variant === 'link') {
    Object.assign(base, { border: 'none', padding: 0, textDecoration: 'underline' });
  }
  return (
    <button type="button" onClick={() => setLang(next)} style={{ ...base, ...style }} title={`Switch to ${label}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      {label}
    </button>
  );
}

export default { LangProvider, useI18n, useT, LangToggle, LANGS };
