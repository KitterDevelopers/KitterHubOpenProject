import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ListChecks, ImagePlus, Send } from 'lucide-react';
import {
  OutlinedTextField, OutlinedSelect, SelectOption, FilledButton,
  TextButton, Switch,
} from '../ui';
import ImageUpload from '../components/ImageUpload';
import MsIcon from '../components/MsIcon';
import client from '../api/client';
import { toast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

const CATEGORIES = ['综合', '游戏', '美术', '音乐'];
// 分类的中文原值会原样提交给后端，这里只把展示文案换成词条
const CATEGORY_KEYS = {
  综合: 'form.catGeneral',
  游戏: 'form.catGame',
  美术: 'form.catArt',
  音乐: 'form.catMusic',
};
const MIN_CREATE_LEVEL = 4;                        // 与后端 serializers.check_level(db, user, 4) 一致
const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7];
// 与后端 studio_core.member_limit_for_level 保持一致
const memberLimitFor = (lv) => ({ 4: 30, 5: 50, 6: 80, 7: 120 }[lv] ?? 50);

// 创建工作室（重构版）：两栏 —— 左边填写，右边 效果预览 / 创建要求 / 创建后会怎样
export default function StudioCreate() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();
  const err = useErr();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [category, setCategory] = useState('综合');
  const [joinMode, setJoinMode] = useState('open');
  const [minLevel, setMinLevel] = useState(0);
  const [multiOnly, setMultiOnly] = useState(false);
  const [applyRequired, setApplyRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);

  const myLevel = user?.level ?? 0;
  const isAdmin = user?.role === 'admin';
  const levelOk = isAdmin || myLevel >= MIN_CREATE_LEVEL;
  const memberLimit = memberLimitFor(myLevel);
  const needApply = joinMode === 'approval';

  const checks = useMemo(() => ([
    { key: 'level', label: t('form.checkLevel', { lv: MIN_CREATE_LEVEL, cur: myLevel }), ok: levelOk },
    { key: 'name', label: t('form.checkName'), ok: Boolean(name.trim()) },
    { key: 'desc', label: t('form.studioCheckDesc'), ok: Boolean(description.trim()), opt: true },
    { key: 'avatar', label: t('form.checkAvatar'), ok: Boolean(avatarUrl), opt: true },
    { key: 'cover', label: t('form.checkCover'), ok: Boolean(coverUrl), opt: true },
    { key: 'announcement', label: t('form.checkAnnouncement'), ok: Boolean(announcement.trim()), opt: true },
  ]), [levelOk, myLevel, name, description, avatarUrl, coverUrl, announcement]);

  const validate = () => {
    if (!levelOk) return t('form.needLevelCreateLong', { lv: MIN_CREATE_LEVEL, cur: myLevel });
    if (!name.trim()) return t('form.needStudioName');
    if (name.trim().length < 2) return t('form.studioNameShort');
    return '';
  };

  const submit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const msg = validate();
    if (msg) {
      setError(msg);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setError('');
    setBusy(true);
    try {
      const res = await client.post('/studios', {
        name: name.trim(),
        description: description.trim(),
        announcement: announcement.trim(),
        avatar_url: avatarUrl || null,
        cover_url: coverUrl || null,
        category,
        join_mode: joinMode,
        min_level: minLevel,
        multi_studio_only: multiOnly,
        apply_required: needApply ? applyRequired : false,
      });
      toast(t('form.studioCreated', { name: res.data.name }));
      navigate(`/studios/${res.data.id}`);
    } catch (e) {
      setError(err(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-pad">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ margin: 0, fontWeight: 800, gap: 8, alignItems: 'center', fontSize: 24 }}>
            <MsIcon name="house" size={22} /> {t('form.studioCreateTitle')}
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {t('form.studioIntro')}
          </p>
        </div>
        <TextButton type="button" onClick={() => setSideOpen((v) => !v)}>
          <ChevronDown slot="icon" size={16} style={{ transform: sideOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .2s' }} />
          {sideOpen ? t('form.collapseOptions') : t('form.expandOptions')}
        </TextButton>
      </div>

      {error && (
        <div className="m3-badge m3-badge--error" style={{ marginBottom: 16, padding: '10px 14px', display: 'block', whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <div className={`form-grid${sideOpen ? '' : ' side-hidden'}`}>
        <div className="form-main">
          {/* ① 基本信息 */}
          <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
            <div className="form-block-title"><MsIcon name="assignment" size={18} /><span>{t('form.basicInfo')}</span></div>

            <OutlinedTextField
              label={t('form.studioName')}
              value={name}
              maxLength={100}
              onInput={(e) => setName(e.target.value)}
              style={{ width: '100%' }}
              supportingText={`${name.length}/100${name.trim() && name.trim().length < 2 ? ` - ${t('form.nameAtLeast')}` : ''}`}
            />

            <div style={{ marginTop: 14 }}>
              <OutlinedSelect label={t('form.category')} value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%' }}>
                {CATEGORIES.map((c) => <SelectOption key={c} value={c} headline={t(CATEGORY_KEYS[c])} />)}
              </OutlinedSelect>
            </div>

            <div style={{ marginTop: 14 }}>
              <OutlinedTextField
                label={t('form.studioDesc')}
                type="textarea"
                rows={3}
                value={description}
                onInput={(e) => setDescription(e.target.value)}
                placeholder={t('form.studioDescPlaceholder')}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <OutlinedTextField
                label={t('form.announcement')}
                type="textarea"
                rows={2}
                value={announcement}
                onInput={(e) => setAnnouncement(e.target.value)}
                placeholder={t('form.announcementPlaceholder')}
                style={{ width: '100%' }}
                supportingText={t('form.announcementHint')}
              />
            </div>
          </div>

          {/* ② 形象 */}
          <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
            <div className="form-block-title"><MsIcon name="palette" size={18} /><span>{t('form.studioLook')}</span></div>
            <div className="row" style={{ gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <div className="form-side-label"><ImagePlus size={15} /> {t('form.avatar')}</div>
                <ImageUpload value={avatarUrl} onChange={setAvatarUrl} label={t('form.uploadAvatar')} previewSize={64} />
              </div>
              <div>
                <div className="form-side-label"><ImagePlus size={15} /> {t('form.coverOptional')}</div>
                <ImageUpload value={coverUrl} onChange={setCoverUrl} label={t('form.uploadCover')} previewSize={64} />
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
              {t('form.studioMediaNote')}
            </div>
          </div>

          {/* ③ 加入方式 */}
          <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
            <div className="form-block-title"><MsIcon name="group" size={18} /><span>{t('form.joinMode')}</span></div>

            <div className="row" style={{ gap: 10 }}>
              <div className={`sc-choice${joinMode === 'open' ? ' on' : ''}`} onClick={() => setJoinMode('open')}>
                <div className="sc-choice-title"><MsIcon name="person_add" size={17} /> {t('form.joinOpen')}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('form.joinOpenDesc')}</div>
              </div>
              <div className={`sc-choice${joinMode === 'approval' ? ' on' : ''}`} onClick={() => setJoinMode('approval')}>
                <div className="sc-choice-title"><MsIcon name="rule" size={17} /> {t('form.joinApproval')}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('form.joinApprovalDesc')}</div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <OutlinedSelect
                label={t('form.minLevel')}
                value={String(minLevel)}
                onChange={(e) => setMinLevel(Number(e.target.value))}
                style={{ width: '100%' }}
              >
                {LEVEL_OPTIONS.map((lv) => (
                  <SelectOption key={lv} value={String(lv)} headline={lv === 0 ? t('form.levelUnlimited') : t('form.levelAndAbove', { lv })} />
                ))}
              </OutlinedSelect>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {t('form.levelNote')}
              </div>
            </div>

            <div className="sc-switch-row">
              <Switch selected={multiOnly} onChange={(e) => setMultiOnly(e.target.selected)} />
              <span>
                <b>{t('form.noMultiStudio')}</b>
                <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                  {t('form.noMultiStudioDesc')}
                </span>
              </span>
            </div>

            <div className={`sc-switch-row${needApply ? '' : ' is-off'}`}>
              <Switch
                selected={applyRequired && needApply}
                disabled={!needApply}
                onChange={(e) => setApplyRequired(e.target.selected)}
              />
              <span>
                <b>{t('form.applyMessage')}</b>
                <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                  {needApply ? t('form.applyMessageOn') : t('form.applyMessageOff')}
                </span>
              </span>
            </div>
          </div>

          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <FilledButton type="button" onClick={submit} disabled={busy || !levelOk} style={{ flex: 1, minWidth: 180 }}>
              <span slot="icon"><Send size={18} /></span>
              {busy ? t('form.creating') : t('form.studioCreateTitle')}
            </FilledButton>
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
              {levelOk ? t('form.memberLimitHint', { lv: myLevel, max: memberLimit }) : t('form.needLevelCreate', { lv: MIN_CREATE_LEVEL })}
            </span>
          </div>
        </div>

        {sideOpen && (
          <aside className="form-side">
            <div className="m3-card" style={{ padding: 16 }}>
              <div className="form-side-title"><MsIcon name="visibility" size={16} /> {t('form.preview')}</div>
              <div className="sc-preview" style={{ marginTop: 12 }}>
                <div className="sc-preview-cover">
                  {coverUrl ? <img src={coverUrl} alt="" /> : <MsIcon name="image" size={26} />}
                </div>
                <div style={{ padding: '12px 14px 14px' }}>
                  <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'nowrap' }}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" style={{ width: 44, height: 44, borderRadius: 'var(--avatar-radius)', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <span className="sc-preview-avatar">{name.trim().charAt(0) || '?'}</span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name.trim() || t('form.studioName')}
                      </div>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className="m3-badge">{t(CATEGORY_KEYS[category])}</span>
                        {needApply && <span className="m3-badge">{t('form.needApproval')}</span>}
                        {minLevel > 0 && <span className="m3-badge">Lv.{minLevel}+</span>}
                      </div>
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {description.trim() || t('form.studioNoDesc')}
                  </div>
                  <div className="row muted" style={{ gap: 12, marginTop: 10, fontSize: 12 }}>
                    <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="group" size={14} /> 1/{memberLimit}</span>
                    <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="palette" size={14} /> 0</span>
                    <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="visibility" size={14} /> 0</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="m3-card" style={{ padding: 16 }}>
              <div className="form-side-title"><ListChecks size={16} /> {t('form.createRequirements')}</div>
              <div className="sc-checks">
                {checks.map((c) => (
                  <div key={c.key} className={`sc-check ${c.ok ? 'ok' : (c.opt ? 'todo opt' : 'todo')}`}>
                    <MsIcon name={c.ok ? 'check_circle' : 'pending'} size={15} />
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="m3-card" style={{ padding: 16 }}>
              <div className="form-side-title"><MsIcon name="lightbulb" size={16} /> {t('form.createAfter')}</div>
              <ul className="sc-tips">
                <li>{t('form.createTip1Pre')} <b>{t('form.createTip1Bold')}</b>{t('form.createTip1Post')}</li>
                <li>{t('form.createTip2Pre')} <b>{t('form.createTip2Bold')}</b>{t('form.createTip2Post')}</li>
                <li>{t('form.createTip3Pre')} <b>{t('form.createTip3Bold')}</b>{t('form.createTip3Post')}</li>
                <li>{t('form.createTip4Pre')} <b>{t('form.createTip4Bold', { n: memberLimit })}</b>{t('form.createTip4Post')}</li>
                <li>{t('form.createTip5')}</li>
                <li>{t('form.createTip6')}</li>
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
