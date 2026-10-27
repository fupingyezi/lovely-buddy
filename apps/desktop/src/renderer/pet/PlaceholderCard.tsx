import type { ReactElement } from 'react'
import ImportPanel from '@/pet/ImportPanel'

interface Props {
  onDismiss: () => void
  onRescan: () => void
}

/** 无模型占位卡（modelUrl 为 null 且未手动关闭时显示）。 */
export default function PlaceholderCard({ onDismiss, onRescan }: Props): ReactElement {
  return (
    <div
      className="placeholder fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-(--sp-2) px-[28px] py-(--sp-5) border border-(--color-border) rounded-card bg-bg text-ink max-w-[420px] shadow-mint"
      data-interactive
    >
      <button
        className="absolute top-(--sp-1) right-2.5 bg-transparent text-ink-3 text-lg leading-none cursor-pointer hover:text-ink"
        title="暂不显示"
        onClick={onDismiss}
      >
        ×
      </button>
      <p className="text-base font-semibold">未找到 Live2D 模型</p>
      <p className="text-xs leading-[1.6] text-ink-2">支持粘贴 HTTPS zip 链接、选择本地 zip 或目录导入。</p>
      <ImportPanel />
      <div className="flex gap-(--sp-1)">
        <button
          className="px-(--sp-3) py-1.5 rounded-pill bg-primary text-white text-[13px] cursor-pointer"
          onClick={onRescan}
        >
          重新扫描
        </button>
      </div>
    </div>
  )
}
