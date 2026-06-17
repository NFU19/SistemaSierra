/**
 * Punto de entrada del servidor local
 * Importa la aplicación Express configurada en app.ts y levanta el servidor HTTP.
 * Para despliegue en Vercel, ver api/index.ts.
 */

import app from './app';
import { config } from './config/config';
import { logger } from './utils/logger';
import { uberStoreService } from './services/uber-store.service';

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

  // Poner la tienda ONLINE al arrancar para que Uber siga enrutando pedidos.
  // Best-effort: si falla (ej. tienda aún no provisionada) NO tumba el servidor.
  if (config.uber.setOnlineOnStartup) {
    uberStoreService
      .setOnline()
      .then((ok) => {
        if (ok) logger.info('Tienda Uber marcada ONLINE al arranque');
      })
      .catch((error: any) => {
        logger.warn('No se pudo marcar la tienda ONLINE al arranque', {
          status: error.response?.status,
          data: error.response?.data,
          hint: 'Verifica que la tienda esté provisionada contra la app y que UBER_STORE_ID sea correcto',
        });
      });
  }
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
