// 设置窗口图标：关于页品牌 logo 与导航图标共居此文件。
import type { ReactElement } from 'react'

/** 48×48 品牌猫脸 logo（关于页品牌卡）：渐变圆底 + 双耳 + 白脸 + 腮红 + 眯眼 + 小嘴。 */
export function AppLogo48(): ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7cdcba" />
          <stop offset="1" stopColor="#35a483" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#logo-g)" />
      <path d="M12.65 20.6L16.2 12.1l3.55 8.5Z" fill="#fff" />
      <path d="M28.25 20.6l3.55-8.5 3.55 8.5Z" fill="#fff" />
      <ellipse cx="24" cy="27.2" rx="9.5" ry="9.5" fill="#fff" />
      <circle cx="16.6" cy="29.4" r="1.9" fill="#f6b8c6" opacity="0.85" />
      <circle cx="31.4" cy="29.4" r="1.9" fill="#f6b8c6" opacity="0.85" />
      <circle cx="20.8" cy="25.9" r="1.4" fill="#3d4a45" />
      <path d="M26.2 25.4h2.6" stroke="#3d4a45" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M22.8 30.3c.8.5 1.6.5 2.4 0" stroke="#3d4a45" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
