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

// —— 导航图标（16×16，stroke 随 currentColor 走选中态）——

/** 形象管理：头 + 肩轮廓 */
export function IconModel(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5.4" r="2.9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.6 14.2c1.4-2 3.3-3 5.4-3s4 1 5.4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** 模型与连接：互锁链环 */
export function IconLink(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.5 11.5l-1 1a2.12 2.12 0 010-3l2-2a2.12 2.12 0 013 0l1 1M11.5 4.5l1-1a2.12 2.12 0 010 3l-2 2a2.12 2.12 0 01-3 0l-1-1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 对话记录：气泡 + 左下尾 */
export function IconChat(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.7 3.4h10.6v7.1H6.4l-3.7 3V3.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

/** 角色设定：薄荷填充文档卡 + 行 */
export function IconPersona(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.2 2.5h7.6c.9 0 1.7.8 1.7 1.7v7.6c0 .9-.8 1.7-1.7 1.7H4.2c-.9 0-1.7-.8-1.7-1.7V4.2c0-.9.8-1.7 1.7-1.7Z"
        fill="#dcf2ea"
        stroke="#35a483"
        strokeWidth="1.2"
      />
      <path d="M5.3 6.5h5.4M5.3 9.5h3.4" stroke="#35a483" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** 关于：圆 + i */
export function IconInfo(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.6v3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r="0.7" fill="currentColor" />
    </svg>
  )
}
