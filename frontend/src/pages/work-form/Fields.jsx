/**
 * 投稿表单的各个区块。
 *
 * 版面按「填写顺序」竖向排：来源 → 信息 → 性质 → 分类封面 → 发布，每块一个带序号的卡片。
 * 这样做的原因是原来把「分类/封面」放右栏、把「性质/展示方式」混在主栏里，
 * 填的时候要在两栏之间来回扫；现在是一条直线往下填。
 */
import { useRef } from 'react';
import { Check, ImagePlus, Info, Link2, ListChecks, Palette, Send, Sparkles, Upload, Wand2 } from 'lucide-react';
import {
  OutlinedTextField, OutlinedSelect, SelectOption, FilterChip, Checkbox, OutlinedButton, FilledButton,
} from '../../ui';
import ImageUpload from '../../components/ImageUpload';
import CodemaoLogo from '../../components/CodemaoLogo';
import EditorLogo from '../../components/EditorLogo';
import MsIcon from '../../components/MsIcon';
import { useI18n } from '../../i18n';
import { CATEGORIES, CATEGORY_KEYS, MAX_TAGS, SOURCE_CODEMAO, SOURCE_MANUAL, SOURCE_SCRATCH, SOURCE_URL } from './constants';

/** 带序号的区块外壳 */
export function Section({ step, icon, title, hint, children, id }) {
  return (
    <section className="m3-card m3-card--filled wf-section" id={id}>
      <div className="wf-section__head">
        {step && <span className="wf-section__step">{step}</span>}
        {icon}
        <b>{title}</b>
        {hint && <span className="muted wf-section__hint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** 播放地址预览：填了编号就能看到最终会播什么，避免填错编辑器还不知道 */
function PlayUrlRow({ playUrl, hint }) {
  const { t } = useI18n();
  if (!playUrl) return <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{hint}</div>;
  return (
    <div className="wf-playurl">
      <Check size={14} />
      <span className="muted">{t('form.playUrlPreview')}</span>
      <b>{playUrl}</b>
    </div>
  );
}

/* ---------------------------------------------------------------- ① 来源 */

export function SourceFields({
  source, setSource, hasCodemao, codemaoSlot, editors, editorCode, setEditorCode,
  editorWorkId, setEditorWorkId, activeEditor, playUrl, sourceUrl, setSourceUrl, urlOk,
  sb3, sb3Busy, uploadSb3,
}) {
  const { t } = useI18n();
  const fileRef = useRef(null);
  const options = [
    { id: SOURCE_CODEMAO, label: t('form.srcCodemao'), hint: t('form.srcCodemaoHint'), icon: <CodemaoLogo size={18} />, disabled: !hasCodemao },
    { id: SOURCE_MANUAL, label: t('form.srcManual'), hint: t('form.srcManualHint'), icon: <MsIcon name="keyboard" size={18} /> },
    { id: SOURCE_SCRATCH, label: t('form.srcScratch'), hint: t('form.srcScratchHint'), icon: <EditorLogo code="scratch" size={18} /> },
    { id: SOURCE_URL, label: t('form.srcUrl'), hint: t('form.srcUrlHint'), icon: <Link2 size={18} /> },
  ];

  return (
    <Section step="1" icon={<Sparkles size={17} />} title={t('form.sourceTitle')} hint={t('form.sourceSubtitle')}>
      <div className="wf-src" role="radiogroup" aria-label={t('form.sourceTitle')}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={source === o.id}
            className={`wf-src__item${source === o.id ? ' is-on' : ''}`}
            onClick={() => setSource(o.id)}
            disabled={o.disabled}
          >
            <span className="wf-src__icon">{o.icon}</span>
            <span style={{ minWidth: 0 }}>
              <b>{o.label}</b>
              <span className="muted wf-src__hint">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {source === SOURCE_CODEMAO && codemaoSlot}

      {/* Scratch：上传 .sb3 文件本身。播放交给 TurboWarp；LV1 可投，但必须过审。 */}
      {source === SOURCE_SCRATCH && (
        <div style={{ marginTop: 14 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".sb3"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSb3(f); e.target.value = ''; }}
          />
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <OutlinedButton onClick={() => fileRef.current?.click()} disabled={sb3Busy}>
              <span slot="icon"><Upload size={16} /></span>
              {sb3Busy ? t('form.sb3Uploading') : (sb3 ? t('form.sb3Replace') : t('form.sb3Choose'))}
            </OutlinedButton>
            {sb3 ? (
              <span className="row" style={{ gap: 6, alignItems: 'center', minWidth: 0 }}>
                <Check size={15} style={{ color: 'var(--md-sys-color-primary)', flexShrink: 0 }} />
                <b style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{sb3.name || sb3.url}</b>
                <span className="muted" style={{ fontSize: 12 }}>{(sb3.size / 1024 / 1024).toFixed(2)} MB</span>
              </span>
            ) : (
              <span className="muted" style={{ fontSize: 12.5 }}>{t('form.sb3Hint')}</span>
            )}
          </div>
          {playUrl && <PlayUrlRow playUrl={playUrl} hint="" />}
          <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>{t('form.sb3Note')}</div>
        </div>
      )}

      {source === SOURCE_URL && (
        <div style={{ marginTop: 14 }}>
          <OutlinedTextField
            label={t('form.sourceUrl')}
            value={sourceUrl}
            onInput={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            style={{ width: '100%' }}
            supportingText={urlOk ? t('form.sourceUrlOk') : t('form.sourceUrlHint')}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>{t('form.sourceUrlNote')}</div>
        </div>
      )}

      {/* 编辑器 + 编号只属于「编程猫/手动编号」这两条路。
          Scratch 是上传文件，绝不能把编辑器与编号也摆出来（之前就是漏了这个判断）。 */}
      {(source === SOURCE_CODEMAO || source === SOURCE_MANUAL) && (
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <OutlinedSelect
              label={t('form.chooseEditor')}
              value={editorCode}
              onChange={(e) => setEditorCode(e.target.value)}
              style={{ flex: '1 1 220px', minWidth: 200 }}
            >
              {editors.map((ed) => (
                <SelectOption key={ed.code} value={ed.code}>
                  <span slot="headline" className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <EditorLogo code={ed.code} size={16} /> {ed.name}
                  </span>
                </SelectOption>
              ))}
            </OutlinedSelect>
            <OutlinedTextField
              label={t('form.editorWorkId')}
              value={editorWorkId}
              onInput={(e) => setEditorWorkId(e.target.value)}
              placeholder={activeEditor?.hint || t('form.editorWorkIdPlaceholder')}
              style={{ flex: '1 1 260px', minWidth: 220 }}
            />
          </div>
          <PlayUrlRow playUrl={playUrl} hint={source === SOURCE_MANUAL ? t('form.playUrlHint') : t('form.cmPickHint')} />
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- ② 信息 */

export function InfoFields({
  title, setTitle, description, setDescription, tagArr, tagInput, setTagInput, onTagKey, removeTag, addTag,
}) {
  const { t } = useI18n();
  return (
    <Section step="2" icon={<Upload size={17} />} title={t('form.workInfo')}>
      <OutlinedTextField
        label={t('form.workTitleLabel')}
        value={title}
        maxLength={200}
        onInput={(e) => setTitle(e.target.value)}
        style={{ width: '100%' }}
        supportingText={`${title.length}/200`}
      />

      <div style={{ marginTop: 14 }}>
        <OutlinedTextField
          label={t('form.workDescLabel')}
          type="textarea"
          rows={4}
          value={description}
          onInput={(e) => setDescription(e.target.value)}
          placeholder={t('form.workDescPlaceholder')}
          style={{ width: '100%' }}
        />
      </div>

      <div className="wf-tagbox" style={{ marginTop: 14 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {tagArr.map((tag) => (
            <button key={tag} type="button" className="wf-tag" title={t('form.tagRemove')} onClick={() => removeTag(tag)}>
              {tag}
              <MsIcon name="close" size={13} />
            </button>
          ))}
          {tagArr.length < MAX_TAGS && (
            <OutlinedTextField
              label={t('form.addTag')}
              value={tagInput}
              onInput={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKey}
              maxLength={12}
              style={{ flex: 1, minWidth: 150 }}
            />
          )}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {tagArr.length >= MAX_TAGS ? t('form.tagMaxHint', { n: MAX_TAGS }) : t('form.tagHint')}
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- ③ 性质 */

export function NatureFields({
  attr, setAttr, isOriginal, setIsOriginal, originalUrl, setOriginalUrl, origOk,
  activeEditor, editorWorkId, fillOriginalFromEditor,
}) {
  const { t } = useI18n();
  return (
    <Section step="3" icon={<MsIcon name="verified" size={17} />} title={t('form.workNature')}>
      <div className="wf-src">
        <button
          type="button"
          className={`wf-src__item${attr === 'original' ? ' is-on' : ''}`}
          onClick={() => setAttr('original')}
          aria-pressed={attr === 'original'}
        >
          <span className="wf-src__icon"><MsIcon name="verified" size={18} /></span>
          <span style={{ minWidth: 0 }}>
            <b>{t('form.originalWork')}</b>
            <span className="muted wf-src__hint">{t('form.originalWorkDesc')}</span>
          </span>
        </button>
        <button
          type="button"
          className={`wf-src__item${attr === 'repost' ? ' is-on' : ''}`}
          onClick={() => setAttr('repost')}
          aria-pressed={attr === 'repost'}
        >
          <span className="wf-src__icon"><MsIcon name="share" size={18} /></span>
          <span style={{ minWidth: 0 }}>
            <b>{t('form.repostWork')}</b>
            <span className="muted wf-src__hint">{t('form.repostWorkDesc')}</span>
          </span>
        </button>
      </div>

      {attr === 'original' ? (
        <button
          type="button"
          className={`wf-claim${isOriginal ? ' is-on' : ''}`}
          onClick={() => setIsOriginal((v) => !v)}
          aria-pressed={isOriginal}
        >
          <Checkbox checked={isOriginal} onClick={(e) => { e.stopPropagation(); setIsOriginal((v) => !v); }} />
          <span style={{ fontSize: 14, textAlign: 'left' }}>
            <b>{t('form.originalClaim')}</b>
            <span className="muted" style={{ fontSize: 12, display: 'block' }}>{t('form.originalClaimNote')}</span>
          </span>
        </button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="wf-side-label"><MsIcon name="link" size={15} /> {t('form.originalUrlRequired')}</div>
          <OutlinedTextField
            label={t('form.originalUrl')}
            value={originalUrl}
            onInput={(e) => setOriginalUrl(e.target.value)}
            placeholder="https://…"
            style={{ width: '100%' }}
            supportingText={origOk ? t('form.originalUrlOk') : t('form.originalUrlHint')}
          />
          {activeEditor && (
            <button type="button" className="wf-inline-action" onClick={fillOriginalFromEditor} disabled={!editorWorkId.trim()}>
              <Wand2 size={15} /> {t('form.autoFillByEditor', { editor: activeEditor.name.replace(/\s*编辑器.*/, '') })}
            </button>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>{t('form.repostNote')}</div>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------- ④ 分类与封面 */

export function SettingsFields({ category, setCategory, coverUrl, setCoverUrl, isScratch, sb3File, coverMode, setCoverMode, coverBusy, autoCover }) {
  const { t } = useI18n();
  const catLabel = (v) => (CATEGORY_KEYS[v] ? t(CATEGORY_KEYS[v]) : v);
  const pickRef = useRef(null);
  return (
    <Section step="4" icon={<Palette size={17} />} title={t('form.workSettings')}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <OutlinedSelect label={t('form.category')} value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%' }}>
            {CATEGORIES.map((c) => <SelectOption key={c} value={c} headline={catLabel(c)} />)}
          </OutlinedSelect>
        </div>
        <div style={{ flex: '1 1 280px', minWidth: 240 }}>
          <div className="wf-side-label"><ImagePlus size={15} /> {t('form.coverOptional')}</div>

          {/* Scratch 作品：封面可以让用户二选一 —— 自己传，或从 .sb3 里自动取舞台背景 */}
          {isScratch && (
            <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <FilterChip selected={coverMode === 'manual'} onClick={() => setCoverMode('manual')}>{t('form.coverManual')}</FilterChip>
              <FilterChip selected={coverMode === 'auto'} onClick={() => setCoverMode('auto')}>{t('form.coverAuto')}</FilterChip>
            </div>
          )}

          {isScratch && coverMode === 'auto' ? (
            <div>
              <input
                ref={pickRef}
                type="file"
                accept=".sb3"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) autoCover(f); e.target.value = ''; }}
              />
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <OutlinedButton onClick={() => pickRef.current?.click()} disabled={coverBusy}>
                  <span slot="icon"><Wand2 size={16} /></span>
                  {coverBusy ? t('form.coverAutoDoing') : t('form.coverAutoBtn')}
                </OutlinedButton>
                {coverUrl && <img src={coverUrl} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 'var(--radius)' }} />}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.7 }}>{t('form.coverAutoHint')}</div>
            </div>
          ) : (
            <ImageUpload value={coverUrl} onChange={setCoverUrl} label={t('form.uploadCover')} previewSize={64} />
          )}
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- ⑤ 发布 */

export function PublishFields({ forceReview, publishMode, setPublishMode, scheduledAt, setScheduledAt }) {
  const { t } = useI18n();
  return (
    <Section step="5" icon={<Send size={17} />} title={t('form.publishMethod')}>
      {forceReview ? (
        <div className="wf-playurl" style={{ marginTop: 0 }}>
          <Info size={14} />
          <b>{t('form.submitReview')}</b>
          <span className="muted">{t('form.linkReviewNote')}</span>
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <FilterChip label={t('form.publishNow')} selected={publishMode === 'auto'} onClick={() => setPublishMode('auto')} />
            <FilterChip label={t('form.submitReview')} selected={publishMode === 'review'} onClick={() => setPublishMode('review')} />
            <FilterChip label={t('form.schedulePublish')} selected={publishMode === 'scheduled'} onClick={() => setPublishMode('scheduled')} />
          </div>
          {publishMode === 'scheduled' && (
            <OutlinedTextField
              label={t('form.publishTime')}
              type="datetime-local"
              value={scheduledAt}
              onInput={(e) => setScheduledAt(e.target.value)}
              style={{ width: '100%', marginTop: 12 }}
              supportingText={t('form.publishTimeHint')}
            />
          )}
          <div className="row" style={{ gap: 6, alignItems: 'flex-start', marginTop: 10 }}>
            <ListChecks size={14} style={{ marginTop: 3, flexShrink: 0, color: 'var(--md-sys-color-on-surface-variant)' }} />
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('form.sensitiveNote')}</div>
          </div>
        </>
      )}
    </Section>
  );
}
