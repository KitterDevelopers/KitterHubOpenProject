/**
 * 设置页 - 界面设置（第二个 tab，路由 /settings/appearance）
 *
 * 判据：**只影响「我自己在这台设备上看到什么」**，全部存在 localStorage，换台设备就恢复默认。
 * 所以这里只有：语言、明暗主题、主题色、页面背景、界面透明度、卡片背景、字号、高对比度、
 * 导航栏样式，以及两个「打开方式 / 标签页标题」的开关。
 *
 * ⚠️ 别把「显示封面 / 显示等级徽章 / 公开个人主页」放进来 —— 那三个决定的是**别人**在你主页上看到什么，
 *    存在服务器上、跟着账号走，属于「账号设置 → 展示与隐私」。
 *
 * 读写与应用都走 ../../appearance.js（各项偏好在 main.jsx 启动时统一应用，
 * 以前只写不读，刷新就丢）。
 *
 * ---------------------------------------------------------------------------
 * 版式（站长 2026-10-11：「整个页面，版式有问题」「单列显示啊」「重构」）
 *
 * 原来是**十张卡竖着排一条长龙**：一张卡只放一个选项，卡片跟着页面容器摊到 1120px 宽，
 * 内容却只占左边一小块，右侧一大片空白；相关选项之间也没有任何分组关系。
 *
 * 现在：**4 张分组卡**，卡内是**设置行** —— 左侧「标题 + 说明」、右侧「控件」，
 * 行与行之间一条细分隔线；整列收窄到 900px 居中。
 * 单列就是单列（站长明确不要两列 / 瀑布流），只是把整列收窄，右侧不再空。
 *
 * ⚠️ 这次是**结构性重排**：控件、state、setter、localStorage 键（appearance.js 里的）
 *    以及「恢复默认」的语义**一个都没改**，只重排与重画。
 */
import { useRef, useState } from 'react';
import { RotateCcw, Languages, Eye, Image as ImageIcon } from 'lucide-react';
import { OutlinedButton, FilledTonalButton, Switch } from '../../ui';
import MsIcon from '../../components/MsIcon';
import { toast } from '../../components/Toast';
import { useI18n } from '../../i18n';
import { useThemeMode } from '../../context/ThemeModeContext';
import {
  FONT_SCALES as FONT_SCALE_VALUES,
  PRESET_COLORS,
  currentBackgroundUrl,
  readBgBlur,
  readBgDim,
  readCardBlur,
  readCardFrost,
  readCardScrim,
  readFontScale,
  readHighContrast,
  resetAppearance,
  readNavStyle,
  readOpenWorkNewTab,
  readSmallSolid,
  readTextSolid,
  readThemeColor,
  readUiAlpha,
  removeBackgroundImage,
  saveBackgroundImage,
  setBgBlur,
  setBgDim,
  setCardBlur,
  setCardFrost,
  setCardScrim,
  setFontScale,
  setHighContrast,
  setNavStyle,
  setOpenWorkNewTab,
  readPageTitleName,
  setPageTitleName,
  setSmallSolid,
  setTextSolid,
  setThemeColor,
  setUiAlpha,
} from '../../appearance';

const FONT_SCALES = FONT_SCALE_VALUES.map((s) => [
  s,
  s === 1 ? 'settings.fontNormal' : s === 1.1 ? 'settings.fontLarge' : 'settings.fontXLarge',
]);

/* ---------------------------------------------------------------------------
   四个积木：分组卡 / 设置行 / 选项组 / 带数值的滑杆
   --------------------------------------------------------------------------- */

/** 分组卡：标题（可选说明）下面是一串设置行 */
function GroupCard({ icon: Icon, title, hint, children }) {
  return (
    <section className="m3-card m3-card--filled appr-card">
      <h3 className="appr-card__head">
        <Icon size={17} /> <span>{title}</span>
      </h3>
      {hint ? <div className="muted appr-card__sub">{hint}</div> : null}
      <div className="appr-rows">{children}</div>
    </section>
  );
}

/**
 * 设置行：左「标题 + 说明」、右「控件」。
 * block=true 时控件比较宽（色块 / 背景图 / 导航栏示意图），让它另起一行占满整宽。
 */
function SettingRow({ title, hint, block, control }) {
  return (
    <div className={`appr-row${block ? ' appr-row--block' : ''}`}>
      <div className="appr-row__text">
        {title ? <div className="appr-row__title">{title}</div> : null}
        {hint ? <div className="muted appr-row__hint">{hint}</div> : null}
      </div>
      <div className="appr-row__ctl">{control}</div>
    </div>
  );
}

/** 一行里的单选：沿用全站按钮，只给选中态上主色（不另造一套按钮样式） */
function Choice({ label, options, value, onPick }) {
  return (
    <div className="appr-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => {
        const on = String(v) === String(value);
        return (
          <OutlinedButton
            key={String(v)}
            onClick={() => onPick(v)}
            aria-pressed={on}
            style={
              on
                ? {
                    borderColor: 'var(--md-sys-color-primary)',
                    background: 'var(--md-sys-color-primary-container)',
                    color: 'var(--md-sys-color-on-primary-container)',
                    fontWeight: 700,
                  }
                : undefined
            }
          >
            {text}
          </OutlinedButton>
        );
      })}
    </div>
  );
}

/**
 * 带数值的滑杆设置行。
 * 轨道仍是 4px 细线，但整条 input 有 28px（手机 44px）高的可点区域 —— 见 global.css 的 .appr-range。
 * ⚠️ 值为 0 / 关闭时**不要**把滑杆设成 disabled：禁用态虽然已经修成「看得见轨道」（见
 *    global.css 的 .ui-range:disabled），但一旦禁用就再也拖不回来了。
 */
function RangeSetting({ title, hint, value, min, max, step = 1, suffix, onChange }) {
  return (
    <SettingRow
      title={title}
      hint={hint}
      control={
        <>
          <span className="muted appr-range__val">{suffix}</span>
          <input
            className="ui-range appr-range"
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={title}
          />
        </>
      }
    />
  );
}

/** 开关设置行 */
function SwitchSetting({ title, hint, checked, onChange }) {
  return (
    <SettingRow
      title={title}
      hint={hint}
      control={<Switch selected={checked} onChange={(e) => onChange(e.target.selected)} aria-label={title} />}
    />
  );
}

export default function AppearanceTab() {
  const { t, lang, setLang } = useI18n();
  const { mode, setMode } = useThemeMode();
  const [fontScale, setFontScaleState] = useState(readFontScale);
  const [highContrast, setHighContrastState] = useState(readHighContrast);
  const [navStyle, setNavStyleState] = useState(readNavStyle);
  const [accent, setAccent] = useState(readThemeColor);
  const [bgUrl, setBgUrl] = useState(() => currentBackgroundUrl());
  const [bgDim, setBgDimState] = useState(readBgDim);
  const [bgBlur, setBgBlurState] = useState(readBgBlur);
  const [bgBusy, setBgBusy] = useState(false);
  const [uiAlpha, setUiAlphaState] = useState(readUiAlpha);
  const [cardBlur, setCardBlurState] = useState(readCardBlur);
  const [cardScrim, setCardScrimState] = useState(readCardScrim);
  const [cardFrost, setCardFrostState] = useState(readCardFrost);
  const [smallSolid, setSmallSolidState] = useState(readSmallSolid);
  const [textSolid, setTextSolidState] = useState(readTextSolid);
  const [workNewTab, setWorkNewTabState] = useState(readOpenWorkNewTab);
  const [pageTitleName, setPageTitleNameState] = useState(readPageTitleName);

  /**
   * 一键恢复默认：清掉本机所有外观偏好（透明度、卡片背景、字体、对比度、导航样式、
   * 主题色、背景图与遮罩…），随即按默认值重新应用。
   * 用整页重载收尾最稳：这一页有十几个本地状态，逐个回填容易漏，重载后全是默认值。
   */
  const onResetAppearance = async () => {
    if (!window.confirm(t('settings.resetConfirm'))) return;
    await resetAppearance();
    window.location.reload();
  };
  const fileRef = useRef(null);

  const pickFont = (s) => {
    setFontScaleState(s);
    setFontScale(s);
  };

  const pickContrast = (v) => {
    setHighContrastState(v);
    setHighContrast(v);
  };

  const pickPageTitleName = (v) => {
    setPageTitleNameState(v);
    setPageTitleName(v);
  };

  const pickWorkNewTab = (v) => {
    setWorkNewTabState(v);
    setOpenWorkNewTab(v);
  };

  const pickNav = (v) => {
    setNavStyleState(v);
    setNavStyle(v);
  };

  const pickAccent = (hex) => {
    setAccent(hex);
    setThemeColor(hex);
  };

  const onPickFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';           // 同一个文件再选一次也要触发 change
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast(t('settings.bgNotImage'), 'error');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast(t('settings.bgTooBig'), 'error');
      return;
    }
    setBgBusy(true);
    try {
      await saveBackgroundImage(file);
      setBgUrl(currentBackgroundUrl());
      toast(t('settings.bgSaved'), 'ok');
    } catch {
      // 隐私模式 / 禁用存储时 IndexedDB 会拒绝
      toast(t('settings.bgFailed'), 'error');
    } finally {
      setBgBusy(false);
    }
  };

  const onRemoveBg = async () => {
    setBgBusy(true);
    try {
      await removeBackgroundImage();
      setBgUrl('');
      toast(t('settings.bgRemoved'), 'ok');
    } catch {
      toast(t('settings.bgFailed'), 'error');
    } finally {
      setBgBusy(false);
    }
  };

  const pickDim = (v) => {
    setBgDimState(v);
    setBgDim(v);
  };

  const pickBlur = (v) => {
    setBgBlurState(v);
    setBgBlur(v);
  };

  const pickUiAlpha = (v) => {
    setUiAlphaState(v);
    setUiAlpha(v);
  };

  // 卡片背景那一组：全部独立、可选可不选（都只影响本机）
  const pickCardBlur = (v) => { setCardBlurState(v); setCardBlur(v); };
  const pickCardScrim = (v) => { setCardScrimState(v); setCardScrim(v); };
  const pickCardFrost = (on) => { setCardFrostState(on); setCardFrost(on); };
  const pickSmallSolid = (on) => { setSmallSolidState(on); setSmallSolid(on); };
  const pickTextSolid = (on) => { setTextSolidState(on); setTextSolid(on); };

  const fontLabelKey = FONT_SCALES.find(([s]) => s === fontScale)?.[1] || 'settings.fontNormal';

  return (
    <div className="stack appr-page appearance-page" style={{ gap: 14 }}>
      <div
        className="m3-badge"
        style={{ display: 'block', whiteSpace: 'normal', padding: '10px 14px', borderRadius: 'var(--radius)', lineHeight: 1.8, fontSize: 12.5 }}
      >
        <MsIcon name="devices" size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('settings.appearanceLocalNote')}
      </div>

      {/* ---------- 1. 语言与主题 ---------- */}
      <GroupCard icon={Languages} title={t('settings.groupTheme')}>
        <SettingRow
          title={t('settings.language')}
          hint={t('settings.languageHint')}
          control={
            <Choice
              label={t('settings.language')}
              options={[['zh', t('settings.langZh')], ['en', t('settings.langEn')]]}
              value={lang}
              onPick={setLang}
            />
          }
        />
        <SettingRow
          title={t('settings.theme')}
          hint={t('settings.themeHint')}
          control={
            <Choice
              label={t('settings.theme')}
              options={[
                ['light', t('settings.themeLight')],
                ['dark', t('settings.themeDark')],
                ['system', t('settings.themeSystem')],
              ]}
              value={mode}
              onPick={setMode}
            />
          }
        />
        {/* 自定义主题色：色块较多，整行占满宽度 */}
        <SettingRow
          title={t('settings.accentColor')}
          hint={t('settings.accentHint')}
          block
          control={
            <div className="row appr-swatches" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`accent-swatch accent-swatch--default${accent ? '' : ' on'}`}
                onClick={() => pickAccent('')}
                title={t('settings.accentDefault')}
                aria-label={t('settings.accentDefault')}
              >
                <MsIcon name="format_color_reset" size={16} />
              </button>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`accent-swatch${accent.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => pickAccent(c)}
                  title={c}
                  aria-label={c}
                />
              ))}
              <label className="accent-custom">
                <input type="color" value={accent || '#1a73e8'} onChange={(e) => pickAccent(e.target.value)} aria-label={t('settings.accentCustom')} />
                <MsIcon name="colorize" size={16} /> {t('settings.accentCustom')}
              </label>
            </div>
          }
        />
      </GroupCard>

      {/* ---------- 2. 背景与外观 ---------- */}
      <GroupCard icon={ImageIcon} title={t('settings.groupBackground')} hint={t('settings.groupBackgroundHint')}>
        {/* 页面背景图（只存本机 IndexedDB） */}
        <SettingRow
          title={t('settings.bgTitle')}
          hint={t('settings.bgLocalNote')}
          control={
            <div className="row appr-file-row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="bg-preview" style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}>
                {!bgUrl && <span className="muted" style={{ fontSize: 12 }}>{t('settings.bgNone')}</span>}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />
                <FilledTonalButton disabled={bgBusy} onClick={() => fileRef.current && fileRef.current.click()}>
                  <span slot="icon"><MsIcon name="add_photo_alternate" size={16} /></span>
                  {t('settings.bgChoose')}
                </FilledTonalButton>
                {bgUrl ? (
                  <OutlinedButton disabled={bgBusy} onClick={onRemoveBg}>
                    <MsIcon slot="icon" name="delete" size={16} /> {t('settings.bgRemove')}
                  </OutlinedButton>
                ) : null}
              </div>
            </div>
          }
        />
        <RangeSetting
          title={t('settings.bgDim')}
          hint={t('settings.bgDimHint')}
          value={bgDim}
          min={0}
          max={95}
          suffix={`${bgDim}%`}
          onChange={pickDim}
        />
        <RangeSetting
          title={t('settings.bgBlur')}
          value={bgBlur}
          min={0}
          max={24}
          suffix={`${bgBlur}px`}
          onChange={pickBlur}
        />

        {/* 界面元素透明度（卡片/顶栏/面板那层「面」） */}
        <RangeSetting
          title={t('settings.uiAlpha')}
          hint={t('settings.uiAlphaHint')}
          value={uiAlpha}
          min={30}
          max={100}
          suffix={`${uiAlpha}%`}
          onChange={pickUiAlpha}
        />

        {/* 卡片背景：模糊 / 覆盖压暗 / 磨砂质感 / 两个不透明开关（都可选可不选） */}
        <div className="appr-sub">
          <div className="appr-sub__title">{t('settings.cardSection')}</div>
          <div className="muted appr-sub__hint">{t('settings.cardSectionHint')}</div>
        </div>
        <RangeSetting
          title={t('settings.cardBlur')}
          value={cardBlur}
          min={0}
          max={24}
          suffix={cardBlur === 0 ? t('settings.off') : `${cardBlur}px`}
          onChange={pickCardBlur}
        />
        <RangeSetting
          title={t('settings.cardScrim')}
          value={cardScrim}
          min={0}
          max={60}
          suffix={cardScrim === 0 ? t('settings.off') : `${cardScrim}%`}
          onChange={pickCardScrim}
        />
        <SwitchSetting
          title={t('settings.cardFrost')}
          hint={t('settings.cardFrostHint')}
          checked={cardFrost}
          onChange={pickCardFrost}
        />
        <SwitchSetting
          title={t('settings.smallSolid')}
          hint={t('settings.smallSolidHint')}
          checked={smallSolid}
          onChange={pickSmallSolid}
        />
        <SwitchSetting
          title={t('settings.textSolid')}
          hint={t('settings.textSolidHint')}
          checked={textSolid}
          onChange={pickTextSolid}
        />
      </GroupCard>

      {/* ---------- 3. 显示与无障碍 ---------- */}
      <GroupCard icon={Eye} title={t('settings.displaySection')}>
        <SettingRow
          title={t('settings.fontSize', { size: t(fontLabelKey) })}
          control={
            <Choice
              label={t('settings.fontSize', { size: t(fontLabelKey) })}
              options={FONT_SCALES.map(([s, key]) => [s, t(key)])}
              value={fontScale}
              onPick={pickFont}
            />
          }
        />
        <SwitchSetting
          title={t('settings.highContrast')}
          checked={highContrast}
          onChange={pickContrast}
        />
        {/* 打开作品时新建标签页（站长 2026-09-30；本机偏好，默认关） */}
        <SwitchSetting
          title={t('settings.workNewTab')}
          hint={t('settings.workNewTabHint')}
          checked={workNewTab}
          onChange={pickWorkNewTab}
        />
        <SwitchSetting
          title={t('settings.pageTitleName')}
          hint={t('settings.pageTitleNameHint')}
          checked={pageTitleName}
          onChange={pickPageTitleName}
        />
        <SettingRow
          title={t('settings.navStyle')}
          hint={t('settings.navStyleHint')}
          block
          control={
            <div className="stack" style={{ gap: 12, width: '100%' }}>
              <Choice
                label={t('settings.navStyle')}
                options={[['float', t('settings.navFloat')], ['normal', t('settings.navNormal')]]}
                value={navStyle}
                onPick={pickNav}
              />
              {/* 小示意图：一眼看出两种样式的区别 */}
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                {[['float', t('settings.navFloat')], ['normal', t('settings.navNormal')]].map(([k, label]) => (
                  <div key={k} style={{ flex: '1 1 160px', minWidth: 140 }}>
                    <div className={`nav-preview nav-preview--${k}`} aria-hidden="true">
                      <span className="nav-preview__logo" />
                      <span className="nav-preview__item nav-preview__item--on" />
                      <span className="nav-preview__item" />
                      <span className="nav-preview__item" />
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 6, textAlign: 'center' }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          }
        />
      </GroupCard>

      {/* ---------- 4. 恢复默认（站长 2026-10-04：一项项改乱了要能一键回到默认） ---------- */}
      <GroupCard icon={RotateCcw} title={t('settings.resetAppearance')}>
        <SettingRow
          hint={t('settings.resetAppearanceHint')}
          control={
            <OutlinedButton onClick={onResetAppearance}>
              <span slot="icon"><RotateCcw size={16} /></span> {t('settings.resetAppearance')}
            </OutlinedButton>
          }
        />
      </GroupCard>
    </div>
  );
}
