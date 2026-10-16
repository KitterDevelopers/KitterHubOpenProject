import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import client from '../api/client';
import { useI18n } from '../i18n';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { lang } = useI18n();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('nimao_token');

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    client
      .get('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => localStorage.removeItem('nimao_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (account, password) => {
    // 带上当前界面语言：待实名账号只允许在英文界面登录，后端据此判断
    const res = await client.post('/auth/login', { account, password, lang });
    localStorage.setItem('nimao_token', res.data.access_token);
    setUser(res.data.user);
    return res.data.user;
  };

  const register = async (username, email, password, nickname, inviteCode, agree) => {
    const res = await client.post('/auth/register', {
      username, email, password,
      nickname: nickname || undefined,
      invite_code: inviteCode || undefined,
      lang,
      // 注册必须勾选同意条款，服务端同样会校验（站长 2026-10-02）
      agree_terms: !!agree,
    });
    localStorage.setItem('nimao_token', res.data.access_token);
    setUser(res.data.user);
    return res.data.user;
  };

  /** 邮箱注册第一步：给邮箱发 6 位验证码（lang 决定邮件模板用中文还是英文）。 */
  const sendEmailCode = async (email, purpose = 'register') => {
    const res = await client.post('/auth/email/send-code', { email, purpose, lang });
    return res.data;
  };

  /** GitHub 登录/绑定第一步：拿授权地址。
   *  intent=login 仅限英文模式（后端会拦）；intent=bind 需已登录。 */
  const githubAuthorize = async (intent = 'login') => {
    const res = await client.post('/auth/github/authorize-url', { intent, lang });
    return res.data.url;
  };

  /** GitHub 回调第二步：用一次性票据换登录态（或在设置页确认绑定完成）。 */
  const githubClaim = async (ticket) => {
    const res = await client.post('/auth/github/claim', { ticket });
    if (res.data.access_token) {
      localStorage.setItem('nimao_token', res.data.access_token);
      setUser(res.data.user);
    } else if (res.data.user) {
      setUser(res.data.user);   // 绑定场景：没有新 token，只更新自己
    }
    return res.data;
  };

  /** 邮箱注册第二步：用户名 + 邮箱 + 验证码 + 密码。 */
  const registerEmail = async ({ username, email, code, password, inviteCode, agree }) => {
    const res = await client.post('/auth/register', {
      username,
      email,
      email_code: code,
      password,
      invite_code: inviteCode || undefined,
      lang,
      // 服务端强制校验：未勾选同意条款不予注册（站长 2026-10-02）
      agree_terms: !!agree,
    });
    localStorage.setItem('nimao_token', res.data.access_token);
    setUser(res.data.user);
    return res.data.user;
  };

  /** 重新拉一次自己的账号信息（实名审核状态变化后调用）。 */
  const refresh = useCallback(async () => {
    const res = await client.get('/auth/me');
    setUser(res.data);
    return res.data;
  }, []);

  const registerCodemao = async (identity, password, inviteCode) => {
    const res = await client.post('/auth/register-codemao', { identity, password, invite_code: inviteCode || undefined });
    localStorage.setItem('nimao_token', res.data.access_token);
    setUser(res.data.user);
    return res.data.user;
  };

  const loginCodemao = async (identity, password) => {
    const res = await client.post('/auth/login-codemao', { identity, password });
    localStorage.setItem('nimao_token', res.data.access_token);
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = () => {
    localStorage.removeItem('nimao_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, token, login, register, registerEmail, sendEmailCode, githubAuthorize, githubClaim, registerCodemao, loginCodemao, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
