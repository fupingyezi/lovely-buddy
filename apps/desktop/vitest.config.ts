import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // 默认 jsdom（renderer 组件测试）；main/preload 的纯逻辑测试在文件顶部
    // 用 `// @vitest-environment node` 切换环境
    environment: 'jsdom',
    include: ['src/**/__test__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}']
  }
})
