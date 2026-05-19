/**
 * Rutas para webhooks y endpoints de Uber
 */

import { Router } from 'express';
import { uberWebhookController } from '../controllers/uber-webhook.controller';
import { posController } from '../controllers/pos.controller';
import { uberMenuController } from '../controllers/uber-menu.controller';

export const webhookRoutes = Router();

/**
 * POST /webhook/uber/orders
 * Recibe webhooks de orden de Uber Eats
 */
webhookRoutes.post('/webhook/uber/orders', (req, res) =>
  uberWebhookController.handleOrderWebhook(req, res)
);

/**
 * GET /webhook/uber/health
 * Verifica el estado del middleware
 */
webhookRoutes.get('/webhook/uber/health', (req, res) =>
  uberWebhookController.healthCheck(req, res)
);

/**
 * POST /api/uber/menus/sync
 * Sincroniza menu desde Sierra a Uber Eats
 */
webhookRoutes.post('/api/uber/menus/sync', (req, res) =>
  uberMenuController.syncMenu(req, res)
);

/**
 * POS ROUTES
 */

/**
 * GET /pos
 * Interfaz visual del POS
 */
webhookRoutes.get('/pos', (req, res) => posController.getPOSInterface(req, res));

/**
 * GET /api/pos/stream
 * Server-Sent Events: stream de órdenes en tiempo real
 */
webhookRoutes.get('/api/pos/stream', (req, res) => posController.streamOrders(req, res));

/**
 * GET /api/pos/orders
 * Obtiene el historial de órdenes en JSON
 */
webhookRoutes.get('/api/pos/orders', (req, res) =>
  posController.getOrdersHistory(req, res)
);

/**
 * GET /
 * Redirige a la interfaz POS
 */
webhookRoutes.get('/', (_req, res) => {
  res.redirect('/pos');
});
