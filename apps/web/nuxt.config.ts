export default defineNuxtConfig({
  compatibilityDate: '2026-10-05',
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css', '@open-file-viewer/core/style.css'],
  runtimeConfig: {
    public: {
      // 后端 API 地址,默认指向本地 API 服务
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://127.0.0.1:4000/api/v1',
      // 留空时后端会使用开发用户身份
      userId: process.env.NUXT_PUBLIC_USER_ID || '',
    },
  },
  app: {
    // 页面切换统一使用淡入淡出过渡,具体动效在 main.css 里定义
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      title: 'LOOP',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
})
