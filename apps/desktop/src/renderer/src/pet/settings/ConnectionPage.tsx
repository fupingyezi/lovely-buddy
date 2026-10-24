import { useState, type FormEvent, type ReactElement } from 'react'
import { useConnectionStore } from '../../store/connectionStore'
import type { ConnectionInfo } from '../../lib/configApi'
import { hostOf, providerLabel, relTime } from './connectionFormat'

/** 表单字段本地态（编辑模式下 key 未动 = api_key 留空提交，服务端保留原 key）。 */
interface FormState {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: string
}

const EMPTY_FORM: FormState = { provider: 'deepseek', baseUrl: '', apiKey: '', model: '', maxTokens: '' }

function formFromConn(c: ConnectionInfo): FormState {
  return {
    provider: c.provider,
    baseUrl: c.base_url,
    apiKey: '',
    model: c.model,
    maxTokens: c.max_tokens > 0 ? String(c.max_tokens) : ''
  }
}

/** 表单输入 → 请求体（maxTokens 空/非数字 = 0；编辑模式 key 未动 = 空字符串保留原 key）。 */
function buildInput(f: FormState): {
  provider: string
  base_url: string
  model: string
  api_key: string
  max_tokens: number
} {
  const n = Number.parseInt(f.maxTokens, 10)
  return {
    provider: f.provider,
    base_url: f.baseUrl.trim(),
    model: f.model.trim(),
    api_key: f.apiKey,
    max_tokens: Number.isFinite(n) && n > 0 ? n : 0
  }
}

const inputCls =
  'h-8 w-full rounded-[9px] border border-border bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-primary-soft focus:shadow-focus'
const labelCls = 'text-[9px] text-ink-3'

/**
 * 设置·模型与连接页（ardot 06 实测值）：页头（当前模型+连接数+添加连接）
 * + 当前模型卡（薄荷浅底渐变 logo + 状态点）+ 连接行三态（使用中/未使用/未连接）
 * + 新增/编辑表单（服务商下拉/Base URL/API Key 掩码/模型名/最大 Token/测试连接/保存并启用）
 * + 页脚说明。行点击 = 打开编辑表单（key 掩码 +「已保存」，聚焦整体替换）。
 */
export default function ConnectionPage(): ReactElement {
  const config = useConnectionStore((s) => s.config)
  const error = useConnectionStore((s) => s.error)
  const formOpen = useConnectionStore((s) => s.formOpen)
  const editing = useConnectionStore((s) => s.editing)
  const saving = useConnectionStore((s) => s.saving)
  const testing = useConnectionStore((s) => s.testing)
  const testResult = useConnectionStore((s) => s.testResult)
  const openAdd = useConnectionStore((s) => s.openAdd)
  const openEdit = useConnectionStore((s) => s.openEdit)
  const closeForm = useConnectionStore((s) => s.closeForm)
  const add = useConnectionStore((s) => s.add)
  const update = useConnectionStore((s) => s.update)
  const remove = useConnectionStore((s) => s.remove)
  const test = useConnectionStore((s) => s.test)
  const clearTest = useConnectionStore((s) => s.clearTest)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [keyDirty, setKeyDirty] = useState(false)

  const connections = config?.connections ?? []
  const active = connections.find((c) => c.active) ?? null
  const meta = active ? `当前 ${active.model} · 共 ${connections.length} 个连接` : `共 ${connections.length} 个连接`

  const openAddForm = (): void => {
    setForm(EMPTY_FORM)
    setKeyDirty(false)
    openAdd()
  }

  const openEditForm = (c: ConnectionInfo): void => {
    setForm(formFromConn(c))
    setKeyDirty(false)
    openEdit(c)
  }

  const cancelForm = (): void => {
    setForm(EMPTY_FORM)
    setKeyDirty(false)
    closeForm()
  }

  const patch = (p: Partial<FormState>): void => {
    setForm((f) => ({ ...f, ...p }))
    clearTest() // 输入变化后旧测试结果失效（设计：失败浮红字保留输入，改输入则清除）
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    const input = buildInput(form)
    if (editing) void update(editing.id, input)
    else void add(input)
  }

  const doDelete = async (c: ConnectionInfo): Promise<void> => {
    const label = providerLabel(c.provider)
    if (c.active) {
      if (!window.confirm(`删除当前连接「${label}」？聊天将回退到默认配置。此操作不可恢复。`)) return
    }
    await remove(c.id)
  }

  const onTest = (): void => {
    void test(buildInput(form))
  }

  const keyEditable = !editing || keyDirty
  const canSave = form.model.trim() !== '' && !saving

  return (
    <>
      <header className="shrink-0 flex items-end justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[17px] leading-none font-semibold text-ink">模型与连接</h1>
          <p className="text-[11px] text-ink-3">{meta}</p>
        </div>
        {formOpen ? (
          <button
            type="button"
            className="flex h-[30px] items-center rounded-pill border border-[#d6e5de] px-(--sp-2) text-[11px] font-medium text-ink-soft cursor-pointer hover:bg-hover-bg active:scale-[0.96]"
            onClick={cancelForm}
          >
            收起表单
          </button>
        ) : (
          <button
            type="button"
            className="flex h-[30px] items-center gap-[5px] rounded-pill border border-[#d6e5de] px-(--sp-2) text-[11px] font-medium text-ink-soft cursor-pointer hover:bg-hover-bg active:scale-[0.96]"
            onClick={openAddForm}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
              <path d="M4.5 1.2v6.6M1.2 4.5h6.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            添加连接
          </button>
        )}
      </header>

      {error !== null && <p className="shrink-0 text-[11px] text-accent-ink">{error}</p>}

      {active !== null ? (
        <div className="connection-card shrink-0 flex h-16 items-center gap-2.5 rounded-[14px] border-[1.5px] border-[#bfe5d9] bg-[#f2fcf7] px-(--sp-2)">
          <div className="size-9 shrink-0 rounded-[10px] bg-linear-to-r from-[#70d9b8] to-[#36a382] flex items-center justify-center">
            <span className="text-[15px] font-bold text-white">{providerLabel(active.provider)[0]}</span>
          </div>
          <div className="min-w-0 flex-1 flex flex-col gap-[3px]">
            <span className="truncate text-xs font-semibold text-[#2e5e50]">
              {providerLabel(active.provider)} · {active.model}
            </span>
            <span className="truncate text-[10px] text-meta-mint">
              {hostOf(active)} · {active.check_fail ? '服务未启动' : relTime(active.last_check)}
            </span>
          </div>
          <span className="flex items-center gap-[5px] text-[10px] font-medium text-active-ink">
            <span className={`size-1.5 rounded-pill ${active.last_check !== null ? 'bg-[#4cc29a]' : 'bg-[#dcd5cb]'}`} />
            {active.last_check !== null ? '已连接' : '未连接'}
          </span>
        </div>
      ) : (
        <div className="shrink-0 flex h-16 items-center justify-center rounded-[14px] border border-dashed border-[#e8e0d4] bg-[#fcfaf5] text-[11px] text-ink-3">
          尚未配置连接，添加后即可对话
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
        {connections.map((c) => (
          <div
            key={c.id}
            className="connection-row group flex h-14 shrink-0 items-center gap-2.5 rounded-[12px] border border-border-warm bg-surface px-2.5 cursor-pointer hover:bg-hover-bg"
            onClick={() => openEditForm(c)}
          >
            <div
              className={`size-7 shrink-0 rounded-lg flex items-center justify-center ${
                c.check_fail ? 'bg-[#f0f5f2]' : 'bg-[#f2efe6]'
              }`}
            >
              <span className="text-xs font-bold text-[#8fa5a0]">{providerLabel(c.provider)[0]}</span>
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <span className="truncate text-xs text-ink">
                {providerLabel(c.provider)} · {c.model}
              </span>
              <span className="truncate text-[10px] text-ink-3">
                {hostOf(c)} · {c.check_fail ? '服务未启动' : c.has_key ? '密钥已保存' : '未填密钥'}
              </span>
            </div>
            {c.active ? (
              <span className="h-6 flex items-center rounded-pill bg-selected-bg px-2.5 text-[10px] font-medium text-primary-deep">
                使用中
              </span>
            ) : c.check_fail ? (
              <span className="flex items-center gap-[5px] text-[10px] text-ink-faint">
                <span className="size-1.5 rounded-pill bg-[#dcd5cb]" />
                未连接
              </span>
            ) : (
              <span className="text-[10px] text-ink-faint">未使用</span>
            )}
            <button
              type="button"
              className="size-7 shrink-0 flex items-center justify-center rounded-pill text-ink-3 cursor-pointer hover:bg-hover-bg hover:text-accent-ink"
              title="删除连接"
              aria-label={`删除连接 ${providerLabel(c.provider)}`}
              onClick={(e) => {
                e.stopPropagation()
                void doDelete(c)
              }}
            >
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
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
        ))}
      </div>

      {formOpen && (
        <form
          className="connection-form shrink-0 flex flex-col gap-[9px] rounded-[14px] border border-border bg-cream-deep p-(--sp-2)"
          onSubmit={onSubmit}
        >
          <span className="text-[11px] font-semibold text-ink-soft">{editing ? '编辑连接' : '添加连接'}</span>
          <div className="flex gap-2">
            <label className="flex-1 flex flex-col gap-1">
              <span className={labelCls}>服务商</span>
              <div className="relative">
                <select
                  className={`${inputCls} cursor-pointer appearance-none pr-6`}
                  value={form.provider}
                  onChange={(e) => patch({ provider: e.target.value })}
                >
                  {Object.entries({
                    deepseek: 'DeepSeek',
                    dashscope: '阿里云百炼',
                    zhipu: '智谱 AI',
                    moonshot: '月之暗面 Kimi'
                  }).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <svg
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-ink-faint"
                  width="9"
                  height="9"
                  viewBox="0 0 9 9"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 3.5l2.5 2.5L7 3.5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </label>
            <label className="flex-1 flex flex-col gap-1">
              <span className={labelCls}>Base URL</span>
              <input
                className={inputCls}
                placeholder="留空使用服务商默认"
                value={form.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>API Key</span>
            {keyEditable ? (
              <input
                type="password"
                className={inputCls}
                placeholder={editing ? '输入新 key 整体替换' : 'sk-…'}
                value={form.apiKey}
                autoFocus={editing !== null}
                onChange={(e) => patch({ apiKey: e.target.value })}
              />
            ) : (
              <button
                type="button"
                className={`${inputCls} flex items-center justify-between cursor-pointer`}
                onClick={() => setKeyDirty(true)}
              >
                <span className="truncate text-[11px] text-ink">{editing?.key_masked}</span>
                <span className="shrink-0 text-[9px] text-primary-deep">已保存</span>
              </button>
            )}
          </label>
          <div className="flex gap-2">
            <label className="flex-1 flex flex-col gap-1">
              <span className={labelCls}>模型名</span>
              <input
                className={inputCls}
                placeholder="deepseek-chat / qwen-plus / …"
                value={form.model}
                onChange={(e) => patch({ model: e.target.value })}
              />
            </label>
            <label className="w-[104px] shrink-0 flex flex-col gap-1">
              <span className={labelCls}>最大 Token</span>
              <input
                className={inputCls}
                type="number"
                min={0}
                placeholder="默认"
                value={form.maxTokens}
                onChange={(e) => patch({ maxTokens: e.target.value })}
              />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span
              className={`text-[11px] ${
                testResult !== null ? (testResult.ok ? 'text-active-ink' : 'text-accent-ink') : ''
              }`}
            >
              {testResult?.message ?? ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex h-7 items-center rounded-pill border border-[#e6ded1] bg-surface px-(--sp-2) text-[11px] font-medium text-ink-soft cursor-pointer hover:bg-hover-bg active:scale-[0.96] disabled:opacity-50"
                disabled={testing || !canSave}
                onClick={onTest}
              >
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button
                type="submit"
                className="flex h-7 items-center rounded-pill bg-linear-to-r from-primary to-deep-end px-[14px] text-[11px] font-medium text-white shadow-button cursor-pointer hover:-translate-y-px active:scale-[0.96] disabled:opacity-60"
                disabled={!canSave}
              >
                {saving ? '保存中…' : '保存并启用'}
              </button>
            </div>
          </div>
        </form>
      )}

      <footer className="shrink-0 text-[10px] text-ink-footer">
        密钥存于本机 keychain，不随对话上传 · 兼容 OpenAI 协议
      </footer>
    </>
  )
}
