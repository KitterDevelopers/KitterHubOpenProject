/* 护照实名审核面板（管理后台「用户 → 护照审核」）。
 *
 * 护照图片存在后端私有目录，nginx 不挂载、公网取不到；
 * 唯一的出口是 GET /admin/verify-docs/{uid}，且必须带管理员 token。
 * 所以这里不能用 <img src="/api/...">（浏览器不会带 Authorization 头），
 * 必须走 axios 拿 blob 再转 objectURL。
 */
import { useEffect, useRef, useState } from 'react';
import { FilledButton, OutlinedButton, TextButton, Dialog, CircularProgress, OutlinedTextField } from '../../ui';
import client from '../../api/client';
import * as adminApi from '../../pages/admin/client';   // 取数一律走后台接口层（唯一入口）
import UserAvatar from '../Avatar';
import MsIcon from '../MsIcon';
import { formatTime } from '../../utils';

const STATE_TEXT = {
  // 这个状态现在包含 GitHub 注册的新号：可以传护照，也可以自己去绑编程猫激活
  awaiting_passport: '待激活（未交护照）',
  pending_review: '待审核',
  rejected: '已驳回',
  ok: '已通过',
};

const STATE_COLOR = {
  awaiting_passport: { bg: 'var(--md-sys-color-tertiary-container)', fg: 'var(--md-sys-color-on-tertiary-container)' },
  pending_review: { bg: 'var(--md-sys-color-secondary-container)', fg: 'var(--md-sys-color-on-secondary-container)' },
  rejected: { bg: 'var(--md-sys-color-error-container)', fg: 'var(--md-sys-color-on-error-container)' },
  ok: { bg: 'var(--md-sys-color-primary-container)', fg: 'var(--md-sys-color-on-primary-container)' },
};

function Chip({ state }) {
  const c = STATE_COLOR[state] || STATE_COLOR.awaiting_passport;
  return (
    <span style={{ background: c.bg, color: c.fg, borderRadius: 'var(--radius-pill)', padding: '2px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {STATE_TEXT[state] || state}
    </span>
  );
}

export default function PassportReview() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(null);      // 当前查看的用户
  const [docUrl, setDocUrl] = useState('');
  const [docBusy, setDocBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const urlRef = useRef('');

  const load = async () => {
    try {
      // 与侧栏「护照审核」角标同源：后端 /admin/stats 的 pending_passport 用的是同一个查询
      const res = await adminApi.verifyQueue();
      setRows(res.data || []);
      setErr('');
    } catch (e) {
      setErr(adminApi.msgOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, []);

  const openDoc = async (row) => {
    setOpen(row);
    setReason('');
    setMsg('');
    setDocBusy(true);
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; }
    setDocUrl('');
    try {
      const res = await client.get(adminApi.verifyDocUrl(row.uid), { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      urlRef.current = url;
      setDocUrl(url);
    } catch (e) {
      setErr(e?.response?.data?.detail || '无法读取护照图片（可能尚未上传）');
    } finally {
      setDocBusy(false);
    }
  };

  const closeDoc = () => {
    setOpen(null);
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; }
    setDocUrl('');
  };

  const act = async (kind) => {
    if (!open) return;
    setBusy(true);
    setMsg('');
    try {
      if (kind === 'approve') {
        await adminApi.approveVerifyDoc(open.uid);
        setMsg(`${open.user?.display_name || open.uid} 已通过审核`);
      } else if (kind === 'reject') {
        await adminApi.rejectVerifyDoc(open.uid, reason.trim());
        setMsg(`${open.user?.display_name || open.uid} 已驳回`);
      } else {
        await adminApi.resetVerifyDoc(open.uid);
        setMsg(`${open.user?.display_name || open.uid} 已退回待上传，护照文件已删除`);
      }
      await load();
      closeDoc();
    } catch (e) {
      setErr(adminApi.msgOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><CircularProgress indeterminate /></div>;
  }

  const pending = rows.filter((r) => r.state === 'pending_review');

  return (
    <div>
      {err && <div className="m3-badge m3-badge--error" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', marginBottom: 12, borderRadius: 'var(--radius)' }}>{err}</div>}
      {msg && <div className="m3-badge" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', marginBottom: 12, borderRadius: 'var(--radius)', background: 'var(--md-sys-color-primary-container)', color: 'var(--md-sys-color-on-primary-container)' }}>{msg}</div>}

      <div className="m3-card m3-card--filled" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <MsIcon name="verified_user" size={18} /> 护照实名审核
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
          英文模式邮箱注册的用户会先被锁定，必须上传护照个人信息页并通过这里的审核，才能正常使用账号。
          护照图片保存在服务器私有目录，公网无法访问，只有管理员在本页能看到。
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="m3-badge" style={{ padding: '4px 10px' }}>待审核 {pending.length}</span>
          <span className="m3-badge" style={{ padding: '4px 10px' }}>未上传 {rows.filter((r) => r.state === 'awaiting_passport').length}</span>
          <span className="m3-badge" style={{ padding: '4px 10px' }}>已驳回 {rows.filter((r) => r.state === 'rejected').length}</span>
          <OutlinedButton onClick={load} style={{ fontSize: 13 }}>刷新</OutlinedButton>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="m3-card" style={{ padding: 24, textAlign: 'center' }}>
          <MsIcon name="check_circle" size={32} />
          <div className="muted" style={{ marginTop: 8 }}>没有待处理的实名审核</div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {rows.map((r) => (
            <div key={r.uid} className="m3-card" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <UserAvatar user={r.user} size={42} />
                <div style={{ minWidth: 160, flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{r.user?.display_name || r.uid}</div>
                  <div className="muted" style={{ fontSize: 12 }}>UID {r.uid} - {r.email || '无邮箱'}</div>
                </div>
                <Chip state={r.state} />
                <div className="muted" style={{ fontSize: 12, minWidth: 150 }}>
                  {r.uploaded_at ? `上传于 ${formatTime(r.uploaded_at)}` : `注册于 ${formatTime(r.created_at)}`}
                  {r.reg_lang ? ` - ${r.reg_lang}` : ''}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <OutlinedButton onClick={() => openDoc(r)} disabled={!r.has_passport} style={{ fontSize: 13 }}>
                    查看护照
                  </OutlinedButton>
                  {r.state === 'pending_review' && (
                    <>
                      <FilledButton onClick={async () => { await client.post(`/admin/verify-docs/${r.uid}/approve`); await load(); setMsg(`${r.user?.display_name || r.uid} 已通过审核`); }} style={{ fontSize: 13 }}>
                        通过
                      </FilledButton>
                      <TextButton onClick={() => openDoc(r)} style={{ fontSize: 13 }}>驳回…</TextButton>
                    </>
                  )}
                </div>
              </div>
              {r.state === 'rejected' && r.note && (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>驳回原因：{r.note}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!open} onClose={closeDoc} onCancel={closeDoc} style={{ '--md-dialog-container-shape': 'var(--radius)' }}>
        <div slot="headline">护照审核 - {open?.user?.display_name || open?.uid}</div>
        <div slot="content" style={{ minWidth: 320 }}>
          {docBusy && <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><CircularProgress indeterminate /></div>}
          {!docBusy && docUrl && (
            <img src={docUrl} alt="passport" style={{ maxWidth: '100%', maxHeight: '52vh', borderRadius: 'var(--radius)', display: 'block', margin: '0 auto' }} />
          )}
          {!docBusy && !docUrl && <div className="muted">没有可显示的图片。</div>}
          <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
            请核对：照片清晰、能看清护照号与本人照片、与账号注册信息一致。审核完成后删除本地缓存即可，服务器上的原件会保留在私有目录。
          </div>
          <div style={{ marginTop: 10 }}>
            <OutlinedTextField label="驳回原因（会通知用户）" value={reason} onInput={(e) => setReason(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        <div slot="actions">
          <TextButton onClick={closeDoc}>关闭</TextButton>
          <OutlinedButton onClick={() => act('reset')} disabled={busy}>退回重传并删除文件</OutlinedButton>
          <OutlinedButton onClick={() => act('reject')} disabled={busy || !docUrl}>驳回</OutlinedButton>
          <FilledButton onClick={() => act('approve')} disabled={busy}>通过审核</FilledButton>
        </div>
      </Dialog>
    </div>
  );
}
