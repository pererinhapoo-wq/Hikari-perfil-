import express from 'express';
import { malRouter } from '../src/server/malRoutes.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Suporte para ambos os formatos de encaminhamento da Vercel (/api/mal e /mal)
app.use('/api/mal', malRouter);
app.use('/mal', malRouter);

// Endpoint de diagnóstico e integridade
app.get(['/api', '/api/health'], (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Hikari Profiles MAL API',
    timestamp: Date.now(),
  });
});

export default app;
