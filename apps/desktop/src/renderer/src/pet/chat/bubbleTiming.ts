/** 流式结束（sending=false）后气泡静默多久淡出（图 01） */
export const HIDE_AFTER_MS = 8000
/** 淡出动画时长（CSS .speech-bubble--out transition 同步） */
export const FADE_MS = 200
/** 气泡展示期间窗口扩展保持：静默 8s + 淡出 200ms + 150ms 余量 */
export const BUBBLE_HOLD_MS = HIDE_AFTER_MS + FADE_MS + 150
