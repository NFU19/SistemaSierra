/**
 * Rutas para webhooks y endpoints de Uber
 *
 * Controladores registrados:
 *   - UberWebhookController  → recepción de órdenes y health check
 *   - POSController          → interfaz web y stream SSE de órdenes
 *
 * Pendiente de exponer:
 *   - UberMenuController (uber-menu.controller.ts) → POST /api/uber/menus/sync
 */

import { Router } from 'express';
import { uberWebhookController } from '../controllers/uber-webhook.controller';
import { posController } from '../controllers/pos.controller';
import { uberStoreService } from '../services/uber-store.service';
import { logger } from '../utils/logger';

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
 * POST /api/pos/orders/:id/accept
 * Acepta la orden: la crea en Sierra y la confirma en Uber
 */
webhookRoutes.post('/api/pos/orders/:id/accept', (req, res) =>
  posController.acceptOrder(req, res)
);

/**
 * POST /api/pos/orders/:id/deny
 * Rechaza la orden en Uber y la elimina del POS
 */
webhookRoutes.post('/api/pos/orders/:id/deny', (req, res) =>
  posController.denyOrder(req, res)
);

/**
 * POST /api/pos/orders/:id/complete
 * Marca la orden como completada
 */
webhookRoutes.post('/api/pos/orders/:id/complete', (req, res) =>
  posController.completeOrder(req, res)
);

/**
 * UBER STORE STATUS ROUTES
 * Control manual del estado de la tienda (ONLINE / PAUSED) desde el POS.
 */

/**
 * GET /api/uber/store/status
 * Consulta el estado actual de la tienda en Uber
 */
webhookRoutes.get('/api/uber/store/status', async (_req, res) => {
  try {
    const status = await uberStoreService.getStoreStatus();
    res.status(200).json({ success: true, status });
  } catch (error: any) {
    logger.error('Error al consultar estado de tienda', error.response?.data || error.message);
    res.status(502).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/**
 * POST /api/uber/store/online
 * Pone la tienda disponible para recibir pedidos
 */
webhookRoutes.post('/api/uber/store/online', async (_req, res) => {
  try {
    await uberStoreService.setOnline();
    res.status(200).json({ success: true, status: 'ONLINE' });
  } catch (error: any) {
    logger.error('Error al poner tienda ONLINE', error.response?.data || error.message);
    res.status(502).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/**
 * POST /api/uber/store/offline
 * Pausa la tienda (body opcional: { reason, paused_until })
 */
webhookRoutes.post('/api/uber/store/offline', async (req, res) => {
  try {
    await uberStoreService.setOffline(req.body?.reason, req.body?.paused_until);
    res.status(200).json({ success: true, status: 'PAUSED' });
  } catch (error: any) {
    logger.error('Error al pausar tienda', error.response?.data || error.message);
    res.status(502).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/**
 * GET /
 * Redirige a la interfaz POS
 */
webhookRoutes.get('/', (_req, res) => {
  res.redirect('/pos');
});
