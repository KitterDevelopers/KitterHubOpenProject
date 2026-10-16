/**
 * 用户与社区类面板：
 *   用户管理 / 官方认证 / 存储扩容 / 用户审计 / 工作室（含成员）/ 云变量房间 / 护照审核
 *
 * 所有动作的字段严格照 .forensics/ADMIN-CONTRACT.md：
 *   ban={reason,until} - verify={type,title} - xp/fish={delta} - scratch-quota={quota_mb}
 *   users/batch={uids,action,reason,until,delta} - users PATCH={nickname,bio,avatar_url,ban_until,sensitive_exempt}
 *   studios PATCH={name,description,category,min_level,join_mode,member_limit,announcement,apply_required,multi_studio_only,avatar_url,cover_url,status}
 *   studio member role={role} / mute={muted} / transfer={user_id}
 *   quota review={decision,grant_mb,note}
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, BadgeCheck, Cloud, Crown, FileText, Gavel, ListTree, Shield, ShieldAlert, ShieldOff,
  Snowflake, Trash2, Users, VolumeX, X,
} from 'lucide-react';
import {
  Checkbox, CircularProgress, Dialog, FilledButton, OutlinedButton, OutlinedSelect,
  OutlinedTextField, SelectOption, Switch, TextButton,
} from '../../../ui';
import PassportReview from '../../../components/admin/PassportReview';
import * as api from '../client';
import { useI18n } from '../../../i18n';
import {
  Avatar, Badge, BatchBar, Card, Empty, Loading, Modal, Note, PanelHead, Pager, RefreshButton,
  Row, SearchInput, SelectAllRow, SelectField, T, Toolbar, detail, num, s, useConfirm, useList,
} from '../ui';

const USER_STATUS = [['all', '全部'], ['banned', '封禁中'], ['active', '正常'], ['deactivated', '已停用']];
const USER_ROLE = [['all', '全部'], ['user', '普通用户'], ['admin', '管理员']];
const USER_VERIFY = [['all', '全部'], ['ok', '已实名'], ['pending_review', '实名待审'], ['awaiting_passport', '未交护照'], ['rejected', '实名被驳回']];
const USER_SORT = [['new', '最新注册'], ['works', '作品最多'], ['level', '等级最高'], ['login', '最近登录']];

const nameOf = (u) => s(u.nickname || u.display_name || u.username) || `#${u.id}`;
const uidOf = (u) => s(u.uid) || String(u.id);

/* ============================================================ 用户管理 */
export function UsersPanel() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [verify, setVerify] = useState('all');
  const [sort, setSort] = useState('new');
  const [region, setRegion] = useState('');
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);

  const [ban, setBan] = useState(null);
  const [banForm, setBanForm] = useState({ until: '7d', reason: '' });
  const [grant, setGrant] = useState(null);
  const [grantForm, setGrantForm] = useState({ xp: 0, fish: 0 });
  const [verifyT, setVerifyT] = useState(null);
  const [verifyForm, setVerifyForm] = useState({ type: 'blue', title: '' });
  const [editU, setEditU] = useState(null);
  const [editForm, setEditForm] = useState({ nickname: '', bio: '', avatar_url: '', sensitive_exempt: false });
  const [quotaU, setQuotaU] = useState(null);
  const [quotaMb, setQuotaMb] = useState('');
  const [del, setDel] = useState(null);
  const [preview, setPreview] = useState(null);
  const [typed, setTyped] = useState('');

  const params = {
    q: query || undefined,
    status: status === 'all' ? undefined : status,
    role: role === 'all' ? undefined : role,
    verify: verify === 'all' ? undefined : verify,
    region: region.trim() || undefined,
    sort,
  };
  const L = useList(api.listUsers, { mode: 'server', keys: ['users', 'items'], params });
  const confirm = useConfirm();

  const openDelete = async (u) => {
    setDel(u); setPreview(null); setTyped('');
    try { const r = await api.userDeletePreview(uidOf(u)); setPreview(r.data); }
    catch (e) { L.setErr(detail(e)); }
  };

  const xpOut = Math.abs(Number(grantForm.xp) || 0) > 10000;
  const fishOut = Math.abs(Number(grantForm.fish) || 0) > 100000;

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}

      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 条`}>
        <div className="adm-filter-search">
          <SearchInput label="搜索 UID / 用户名 / 昵称" value={q} onChange={setQ} onSubmit={() => { setQuery(q); L.setPage(1); }} />
        </div>
        <SelectField label="状态" value={status} onChange={(v) => { setStatus(v); L.setPage(1); }} options={USER_STATUS} />
        <SelectField label="身份" value={role} onChange={(v) => { setRole(v); L.setPage(1); }} options={USER_ROLE} />
        <SelectField label="实名" value={verify} onChange={(v) => { setVerify(v); L.setPage(1); }} options={USER_VERIFY} />
        <SelectField label="排序" value={sort} onChange={setSort} options={USER_SORT} />
        <OutlinedTextField label="IP 属地筛选" value={region} onInput={(e) => setRegion(e.target.value)} />
        <FilledButton onClick={() => { setQuery(q); L.setPage(1); }}>搜索</FilledButton>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {sel.length > 0 && (
        <BatchBar count={sel.length} onClear={() => setSel([])}
                  actions={<>
                    <OutlinedButton disabled={busy} onClick={() => L.run(async () => { await api.batchUsers({ uids: sel, action: 'unban' }); setSel([]); }, '已批量解封')}>批量解封</OutlinedButton>
                    <OutlinedButton disabled={busy} onClick={async () => { if (await confirm(`批量封禁 ${sel.length} 个账号 7 天？`)) L.run(async () => { await api.batchUsers({ uids: sel, action: 'ban', until: '7d', reason: '管理员批量封禁' }); setSel([]); }, '已批量封禁'); }}>批量封禁 7 天</OutlinedButton>
                    <OutlinedButton disabled={busy} onClick={() => L.run(async () => { await api.batchUsers({ uids: sel, action: 'force_logout' }); setSel([]); }, '已批量下线')}>批量强制下线</OutlinedButton>
                  </>} />
      )}

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="group" title="没有符合条件的用户" /></Card> : (
        <Card style={{ padding: 12 }}>
          <SelectAllRow checked={L.rows.length > 0 && sel.length === L.rows.length}
                        onChange={() => setSel(sel.length === L.rows.length ? [] : L.rows.map(uidOf))} />
          {L.rows.map((u) => (
            <Row key={uidOf(u)}
                 leading={<>
                   <Checkbox checked={sel.includes(uidOf(u))}
                             onChange={() => setSel((p) => (p.includes(uidOf(u)) ? p.filter((x) => x !== uidOf(u)) : [...p, uidOf(u)]))} />
                   <Avatar user={u} />
                 </>}
                 title={<>
                   <b>{nameOf(u)}</b>
                   <span className="muted" style={{ fontSize: 12 }}>@{s(u.username)}</span>
                   {s(u.role) === 'admin' && <Badge tone="primary">管理员</Badge>}
                   {u.is_deactivated && <Badge>已停用</Badge>}
                   {s(u.verify_state) === 'pending_review' && <Badge>实名待审</Badge>}
                   {s(u.verify_state) === 'awaiting_passport' && <Badge>未交护照</Badge>}
                   {s(u.verify_state) === 'rejected' && <Badge>实名被驳回</Badge>}
                   {s(u.verification_type) && <Badge tone="primary">{s(u.verification_type) === 'gold' ? '黄标' : '蓝标'} {s(u.verification_title)}</Badge>}
                   {u.sensitive_exempt && <Badge><Shield size={12} /> 免敏感词</Badge>}
                   {u.is_banned && <Badge tone="error">{u.ban_until ? `封禁至 ${T(u.ban_until)}` : '已永久封禁'}</Badge>}
                   {u.effective_banned && !u.is_banned && <Badge tone="error">封禁中</Badge>}
                 </>}
                 meta={<>
                   UID {uidOf(u)} - 等级 {num(u.level)} - 作品 {num(u.works_count)} - 帖子 {num(u.posts_count)}
                   {' - '}{s(u.ip_region) || '未识别属地'}{u.ip_region_at ? `（${T(u.ip_region_at)} 更新）` : ''}
                   {s(u.last_ip) ? ` - 最近 IP ${s(u.last_ip)}` : ''}
                   {num(u.same_ip_count) > 1 ? ` - 同 IP ${num(u.same_ip_count)} 个账号` : ''}
                   {s(u.ban_reason) ? ` - 封禁原因：${s(u.ban_reason)}` : ''}
                 </>}
                 actions={<>
                   {u.is_banned || u.effective_banned
                     ? <OutlinedButton disabled={busy} onClick={() => L.run(() => api.unbanUser(uidOf(u)), '已解封')}>解封</OutlinedButton>
                     : <OutlinedButton disabled={busy} onClick={() => { setBan(u); setBanForm({ until: '7d', reason: '' }); }}>封禁</OutlinedButton>}
                   <TextButton onClick={() => { setGrant(u); setGrantForm({ xp: 0, fish: 0 }); }}>发放</TextButton>
                   <TextButton onClick={() => { setVerifyT(u); setVerifyForm({ type: s(u.verification_type) || 'blue', title: s(u.verification_title) }); }}>认证</TextButton>
                   <TextButton onClick={() => {
                     setEditU(u);
                     setEditForm({ nickname: s(u.nickname), bio: s(u.bio), avatar_url: s(u.avatar_url), sensitive_exempt: !!u.sensitive_exempt });
                   }}>资料</TextButton>
                   <TextButton onClick={() => { setQuotaU(u); setQuotaMb(String(u.scratch_quota_mb || u.quota_mb || '')); }}>配额</TextButton>
                   <TextButton disabled={busy} onClick={() => L.run(() => api.forceLogout(uidOf(u)), '已强制下线')}>下线</TextButton>
                   <TextButton onClick={() => navigate(`/admin?tab=user-audit&uid=${uidOf(u)}`)}>审计</TextButton>
                   <TextButton disabled={busy} onClick={() => openDelete(u)}><Trash2 size={14} /> 删除</TextButton>
                 </>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}

      {/* 封禁：{ until, reason } */}
      <Modal open={!!ban} title={`封禁 ${ban ? nameOf(ban) : ''}`} onClose={() => setBan(null)} width={360} busy={busy}
             onSubmit={() => L.run(async () => { await api.banUser(uidOf(ban), { until: banForm.until, reason: banForm.reason.trim() }); setBan(null); }, '已封禁')}
             submitLabel="确认封禁">
        <SelectField label="时长" value={banForm.until} onChange={(v) => setBanForm((f) => ({ ...f, until: v }))}
                     options={[['1d', '1 天'], ['7d', '7 天'], ['30d', '30 天'], ['permanent', '永久封禁']]} />
        <OutlinedTextField label="原因（会通知用户，最多 200 字）" value={banForm.reason} onInput={(e) => setBanForm((f) => ({ ...f, reason: e.target.value }))} />
        <Note>{banForm.until === 'permanent' ? '永久封禁：解封前无法登录。' : '限时封禁：到期自动解封。'}</Note>
      </Modal>

      {/* 发放：{ delta } ×2，范围与后端一致 */}
      <Modal open={!!grant} title={`发放给 ${grant ? nameOf(grant) : ''}`} onClose={() => setGrant(null)} width={380} busy={busy}
             onSubmit={() => L.run(async () => {
               if (Number(grantForm.xp)) await api.grantXp(uidOf(grant), Number(grantForm.xp));
               if (Number(grantForm.fish)) await api.grantFish(uidOf(grant), Number(grantForm.fish));
               setGrant(null);
             }, '已发放')}
             disabled={(Number(grantForm.xp) === 0 && Number(grantForm.fish) === 0) || xpOut || fishOut}
             submitLabel="确认发放">
        <Note>后端限制：经验 -10000 ~ 10000，小鱼干 -100000 ~ 100000，且不能为 0。小鱼干不会低于 0。</Note>
        <OutlinedTextField label="经验增减" type="number" value={String(grantForm.xp)}
                           onInput={(e) => setGrantForm((f) => ({ ...f, xp: e.target.value }))}
                           supportingText={xpOut ? '超出 ±10000' : '例如 100 或 -50'} error={xpOut} />
        <OutlinedTextField label="小鱼干增减" type="number" value={String(grantForm.fish)}
                           onInput={(e) => setGrantForm((f) => ({ ...f, fish: e.target.value }))}
                           supportingText={fishOut ? '超出 ±100000' : '例如 50 或 -20'} error={fishOut} />
      </Modal>

      {/* 认证：{ type, title } —— type 必选 blue/gold */}
      <Modal open={!!verifyT} title={`官方认证 ${verifyT ? nameOf(verifyT) : ''}`} onClose={() => setVerifyT(null)} width={380} busy={busy}
             onSubmit={() => L.run(async () => { await api.verifyUser(uidOf(verifyT), { type: verifyForm.type, title: verifyForm.title.trim() }); setVerifyT(null); }, '已认证')}
             submitLabel="授予认证">
        <SelectField label="认证类型（必选）" value={verifyForm.type} onChange={(v) => setVerifyForm((f) => ({ ...f, type: v }))}
                     options={[['blue', '蓝标 - 官方认证'], ['gold', '黄标 - 官方认证']]} />
        <OutlinedTextField label="认证头衔（可留空，≤50 字）" value={verifyForm.title}
                           onInput={(e) => setVerifyForm((f) => ({ ...f, title: e.target.value }))} supportingText="例如：官方团队" />
        {verifyT && s(verifyT.verification_type) && (
          <TextButton disabled={busy} onClick={() => L.run(async () => { await api.unverifyUser(uidOf(verifyT)); setVerifyT(null); }, '已取消认证')}>
            <X size={14} /> 取消现有认证
          </TextButton>
        )}
      </Modal>

      {/* 资料：PATCH /admin/users/{uid} */}
      <Modal open={!!editU} title={`编辑资料 ${editU ? nameOf(editU) : ''}`} onClose={() => setEditU(null)} width={400} busy={busy}
             onSubmit={() => L.run(async () => {
               await api.editUser(uidOf(editU), {
                 nickname: editForm.nickname.trim(), bio: editForm.bio,
                 avatar_url: editForm.avatar_url.trim(), sensitive_exempt: !!editForm.sensitive_exempt,
               });
               setEditU(null);
             }, '已保存')}>
        <OutlinedTextField label="昵称" value={editForm.nickname} onInput={(e) => setEditForm((f) => ({ ...f, nickname: e.target.value }))} />
        <OutlinedTextField label="个人简介" value={editForm.bio} onInput={(e) => setEditForm((f) => ({ ...f, bio: e.target.value }))} rows={3} />
        <OutlinedTextField label="头像地址" value={editForm.avatar_url} onInput={(e) => setEditForm((f) => ({ ...f, avatar_url: e.target.value }))} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14 }}>免敏感词检查</span>
          <Switch selected={!!editForm.sensitive_exempt} onChange={(e) => setEditForm((f) => ({ ...f, sensitive_exempt: e.target.selected }))} />
        </div>
      </Modal>

      {/* 配额：{ quota_mb } */}
      <Modal open={!!quotaU} title={`设置 Scratch 配额 ${quotaU ? nameOf(quotaU) : ''}`} onClose={() => setQuotaU(null)} width={340} busy={busy}
             onSubmit={() => L.run(async () => { await api.setScratchQuota(uidOf(quotaU), Number(quotaMb) || 0); setQuotaU(null); }, '已设置配额')}
             disabled={!quotaMb || Number.isNaN(Number(quotaMb))} submitLabel="保存配额">
        <OutlinedTextField label="新配额（MB）" type="number" value={quotaMb} onInput={(e) => setQuotaMb(e.target.value)}
                           supportingText="直接设定为该值，不是增量" />
      </Modal>

      {/* 删除：必须先看预览，再输入用户名（query confirm） */}
      <Modal open={!!del} title={`彻底删除 ${del ? nameOf(del) : ''}`} onClose={() => setDel(null)} width={420} busy={busy}
             onSubmit={() => L.run(async () => { await api.deleteUser(uidOf(del), typed.trim()); setDel(null); }, '账号已删除')}
             disabled={!del || typed.trim() !== s(del.username)} submitLabel="确认删除">
        <Note tone="error">删除不可恢复。下面是这个账号牵连的数据统计：</Note>
        {!preview ? <Loading /> : Object.entries(preview).map(([k, v]) => (
          <div key={k} className="row" style={{ justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span className="muted">{k}</span>
            <b style={{ textAlign: 'right', wordBreak: 'break-all' }}>
              {typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 90) : String(v)}
            </b>
          </div>
        ))}
        <OutlinedTextField label={`输入用户名 ${del ? s(del.username) : ''} 以确认`} value={typed} onInput={(e) => setTyped(e.target.value)} />
      </Modal>
    </>
  );
}

/* ============================================================ 官方认证 */
export function Verifications() {
  const L = useList(api.listVerifications, { mode: 'client', keys: ['items', 'verifications'] });
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ type: 'blue', title: '' });

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={L.total != null ? `共 ${L.total} 个已认证账号 - 第 ${L.page} / ${L.pages} 页` : ''}>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>
      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="verified" title="还没有认证账号" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((u) => (
            <Row key={uidOf(u)} leading={<Avatar user={u} />}
                 title={<><b>{nameOf(u)}</b>
                   <Badge tone="primary">{s(u.verification_type) === 'gold' ? '黄标' : '蓝标'} {s(u.verification_title) || '无头衔'}</Badge>
                   <span className="muted" style={{ fontSize: 12 }}>@{s(u.username)}</span></>}
                 meta={<>UID {uidOf(u)} - {s(u.ip_region) || '未识别属地'} - 注册 {T(u.created_at)}</>}
                 actions={<>
                   <TextButton onClick={() => { setEdit(u); setForm({ type: s(u.verification_type) || 'blue', title: s(u.verification_title) }); }}>改认证</TextButton>
                   <TextButton disabled={busy} onClick={async () => { if (await confirm(`取消 ${nameOf(u)} 的官方认证？`)) L.run(() => api.unverifyUser(uidOf(u)), '已取消认证'); }}>
                     <X size={14} /> 取消认证
                   </TextButton>
                 </>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="client" />
        </Card>
      )}

      <Modal open={!!edit} title={`修改认证 ${edit ? nameOf(edit) : ''}`} onClose={() => setEdit(null)} width={360} busy={busy}
             onSubmit={() => L.run(async () => { await api.verifyUser(uidOf(edit), { type: form.type, title: form.title.trim() }); setEdit(null); }, '已更新')}>
        <SelectField label="认证类型" value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))}
                     options={[['blue', '蓝标'], ['gold', '黄标']]} />
        <OutlinedTextField label="认证头衔" value={form.title} onInput={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      </Modal>
    </>
  );
}

/* ============================================================ 存储扩容 */
export function Quota() {
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState({ decision: 'approve', grant_mb: '', note: '' });
  const params = { status: status === 'all' ? undefined : status };
  const L = useList(api.listQuotaRequests, { mode: 'client', keys: ['requests', 'items'], params });

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={L.total != null ? `共 ${L.total} 条申请 - 第 ${L.page} / ${L.pages} 页` : ''}>
        <SelectField label="状态" value={status} onChange={(v) => { setStatus(v); L.setPage(1); }}
                     options={[['pending', '待审'], ['approved', '已通过'], ['rejected', '已驳回'], ['all', '全部']]} />
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="cloud" title="没有扩容申请" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((r) => (
            <Row key={r.id}
                 title={<><b>{s(r.nickname || r.username) || `申请 #${r.id}`}</b>
                   <Badge tone={s(r.status) === 'pending' ? 'error' : 'plain'}>{s(r.status) || '—'}</Badge></>}
                 meta={<>当前 {s(r.current_mb) || '—'} MB - 申请到 {s(r.requested_mb) || '—'} MB - {T(r.created_at)}{s(r.note) ? ` - 备注：${s(r.note)}` : ''}</>}
                 body={s(r.reason) ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>理由：{s(r.reason)}</div> : null}
                 actions={<>
                   <FilledButton disabled={busy} onClick={() => { setTarget(r); setForm({ decision: 'approve', grant_mb: String(r.requested_mb || ''), note: '' }); }}>审批</FilledButton>
                 </>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="client" />
        </Card>
      )}

      {/* 审批：{ decision, grant_mb, note } */}
      <Modal open={!!target} title={`审批扩容申请 #${target ? target.id : ''}`} onClose={() => setTarget(null)} width={380} busy={busy}
             onSubmit={() => L.run(async () => {
               await api.reviewQuotaRequest(target.id, {
                 decision: form.decision,
                 grant_mb: form.decision === 'approve' ? (Number(form.grant_mb) || undefined) : undefined,
                 note: form.note.trim(),
               });
               setTarget(null);
             }, '已处理')}>
        <SelectField label="决定" value={form.decision} onChange={(v) => setForm((f) => ({ ...f, decision: v }))}
                     options={[['approve', '通过'], ['reject', '驳回']]} />
        {form.decision === 'approve' && (
          <OutlinedTextField label="批准到多少 MB" type="number" value={form.grant_mb}
                             onInput={(e) => setForm((f) => ({ ...f, grant_mb: e.target.value }))} />
        )}
        <OutlinedTextField label={form.decision === 'approve' ? '备注（可选）' : '驳回理由'} value={form.note}
                           onInput={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
      </Modal>
    </>
  );
}

/* ============================================================ 用户审计 */
export function UserAudit() {
  const [params] = useSearchParams();
  const [uid, setUid] = useState(params.get('uid') || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!uid.trim()) return;
    setBusy(true); setErr(''); setData(null);
    try { const r = await api.userAudit(uid.trim()); setData(r.data); }
    catch (e) { setErr(detail(e)); } finally { setBusy(false); }
  };

  // 从用户管理点「审计」跳过来时带 uid，进入即自动查询
  useEffect(() => { if (params.get('uid')) run(); /* eslint-disable-next-line */ }, []);

  // 后端 GET /admin/audit/{uid} 的结构：
  //   { user:{...}, created_at, last_login_at, works_count, posts_count,
  //     comments_count, reports_received, admin_logs:[...] }
  const u = data && data.user ? data.user : null;
  const logs = (data && Array.isArray(data.admin_logs)) ? data.admin_logs : [];

  const facts = data && [
    ['注册时间', T(data.created_at)],
    ['最后登录', T(data.last_login_at)],
    ['稿件', num(data.works_count)],
    ['帖子', num(data.posts_count)],
    ['评论', num(data.comments_count)],
    ['收到举报', num(data.reports_received)],
    ['等级', u ? `${num(u.level)}${s(u.level_name) ? ` - ${s(u.level_name)}` : ''}` : '—'],
    ['属地', s(u && u.ip_region) || '未识别'],
    ['实名', s(u && u.verify_state) || '—'],
    ['状态', u && u.is_banned ? '封禁中' : u && u.is_deactivated ? '已停用' : '正常'],
  ];

  return (
    <>
      {err && <Note tone="error">{err}</Note>}
      <Toolbar>
        <div className="adm-filter-search">
          <SearchInput label="用户 UID" value={uid} onChange={setUid} onSubmit={run} />
        </div>
        <FilledButton onClick={run} disabled={busy || !uid.trim()}>查询</FilledButton>
      </Toolbar>

      {!data && (
        <Card>
          <PanelHead icon={<Gavel size={17} />} title="怎么用" />
          <Note>
            填入用户 UID 后查询该账号的概览与后台操作记录（登录、改资料、封禁、处罚等）。
            也可以从「用户管理」列表里直接点某个账号的「审计」，UID 会自动带过来并立即查询。
          </Note>
        </Card>
      )}

      {u && (
        <Card>
          <PanelHead icon={<Gavel size={17} />} title="账号概览" />
          <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <Avatar user={u} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {s(u.nickname || u.display_name || u.username)}
                {s(u.role) === 'admin' && <Badge tone="primary">管理员</Badge>}
                {s(u.verification_title) && <Badge tone="primary">{s(u.verification_title)}</Badge>}
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>@{s(u.username)} - UID {s(u.uid)}</div>
            </div>
          </div>
          <div className="adm-stats">
            {facts.filter(Boolean).map(([label, val]) => (
              <div key={label} className="adm-stat">
                <div>
                  <div className="adm-stat-num" style={{ fontSize: 16 }}>{val}</div>
                  <div className="adm-stat-label">{label}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data && (
        <Card>
          <PanelHead icon={<Shield size={17} />} title="后台操作记录" count={logs.length} />
          {logs.length === 0 ? (
            <Note>这个账号还没有被后台处理过的记录。</Note>
          ) : logs.map((g, i) => (
            <Row key={g.id || i}
                 title={<><b>{s(g.action) || '操作'}</b>
                   {s(g.target_type) && <Badge>{s(g.target_type)}{g.target_id ? ` #${s(g.target_id)}` : ''}</Badge>}</>}
                 meta={<>{T(g.created_at)}{s(g.actor_nickname || g.actor) ? ` - 操作者 ${s(g.actor_nickname || g.actor)}` : ''}{s(g.detail) ? ` - ${s(g.detail)}` : ''}</>} />
          ))}
        </Card>
      )}
    </>
  );
}

/* ============================================================ 工作室 */
const STUDIO_STATUS = [['all', '全部'], ['active', '正常'], ['frozen', '已冻结'], ['banned', '已封禁']];
const JOIN_MODES = [['open', '自由加入'], ['apply', '需审核'], ['invite', '仅邀请']];

export function Studios() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState(false);
  const [editS, setEditS] = useState(null);
  const [form, setForm] = useState({});
  const [members, setMembers] = useState(null);
  const [memberRows, setMemberRows] = useState(null);

  const params = { q: query || undefined, status: status === 'all' ? undefined : status };
  const L = useList(api.listStudios, { mode: 'server', keys: ['studios'], params });
  const confirm = useConfirm();

  const openEdit = (st) => {
    setForm({
      name: s(st.name), description: s(st.description), category: s(st.category),
      min_level: num(st.min_level), join_mode: s(st.join_mode) || 'open',
      member_limit: num(st.member_limit), announcement: s(st.announcement),
      apply_required: !!st.apply_required, multi_studio_only: !!st.multi_studio_only,
      avatar_url: s(st.avatar_url), cover_url: s(st.cover_url), status: s(st.status) || 'active',
    });
    setEditS(st);
  };

  const openMembers = async (st) => {
    setMembers(st); setMemberRows(null);
    try { const r = await api.studioMembers(st.id, {}); setMemberRows(Array.isArray(r.data) ? r.data : (r.data.members || [])); }
    catch (e) { L.setErr(detail(e)); setMemberRows([]); }
  };

  const reloadMembers = async () => {
    if (!members) return;
    const r = await api.studioMembers(members.id, {});
    setMemberRows(Array.isArray(r.data) ? r.data : (r.data.members || []));
  };

  const memberName = (m) => s(m.nickname || m.display_name || m.username)
    || s(m.user && (m.user.nickname || m.user.username)) || `UID ${s(m.user_id || m.uid)}`;

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 个`}>
        <div className="adm-filter-search">
          <SearchInput label="搜索工作室名 / 室长" value={q} onChange={setQ} onSubmit={() => { setQuery(q); L.setPage(1); }} />
        </div>
        <SelectField label="状态" value={status} onChange={(v) => { setStatus(v); L.setPage(1); }} options={STUDIO_STATUS} />
        <FilledButton onClick={() => { setQuery(q); L.setPage(1); }}>搜索</FilledButton>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="groups" title="没有工作室" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((st) => (
            <Row key={st.id}
                 leading={<Avatar name={s(st.name)} src={s(st.avatar_url || st.cover_url)} />}
                 title={<><b>{s(st.name) || `#${st.id}`}</b>
                   {s(st.status) && <Badge tone={s(st.status) === 'active' ? 'primary' : 'error'}>{s(st.status)}</Badge>}
                   {s(st.category) && <Badge>{s(st.category)}</Badge>}
                   {st.frozen && <Badge><Snowflake size={12} /> 冻结</Badge>}</>}
                 meta={<>#{st.id} - 室长 {s(st.owner_nickname) || s(st.owner && st.owner.nickname) || '—'} - 成员 {num(st.member_count)} - 加入方式 {s(st.join_mode) || '—'} - 创建 {T(st.created_at)}</>}
                 body={s(st.description) ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{s(st.description).slice(0, 110)}</div> : null}
                 actions={<>
                   <TextButton onClick={() => openEdit(st)}>编辑</TextButton>
                   <TextButton onClick={() => openMembers(st)}><Users size={14} /> 成员</TextButton>
                   <TextButton disabled={busy} onClick={() => L.run(() => api.studioInvite(st.id), '已开启邀请')}>开启邀请</TextButton>
                   <TextButton disabled={busy} onClick={() => L.run(() => api.revokeStudioInvite(st.id), '已撤销邀请')}>撤销邀请</TextButton>
                   {st.frozen
                     ? <TextButton disabled={busy} onClick={() => L.run(() => api.unfreezeStudio(st.id), '已解冻')}>解冻</TextButton>
                     : <TextButton disabled={busy} onClick={() => L.run(() => api.freezeStudio(st.id), '已冻结')}><Snowflake size={14} /> 冻结</TextButton>}
                   {s(st.status) === 'banned'
                     ? <TextButton disabled={busy} onClick={() => L.run(() => api.unbanStudio(st.id), '已解封')}>解封</TextButton>
                     : <TextButton disabled={busy} onClick={async () => { if (await confirm(`封禁工作室「${s(st.name)}」？`)) L.run(() => api.banStudio(st.id), '已封禁'); }}><ShieldOff size={14} /> 封禁</TextButton>}
                   <TextButton disabled={busy} onClick={async () => { if (await confirm(`强制解散「${s(st.name)}」？不可恢复。`)) L.run(() => api.disbandStudio(st.id), '已解散'); }}>
                     <Trash2 size={14} /> 解散
                   </TextButton>
                 </>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}

      {/* 工作室资料：字段与 PATCH /admin/studios/{id} 一致 */}
      <Modal open={!!editS} title={`编辑工作室 ${editS ? s(editS.name) : ''}`} onClose={() => setEditS(null)} width={420} busy={busy}
             onSubmit={() => L.run(async () => {
               await api.editStudio(editS.id, {
                 name: form.name.trim(), description: form.description, category: form.category,
                 min_level: Number(form.min_level) || 0, join_mode: form.join_mode,
                 member_limit: Number(form.member_limit) || 0, announcement: form.announcement,
                 apply_required: !!form.apply_required, multi_studio_only: !!form.multi_studio_only,
                 avatar_url: form.avatar_url.trim(), cover_url: form.cover_url.trim(), status: form.status,
               });
               setEditS(null);
             }, '已保存')}>
        <OutlinedTextField label="名称" value={form.name || ''} onInput={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <OutlinedTextField label="简介" value={form.description || ''} onInput={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
        <OutlinedTextField label="分类" value={form.category || ''} onInput={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
        <SelectField label="加入方式" value={form.join_mode} onChange={(v) => setForm((f) => ({ ...f, join_mode: v }))} options={JOIN_MODES} />
        <SelectField label="状态" value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                     options={[['active', '正常'], ['frozen', '冻结'], ['banned', '封禁']]} />
        <OutlinedTextField label="加入最低等级" type="number" value={String(form.min_level ?? 0)}
                           onInput={(e) => setForm((f) => ({ ...f, min_level: e.target.value }))} />
        <OutlinedTextField label="成员上限" type="number" value={String(form.member_limit ?? 0)}
                           onInput={(e) => setForm((f) => ({ ...f, member_limit: e.target.value }))} />
        <OutlinedTextField label="工作室公告" value={form.announcement || ''} onInput={(e) => setForm((f) => ({ ...f, announcement: e.target.value }))} rows={3} />
        <OutlinedTextField label="头像地址" value={form.avatar_url || ''} onInput={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))} />
        <OutlinedTextField label="封面地址" value={form.cover_url || ''} onInput={(e) => setForm((f) => ({ ...f, cover_url: e.target.value }))} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14 }}>需要申请审核</span>
          <Switch selected={!!form.apply_required} onChange={(e) => setForm((f) => ({ ...f, apply_required: e.target.selected }))} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14 }}>仅允许未加入其他工作室的用户</span>
          <Switch selected={!!form.multi_studio_only} onChange={(e) => setForm((f) => ({ ...f, multi_studio_only: e.target.selected }))} />
        </div>
      </Modal>

      {/* 成员管理 */}
      <Modal open={!!members} title={`成员管理 - ${members ? s(members.name) : ''}`} onClose={() => setMembers(null)} width={560}>
        {!memberRows ? <Loading /> : memberRows.length === 0 ? <Note>这个工作室没有成员</Note> : memberRows.map((m) => {
          const role = s(m.role) || 'member';
          const muted = !!(m.muted || m.muted_until);
          const id = s(m.user_id || m.uid);
          return (
            <div key={id} className="row" style={{ justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-soft)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {memberName(m)} <Badge>{role}</Badge> {muted && <Badge tone="error">已禁言</Badge>}
                  {role === 'owner' && <Crown size={13} />}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>UID {id}{m.joined_at ? ` - 加入 ${T(m.joined_at)}` : ''}</div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <TextButton onClick={async () => { await api.setStudioMemberRole(members.id, id, role === 'admin' ? 'member' : 'admin'); await reloadMembers(); }}>
                  {role === 'admin' ? '降为成员' : '升为管理'}
                </TextButton>
                <TextButton onClick={async () => { await api.muteStudioMember(members.id, id, !muted); await reloadMembers(); }}>
                  <VolumeX size={13} /> {muted ? '解除禁言' : '禁言'}
                </TextButton>
                <TextButton onClick={async () => { if (await confirm(`把 ${memberName(m)} 移出工作室？`)) { await api.kickStudioMember(members.id, id); await reloadMembers(); } }}>
                  移出
                </TextButton>
                <TextButton onClick={async () => { if (await confirm(`把室主转让给 ${memberName(m)}？不可撤销。`)) { await api.transferStudioOwner(members.id, id); await reloadMembers(); } }}>
                  转让室主
                </TextButton>
              </div>
            </div>
          );
        })}
      </Modal>
    </>
  );
}

/* ============================================================ 风纪委员会（2026-10-12 新规则） */
/**
 * 后台面板：审议库复审（含完整票型）+ 入会申请审批 + 委员管理（任期/标记数/续任）+ 审计日志。
 * 接口见 pages/admin/client.js 的 committee* 一组。
 */
export function Committee() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [queueState, setQueueState] = useState('admin_review');
  const [queue, setQueue] = useState([]);
  const [audit, setAudit] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState(null);      // { item, decision }
  const [appRow, setAppRow] = useState(null);      // 申请审批
  const [memRow, setMemRow] = useState(null);      // 委员操作
  const [form, setForm] = useState({ note: '', suspend: false });
  const [grantUid, setGrantUid] = useState('');

  const load = async () => {
    setErr('');
    try {
      const [ov, rq, au] = await Promise.all([
        api.committeeOverview(),
        api.committeeReviewQueue({ state: queueState, limit: 60 }),
        api.committeeAudit({ limit: 60 }),
      ]);
      setData(ov.data || {});
      setQueue((rq.data && rq.data.items) || []);
      setAudit((au.data && au.data.items) || []);
    } catch (e) { setErr(detail(e)); }
  };
  useEffect(() => { load(); }, [queueState]);   // eslint-disable-line

  const run = async (fn, ok = 'ok') => {
    setBusy(true); setErr('');
    try { await fn(); await load(); } catch (e) { setErr(detail(e)); } finally { setBusy(false); }
  };

  if (err && !data) return <Note tone="error">{err}</Note>;
  if (!data) return <Loading />;

  const th = data.thresholds || {};
  const apps = data.applications || [];
  const members = data.members || [];
  const counts = data.review_counts || {};

  return (
    <>
      <Card>
        <PanelHead icon={<Gavel size={17} />} title={t('committee.adminTitle')}>
          <RefreshButton onClick={load} busy={busy} />
        </PanelHead>
        <Note>{t('committee.adminThresholds', {
          report_hide: th.report_hide, violation_hide: th.violation_hide, clean_restore: th.clean_restore,
          term_days: th.term_days, renew_marks: th.renew_marks, exam_draw: th.exam_draw, exam_pass: th.exam_pass,
        })}</Note>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <Badge tone={(counts.admin_review || 0) > 0 ? 'error' : 'plain'}>
            {t('committee.tabAdminReview')} {counts.admin_review || 0}
          </Badge>
          <Badge>{t('committee.tabHidden')} {counts.hidden || 0}</Badge>
          <Badge>{t('committee.tabPending')} {counts.pending || 0}</Badge>
          <Badge tone="primary">{t('committee.tabRestored')} {counts.restored || 0}</Badge>
          <Badge>{t('committee.adminApplications')} {apps.length}</Badge>
          <Badge>{t('committee.adminMembers')} {members.length}</Badge>
        </div>
        {err && <div style={{ marginTop: 10 }}><Note tone="error">{err}</Note></div>}
      </Card>

      {/* 审议库复审 */}
      <Card>
        <PanelHead icon={<ShieldAlert size={17} />} title={t('committee.adminPending')} count={queue.length}>
          <SelectField label={t('committee.myStatus')} value={queueState} onChange={setQueueState}
                       options={[['admin_review', t('committee.tabAdminReview')], ['hidden', t('committee.tabHidden')],
                                 ['pending', t('committee.tabPending')], ['restored', t('committee.tabRestored')],
                                 ['all', t('committee.tabAll')]]} />
        </PanelHead>
        {queue.length === 0 ? <Note>{t('committee.adminEmpty')}</Note> : queue.map((it) => (
          <Row key={it.review_id}
               title={<><b>{s(it.title) || `#${it.target_id}`}</b> <Badge>{s(it.state_label)}</Badge>{' '}
                 <Badge tone={it.votes && it.votes.violation > 0 ? 'error' : 'plain'}>{s(it.source_label)}</Badge></>}
               meta={<>
                 {s(it.kind_label || (it.target_type))} - {t('committee.author', { name: s(it.author && (it.author.nickname || it.author.display_name)) || '—' })}
                 {' - '}{t('committee.votesViolation', { n: (it.votes && it.votes.violation) || 0 })}
                 {' / '}{t('committee.votesClean', { n: (it.votes && it.votes.clean) || 0 })}
                 {it.report_count > 0 ? ` - ${t('committee.reportCount', { n: it.report_count })}` : ''}
                 {it.hidden_reason ? ` - ${t('committee.hiddenBy', { reason: it.hidden_reason })}` : ''}
               </>}
               body={<>
                 {it.preview && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{s(it.preview)}</div>}
                 {/* 完整票型（谁投的什么） */}
                 {it.votes && (
                   <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.9 }}>
                     {(it.votes.violation_by || []).map((v) => `有违规：${s(v.nickname)}`).join('；')}
                     {(it.votes.violation_by || []).length && (it.votes.clean_by || []).length ? '；' : ''}
                     {(it.votes.clean_by || []).map((v) => `无违规：${s(v.nickname)}`).join('；')}
                   </div>
                 )}
               </>}
               actions={<>
                 <FilledButton disabled={busy}
                               onClick={() => { setDecide({ item: it, decision: 'restore' }); setForm({ note: '' }); }}>
                   {t('committee.adminRestore')}
                 </FilledButton>
                 <TextButton disabled={busy}
                             onClick={() => { setDecide({ item: it, decision: 'uphold' }); setForm({ note: '' }); }}>
                   {t('committee.adminUphold')}
                 </TextButton>
               </>} />
        ))}
      </Card>

      {/* 入会申请 */}
      <Card>
        <PanelHead icon={<Users size={17} />} title={t('committee.adminApplications')} count={apps.length} />
        {apps.length === 0 ? <Note>{t('committee.adminEmpty')}</Note> : apps.map((a) => (
          <Row key={a.id}
               title={<><b>{s(a.user && (a.user.nickname || a.user.username)) || `UID ${s(a.uid)}`}</b>{' '}
                 <Badge tone="primary">{t('committee.adminExamScore')} {num(a.exam_score)} / {num(a.exam_total)}</Badge></>}
               meta={<>UID {s(a.uid)} - {T(a.created_at)}{s(a.note) ? ` - ${s(a.note)}` : ''}</>}
               actions={<>
                 <FilledButton disabled={busy} onClick={() => { setAppRow(a); setForm({ note: '' }); }}>
                   {t('committee.adminApprove')}
                 </FilledButton>
               </>} />
        ))}
      </Card>

      {/* 在册委员 */}
      <Card>
        <PanelHead icon={<Shield size={17} />} title={t('committee.adminMembers')} count={members.length} />
        {members.length === 0 ? <Note>{t('committee.adminEmpty')}</Note> : members.map((m) => (
          <Row key={m.id}
               title={<><b>{s(m.user && (m.user.nickname || m.user.username)) || `UID ${s(m.uid)}`}</b>{' '}
                 {m.status === 'active' ? <Badge tone="primary">{s(m.status)}</Badge> : <Badge tone="error">{s(m.status)}</Badge>}
                 {m.renewal_mode === 'auto_threshold' && <Badge>{s(m.renewal_mode)}</Badge>}</>}
               meta={<>
                 UID {s(m.uid)}
                 {' - '}{t('committee.adminMarks')} {num(m.marks_total)}
                 {' - '}{t('committee.votesViolation', { n: num(m.violations) })}
                 {' / '}{t('committee.votesClean', { n: num(m.clean) })}
                 {' - '}{t('committee.adminTerm')} {T(m.term && m.term.term_ends_at)}
                 {' - '}{t('committee.termProgress', { n: num(m.term && m.term.marked_count), threshold: num(m.term && m.term.mark_threshold) })}
               </>}
               actions={<>
                 <TextButton disabled={busy} onClick={() => { setMemRow(m); setForm({ note: '', suspend: m.status !== 'active' }); }}>
                   {m.status === 'active' ? t('committee.adminSuspend') : t('committee.adminResume')}
                 </TextButton>
                 <TextButton disabled={busy}
                             onClick={() => run(async () => { await api.renewCommitteeMember(s(m.uid), {}); }, 'ok')}>
                   {t('committee.adminRenew')}
                 </TextButton>
               </>} />
        ))}
        <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          {t('committee.adminGrantHint', { term_days: th.term_days })}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <OutlinedTextField label={t('committee.adminGrantUid')} value={grantUid}
                             onInput={(e) => setGrantUid(e.target.value)} />
          <FilledButton disabled={busy || !grantUid.trim()}
                        onClick={() => run(async () => {
                          await api.grantCommitteeMember(grantUid.trim(), {});
                          setGrantUid('');
                        })}>
            {t('committee.adminGrant')}
          </FilledButton>
        </div>
      </Card>

      {/* 审计日志 */}
      <Card>
        <PanelHead icon={<ListTree size={17} />} title={t('committee.adminAudit')} count={audit.length} />
        {audit.length === 0 ? <Note>{t('committee.adminEmpty')}</Note> : audit.map((a) => (
          <Row key={a.id}
               title={<><b>{s(a.method)}</b> <span className="muted">{s(a.path)}</span></>}
               meta={<>{T(a.created_at)}{a.user ? ` - ${s(a.user.nickname || a.user.username)}` : ''}</>}
               body={<div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{s(a.detail)}</div>} />
        ))}
      </Card>

      {/* 复审决定 */}
      <Modal open={!!decide} busy={busy} width={380}
             title={decide ? `${decide.decision === 'restore' ? t('committee.adminRestore') : t('committee.adminUphold')} - ${s(decide.item.title)}` : ''}
             onClose={() => setDecide(null)}
             onSubmit={() => run(async () => {
               await api.committeeDecide(decide.item.review_id, { decision: decide.decision, note: form.note.trim() });
               setDecide(null);
             })}>
        <Note>{t('committee.adminNote')}</Note>
        <OutlinedTextField label={t('committee.adminNote')} value={form.note}
                           onInput={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
      </Modal>

      {/* 申请审批 */}
      <Modal open={!!appRow} busy={busy} width={380}
             title={`${t('committee.adminApplications')} - ${appRow ? s(appRow.user && (appRow.user.nickname || appRow.user.username)) : ''}`}
             onClose={() => setAppRow(null)}
             onSubmit={() => run(async () => {
               await api.reviewCommitteeApplication(s(appRow.uid), { decision: 'approve', note: form.note.trim() });
               setAppRow(null);
             })}>
        <Note>{t('committee.adminNote')}</Note>
        <OutlinedTextField label={t('committee.adminNote')} value={form.note}
                           onInput={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        <TextButton disabled={busy} onClick={() => run(async () => {
          await api.reviewCommitteeApplication(s(appRow.uid), { decision: 'reject', note: form.note.trim() });
          setAppRow(null);
        })}>
          {t('committee.adminReject')}
        </TextButton>
      </Modal>

      {/* 委员停职 / 复职 */}
      <Modal open={!!memRow} busy={busy} width={380}
             title={`${form.suspend ? t('committee.adminSuspend') : t('committee.adminResume')} - ${memRow ? s(memRow.user && (memRow.user.nickname || memRow.user.username)) : ''}`}
             onClose={() => setMemRow(null)}
             onSubmit={() => run(async () => {
               await api.suspendCommitteeMember(s(memRow.uid), { suspended: form.suspend, note: form.note.trim() });
               setMemRow(null);
             })}>
        <Note>{t('committee.adminNote')}</Note>
        <OutlinedTextField label={t('committee.adminNote')} value={form.note}
                           onInput={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
      </Modal>
    </>
  );
}

/* ============================================================ 云变量房间 */
export function CloudRooms() {
  const L = useList(api.cloudRooms, { mode: 'client', keys: ['items'] });
  const confirm = useConfirm();
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState(null);
  const [detailData, setDetailData] = useState(null);

  useEffect(() => { api.cloudStats().then((r) => setStats(r.data)).catch(() => {}); }, []);

  const openRoom = async (r) => {
    setRoom(r); setDetailData(null);
    try { const res = await api.cloudRoom(s(r.work_id || r.id)); setDetailData(res.data); }
    catch (e) { L.setErr(detail(e)); }
  };

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}

      {stats && (
        <Card>
          <PanelHead icon={<Cloud size={17} />} title="云变量概览" />
          <div className="adm-stats">
            {Object.entries(stats).map(([k, v]) => (
              <div key={k} className="adm-stat">
                <div>
                  <div className="adm-stat-num">{typeof v === 'object' ? JSON.stringify(v).slice(0, 18) : String(v)}</div>
                  <div className="adm-stat-label">{k}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Toolbar footer={L.total != null ? `共 ${L.total} 个房间 - 第 ${L.page} / ${L.pages} 页` : ''}>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="cloud" title="没有活跃的云变量房间" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((r) => (
            <Row key={s(r.work_id || r.id)}
                 title={<b>{s(r.title) || s(r.name) || `房间 ${s(r.work_id || r.id)}`}</b>}
                 meta={<>稿件 #{s(r.work_id || r.id)} - 连接 {num(r.conns)} - 变量 {num(r.vars)} - 更新 {T(r.updated_at || r.at)}</>}
                 actions={<>
                   <TextButton onClick={() => openRoom(r)}>查看</TextButton>
                   <TextButton disabled={busy} onClick={async () => { if (await confirm('清空这个房间的云变量？不可恢复。')) L.run(() => api.clearCloudRoom(s(r.work_id || r.id)), '已清空'); }}>
                     <Trash2 size={14} /> 清空
                   </TextButton>
                 </>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="client" />
        </Card>
      )}

      <Modal open={!!room} title={`房间详情 ${room ? s(room.work_id || room.id) : ''}`} onClose={() => setRoom(null)} width={420}>
        {!detailData ? <Loading /> : Object.entries(detailData).map(([k, v]) => (
          <div key={k} className="row" style={{ justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
            <span className="muted">{k}</span>
            <b style={{ textAlign: 'right', wordBreak: 'break-all', maxWidth: 260 }}>
              {typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 140) : String(v)}
            </b>
          </div>
        ))}
      </Modal>
    </>
  );
}

/* ============================================================ 护照审核（复用既有组件） */
export function Passport() {
  return (
    <Card>
      <PanelHead icon={<FileText size={17} />} title="护照实名审核" />
      <PassportReview />
    </Card>
  );
}
