import type { DragEvent, ReactElement } from 'react'
import { usePetStore } from '../../store/petStore'

/** 体积 → 「4.2 MB」 */
function formatBytes(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 行 meta：「hiyori.model3 · 4.2 MB · 3 组表情」（无数据的分段省略） */
function modelMeta(m: AvatarInfo): string {
  const parts = [(m.entry.split('/').pop() ?? m.entry).replace(/\.json$/, '')]
  if (m.sizeBytes !== undefined) parts.push(formatBytes(m.sizeBytes))
  if (m.expressions) parts.push(`${m.expressions} 组表情`)
  return parts.join(' · ')
}

/** 48×48 形象缩略占位（与菜单 24px 版同款 viewBox） */
function Thumb48(): ReactElement {
  return (
    <div className="size-12 shrink-0 rounded-xl bg-[#eaf7f1] flex items-center justify-center">
      <svg viewBox="0 0 48 48" className="size-7" fill="none" aria-hidden="true">
        <circle cx="24" cy="27" r="10" fill="#fff" />
        <circle cx="24" cy="13" r="5.5" fill="#fff" />
        <circle cx="21.5" cy="13.5" r="1" fill="#33403b" />
        <circle cx="26.5" cy="13.5" r="1" fill="#33403b" />
        <path d="M19.5 29.5c3 2 6 2 9 0" stroke="#33403b" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

/**
 * 设置·形象管理页：页头（标题+meta+导入按钮）+ 拖放区 + 形象行四态
 * （使用中/可切换/导入中/失败）+ 页脚。导入=浏览/拖放文件夹（后端校验 zip/目录内容）；
 * 导入进度无后端通道 → 导入中行用不确定态转圈，无取消。
 * 删除当前形象二次确认（回退默认）；成功后 notifyModelsChanged 广播桌宠窗口刷新。
 */
export default function ModelPage(): ReactElement {
  const models = usePetStore((s) => s.models)
  const modelUrl = usePetStore((s) => s.modelUrl)
  const importing = usePetStore((s) => s.importing)
  const importError = usePetStore((s) => s.importError)
  const importName = usePetStore((s) => s.importName)
  const selectModel = usePetStore((s) => s.selectModel)
  const importModel = usePetStore((s) => s.importModel)
  const deleteModel = usePetStore((s) => s.deleteModel)
  const clearImportError = usePetStore((s) => s.clearImportError)

  const total = models.reduce((s, m) => s + (m.sizeBytes ?? 0), 0)
  const meta =
    total > 0
      ? `共 ${models.length} 个 · 占用 ${formatBytes(total)} · Cubism 3 / 4`
      : `共 ${models.length} 个 · Cubism 3 / 4`

  const importFromPath = async (path: string): Promise<void> => {
    const ok = await importModel({ type: 'path', value: path })
    if (ok) window.lovelybuddy.notifyModelsChanged()
  }

  const browse = async (): Promise<void> => {
    const { canceled, path } = await window.lovelybuddy.pickImportPath('dir')
    if (!canceled && path) void importFromPath(path)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (!f) return
    void importFromPath(window.lovelybuddy.getPathForFile(f))
  }

  const doDelete = async (info: AvatarInfo): Promise<void> => {
    const current = info.url === modelUrl
    const tip = current
      ? `删除当前形象「${info.name}」？将回退到默认形象。此操作不可恢复。`
      : `删除形象「${info.name}」？此操作不可恢复。`
    if (!window.confirm(tip)) return
    await deleteModel(info)
    window.lovelybuddy.notifyModelsChanged()
  }

  return (
    <>
      <header className="shrink-0 flex items-end justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[17px] leading-none font-semibold text-ink">形象管理</h1>
          <p className="text-[11px] text-ink-3">{meta}</p>
        </div>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-pill bg-linear-to-r from-primary to-deep-end px-(--sp-3) text-xs font-medium text-white shadow-button cursor-pointer hover:-translate-y-px active:scale-[0.96]"
          onClick={() => void browse()}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M5.5 1.5v8M1.5 5.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          导入模型
        </button>
      </header>
      <div
        className="flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-[14px] border border-dashed border-[#e8e0d4] bg-[#fcfaf5] text-[11px] text-ink-3 cursor-pointer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => void browse()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1.5 3.5h3l1.2 1.4h6.8v6H1.5v-7.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M7 7.5v3M5.5 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span>拖入 .model3.json 所在文件夹，或点击浏览</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
        {importing && (
          <div className="flex h-[68px] shrink-0 items-center gap-3 rounded-[14px] border border-[#f0ebe0] bg-[#fcfaf5] px-2.5">
            <div className="size-12 shrink-0 rounded-xl bg-[#f1faf6] flex items-center justify-center">
              <div className="size-[38px] rounded-full border-2 border-[#dbeee7] border-t-[#5bc8a6] animate-spin" />
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
              <span className="truncate text-xs text-ink-2">正在导入 {importName ?? ''}</span>
              <div className="h-1 w-full max-w-[200px] rounded-pill bg-[#edf2f0]" />
            </div>
            <span className="h-6 flex items-center rounded-pill bg-[#f5faf7] px-2.5 text-[10px] font-medium text-[#8fa5a0]">
              导入中
            </span>
          </div>
        )}
        {importError !== null && (
          <div className="flex h-[68px] shrink-0 items-center gap-3 rounded-[14px] border border-[#f7e5e8] bg-[#fffafa] px-2.5">
            <div className="size-12 shrink-0 rounded-xl bg-[#faf4f4] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 2h8l4 4v12H5V2Z" fill="#faf4f4" stroke="#c98a94" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M8 9l4 4M12 9l-4 4" stroke="#c98a94" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <span className="truncate text-xs font-semibold text-[#6e5a5c]">{importName ?? '导入失败'}</span>
              <span className="truncate text-[10px] text-[#c98a94]">{importError}</span>
            </div>
            <span className="h-6 flex items-center rounded-pill bg-[#fcedf0] px-2.5 text-[10px] font-medium text-accent-ink">
              失败
            </span>
            <button
              type="button"
              className="text-[10px] text-ink-3 cursor-pointer hover:text-ink"
              onClick={clearImportError}
            >
              移除
            </button>
          </div>
        )}
        {models.length === 0 && !importing && importError === null && (
          <p className="text-ink-3 text-center mt-6">暂无形象，导入一个开始吧</p>
        )}
        {models.map((m) => {
          const active = m.url === modelUrl
          return (
            <div
              key={m.slug}
              className={`group flex h-[68px] shrink-0 items-center gap-3 rounded-[14px] border bg-surface px-2.5 ${
                active ? 'border-[#d1ede3]' : 'border-[#f0ebe0] cursor-pointer'
              }`}
              onClick={() => {
                if (!active) selectModel(m)
              }}
            >
              <Thumb48 />
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                <span className="truncate text-xs font-semibold text-ink">{m.name}</span>
                <span className="truncate text-[10px] text-ink-3">{modelMeta(m)}</span>
              </div>
              {active ? (
                <span className="h-6 flex items-center rounded-pill bg-selected-bg px-2.5 text-[10px] font-medium text-primary-deep">
                  使用中
                </span>
              ) : (
                <span className="invisible group-hover:visible h-6 flex items-center rounded-pill bg-[#f5faf7] px-2.5 text-[10px] font-medium text-[#8fa5a0]">
                  设为当前
                </span>
              )}
              <button
                type="button"
                className="size-7 shrink-0 flex items-center justify-center rounded-pill text-ink-3 cursor-pointer hover:bg-hover-bg hover:text-ink"
                title="删除形象"
                aria-label={`删除形象 ${m.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void doDelete(m)
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M2 3.5h8M4.5 3V2h3v1M3 3.5l.6 6.2c0 .4.3.8.7.8h3.4c.4 0 .7-.4.7-.8l.6-6.2M5 5.5v3M7 5.5v3"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          )
        })}
      </div>
      <footer className="shrink-0 text-[10px] text-ink-footer">
        仅支持 Cubism 3 / 4 · 单模型上限 80 MB · 删除当前模型会回退到默认形象
      </footer>
    </>
  )
}
