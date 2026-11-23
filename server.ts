import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createSedoApp } from './server/app.ts';
import { runAutomatedDailyBackup } from './server/store.ts';
import { hydrateCatalogFromPublicFirestore } from './server/firestoreHydrate.ts';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const { app } = createSedoApp();
  const httpServer = http.createServer(app);

  // Return JSON 404 for unmatched /api/* routes before SPA HTML fallback
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Vite Dev Middleware or Static Production Build
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  await hydrateCatalogFromPublicFirestore();
  runAutomatedDailyBackup();
  const backupInterval = setInterval(() => {
    runAutomatedDailyBackup();
  }, 12 * 60 * 60 * 1000);
  backupInterval.unref();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SEDO Flowers & Gifts server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
