/**
 * 经验中心（版面大改）：一条数据带 + 三列等高网格 + 底部规则与入口，桌面一屏看完。
 *
 * 改版历史：
 *   第一版是一列卡片从上堆到下（等级卡 → 编程猫卡 → 绑定卡 → 7 行明细 → 8 张等级卡 → 规则 → CTA），
 *   宽屏大半是空的；
 *   第二版改成「顶部概览 + 左列（能领的 / 来源）+ 右列（等级时间线）」，信息找得到了，
 *   但左列 700px、右列 1000px，页面近 2000px（手机 3300px），站长说「整体就是不好看」。
 *   现在这一版把「一屏看完」作为硬指标：
 *     数据带（等级/进度/鱼/签到，约 88px）
 *     三列网格（现在能领的 / 等级阶梯 / 经验来源），每列的次要内容一律折叠
 *     底部一行（规则折叠 + 两个入口）
 *
 * 接口没动：数据仍来自 /users/me/xp_center、/users/me/codemao_level、/users/me/bind_rewards，
 * 「能领多少」全部在前端算。所有文案走 i18n，图标走 MsIcon / lucide（无 emoji），圆角走 --radius。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Trophy } from 'lucide-react';
import { OutlinedButton, TextButton, CircularProgress } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';
import { toast } from '../components/Toast';
import MsIcon from '../components/MsIcon';
import InviteCodeCard from '../components/InviteCodeCard';
import XpHero from '../components/xp/XpHero';
import XpClaimCard from '../components/xp/XpClaimCard';
import XpSources from '../components/xp/XpSources';
import XpLadder from '../components/xp/XpLadder';
import XpRules from '../components/xp/XpRules';

export default function XpCenter() {
  const { refresh } = useAuth();
  const { t } = useI18n();
  const localizeErr = useErr();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  // 编程猫作者等级（自己看自己，不对外展示）
  const [cm, setCm] = useState(null);
  const [cmBusy, setCmBusy] = useState(false);
  // 绑定奖励（绑一项领一次，每项只能领一次）
  const [bind, setBind] = useState(null);
  const [bindBusy, setBindBusy] = useState('');

  const load = () => client.get('/users/me/xp_center').then((r) => setData(r.data)).catch(() => {});
  const loadCm = () => client.get('/users/me/codemao_level').then((r) => setCm(r.data)).catch(() => setCm({ error: 'unavailable' }));
  const loadBind = () => client.get('/users/me/bind_rewards').then((r) => setBind(r.data)).catch(() => setBind(null));
  useEffect(() => { load(); loadCm(); loadBind(); }, []);

  const claimBind = async (key) => {
    setBindBusy(key);
    try {
      const r = await client.post('/users/me/bind_rewards/claim', { key });
      toast(t('xp.bindClaimOk', { n: r.data.gained }), 'ok');
      await Promise.all([load(), loadBind()]);
      if (refresh) refresh();
    } catch (e) {
      toast(localizeErr(e), 'error');
    } finally {
      setBindBusy('');
    }
  };

  const signIn = async () => {
    setBusy(true);
    try {
      const r = await client.post('/users/me/signin');
      toast(t('xp.signinOk', { fish: r.data.fish_gained, xp: r.data.xp_gained }), 'ok');
      await load();
      if (refresh) refresh();
    } catch (e) {
      toast(localizeErr(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const claimCodemao = async () => {
    setCmBusy(true);
    try {
      const r = await client.post('/users/me/codemao_level/claim');
      toast(
        r.data.gained > 0
          ? t('xp.cmGained', { n: r.data.gained, level: r.data.level, name: r.data.level_name })
          : t('xp.cmGainedZero', { level: r.data.level, name: r.data.level_name }),
        'ok'
      );
      await Promise.all([load(), loadCm()]);
      if (refresh) refresh();
    } catch (e) {
      toast(localizeErr(e), 'error');
    } finally {
      setCmBusy(false);
    }
  };

  if (!data) {
    return <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>;
  }

  return (
    <div className="page-pad xp-shell">
      <div className="xp-head">
        <h1 className="xp-title">
          <Trophy size={22} /> {t('xp.title')}
        </h1>
        <span className="muted xp-subtitle">{t('xp.subtitle')}</span>
      </div>

      <XpHero data={data} busy={busy} onSignin={signIn} t={t} />

      {/* 补填邀请码（站长 2026-10-01）：只在「注册 24 小时内且还没填过」时出现 */}
      <div style={{ marginTop: 14 }}>
        <InviteCodeCard compact />
      </div>

      <div className="xp-grid">
        <XpClaimCard
          data={data}
          cm={cm}
          bind={bind}
          busy={busy}
          cmBusy={cmBusy}
          bindBusy={bindBusy}
          onSignin={signIn}
          onClaimCodemao={claimCodemao}
          onClaimBind={claimBind}
          t={t}
        />
        <XpLadder levels={data.levels} current={data.level} t={t} />
        <XpSources
          detail={data.detail}
          total={data.xp}
          feedToday={data.feed_today_xp}
          feedCap={data.feed_daily_cap}
          t={t}
        />
      </div>

      <div className="xp-foot">
        <div className="xp-foot-links">
          <XpRules t={t} />
          <Link to="/settings#bind" style={{ textDecoration: 'none' }}>
            <TextButton className="xp-rules-btn">
              <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                <MsIcon name="link" size={17} /> {t('xp.bindTitle')}
              </span>
            </TextButton>
          </Link>
        </div>
        <div className="xp-cta">
          <Link to="/create"><OutlinedButton>{t('topbar.createCenter')} <ArrowRight size={15} /></OutlinedButton></Link>
          <Link to="/discover"><OutlinedButton>{t('nav.discover')} <ArrowRight size={15} /></OutlinedButton></Link>
        </div>
      </div>
    </div>
  );
}
