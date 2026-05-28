/**
 * Punto de entrada del servidor local
 * Importa la aplicación Express configurada en app.ts y levanta el servidor HTTP.
 * Para despliegue en Vercel, ver api/index.ts.
 */

import app from './app';
import { config } from './config/config';
import { logger } from './utils/logger';

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info(`Servidor iniciado en puerto ${PORT}`);
  logger.info(`Ambiente: ${config.nodeEnv}`);
  logger.info(`Base URL Sierra: ${config.sierra.apiUrl}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Intro: http://localhost:${PORT}/api/v1/intro`);
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGTERM', () => {
  logger.info('SIGTERM recibido, cerrando servidor...');
  server.close(() => {
    logger.info('Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT recibido, cerrando servidor...');
  server.close(() => {
    logger.info('Servidor cerrado');
    process.exit(0);
  });
});
