/**
 * Configuración de la aplicación Express
 * Define middlewares, rutas y manejo de errores.
 * Exportada como módulo: usada por src/index.ts (servidor local) y api/index.ts (Vercel).
 */

import express, { Express, Request, Response } from 'express';
import { config, validateConfig } from './config/config';
import { logger } from './utils/logger';
import { webhookRoutes } from './routes/webhook.routes';

// Validar que las variables de entorno necesarias esten presentes
validateConfig();

const app: Express = express();
// Ocultar cabecera X-Powered-By para no exponer el framework
app.disable('x-powered-by');

// ============================================================================
// MIDDLEWARES GLOBALES
// ============================================================================

// Body parser para JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Middleware de logging de requests
app.use((req: Request, res: Response, next) => {
  const startTime = Date.now();

  // Capturar el metodo res.send original
  const originalSend = res.send;
  res.send = function (data: any) {
    const duration = Date.now() - startTime;
    // Log INFO para webhooks, DEBUG para el resto
    const isWebhook = req.path.startsWith('/webhook');
    const logFn = isWebhook ? logger.info.bind(logger) : logger.debug.bind(logger);
    logFn(`${req.method} ${req.path} → ${res.statusCode} (+${duration}ms)`);
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
    message: 'Middleware de Integracion Uber Eats ↔ Sistemas Sierra',
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

export default app;
