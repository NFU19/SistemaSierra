/**
 * Servicio de Procesamiento de Webhooks
 * Coordina el flujo completo: recepción → mapeo → envío a Sierra
 */

import { logger } from '../utils/logger';
import { uberOrderService } from './uber-order.service';
import { orderMapperService } from './order-mapper.service';
import { sierraIntegrationService } from './sierra-integration.service';
import { eventService } from './event.service';
import { config } from '../config/config';
import { UberOrderDetails, UberWebhookPayload } from '../interfaces/uber.interface';

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
    const webhookStoreId = webhook.data?.store_id;
    const uberOrderId = this.getOrderIdFromWebhook(webhook);
    let uberOrderDetails: UberOrderDetails | null = null;
    let resourceHref: string | undefined;

    try {
      logger.info(`Iniciando procesamiento de orden Uber: ${uberOrderId}`);

      if (!uberOrderId) {
        return {
          success: false,
          message: 'order_id no presente en webhook',
        };
      }

      if (config.uber.storeId && webhookStoreId && webhookStoreId !== config.uber.storeId) {
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
      resourceHref = webhook.resource_href;

      if (resourceHref) {
        const orderDetails = await uberOrderService.getOrderDetailsByResourceHref(resourceHref);

        if (this.isLegacyUberOrderDetails(orderDetails)) {
          uberOrderDetails = orderDetails;
        } else {
          logger.warn('Formato de orden no compatible con el mapeo actual', {
            uberOrderId,
            resourceHref,
          });

          eventService.emitOrderProcessed({
            id: `order_${Date.now()}`,
            uberOrderId,
            timestamp: new Date().toISOString(),
            status: 'processing',
            uberStatus: webhook.event_type,
            message: 'Orden recibida (detalle no compatible)',
          });

          return {
            success: true,
            message: 'Orden recibida, pendiente de mapeo',
            uberOrderId,
          };
        }
      } else {
        uberOrderDetails = await uberOrderService.getOrderDetails(uberOrderId);
      }

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
        uberOrderNumber: uberOrderDetails.order_number,
        timestamp: new Date().toISOString(),
        status: 'success' as const,
        uberStatus: uberOrderDetails.status,
        message: 'Orden creada exitosamente en Sierra',
        items: uberOrderDetails.items.map((item) => ({
          name: item.title,
          quantity: item.quantity,
          price: item.price,
        })),
        totals: {
          subtotal: uberOrderDetails.totals.subtotal,
          tax: uberOrderDetails.totals.tax,
          total: uberOrderDetails.totals.total,
          currency: uberOrderDetails.totals.currency,
        },
        customerName: `${uberOrderDetails.customer.first_name} ${uberOrderDetails.customer.last_name}`,
        notes: uberOrderDetails.special_instructions,
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

      if (uberOrderDetails) {
        eventService.emitOrderProcessed({
          id: `err_${uberOrderId}_${Date.now()}`,
          uberOrderId,
          uberOrderNumber: uberOrderDetails.order_number,
          timestamp: new Date().toISOString(),
          status: 'error',
          uberStatus: uberOrderDetails.status,
          message: error.message || 'Error desconocido',
          items: uberOrderDetails.items.map((item) => ({
            name: item.title,
            quantity: item.quantity,
            price: item.price,
          })),
          totals: {
            subtotal: uberOrderDetails.totals.subtotal,
            tax: uberOrderDetails.totals.tax,
            total: uberOrderDetails.totals.total,
            currency: uberOrderDetails.totals.currency,
          },
          customerName: `${uberOrderDetails.customer.first_name} ${uberOrderDetails.customer.last_name}`,
          notes: uberOrderDetails.special_instructions,
          errorDetails: error,
        });
      } else {
        eventService.emitOrderError(uberOrderId, error);
      }

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

  private getOrderIdFromWebhook(webhook: UberWebhookPayload): string {
    if (webhook.data?.order_id) {
      return webhook.data.order_id;
    }

    if (webhook.data?.resource_id) {
      return webhook.data.resource_id;
    }

    if (webhook.resource_id) {
      return webhook.resource_id;
    }

    if (webhook.resource_href) {
      try {
        const url = new URL(webhook.resource_href);
        const segments = url.pathname.split('/').filter(Boolean);
        return segments[segments.length - 1] || '';
      } catch (error) {
        logger.warn('No se pudo parsear resource_href', {
          resourceHref: webhook.resource_href,
        });
      }
    }

    return '';
  }

  private isLegacyUberOrderDetails(orderDetails: any): orderDetails is UberOrderDetails {
    return (
      orderDetails &&
      typeof orderDetails === 'object' &&
      Array.isArray(orderDetails.items) &&
      orderDetails.totals &&
      orderDetails.customer
    );
  }
}

export const webhookProcessingService = new WebhookProcessingService();
