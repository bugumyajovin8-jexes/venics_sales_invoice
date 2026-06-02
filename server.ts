import express from 'express';
import { createServer as createViteServer } from 'vite';
import { authRouter } from './server/routes/auth';
import { syncRouter } from './server/routes/sync';
import { adminRouter } from './server/routes/admin';
import { licenseRouter } from './server/routes/license';
import dotenv from 'dotenv';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/license', licenseRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
