import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Apenas as seis variáveis de ambiente públicas do Firebase autorizadas para o bundle do navegador
const CLIENT_FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const;

export default defineConfig(() => {
  // Constrói mapeamento restrito sem expor process.env inteiro ou outras variáveis
  const firebaseDefines: Record<string, string> = {};
  for (const key of CLIENT_FIREBASE_ENV_KEYS) {
    const val = process.env[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      firebaseDefines[`import.meta.env.${key}`] = JSON.stringify(val.trim());
    }
  }

  return {
    define: firebaseDefines,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (
              id.includes('/node_modules/@firebase/firestore') ||
              id.includes('/node_modules/firebase/firestore') ||
              id.includes('/node_modules/@firebase/webchannel-wrapper') ||
              id.includes('/node_modules/@grpc/')
            ) {
              return 'vendor-firebase-firestore';
            }
            if (
              id.includes('/node_modules/firebase/') ||
              id.includes('/node_modules/@firebase/')
            ) {
              return 'vendor-firebase-auth';
            }
            if (id.includes('/node_modules/lucide-react/')) {
              return 'vendor-lucide';
            }
            if (
              id.includes('/node_modules/motion/') ||
              id.includes('/node_modules/framer-motion/')
            ) {
              return 'vendor-motion';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
