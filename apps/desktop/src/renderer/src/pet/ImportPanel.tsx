import { useState, type ReactElement } from 'react'
import { usePetStore } from '../store/petStore'
import type { ImportSource } from '../lib/assetsApi'

interface Props {
  /** 导入成功后回调（菜单里用于顺手关闭菜单） */
  onDone?: () => void
}

/** 导入面板：URL / 本地 zip / 本地目录，共用状态走 petStore。菜单与无模型占位卡共用。 */
export default function ImportPanel({ onDone }: Props): ReactElement {
  const importing = usePetStore((s) => s.importing)
  const importError = usePetStore((s) => s.importError)
  const importModel = usePetStore((s) => s.importModel)
  const [urlText, setUrlText] = useState('')

  // 本地导入：弹文件/目录选择框 → 交给后端导入管线
  const importLocal = async (mode: 'zip' | 'dir'): Promise<void> => {
    const picked = await window.lovelybuddy.pickImportPath(mode)
    if (picked.canceled || !picked.path) return
    const source: ImportSource = { type: 'path', value: picked.path }
    if (await importModel(source)) onDone?.()
  }

  const importFromUrl = async (): Promise<void> => {
    const value = urlText.trim()
    if (!value) return
    if (await importModel({ type: 'url', value })) {
      setUrlText('')
      onDone?.()
    }
  }

  return (
    <div className="import-panel">
      <input
        className="import-url"
        placeholder="粘贴 https://…zip 链接"
        value={urlText}
        onChange={(e) => setUrlText(e.target.value)}
        disabled={importing}
      />
      <div className="import-buttons">
        <button onClick={() => void importFromUrl()} disabled={importing || !urlText.trim()}>
          {importing ? '导入中…' : '从 URL 导入'}
        </button>
        <button onClick={() => void importLocal('zip')} disabled={importing}>
          本地 zip
        </button>
        <button onClick={() => void importLocal('dir')} disabled={importing}>
          本地目录
        </button>
      </div>
      {importing && <p className="import-status">导入中…（大文件可能需要一点时间）</p>}
      {importError !== null && <p className="import-error">{importError}</p>}
    </div>
  )
}
