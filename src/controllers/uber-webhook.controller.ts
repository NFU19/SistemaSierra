/**
 * Controlador del Webhook de Uber Eats
 */

import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { webhookProcessingService } from '../services/webhook-processing.service';
import { UberWebhookPayload } from '../interfaces/uber.interface';

class UberWebhookController {
  /**
   * Endpoint POST /webhook/uber/orders
   * Recibe webhooks de Uber Eats y retorna 200 OK inmediatamente
   */
  async handleOrderWebhook(req: Request, res: Response): Promise<void> {
    try {
      logger.debug('Webhook recibido de Uber', {
        headers: req.headers,
        body: req.body,
      });

      // Validar que el payload sea válido
      if (!this.isValidPayload(req.body)) {
        logger.warn('Payload de webhook inválido', req.body);
        res.status(400).json({
          success: false,
          error: 'Payload inválido',
        });
        return;
      }

      const webhook = req.body as UberWebhookPayload;

      // Validar la firma del webhook (si está disponible)
      const signature = req.headers['x-uber-signature'] as string;
      if (signature && !webhookProcessingService.validateWebhookSignature(signature, req.body)) {
        logger.warn('Firma de webhook inválida');
        res.status(401).json({
          success: false,
          error: 'Firma de webhook inválida',
        });
        return;
      }

      // Retornar 200 OK inmediatamente
      logger.info(`Webhook ${webhook.event_id} aceptado, procesando en segundo plano`);
      res.status(200).json({
        success: true,
        message: 'Webhook recibido y en procesamiento',
        eventId: webhook.event_id,
      });

      // Procesar el webhook de forma asíncrona (fire and forget)
      // De esta forma, Uber no espera a que se complete el procesamiento
      webhookProcessingService.processWebhookAsync(webhook);
    } catch (error) {
      logger.error('Error en controlador de webhook', error);
      res.status(500).json({
        success: false,
        error: 'Error procesando webhook',
      });
    }
  }

  /**
   * Endpoint GET /webhook/uber/health
   * Verifica el estado del middleware y la conexión con Sierra
   */
  async healthCheck(_req: Request, res: Response): Promise<void> {
    try {
      logger.debug('Health check solicitado');

      const timestamp = new Date().toISOString();

      // Verificar conexión con Sierra
      // Nota: Importar sierraIntegrationService evita dependencia circular
      const { sierraIntegrationService } = await import('../services/sierra-integration.service');
      const sierraHealthy = await sierraIntegrationService.healthCheck();

      res.status(200).json({
        success: true,
        status: 'healthy',
        timestamp,
        services: {
          sierra: sierraHealthy ? 'ok' : 'down',
        },
      });
    } catch (error) {
      logger.error('Error en health check', error);
      res.status(500).json({
        success: false,
        status: 'unhealthy',
        error: 'Error al verificar estado',
      });
    }
  }

  /**
   * Valida que el payload del webhook sea un UberWebhookPayload válido
   */
  private isValidPayload(body: any): body is UberWebhookPayload {
    if (!body || typeof body !== 'object') return false;
    if (typeof body.event_id !== 'string') return false;
    if (typeof body.event_type !== 'string') return false;
    
    // Validar formato nuevo (oficial de Uber Eats) o formatos anteriores
    const hasNewFormat = body.meta && typeof body.meta.resource_id === 'string';
    const hasDataFormat = body.data && typeof body.data.order_id === 'string';
    const hasRootOrderId = typeof body.order_id === 'string'; // orders.notification pone order_id en la raíz
    
    return hasNewFormat || hasDataFormat || hasRootOrderId;
  }
}

export const uberWebhookController = new UberWebhookController();
