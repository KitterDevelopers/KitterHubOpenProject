import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FilledButton, OutlinedButton, CircularProgress, TextButton } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import UserAvatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import { VerifySeal } from '../components/VerifyBadge';
import { toast } from '../components/Toast';
import { displayName } from '../utils';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

// 粉丝 / 关注 列表。注意路由参数是 :id（见 App.jsx），这里两种命名都兼容。
export default function Followers() {
  const params = useParams();
  const uid = params.id || params.uid;
  const { pathname } = useLocation();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();
  const errOf = useErr();

  const mode = pathname.endsWith('/following') || sp.get('tab') === 'following' ? 'following' : 'followers';

  const [target, setTarget] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyUid, setBusyUid] = useState(null);

  const load = useCallback(async () => {
    if (!uid) {
      setErr(t('follow.missingUser'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const [targetUser, listData] = await Promise.all([
        client.get(`/users/${uid}`).then((r) => r.data),
        client.get(`/users/${uid}/${mode}`).then((r) => r.data),
      ]);
      setTarget(targetUser);
      setList(Array.isArray(listData) ? listData : []);
    } catch (e) {
      setErr(errOf(e));
      setTarget(null);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [uid, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFollow = async (u) => {
    if (!user || busyUid) return;
    setBusyUid(u.uid);
    try {
      if (u.is_following) await client.delete(`/users/${u.uid}/follow`);
      else await client.post(`/users/${u.uid}/follow`);
      setList((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, is_following: !x.is_following } : x)));
    } catch (e) {
      toast(errOf(e), 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const title = target ? displayName(target) : t('common.user');
  const isMe = !!user && user.uid === uid;

  const TabLink = ({ to, active, children }) => (
    <Link to={to} className={`follow-tab${active ? ' active' : ''}`}>
      {children}
    </Link>
  );

  return (
    <div className="page-pad" style={{ maxWidth: 680, margin: '0 auto' }}>
      <TextButton onClick={() => navigate(`/users/${uid}`)} style={{ marginBottom: 10 }}>
        <MsIcon slot="icon" name="arrow_back" size={18} /> {t('follow.backToProfile')}
      </TextButton>

      <div className="follow-head">
        {target && (
          <Link to={`/users/${uid}`} className="follow-head-user">
            <UserAvatar user={target} size={52} />
            <span>
              <b>{title}</b>
              <i className="muted">
                {mode === 'followers' ? t('follow.followersOf') : t('follow.followingOf')}
                {isMe ? t('follow.meSuffix') : ''}
              </i>
            </span>
          </Link>
        )}
        <div className="follow-tabs">
          <TabLink to={`/users/${uid}/followers`} active={mode === 'followers'}>
            <MsIcon name="group" size={15} /> {t('follow.followers')} {target?.followers_count ?? ''}
          </TabLink>
          <TabLink to={`/users/${uid}/following`} active={mode === 'following'}>
            <MsIcon name="person" size={15} /> {t('common.follow')} {target?.following_count ?? ''}
          </TabLink>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <CircularProgress indeterminate />
        </div>
      ) : err ? (
        <EmptyState msIcon="sentiment_dissatisfied" title={err} subtitle={t('follow.errDesc')}>
          <FilledButton onClick={() => navigate('/discover')}>{t('profile.goDiscover')}</FilledButton>
        </EmptyState>
      ) : target?.blocked ? (
        <EmptyState msIcon="block" title={t('follow.blockedTitle')} subtitle={t('follow.blockedDesc', { name: title })} />
      ) : list.length === 0 ? (
        <EmptyState
loading={loading}           msIcon={mode === 'followers' ? 'group' : 'person_add'}
          title={mode === 'followers' ? (isMe ? t('follow.noFollowers') : t('follow.noFollowersOther')) : isMe ? t('follow.noFollowing') : t('follow.noFollowingOther')}
          subtitle={mode === 'followers' ? t('follow.emptyFollowersDesc') : t('follow.emptyFollowingDesc')}
        >
          <FilledButton onClick={() => navigate('/discover')}>{t('follow.goDiscover')}</FilledButton>
        </EmptyState>
      ) : (
        <div className="follow-list">
          {list.map((u) => (
            <div key={u.uid} className="m3-card follow-item">
              <Link to={`/users/${u.uid}`}>
                <UserAvatar user={u} size={44} />
              </Link>
              <div className="follow-item-main">
                <Link to={`/users/${u.uid}`} className="follow-item-name">
                  <b>{displayName(u)}</b>
                  {u.verification_type && (
                    <span style={{ width: 14, height: 14, display: 'inline-flex', flexShrink: 0 }}>
                      <VerifySeal type={u.verification_type} title={u.verification_title || t('profile.official')} />
                    </span>
                  )}
                  {u.is_deactivated && <span className="m3-badge">{t('follow.deactivated')}</span>}
                  {!u.is_deactivated && u.is_banned && <span className="m3-badge m3-badge--error">{t('follow.banned')}</span>}
                </Link>
                <div className="follow-item-sub">{u.bio || `@${u.username}`}</div>
              </div>
              {user && u.uid !== user.uid && (
                u.is_following ? (
                  <OutlinedButton onClick={() => toggleFollow(u)} disabled={busyUid === u.uid} style={{ fontSize: 12 }}>
                    {t('common.unfollow')}
                  </OutlinedButton>
                ) : (
                  <FilledButton onClick={() => toggleFollow(u)} disabled={busyUid === u.uid} style={{ fontSize: 12 }}>
                    <MsIcon slot="icon" name="person_add" size={16} /> {t('common.follow')}
                  </FilledButton>
                )
              )}
              {user && u.uid === user.uid && <span className="muted" style={{ fontSize: 12 }}>{t('follow.thisIsMe')}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
