/**
 * 「现在能领的经验」+（折叠的）「这些还领不到」。
 *
 * 版面大改前这一栏和「经验来源」上下叠在左列，把左列撑到 700px 高，
 * 而里面一半内容是「领不到的理由」。现在：
 * - 能领的**只有能领的**，一屏最多三四行，按钮就在行尾；
 * - 领不到的整体收进卡片底部的折叠（标题带数量），要看原因再展开；
 * - 卡片里不再重复「绑定奖励」的说明段，只留一个入口按钮。
 *
 * ⚠️ 两个容易在重构里丢掉的东西，这里刻意保留：
 *   1. 编程猫**官方徽章图**（cm.badge_url）和「已领取 - 本站保底 LVx」+「升级后可再领」的说明 ——
 *      只在「有徽章」的用户身上出现，而这批人恰恰是最在意自己等级的；
 *      写成「能领才显示」的话，他们升级领完之后这一行会整块消失。
 *   2. 「训练师编号」（cm.uid）。
 * 另外：活动奖励（9/30 那种）是**登录自动到账**的，没有可点的动作，所以不进这一栏，
 * 它只出现在旁边的「经验来源」里。
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Github, Mail, ChevronDown } from 'lucide-react';
import { FilledButton, OutlinedButton } from '../../ui';
import MsIcon from '../MsIcon';
import CodemaoLogo from '../CodemaoLogo';

const bindIcon = (key) => {
  if (key === 'codemao') return <CodemaoLogo size={20} />;
  if (key === 'github') return <Github size={20} />;
  return <Mail size={20} />;
};

export default function XpClaimCard({ data, cm, bind, busy, cmBusy, bindBusy, onSignin, onClaimCodemao, onClaimBind, t }) {
  const [openBlocked, setOpenBlocked] = useState(false);
  const cmName = (lv) => t(`xp.cmName${lv}`);
  const bindItems = bind?.items || [];
  const cmTarget = cm && cm.reward_target_level != null ? cm.reward_target_level : null;
  const cmHasBadge = Boolean(cm && !cm.error && cm.badge_url);
  // 有徽章时把官方原图放在标题旁边（动图/静图尺寸不同，用 maxHeight 兜住，避免撑高行）
  const cmBadge = cmHasBadge
    ? <img src={cm.badge_url} alt={cmName(cm.author_level)} className="xp-cm-badge" />
    : null;
  const cmTitleNode = (
    <span className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {t('xp.cmTitle')}
      {cmBadge}
      {cmHasBadge && <span style={{ fontWeight: 600 }}>{cmName(cm.author_level)}</span>}
    </span>
  );

  // ---- 现在能领的 ----
  const claimable = [];
  if (!data.signed_today) {
    claimable.push({
      key: 'signin',
      icon: <MsIcon name="calendar_today" size={20} style={{ color: 'var(--md-sys-color-primary)' }} />,
      title: t('xp.src_signin'),
      desc: t('xp.signinGain', { xp: 10, fish: data.daily_fish }),
      gain: 10,
      action: (
        <FilledButton onClick={onSignin} disabled={busy} style={{ flexShrink: 0 }}>
          {busy ? t('xp.signing') : t('xp.signin')}
        </FilledButton>
      ),
    });
  }
  if (cm && cm.claimable && cmTarget !== null) {
    claimable.push({
      key: 'codemao',
      icon: <MsIcon name="military_tech" size={20} style={{ color: 'var(--md-sys-color-primary)' }} />,
      title: cmTitleNode,
      desc: (
        <>
          {cm.claim_need_xp > 0
            ? t('xp.cmClaimable', { level: cmTarget, xp: cm.reward_target_xp })
            : t('xp.cmClaimableFree', { level: cmTarget })}
          {cm.uid ? <div>{t('xp.cmUid', { uid: cm.uid })}</div> : null}
        </>
      ),
      gain: cm.claim_need_xp || 0,
      action: (
        <FilledButton onClick={onClaimCodemao} disabled={cmBusy} style={{ flexShrink: 0 }}>
          {cmBusy ? t('xp.cmClaiming') : t('xp.cmClaim', { level: cmTarget })}
        </FilledButton>
      ),
    });
  }
  for (const it of bindItems.filter((x) => x.claimable)) {
    claimable.push({
      key: `bind-${it.key}`,
      icon: <span style={{ display: 'inline-flex', flexShrink: 0 }}>{bindIcon(it.key)}</span>,
      title: t(`xp.bind${it.key[0].toUpperCase()}${it.key.slice(1)}`),
      desc: t('xp.claimBindRow', { xp: it.xp }),
      gain: it.xp,
      action: (
        <FilledButton onClick={() => onClaimBind(it.key)} disabled={Boolean(bindBusy)} style={{ flexShrink: 0 }}>
          {bindBusy === it.key ? t('xp.bindClaiming') : t('xp.bindClaim')}
        </FilledButton>
      ),
    });
  }
  const total = claimable.reduce((n, x) => n + (x.gain || 0), 0);

  // ---- 还领不到的（含原因与下一步）----
  const blocked = [];
  if (data.signed_today) {
    blocked.push({
      key: 'signin-done',
      icon: <MsIcon name="check_circle" size={18} style={{ color: 'var(--md-sys-color-on-surface-variant)' }} />,
      title: t('xp.src_signin'),
      desc: t('xp.signedToday'),
      action: null,
    });
  }
  // 编程猫：除了「能领」那一支，其余状态**一律**要有这一行（有徽章的人也不例外）
  if (cm && !(cm.claimable && cmTarget !== null)) {
    let desc = null;
    let action = null;
    if (cm.error === 'not_bound') {
      desc = t('xp.cmNotBound');
      action = (
        <Link to="/settings#bind-codemao" style={{ textDecoration: 'none', flexShrink: 0 }}>
          <OutlinedButton>{t('xp.cmGoBind')}</OutlinedButton>
        </Link>
      );
    } else if (cm.error === 'unavailable') {
      desc = t('xp.cmUnavailable');
    } else if (!cmHasBadge) {
      desc = t('xp.cmNone');
    } else if (cmTarget === null) {
      desc = t('xp.cmNoReward', { name: cmName(cm.author_level) });
    } else {
      // 有徽章、也已经领过：把「已领到哪一级」和「升级后能再领」讲清楚
      desc = (
        <>
          {t('xp.cmClaimed', { level: cmTarget })}
          <div style={{ marginTop: 2 }}>{t('xp.cmClaimedHint')}</div>
          {cm.uid ? <div>{t('xp.cmUid', { uid: cm.uid })}</div> : null}
        </>
      );
    }
    blocked.push({
      key: 'codemao-state',
      icon: cmHasBadge
        ? <MsIcon name="check_circle" size={18} style={{ color: 'var(--md-sys-color-on-surface-variant)' }} />
        : <MsIcon name="military_tech" size={18} style={{ color: 'var(--md-sys-color-on-surface-variant)' }} />,
      title: cmTitleNode,
      desc,
      action,
    });
  }
  for (const it of bindItems.filter((x) => !x.claimable)) {
    blocked.push({
      key: `bind-${it.key}`,
      icon: <span style={{ display: 'inline-flex', flexShrink: 0 }}>{bindIcon(it.key)}</span>,
      title: t(`xp.bind${it.key[0].toUpperCase()}${it.key.slice(1)}`),
      desc: it.claimed
        ? `${t('xp.bindClaimed')}${it.claimed_at ? ` - ${it.claimed_at.slice(0, 10)}` : ''}`
        : t('xp.bindNotBound'),
      action: it.claimed
        ? <span className="muted row" style={{ fontSize: 12.5, gap: 4, flexShrink: 0 }}><MsIcon name="check_circle" size={15} /> {t('xp.bindClaimed')}</span>
        : <Link to={`/settings#bind-${it.key}`} style={{ textDecoration: 'none', flexShrink: 0 }}><OutlinedButton>{t('xp.bindGoBind')}</OutlinedButton></Link>,
    });
  }

  return (
    <section className="m3-card xp-card">
      <div className="xp-card-head">
        <MsIcon name="redeem" size={18} style={{ color: 'var(--md-sys-color-primary)' }} />
        <b className="xp-card-title">{t('xp.claimableTitle')}</b>
        {total > 0 && (
          <span className="m3-badge m3-badge--primary xp-card-badge">{t('xp.claimableTotal', { n: total })}</span>
        )}
      </div>

      {claimable.length === 0 ? (
        <p className="muted xp-card-hint" style={{ margin: 0 }}>{t('xp.claimableNone')}</p>
      ) : (
        <>
          <div className="xp-claim-list">
            {claimable.map((row) => (
              <div key={row.key} className="xp-claim-row">
                {row.icon}
                <div className="xp-row-main">
                  <div className="xp-claim-title">{row.title}</div>
                  <div className="muted xp-claim-desc">{row.desc}</div>
                </div>
                {row.gain > 0 && <span className="xp-gain">+{row.gain}</span>}
                {row.action}
              </div>
            ))}
          </div>
          {/* 可领项少的时候这一列会空一大块，用一句「还能怎么攒」把话说满 */}
          {claimable.length <= 2 && <p className="muted xp-card-hint" style={{ margin: 0 }}>{t('xp.claimableMore')}</p>}
        </>
      )}

      {/* 折叠段贴底（靠 CSS 的 .xp-card > :last-child）：三列等高时
          「这些还领不到 / 全部来源 / 完整等级」才会落在同一条基线上。
          绑定奖励入口已经挪到页面底部那一行，不再压在这里。 */}
      {blocked.length > 0 && (
        <div className="xp-sub">
          <button type="button" className="xp-fold-head" aria-expanded={openBlocked} onClick={() => setOpenBlocked((v) => !v)}>
            <MsIcon name="lock" size={15} />
            {t('xp.blockedTitle')}
            <span className="muted xp-fold-count">{blocked.length}</span>
            <ChevronDown size={16} className="xp-fold-arrow" />
          </button>
          {openBlocked && (
            <div style={{ marginTop: 2 }}>
              {blocked.map((row) => (
                <div key={row.key} className="xp-blocked-row">
                  {row.icon}
                  <div className="xp-row-main">
                    <div className="xp-blocked-title">{row.title}</div>
                    <div className="muted xp-claim-desc">{row.desc}</div>
                  </div>
                  {row.action}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
