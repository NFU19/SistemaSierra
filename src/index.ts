/**
 * Punto de entrada de la aplicación
 * Configura Express y todos los middlewares
 */

import express, { Express, Request, Response } from 'express';
import { config, validateConfig } from './config/config';
import { logger } from './utils/logger';
import { webhookRoutes } from './routes/webhook.routes';

// Validar que las variables de entorno necesarias estén presentes
validateConfig();

const app: Express = express();

// ============================================================================
// MIDDLEWARES GLOBALES
// ============================================================================

// Body parser para JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Middleware de logging de requests
app.use((req: Request, res: Response, next) => {
  const startTime = Date.now();

  // Log al inicio
  logger.debug(`→ ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Capturar el método res.send original
  const originalSend = res.send;
  res.send = function (data: any) {
    const duration = Date.now() - startTime;
    logger.debug(`← ${req.method} ${req.path} ${res.statusCode} (+${duration}ms)`);
    return originalSend.call(this, data);
  };

  next();
});

// ============================================================================
// RUTAS
// ============================================================================

// Rutas de webhooks
app.use('/', webhookRoutes);

// Endpoint de bienvenida
app.get('/api/v1/intro', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Middleware de Integración Uber Eats ↔ Sistemas Sierra',
    version: '1.0.0',
    endpoints: {
      webhook: 'POST /webhook/uber/orders',
      health: 'GET /webhook/uber/health',
    },
  });
});

// Health check general
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// MANEJO DE ERRORES 404 Y GLOBAL
// ============================================================================

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn(`Endpoint no encontrado: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'Endpoint no encontrado',
    path: req.path,
    method: req.method,
  });
});

// Global error handler
app.use(
  (
    err: any,
    _req: Request,
    res: Response,
    _next: any
  ) => {
    logger.error('Error global no manejado', err);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: config.nodeEnv === 'development' ? err.message : undefined,
    });
  }
);

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info(`✓ Servidor iniciado en puerto ${PORT}`);
  logger.info(`✓ Ambiente: ${config.nodeEnv}`);
  logger.info(`✓ Base URL Sierra: ${config.sierra.apiUrl}`);
  logger.info(`✓ Health check: http://localhost:${PORT}/health`);
  logger.info(`✓ Intro: http://localhost:${PORT}/api/v1/intro`);
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

export default app;
