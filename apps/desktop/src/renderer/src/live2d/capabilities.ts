// 模型能力目录：加载时从模型设定读出「有什么动作组、有什么表情」，
// 供意图解析降级链与 avatar.json 映射校验使用（见 actions.ts）。
import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch'

export interface ModelCapabilities {
  /** 动作组名 → 组内动作数（模型设定文件实际定义的） */
  motions: Record<string, number>
  /** 表情名列表（模型设定文件实际定义的） */
  expressions: string[]
}

export function deriveCapabilities(model: Live2DModel): ModelCapabilities {
  const defs = model.internalModel.motionManager.definitions as Record<string, unknown[]>
  const motions: Record<string, number> = {}
  for (const [group, list] of Object.entries(defs)) motions[group] = list.length
  // cubism4 大写 Name / cubism2 小写 name，两种都读
  const settings = model.internalModel.settings as { expressions?: { Name?: string; name?: string }[] }
  const expressions = (settings.expressions ?? []).map((e) => e.Name ?? e.name ?? '').filter(Boolean)
  return { motions, expressions }
}
