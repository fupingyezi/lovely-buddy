// CSS 副作用导入的类型声明（TS 6 起 noUncheckedSideEffectImports 默认开启，编辑器报 TS2882）。
// 必须是脚本文件（不能有 import/export）：模块文件里的 declare module 会变成
// 对既有模块的 augmentation，通配 *.css 匹配不到真实模块 → 静默失效。
declare module '*.css'
