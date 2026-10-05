import { createApp } from './app';
import { config } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';

const app = createApp();

const server = app.listen(config.server.port, '0.0.0.0', async () => {
  console.log(`[NUMMF Server] Running in ${config.server.env} mode on port ${config.server.port}`);
  console.log(`[Health Endpoint] http://0.0.0.0:${config.server.port}${config.server.apiPrefix}/health`);
  console.log(`[Tenant Isolation] ${config.features.tenantIsolation ? 'Enabled' : 'Disabled'}`);

  await connectDatabase();
});

const shutdown = async (signal: string) => {
  console.log(`\n[NUMMF Server] ${signal} received. Shutting down gracefully...`);
  await disconnectDatabase();
  server.close(() => {
    console.log('[NUMMF Server] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
