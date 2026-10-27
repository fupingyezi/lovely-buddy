import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '@/App'
import SettingsApp from '@/settings/SettingsApp'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@/styles/tokens.css'
import '@/styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false }
  }
})

// 设置窗口复用同一渲染进程（主进程 loadURL/loadFile 带 ?settings=1），不加载 PIXI/桌宠逻辑
const isSettings = new URLSearchParams(window.location.search).has('settings')

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>{isSettings ? <SettingsApp /> : <App />}</QueryClientProvider>
)
