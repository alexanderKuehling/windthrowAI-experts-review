import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The tileloading backend, as reached from the dev server. Everything the app
// requests under /api is forwarded there, so the browser only ever talks to
// the dev server's own origin and the backend's CORS allow-list stays out of
// the picture. Point TILE_API_PROXY_TARGET at the deployed service to develop
// against production instead of a local uvicorn.
const DEFAULT_PROXY_TARGET = 'http://localhost:8080'

// https://vite.dev/config/
// base is './' so the built site works when served from any subpath
// (e.g. a GitHub Pages project page at /<repo>/ or a custom domain root).
export default defineConfig(({ mode }) => {
  // '' = no prefix filter: the proxy target is a dev-server setting, not
  // something that should be inlined into the client bundle, so it is
  // deliberately not a VITE_ variable.
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.TILE_API_PROXY_TARGET || DEFAULT_PROXY_TARGET

  return {
    base: './',
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('error', (err) => {
              // A refused connection arrives as an AggregateError whose message
              // is empty, so prefer the errno code when there is one.
              const reason = (err as NodeJS.ErrnoException).code || err.message
              console.error(
                `\n[api-proxy] ${target} is not reachable (${reason}).\n` +
                `            Start the tileloading backend (./dev.sh in windthrowAI-tileloading)\n` +
                `            or set TILE_API_PROXY_TARGET to the deployed service.\n`,
              )
            })
          },
        },
      },
    },
  }
})
