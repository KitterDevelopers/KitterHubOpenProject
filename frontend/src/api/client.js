import axios from 'axios';
import { API_BASE } from './base';

const client = axios.create({ baseURL: API_BASE });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('nimao_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('nimao_token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export function errMsg(err) {
  const en = localStorage.getItem('nimao_lang') === 'en';
  let d = err?.response?.data?.detail ?? err?.response?.data?.message;
  if (Array.isArray(d)) {
    // FastAPI 422 校验错误：detail 是对象数组，转成可读文字
    return d.map((x) => (x && x.msg) || JSON.stringify(x)).join('；');
  }
  // nginx / 网关直接挡下来的请求（413 等）返回的是 HTML 错误页，不能当 detail 显示，
  // 否则界面上会糊一整段 <html><head><title>413 ...>
  if (typeof d === 'string' && d.trim().startsWith('<')) d = '';
  if (d) return d;

  // 没有 detail 时按状态码给一句人话。413 尤其重要：护照图片超过 nginx 允许的大小
  // 时原来只会显示 axios 的 "Request failed with status code 413"，用户完全不知道该干嘛。
  const STATUS_TEXT = {
    400: en ? 'The request was rejected. Please check the input.' : '请求被拒绝了，请检查填写的内容。',
    401: en ? 'Please sign in first.' : '请先登录。',
    403: en ? 'You do not have permission to do that.' : '你没有权限执行该操作。',
    404: en ? 'Not found.' : '找不到请求的内容。',
    413: en ? 'The file is too large for the server to accept.' : '文件太大，服务器拒绝了这次上传。',
    429: en ? 'Too many requests. Please slow down.' : '请求过于频繁，请稍后再试。',
    500: en ? 'The server hit an error. Please try again later.' : '服务器出错了，请稍后重试。',
    502: en ? 'The server is unreachable right now. Please try again later.' : '服务暂时不可用，请稍后重试。',
    503: en ? 'The service is under maintenance. Please try again later.' : '服务正在维护，请稍后重试。',
    504: en ? 'The server timed out. Please try again.' : '服务器超时了，请重试。',
  };
  const status = err?.response?.status;
  if (status && STATUS_TEXT[status]) return STATUS_TEXT[status];

  // 兜底文案：errMsg 是普通函数（不是 hook），拿不到 t()，
  // 所以直接读 i18n 写的那个 localStorage key —— utils.js 的时间格式化也是这么做的。
  // 不这么写的话，英文模式下任何没有 detail 的失败都会冒出一句中文。
  const fallback = en ? 'Something went wrong. Please try again.' : '出错了，请稍后重试';
  return err?.message || fallback;
}

export default client;
