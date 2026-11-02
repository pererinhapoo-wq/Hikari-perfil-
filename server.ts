import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { malRouter } from './src/server/malRoutes.js';
import { chatRouter } from './src/server/chatRoutes.js';

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
