/**
 * 「补填邀请码」卡片（站长 2026-10-01）。
 *
 * 起因：用编程猫账号注册（以及扫码/免密登录时自动建号）那条路**没有填邀请码的界面**，
 * 所以新用户压根没机会填。现在补一个窗口：**注册后 24 小时内**可以补填一次。
 *
 * 放在「账号设置」和「经验中心」两处（同一个组件）：经验中心是「邀请好友得经验」的地方，
 * 新用户看等级/经验时会经过；账号设置则是习惯性的去处。
 * 卡片只在**确实还能填**的时候出现，填过 / 过期就不显示，不占版面。
 *
 * 后端：GET/POST /users/me/invite-code（奖励按 invited_by 条数实时算，天然幂等）。
 */
import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { FilledButton, OutlinedTextField } from '../ui';
import { toast } from './Toast';
import { useI18n } from '../i18n';
import client from '../api/client';

/** 从 axios 错误里取后端那句话（与别处 errMsg 同样的取法） */
const errText = (e) => {
  const d = e && e.response && e.response.data && e.response.data.detail;
  if (typeof d === 'string' && d) return d;
  return (e && e.message) || '操作失败';
};

export default function InviteCodeCard({ compact = false }) {
  const { t } = useI18n();
  const [state, setState] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await client.get('/users/me/invite-code');
      setState(r.data);
    } catch {
      setState(null);      // 读不到就不显示这张卡，不要用报错打扰用户
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    const v = code.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const r = await client.post('/users/me/invite-code', { invite_code: v });
      toast(t('invite.filled', { name: (r.data && r.data.inviter && (r.data.inviter.nickname || r.data.inviter.username)) || '' }), 'ok');
      setCode('');
      await load();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!state || !state.can_fill) return null;

  return (
    <div className="m3-card m3-card--filled" style={{ padding: compact ? 16 : 20 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 800, marginBottom: 6 }}>
        <Gift size={18} /> {t('invite.title')}
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 10 }}>
        {t('invite.hint', { hours: state.window_hours, left: state.hours_left, xp: state.invite_xp })}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <OutlinedTextField
            label={t('invite.label')}
            value={code}
            onInput={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            supportingText={t('invite.support')}
          />
        </div>
        <FilledButton disabled={!code.trim() || busy} onClick={submit}>
          {busy ? t('invite.submitting') : t('invite.submit')}
        </FilledButton>
      </div>
    </div>
  );
}
