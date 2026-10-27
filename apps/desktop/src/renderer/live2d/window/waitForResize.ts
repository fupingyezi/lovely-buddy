/** 等下一次窗口 resize 事件（主进程 setBounds 后渲染进程尺寸异步落地，模型位移
 *  随之完成）。超时兜底 300ms：扩展被屏幕夹紧无尺寸变化时没有 resize 事件，
 *  不能卡死打开流程。 */
export function waitForResize(timeoutMs = 300): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, timeoutMs)
    function done(): void {
      window.removeEventListener('resize', done)
      window.clearTimeout(timer)
      resolve()
    }
    window.addEventListener('resize', done)
  })
}
