/** lovelybuddy:* IPC 频道名契约——preload（渲染侧调用）与 ipc.ts（主进程注册）共享的单一来源。 */
export const CHANNELS = {
  getRuntime: 'lovelybuddy:get-runtime',
  setPassthrough: 'lovelybuddy:set-passthrough',
  moveWindow: 'lovelybuddy:move-window',
  moveWindowEnd: 'lovelybuddy:move-window-end',
  resizeWindow: 'lovelybuddy:resize-window',
  expandWindow: 'lovelybuddy:expand-window',
  collapseWindow: 'lovelybuddy:collapse-window',
  expandMenu: 'lovelybuddy:expand-menu',
  quit: 'lovelybuddy:quit',
  openSettings: 'lovelybuddy:open-settings',
  closeSettings: 'lovelybuddy:close-settings',
  notifyChatCleared: 'lovelybuddy:notify-chat-cleared',
  chatCleared: 'lovelybuddy:chat-cleared',
  notifyModelsChanged: 'lovelybuddy:notify-models-changed',
  modelsChanged: 'lovelybuddy:models-changed',
  pickImportPath: 'lovelybuddy:pick-import-path',
  exportFile: 'lovelybuddy:export-file',
  getAppInfo: 'lovelybuddy:get-app-info',
  openExternal: 'lovelybuddy:open-external'
} as const
