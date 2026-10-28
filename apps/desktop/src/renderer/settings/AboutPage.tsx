import { useEffect, useState, type ReactElement } from 'react'
import { AppLogo48 } from '@/settings/icons'

const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

const CREDITS = ['Electron', 'Live2D Cubism SDK', 'React', 'Zustand'] as const

/**
 * 设置·关于页：品牌卡 + 运行信息卡 + 致谢卡 + 页脚。版本/运行时全来自主进程真实值。
 * 链接行（项目主页/问题反馈/更新日志）、检查更新与开源协议行待仓库公开与打包发布（M4）后接入，
 * 本期不渲染。
 */
export default function AboutPage(): ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.lovelybuddy.getAppInfo().then(setInfo)
  }, [])

  const platform = info ? (PLATFORM_NAMES[info.platform] ?? info.platform) : '…'
  const infoRows: Array<[string, string]> = [
    ['版本', info?.version ?? '…'],
    ['运行环境', `${platform} ${info?.arch ?? ''}`.trim()],
    ['Live2D 运行时', 'pixi-live2d-display（Cubism Core）'],
    ['数据目录', info?.userData ?? '…']
  ]

  return (
    <>
      <header className="shrink-0 flex items-end justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[17px] leading-none font-semibold text-ink">关于</h1>
          <p className="text-[11px] text-ink-3">lovely-buddy v{info?.version ?? '0.1.0'} · 本地运行</p>
        </div>
      </header>
      <section className="shrink-0 flex items-center gap-3 rounded-[14px] border border-[#f0ebe0] bg-surface p-(--sp-3)">
        <AppLogo48 />
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-[13px] font-bold text-ink">lovely-buddy</span>
          <span className="text-[10px] text-ink-3">一只住在桌面角落的小猫，会看代码也会闲聊。</span>
        </div>
      </section>
      <section className="shrink-0 rounded-[14px] border border-[#f0ebe0] bg-surface px-(--sp-3) py-2 flex flex-col">
        {infoRows.map(([k, v]) => (
          <div key={k} className="flex h-8 items-center justify-between border-b border-[#f5efe6] last:border-b-0">
            <span className="text-[11px] text-ink-3">{k}</span>
            <span className="text-[11px] text-ink-soft truncate max-w-[320px]">{v}</span>
          </div>
        ))}
      </section>
      <section className="shrink-0 rounded-[14px] border border-[#f0ebe0] bg-surface p-(--sp-3) flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink">致谢</span>
        <div className="flex flex-wrap gap-1.5">
          {CREDITS.map((c) => (
            <span
              key={c}
              className="h-6 flex items-center rounded-pill bg-[#f5faf7] px-2.5 text-[10px] font-medium text-[#5d7a72]"
            >
              {c}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-ink-3">Live2D Cubism SDK 按 Live2D 专有许可使用，仅用于模型展示。</span>
      </section>
      <footer className="shrink-0 text-[10px] text-ink-footer">
        lovely-buddy {new Date().getFullYear()} · 所有数据仅存本机，不外传
      </footer>
    </>
  )
}
