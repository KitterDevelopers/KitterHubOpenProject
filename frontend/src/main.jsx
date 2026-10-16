import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeModeProvider } from './context/ThemeModeContext';
import { LangProvider } from './i18n';
import { applyAppearance } from './appearance';
import './styles/global.css';

// 界面偏好（字号 / 高对比度 / 导航栏样式）存在本机，必须在首屏渲染前落到 <html> 上，
// 否则会先按默认样式画一帧再跳变。
applyAppearance();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeModeProvider>
      {/* LangProvider 必须在 AuthProvider 外层：登录时要按当前语言提交 */}
      <LangProvider>
        <App />
      </LangProvider>
    </ThemeModeProvider>
  </React.StrictMode>
);
