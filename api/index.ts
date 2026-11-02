import express from 'express';
import { malRouter } from '../src/server/malRoutes.js';
import { chatRouter } from '../src/server/chatRoutes.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Suporte para ambos os formatos de encaminhamento da Vercel (/api/mal e /mal)
app.use('/api/mal', malRouter);
app.use('/mal', malRouter);

// Rotas de chat privado (/api/chat e /chat)
app.use('/api/chat', chatRouter);
app.use('/chat', chatRouter);

// Endpoint de diagnóstico e integridade
app.get(['/api', '/api/health'], (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Hikari Profiles MAL API',
    timestamp: Date.now(),
  });
});

export default app;
