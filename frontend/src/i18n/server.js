/* 后端中文提示 → 英文提示 的翻译层。
 *
 * 为什么不用后端返回 code：后端有 200 多处 raise，改动面太大且容易漏；
 * 这里只覆盖用户真正常见的那批提示，用「精确匹配 + 正则」兜底，
 * 翻不到的就把中文原样透出（总比显示一个 code 让人摸不着头脑好）。
 */
import { errMsg } from '../api/client';
import { useI18n } from './index.jsx';

const RULES = [
  // ---- 登录 / 账号 ----
  [/^账号或密码错误$/, 'Incorrect account or password'],
  [/^该账号已被封禁，无法登录$/, 'This account has been banned and cannot sign in.'],
  [/^该账号已注销，无法登录$/, 'This account has been deactivated and cannot sign in.'],
  [/^该账号尝试登录失败次数过多，请 15 分钟后再试$/, 'Too many failed sign-in attempts for this account. Please try again in 15 minutes.'],
  [/^该账号尝试次数过多，请 15 分钟后再试$/, 'Too many attempts for this account. Please try again in 15 minutes.'],
  [/^该账号为编程猫注册，尚未设置本站密码/, 'This account was created through Codemao and has no local password yet. Please sign in with Codemao and set a password in Settings first.'],
  [/^该账号需在英文模式下登录并完成实名验证/, 'This account must sign in with the English interface to complete identity verification.'],
  [/^This account must sign in with the English interface/, 'This account must sign in with the English interface to complete identity verification.'],

  // ---- 注册 ----
  [/^邮箱注册通道暂未开放/, 'Email sign-up is currently closed. Please sign in with your Codemao account instead.'],
  [/^这个邮箱已经注册过了，直接登录就好$/, 'This email is already registered — just sign in.'],
  [/^用户名或邮箱已被注册$/, 'That username or email is already taken.'],
  [/^用户名包含敏感词：(.+?)，请更换$/, (m) => `The username contains blocked words: ${m[1]}. Please choose another one.`],
  [/^邀请码无效$/, 'That invite code is not valid.'],
  [/^当前新用户注册过于频繁，请稍后再试$/, 'Too many new sign-ups right now. Please try again later.'],

  // ---- 验证码 ----
  [/^请先获取邮箱验证码$/, 'Please request an email verification code first.'],
  [/^验证码已过期，请重新获取$/, 'The code has expired. Please request a new one.'],
  [/^验证码不正确，还可以再试 (\d+) 次$/, (m) => `Incorrect code. You have ${m[1]} attempt(s) left.`],
  [/^验证码错误次数过多，请重新获取$/, 'Too many incorrect codes. Please request a new one.'],
  [/^验证码刚发送过，请 (\d+) 秒后再试$/, (m) => `A code was just sent. Please wait ${m[1]} seconds.`],
  [/^该邮箱获取验证码过于频繁，请 1 小时后再试$/, 'Too many codes requested for this email. Please try again in an hour.'],

  // ---- 邮件服务 ----
  [/^邮件服务还没配置好/, 'The mail service is not configured yet. Please contact the site administrator.'],
  [/^邮件服务鉴权失败/, 'Mail service authentication failed. Please contact the site administrator.'],
  [/^邮件发送被拒绝/, 'The mail service rejected the message (the sender domain may not be verified).'],
  [/^邮件参数被拒绝/, 'The mail service rejected the message format.'],
  [/^邮件发送过于频繁/, 'Too many emails sent. Please try again later.'],
  [/^邮件发送失败（网络异常）/, 'Failed to send the email (network error). Please try again later.'],
  [/^邮件发送失败（SMTP/, 'Failed to send the email (SMTP error). Please try again later.'],
  [/^SMTP 登录被拒/, 'The mail server rejected our sign-in. Please contact the site administrator.'],
  [/^收件人被拒绝/, 'The mail server refused that recipient address. Please check the email address.'],
  [/^发件人被拒绝/, 'The mail server refused our sender address. Please contact the site administrator.'],
  [/^部分收件人被拒绝/, 'The mail server refused some recipients. Please check the email address.'],
  [/^今天的验证码发送量已达上限，请明天再试$/, 'The daily limit for verification emails has been reached. Please try again tomorrow.'],

  // ---- 注册邮箱预检 ----
  [/^该账号还没有绑定可用的邮箱/, 'This account has no usable email address bound yet, so the password cannot be reset by email. Please sign in and bind an email address in Settings.'],
  [/^这就是你当前绑定的邮箱，无需重复绑定$/, 'That is already your current email address.'],
  [/^这个邮箱已经被其他账号绑定了，请换一个$/, 'That email address is already bound to another account. Please use a different one.'],
  [/^当前没有绑定邮箱$/, 'You have no email address bound right now.'],
  [/^当前密码不正确$/, 'Your current password is incorrect.'],

  // ---- GitHub 登录 / 绑定 ----
  [/^GitHub 登录暂未开放/, 'GitHub sign-in is not available yet (the site administrator has not configured the GitHub OAuth client ID / secret).'],
  [/^请先登录再绑定 GitHub$/, 'Please sign in before linking GitHub.'],
  [/^你的账号已经绑定过 GitHub 了，请先解绑$/, 'Your account already has GitHub linked. Please unlink it first.'],
  [/^这次 GitHub 登录已失效或重复使用，请重新点击登录$/, 'This GitHub sign-in has expired or was already used. Please click sign in with GitHub again.'],
  [/^GitHub 回调参数不完整，请重新点击登录$/, 'The GitHub callback was incomplete. Please click sign in with GitHub again.'],
  [/^登录状态已失效，请重新登录后再绑定$/, 'Your session expired. Please sign in again and then link GitHub.'],
  [/^这个 GitHub 账号已经绑定了其他 KitterHub 账号$/, 'That GitHub account is already linked to another KitterHub account.'],
  [/^当前没有绑定 GitHub$/, 'No GitHub account is linked right now.'],
  [/^解绑后你将无法登录：/, 'You would be locked out: please bind an email address or set a password in Settings before unlinking GitHub.'],
  [/^GitHub 授权失败：/, 'GitHub authorization failed. Please try again.'],
  [/^连接 GitHub 失败：/, 'Could not reach GitHub. Please try again later.'],
  [/^GitHub 拒绝了这次请求/, 'GitHub rejected the request (possibly rate limited). Please try again later.'],
  [/^GitHub 授权已失效，请重新登录$/, 'Your GitHub authorization has expired. Please sign in again.'],
  [/^邮箱地址格式不正确，请检查后重试$/, 'That email address is not in a valid format. Please check it and try again.'],
  [/^这是一次性（临时）邮箱/, 'That looks like a disposable (temporary) email address — you would not receive the code, and it can be recycled. Please use a regular email address.'],
  [/^这个邮箱域名收不到邮件/, 'That email domain cannot receive mail (no MX record found). Please check for a typo.'],
  [/^邮箱地址不可用，请更换后重试$/, 'That email address cannot be used. Please try another one.'],

  // ---- 找回密码 ----
  [/^没有找到这个邮箱对应的账号$/, 'No account is linked to that email.'],
  [/^没有找到这个账号，请检查用户名 \/ 邮箱$/, 'No such account. Please check the username or email.'],
  [/^该账号是编程猫登录时自动创建的/, 'This account was created automatically through Codemao and has no real email address, so the password cannot be reset by email.'],
  // ---- 实名验证 ----
  [/^账号待实名验证：请先上传护照个人信息页并等待管理员审核$/, 'Your account is pending identity verification. Upload a photo of your passport information page and wait for an administrator to review it.'],
  [/^你的账号已通过审核，无需重复上传$/, 'Your account is already verified — no need to upload again.'],
  [/^护照已提交，正在等待管理员审核$/, 'Your passport has already been submitted and is waiting for review.'],
  [/^仅支持 JPG \/ PNG \/ WebP 图片$/, 'Only JPG / PNG / WebP images are supported.'],
  [/^图片大小不能超过 (\d+)MB$/, (m) => `The image must be smaller than ${m[1]}MB.`],
  [/^文件内容与声明格式不符，请重新上传$/, 'The file content does not match its format. Please upload again.'],
  [/^文件为空$/, 'The file is empty.'],
  [/^该用户还没有上传护照$/, 'This user has not uploaded a passport yet.'],
  [/^用户不存在$/, 'User not found.'],

  // ---- 编程猫等级奖励（经验中心）----
  [/^还没有绑定编程猫账号/, 'No Codemao account is linked yet. Link one first.'],
  [/^暂时读不到你的编程猫等级/, 'Your Codemao level cannot be read right now. Please try again later.'],
  [/^还没读到你的编程猫作者等级/, 'Your Codemao author level could not be read. Please try again in a moment.'],
  [/^编程猫「(.+?)」还没有对应的等级奖励/, (m) => `Codemao “${m[1]}” has no level reward here yet.`],
  [/^编程猫 Lv(\d+) 的奖励你已经领过了；等你升到更高级再来（当前保底 LV(\d+)）$/, (m) => `You have already claimed the reward for Codemao Lv${m[1]}. Come back when your Codemao level goes up (currently guaranteed LV${m[2]}).`],

  // ---- 权限 / 通用 ----
  [/^没有权限执行该操作$/, 'You do not have permission to do that.'],  [/^请先登录$/, 'Please sign in first.'],
  [/^登录状态已失效，请重新登录$/, 'Your session has expired. Please sign in again.'],
  [/^未找到(.+)$/, (m) => `Not found: ${m[1]}`],
  [/^请求过于频繁/, 'Too many requests. Please slow down.'],
];

/** 把一条后端提示翻成目标语言；翻不到就原样返回。 */
export function localizeServerMessage(message, lang) {
  const text = String(message == null ? '' : message).trim();
  if (!text || lang !== 'en') return text;
  for (const [pattern, repl] of RULES) {
    const m = text.match(pattern);
    if (m) return typeof repl === 'function' ? repl(m) : repl;
  }
  return text;
}

/**
 * 统一的错误提示 hook：
 *   const err = useErr();
 *   setError(err(e));         // axios 错误 → 本地化文案
 */
export function useErr() {
  const { lang, t } = useI18n();
  return (e) => {
    if (!e) return t('common.error');
    if (!e.response) return e.message && !/Network Error/i.test(e.message) ? localizeServerMessage(e.message, lang) : t('common.networkError');
    const raw = errMsg(e);
    return localizeServerMessage(raw, lang);
  };
}

export default { localizeServerMessage, useErr };
