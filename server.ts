import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { malRouter } from './src/server/malRoutes.js';
import { chatRouter } from './src/server/chatRoutes.js';
import { adminRouter } from './src/server/adminRoutes.js';
import { blobRouter } from './src/server/blobRoutes.js';
import { activityRouter } from './src/server/activityRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = 3000;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Montagem das rotas oficiais do MyAnimeList compartilhadas com o backend Vercel
app.use('/api/mal', malRouter);
app.use('/mal', malRouter);

// Montagem das rotas de mensagens privadas do Hikari
app.use('/api/chat', chatRouter);
app.use('/chat', chatRouter);

// Montagem das rotas administrativas seguras do Hikari
app.use('/api/admin', adminRouter);
app.use('/admin', adminRouter);

// Montagem das rotas seguras de mídia e Vercel Blob do Hikari Perfil
app.use('/api/media', blobRouter);
app.use('/media', blobRouter);

// Montagem das rotas seguras de atividades do Hikari
app.use('/api/activities', activityRouter);
app.use('/activities', activityRouter);
app.use('/api/users', activityRouter);

// Integração do Frontend com Vite em Desenvolvimento Local ou Produção
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hikari Profiles server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().catch((err) => {
    console.error('Falha ao iniciar o servidor:', err);
    process.exit(1);
  });
}

export default app;
