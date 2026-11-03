import express from 'express';
import { malRouter } from '../src/server/malRoutes.js';
import { chatRouter } from '../src/server/chatRoutes.js';
import { adminRouter } from '../src/server/adminRoutes.js';
import { blobRouter } from '../src/server/blobRoutes.js';
import { activityRouter } from '../src/server/activityRoutes.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Normalização de rota para rewrites da Vercel (/api/(.*) -> /api?__hikari_route=$1)
app.use((req, _res, next) => {
  const rawRoute = req.query?.__hikari_route;
  const forwardedRoute = Array.isArray(rawRoute) ? rawRoute[0] : rawRoute;

  if (typeof forwardedRoute === 'string') {
    delete req.query.__hikari_route;
    const cleanSubPath = forwardedRoute.replace(/^\/+/, '');
    if (cleanSubPath && (req.path === '/api' || req.path === '/')) {
      const parsedUrl = new URL(req.url, 'http://localhost');
      parsedUrl.searchParams.delete('__hikari_route');
      const remainingSearch = parsedUrl.searchParams.toString();
      req.url = `/api/${cleanSubPath}${remainingSearch ? `?${remainingSearch}` : ''}`;
    }
  }
  next();
});

// Suporte para ambos os formatos de encaminhamento da Vercel (/api/mal e /mal)
app.use('/api/mal', malRouter);
app.use('/mal', malRouter);

// Rotas de chat privado (/api/chat e /chat)
app.use('/api/chat', chatRouter);
app.use('/chat', chatRouter);

// Rotas administrativas seguras do Hikari (/api/admin e /admin)
app.use('/api/admin', adminRouter);
app.use('/admin', adminRouter);

// Rotas de mídia e Vercel Blob (/api/media e /media)
app.use('/api/media', blobRouter);
app.use('/media', blobRouter);

// Rotas de atividades do Hikari (/api/activities, /activities e /api/users/:userId/activities)
app.use('/api/activities', activityRouter);
app.use('/activities', activityRouter);
app.use('/api/users', activityRouter);

// Endpoint de diagnóstico e integridade
app.get(['/api', '/api/health'], (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Hikari Profiles MAL API',
    timestamp: Date.now(),
  });
});

export default app;
