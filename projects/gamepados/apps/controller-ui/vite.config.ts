import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

// Two builds of the same UI (owner, 2026-11-02): the Google Play build and everything else. Mode "play" sets
// __PLAY__, so code that only the other builds need (Razorpay, our own prices) is removed from the Play bundle
// at build time, and the Play bundle goes to dist-play/. Each bundle carries a marker the Android build checks.
function bundleMarker(kind: 'play' | 'web' | 'camos') {
  return {
    name: 'gp-bundle-marker',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'gp-bundle', content: kind }, injectTo: 'head-prepend' as const }],
  }
}

export default defineConfig(({command, mode}) => ({
  base: command === 'serve' ? '/' : './',
  define: { __PLAY__: JSON.stringify(mode === 'play') },
  // Mode "camos" (2026-11-21) builds the CamOS webcam app's UI from camos.html into dist-camos/ — same styles and
  // motion as GamepadOS, separate app (apps/camos-android).
  build: mode === 'camos'
    ? { outDir: 'dist-camos', rollupOptions: { input: path.resolve(__dirname, 'camos.html') } }
    : { outDir: mode === 'play' ? 'dist-play' : 'dist' },
  plugins: [
    figmaAssetResolver(),
    bundleMarker(mode === 'play' ? 'play' : mode === 'camos' ? 'camos' : 'web'),
    // Only use viteSingleFile for production builds, not dev server
    ...(command === 'build' ? [viteSingleFile()] : []),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Dev server — accessible from Android phone on the same Wi-Fi network
  server: {
    host: '0.0.0.0',   // Expose to all network interfaces (not just localhost)
    port: 5173,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
}))
