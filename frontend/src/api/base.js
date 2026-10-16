/* 后端地址的唯一来源（client.js 与 socket.js 共用）。
 *
 * 生产 / 局域网访问一律走**同源相对路径**：前端静态文件由 nginx 提供，
 * `/api` 与 `/socket.io` 都由 nginx 反代到后端，所以不需要、也不应该写死主机名。
 *
 * ★ 这里踩过一个坑：原来两个文件各自默认 `http://localhost:8000/api`，
 *   在服务器上编译时靠环境变量 `VITE_API_URL=/api` 覆盖，看着没问题；
 *   后来改成「本地 build + scp 上传 dist」之后，本地 shell 没有这个变量，
 *   打出来的包里就写死了 localhost:8000 —— 一上线，所有用户的浏览器都去连
 *   **自己电脑**的 8000 端口，整站接口全部 Network Error。
 *   现在默认值就是同源的 `/api`，只有 vite 开发服务器（5173）才直连本机后端。
 */
// 【本地验收用临时值】原本是 http://localhost:8000/api（vite 开发服务器直连后端）。
// 本次后台重构验收改成同源 /api，由 vite.adminverify.config.js 的 proxy 转发到隧道；
// 生产构建走 import.meta.env.VITE_API_URL / 相对路径，与这里无关。**验收结束前会还原**。
const DEV_API = 'http://localhost:8000/api';

function isViteDev() {
  try {
    return typeof window !== 'undefined' && ['5173', '5273'].includes(String(window.location.port));
  } catch (e) {
    return false;
  }
}

export const API_BASE = import.meta.env.VITE_API_URL || (isViteDev() ? DEV_API : '/api');

// Socket.IO 挂在服务端根路径（不是 /api），去掉 /api 后缀；相对路径时回退到当前源
const stripped = API_BASE.replace(/\/api\/?$/, '');
export const SOCKET_URL = stripped || (typeof window !== 'undefined' ? window.location.origin : '');

export default API_BASE;
