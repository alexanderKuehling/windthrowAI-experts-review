import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base is './' so the built site works when served from any subpath
// (e.g. a GitHub Pages project page at /<repo>/ or a custom domain root).
export default defineConfig({
  base: './',
  plugins: [react()],
})
