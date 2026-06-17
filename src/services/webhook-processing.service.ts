/**
 * Servicio de Procesamiento de Webhooks
 * Coordina el flujo completo: recepción → mapeo → envío a Sierra
 */

import crypto from 'node:crypto';
import { UberWebhookPayload } from '../interfaces/uber.interface';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { uberOrderService } from './uber-order.service';
import { orderMapperService } from './order-mapper.service';
import { sierraIntegrationService } from './sierra-integration.service';
import { eventService } from './event.service';

// Valores placeholder que indican que el secret aún no se ha configurado de verdad
const PLACEHOLDER_SECRETS = new Set(['default-secret', 'your-webhook-secret-key', '']);

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
    // Extraemos el UUID de la orden: formato nuevo (meta.resource_id), formato data, o formato orders.notification (root order_id)
    const uberOrderId = webhook.meta?.resource_id || webhook.data?.order_id || webhook.order_id;

    if (!uberOrderId) {
      throw new Error('No se pudo extraer el UUID (orderId) del payload del webhook');
    }

    try {
      logger.info(`Iniciando procesamiento de orden Uber: ${uberOrderId}`);

      // Paso 1: Obtener detalles completos de la orden (con reintentos)
      logger.debug('Paso 1: Obteniendo detalles de orden de Uber...');
      
      let uberOrderDetails: any;
      let obtenerDetallesFallo = false;

      try {
        uberOrderDetails = await this.getOrderDetailsWithRetry(uberOrderId, 3);
      } catch (detailsError: any) {
        logger.warn(`No se pudieron obtener los detalles de la orden ${uberOrderId}, continuando con webhook payload`, detailsError.message);
        obtenerDetallesFallo = true;

        // Crear un objeto mínimo con información del webhook como fallback
        uberOrderDetails = this.createMinimalOrderFromWebhook(uberOrderId, webhook);
      }

      // Paso 2: Mapear a formato Sierra
      logger.debug('Paso 2: Mapeando orden a formato Sierra...');
      const sierraOrderTicket = orderMapperService.mapUberOrderToSierraTicket(uberOrderDetails);

      // Si fallaron los detalles y no hay PLUs, no podemos crear una orden vacía en Sierra
      if (obtenerDetallesFallo && sierraOrderTicket.plus.length === 0) {
        logger.warn(`Orden ${uberOrderId} recibida sin items — no se envía a Sierra. Requiere revisión manual.`);

        // Opcional: rechazar en Uber para no dejar la orden vencer por timeout (penaliza la tienda)
        if (config.uber.autoDenyUnfulfillable) {
          logger.warn(`Auto-deny activado: rechazando orden ${uberOrderId} en Uber (sin items disponibles)`);
          await uberOrderService.denyOrder(uberOrderId, 'ITEM_UNAVAILABLE');
        }

        eventService.emitOrderError(uberOrderId, new Error(`Orden recibida de Uber pero sin items disponibles (order fetch falló). Revisar manualmente en Uber Eats Manager.`));
        return {
          success: false,
          message: 'Orden recibida sin detalles — revisión manual requerida',
          uberOrderId,
          error: 'No se pudieron obtener los items de la orden de Uber',
        };
      }

      // Paso 3: Crear orden en Sierra
      logger.debug('Paso 3: Creando orden en Sierra...');
      const sierraResponse = await sierraIntegrationService.createOrder(sierraOrderTicket);

      // Paso 4: Confirmar la orden en Uber (obligatorio dentro de 11.5 min)
      logger.debug('Paso 4: Aceptando orden en Uber...');
      await uberOrderService.acceptOrder(uberOrderId);

      const processingTime = Date.now() - startTime;

      const logMessage = obtenerDetallesFallo 
        ? `Orden procesada (sin detalles completos) en ${processingTime}ms`
        : `Orden procesada exitosamente en ${processingTime}ms`;

      logger.info(logMessage, {
        uberOrderId,
        sierraOrderId: sierraResponse.orderId,
        processingTime,
        detallesFallo: obtenerDetallesFallo,
      });

      const successOrder = {
        id: `order_${Date.now()}`,
        uberOrderId,
        timestamp: new Date().toISOString(),
        status: 'success' as const,
        message: obtenerDetallesFallo 
          ? 'Orden creada en Sierra (detalles incompletos)' 
          : 'Orden creada exitosamente en Sierra',
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
   * Intenta obtener los detalles de la orden con reintentos
   * @param orderId ID de la orden
   * @param maxRetries Número máximo de reintentos
   * @returns Detalles de la orden
   */
  private async getOrderDetailsWithRetry(orderId: string, maxRetries: number = 3): Promise<any> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Intento ${attempt}/${maxRetries} obtener detalles de orden ${orderId}`);
        return await uberOrderService.getOrderDetails(orderId);
      } catch (error: any) {
        lastError = error;
        logger.warn(`Intento ${attempt} falló para orden ${orderId}:`, error.message);

        // No reintentar si es error de autenticación
        if (error.message?.includes('401') || error.message?.includes('Token')) {
          throw error;
        }

        // Esperar antes de reintentar (backoff exponencial)
        if (attempt < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    throw lastError;
  }

  /**
   * Crea un objeto minimal de orden cuando no se pueden obtener los detalles
   * @param orderId ID de la orden
   * @param webhook Payload del webhook
   * @returns Objeto con información mínima de la orden
   */
  private createMinimalOrderFromWebhook(orderId: string, webhook: UberWebhookPayload): any {
    logger.warn(`Creando objeto mínimo de orden para ${orderId} usando información del webhook`);

    return {
      id: orderId,
      store_id: webhook.meta?.user_id || 'unknown',
      order_number: orderId.substring(0, 8),
      timestamp: webhook.event_time || webhook.timestamp || Date.now(),
      status: webhook.meta?.status || 'pos',
      items: [], // Vacío porque no tenemos detalles
      customer: {
        id: webhook.meta?.user_id || 'unknown',
        first_name: 'Customer',
        last_name: '',
        email: '',
        phone_number: '',
      },
      totals: {
        subtotal: 0,
        tax: 0,
        delivery_fee: 0,
        promotion: 0,
        total: 0,
        currency: 'MXN',
      },
      special_instructions: `Orden sin detalles completos. Webhook recibido: ${webhook.event_type}`,
      _incomplete: true, // Flag indicando que es incompleta
    };
  }

  /**
   * Valida que el webhook provenga de Uber.
   * Uber firma cada webhook con HMAC-SHA256 sobre el cuerpo CRUDO del request,
   * usando el Signing Key (configurado en WEBHOOK_SIGNATURE_SECRET) como clave.
   * El resultado va en el header X-Uber-Signature en hex minúsculas.
   *
   * Comportamiento seguro: si el secret aún no se configura (placeholder), NO bloquea
   * — solo advierte. Así no se pierden webhooks durante la fase de pruebas.
   *
   * @param signature Valor del header X-Uber-Signature
   * @param rawBody Cuerpo crudo del request (Buffer) — NO el objeto ya parseado
   * @returns true si la firma es válida (o si la validación está desactivada)
   */
  validateWebhookSignature(signature: string, rawBody: Buffer | string | undefined): boolean {
    const secret = config.webhook.signatureSecret;

    // Sin secret real configurado → no enforzar (modo pruebas)
    if (PLACEHOLDER_SECRETS.has(secret)) {
      logger.warn(
        'WEBHOOK_SIGNATURE_SECRET no configurado — se omite validación de firma. ' +
          'Configúralo con el "Signing Key" del dashboard de Uber para activar la verificación.'
      );
      return true;
    }

    if (!rawBody) {
      logger.warn('No se pudo validar la firma: cuerpo crudo (rawBody) no disponible');
      return false;
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = (signature || '').toLowerCase();

    // Comparación en tiempo constante; requiere buffers de igual longitud
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    if (expectedBuf.length !== providedBuf.length) {
      logger.warn('Firma de webhook con longitud inesperada — rechazada');
      return false;
    }

    const valid = crypto.timingSafeEqual(expectedBuf, providedBuf);
    if (!valid) {
      logger.warn('Firma de webhook no coincide con el HMAC esperado');
    }
    return valid;
  }
}

export const webhookProcessingService = new WebhookProcessingService();
