import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// CSP aplicada apenas no build (o servidor de dev do Vite usa scripts inline).
// GitHub Pages não permite cabeçalhos HTTP próprios, por isso usamos <meta>.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/';
  return {
    base,
    define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0') },
    plugins: [
      react(),
      {
        name: 'csp-meta',
        apply: 'build',
        transformIndexHtml: (html: string) =>
          html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
      },
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Smart Pantry',
          short_name: 'Despensa',
          description: 'Compras, despensa e preços da sua Casa — offline e compartilhado.',
          lang: 'pt-BR',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#f2f2f7',
          theme_color: '#34a853',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: 'index.html',
          // Nunca cachear chamadas à API (dados ficam no IndexedDB, não no cache HTTP).
          runtimeCaching: [],
        },
      }),
    ],
    build: {
      sourcemap: false,
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks: (id: string) =>
            id.includes('@supabase') ? 'supabase' : id.includes('node_modules') ? 'vendor' : undefined,
        },
      },
    },
  };
});
