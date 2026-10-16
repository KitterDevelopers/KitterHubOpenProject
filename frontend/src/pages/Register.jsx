import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { OutlinedTextField, FilledButton } from '../ui';
import KitterLogo from '../components/KitterLogo';
import { useAuth } from '../context/AuthContext';
import { errMsg } from '../api/client';

export default function Register() {
  const { registerCodemao } = useAuth();
  const navigate = useNavigate();
  // 编程猫注册
  const [cmIdentity, setCmIdentity] = useState('');
  const [cmPassword, setCmPassword] = useState('');
  const [cmInvite, setCmInvite] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!cmIdentity.trim() || !cmPassword) {
      setError('请输入编程猫账号和密码');
      return;
    }
    setBusy(true);
    try {
      await registerCodemao(cmIdentity, cmPassword, cmInvite);
      navigate('/');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-pad" style={{ maxWidth: 420, margin: '0 auto' }}>
      <div className="m3-card m3-card--filled" style={{ padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}><KitterLogo size={72} /></div>
        <h2 style={{ margin: 0, fontWeight: 800, textAlign: 'center' }}>加入KitterHub</h2>
        <p className="muted" style={{ margin: '6px 0 16px', textAlign: 'center' }}>用编程猫账号，一键开启创作之旅</p>
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-secondary-container)', color: 'var(--md-sys-color-on-secondary-container)', fontSize: 13, lineHeight: 1.6, margin: '16px 0 14px' }}>
          测试期间请通过<b>编程猫账号</b>注册，邮箱注册通道暂未开放。
        </div>
        {error && <div className="m3-badge m3-badge--error" style={{ margin: '12px 0', padding: '8px 12px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)' }}>{error}</div>}
        <form onSubmit={submit} className="stack" style={{ marginTop: 16 }}>
          <OutlinedTextField label="编程猫账号（手机号 / 用户名）" value={cmIdentity} onInput={(e) => setCmIdentity(e.target.value)} />
          <OutlinedTextField autocomplete="current-password" label="编程猫密码" type="password" value={cmPassword} onInput={(e) => setCmPassword(e.target.value)} />
          <OutlinedTextField label="邀请码（可选，填好友的用户名）" value={cmInvite} onInput={(e) => setCmInvite(e.target.value)} />
          <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-secondary-container)', color: 'var(--md-sys-color-on-secondary-container)', fontSize: 13, lineHeight: 1.6 }}>
            注册后自动绑定编程猫账号，<b>昵称和头像直接用编程猫的</b>，主页展示「编程猫 UID」徽标。
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>密码仅用于本次验证，不会保存。</div>
          </div>
          <FilledButton type="submit" disabled={busy || !cmIdentity.trim() || !cmPassword} style={{ width: '100%' }}>{busy ? '验证中…' : '用编程猫账号注册'}</FilledButton>
        </form>
        <p className="muted" style={{ textAlign: 'center', marginTop: 20, fontSize: 14 }}>
          已有账号？<Link to="/login" style={{ color: 'var(--md-sys-color-primary)', fontWeight: 600 }}>去登录</Link>
        </p>
      </div>
    </div>
  );
}
