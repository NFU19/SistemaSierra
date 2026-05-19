/**
 * Servicio de Procesamiento de Webhooks
 * Coordina el flujo completo: recepción → mapeo → envío a Sierra
 */

import { UberWebhookPayload } from '../interfaces/uber.interface';
import { logger } from '../utils/logger';
import { uberOrderService } from './uber-order.service';
import { orderMapperService } from './order-mapper.service';
import { sierraIntegrationService } from './sierra-integration.service';
import { eventService } from './event.service';
import { config } from '../config/config';

interface ProcessingResult {
  success: boolean;
  message: string;
  uberOrderId?: string;
  sierraOrderId?: string;
  error?: string;
}

class WebhookProcessingService {
  /**
   * Procesa un webhook de Uber Eats de forma asíncrona
   * @param webhook Payload del webhook
   */
  async processWebhookAsync(webhook: UberWebhookPayload): Promise<void> {
    // Fire and forget: procesamos en segundo plano sin bloquear la respuesta HTTP
    this.processWebhookInternal(webhook).catch((error) => {
      logger.error('Error crítico en procesamiento de webhook', error);
    });
  }

  /**
   * Procesa internamente el webhook
   * @param webhook Payload del webhook
   */
  private async processWebhookInternal(webhook: UberWebhookPayload): Promise<ProcessingResult> {
    const startTime = Date.now();
    const uberOrderId = webhook.data.order_id || webhook.data.resource_id || '';
    const webhookStoreId = webhook.data.store_id;

    try {
      logger.info(`Iniciando procesamiento de orden Uber: ${uberOrderId}`);

      if (!uberOrderId) {
        return {
          success: false,
          message: 'order_id no presente en webhook',
        };
      }

      if (config.uber.storeId && webhookStoreId !== config.uber.storeId) {
        logger.warn('Webhook ignorado por store_id no coincidente', {
          uberOrderId,
          webhookStoreId,
          expectedStoreId: config.uber.storeId,
        });

        return {
          success: false,
          message: 'store_id no coincide con la tienda configurada',
          uberOrderId,
        };
      }

      // Paso 1: Obtener detalles completos de la orden
      logger.debug('Paso 1: Obteniendo detalles de orden de Uber...');
      const uberOrderDetails = await uberOrderService.getOrderDetails(uberOrderId);

      if (config.uber.storeId && uberOrderDetails.store_id !== config.uber.storeId) {
        logger.warn('Orden ignorada por store_id no coincidente en detalles', {
          uberOrderId,
          detailsStoreId: uberOrderDetails.store_id,
          expectedStoreId: config.uber.storeId,
        });

        return {
          success: false,
          message: 'store_id no coincide con la tienda configurada',
          uberOrderId,
        };
      }

      // Paso 2: Mapear a formato Sierra
      logger.debug('Paso 2: Mapeando orden a formato Sierra...');
      const sierraOrderTicket = orderMapperService.mapUberOrderToSierraTicket(uberOrderDetails);

      // Paso 3: Crear orden en Sierra
      logger.debug('Paso 3: Creando orden en Sierra...');
      const sierraResponse = await sierraIntegrationService.createOrder(sierraOrderTicket);

      // Paso 4: Aceptar orden en Uber (si aplica)
      logger.debug('Paso 4: Aceptando orden en Uber...');
      await uberOrderService.acceptOrder(uberOrderId);

      const processingTime = Date.now() - startTime;

      logger.info(`Orden procesada exitosamente en ${processingTime}ms`, {
        uberOrderId,
        sierraOrderId: sierraResponse.orderId,
        processingTime,
      });

      const successOrder = {
        id: `order_${Date.now()}`,
        uberOrderId,
        timestamp: new Date().toISOString(),
        status: 'success' as const,
        message: 'Orden creada exitosamente en Sierra',
        orderData: sierraOrderTicket,
      };

      eventService.emitOrderProcessed(successOrder);

      return {
        success: true,
        message: 'Orden procesada exitosamente',
        uberOrderId,
        sierraOrderId: sierraResponse.orderId,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;

      logger.error(`Error procesando orden ${uberOrderId} después de ${processingTime}ms`, error);

      eventService.emitOrderError(uberOrderId, error);

      return {
        success: false,
        message: error.message || 'Error desconocido al procesar la orden',
        uberOrderId,
        error: error.stack || error.toString(),
      };
    }
  }

  /**
   * Valida que el webhook provenga de Uber (validación de firma)
   * TODO: Implementar validación de firma HMAC
   * @param signature Firma del webhook
   * @param payload Payload del webhook
   * @returns true si la firma es válida
   */
  validateWebhookSignature(_signature: string, _payload: any): boolean {
    // TODO: Implementar validación HMAC-SHA256 con WEBHOOK_SIGNATURE_SECRET
    logger.debug('Validando firma de webhook (función placeholder)');
    // Por ahora, siempre retorna true. En producción, validar con HMAC
    return true;
  }
}

export const webhookProcessingService = new WebhookProcessingService();
