// 前端建置設定（issue #39）：只打包 JS，HTML / CSS / 圖片維持由 FastAPI 直接提供。
// - 輸入：各頁的 ES module 進入點 static/js/pages/*.js
// - 輸出：static/dist/assets/<name>-<hash>.js 與 static/dist/.vite/manifest.json（建置結果進 repo）
// - main.py 送出 HTML 時依 manifest 把 /static/js/pages/<page>.js 換成對應的 dist 檔；沒有 dist 時直接載入原始 ES modules
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = name => fileURLToPath(new URL(`./static/js/pages/${name}.js`, import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'static/dist',
    emptyOutDir: true,
    manifest: true,
    // 不壓縮、不產生 source map：辦公室電腦上用 DevTools 直接看得懂建置後的程式碼
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: page('main'),
        settings: page('settings'),
        permissions: page('permissions'),
        login: page('login'),
      },
    },
  },
});
