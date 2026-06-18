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
import { orderStore, PosOrder } from './event.service';

// Valores placeholder que indican que el secret aún no se ha configurado de verdad
const PLACEHOLDER_SECRETS = new Set(['default-secret', 'your-webhook-secret-key', '']);

// Ventana de Uber para aceptar/rechazar antes del auto-cancel (~11.5 min)
const ACCEPT_WINDOW_MS = 11.5 * 60 * 1000;

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
        uberOrderDetails = await this.getOrderDetailsWithRetry(uberOrderId, 5);
      } catch (detailsError: any) {
        logger.warn(`No se pudieron obtener los detalles de la orden ${uberOrderId}, continuando con webhook payload`, detailsError.message);
        obtenerDetallesFallo = true;
        uberOrderDetails = this.createMinimalOrderFromWebhook(uberOrderId, webhook);
      }

      // Paso 2: Mapear a formato Sierra (se guarda listo, pero NO se envía hasta Aceptar)
      logger.debug('Paso 2: Mapeando orden a formato Sierra...');
      const sierraOrderTicket = orderMapperService.mapUberOrderToSierraTicket(uberOrderDetails);
      const details = this.buildOrderDetails(uberOrderDetails);

      // Paso 3: Guardar como PENDIENTE para que el operador decida (Aceptar/Denegar)
      const pendingOrder: PosOrder = {
        id: uberOrderId,
        orderNumber: details.orderNumber || uberOrderId.slice(0, 8),
        status: 'pending',
        receivedAt: new Date().toISOString(),
        deadline: this.computeDeadline(uberOrderDetails),
        details,
        ticket: sierraOrderTicket,
        message: obtenerDetallesFallo
          ? 'Detalles incompletos — revisar antes de aceptar'
          : undefined,
      };

      orderStore.upsert(pendingOrder);

      logger.info(`Orden ${uberOrderId} PENDIENTE, esperando acción del operador`, {
        items: sierraOrderTicket.plus.length,
        deadline: pendingOrder.deadline,
        tiempoProceso: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Orden pendiente de aceptación',
        uberOrderId,
      };
    } catch (error: any) {
      logger.error(`Error procesando orden ${uberOrderId}`, error);

      // Mostrar la orden en estado de error para que sea visible en el POS
      orderStore.upsert({
        id: uberOrderId,
        orderNumber: uberOrderId.slice(0, 8),
        status: 'error',
        receivedAt: new Date().toISOString(),
        deadline: null,
        message: error.message || 'Error desconocido al procesar la orden',
      });

      return {
        success: false,
        message: error.message || 'Error desconocido al procesar la orden',
        uberOrderId,
        error: error.stack || error.toString(),
      };
    }
  }

  /**
   * ACEPTAR: crea la orden en Sierra y la confirma en Uber (accept_pos_order).
   * Llamado desde el POS cuando el operador presiona "Aceptar".
   */
  async acceptOrder(uberOrderId: string): Promise<ProcessingResult> {
    const order = orderStore.get(uberOrderId);
    if (!order) {
      throw new Error(`Orden ${uberOrderId} no encontrada`);
    }
    if (order.status !== 'pending') {
      logger.warn(`Orden ${uberOrderId} ya no está pendiente (estado: ${order.status})`);
    }

    let ticket = order.ticket;

    // Si la orden quedó sin items (p.ej. el fetch inicial falló por token caído),
    // reintentamos obtener los detalles AHORA antes de mandarla a Sierra.
    if (!ticket || ticket.plus.length === 0) {
      logger.warn(`Orden ${uberOrderId} sin items — reintentando obtener detalles de Uber...`);
      const details = await uberOrderService.getOrderDetails(uberOrderId);
      ticket = orderMapperService.mapUberOrderToSierraTicket(details);
      orderStore.setStatus(uberOrderId, order.status, {
        ticket,
        details: this.buildOrderDetails(details),
      });
      if (ticket.plus.length === 0) {
        throw new Error('La orden no tiene productos disponibles en Uber');
      }
    }

    // 1) Crear en Sierra
    logger.info(`Aceptando orden ${uberOrderId}: creando en Sierra...`);
    const sierraResponse = await sierraIntegrationService.createOrder(ticket);

    // 2) Confirmar en Uber (si esto falla, Sierra ya la tiene; no revertimos)
    await uberOrderService.acceptOrder(uberOrderId);

    orderStore.setStatus(uberOrderId, 'preparing', {
      sierraOrderId: sierraResponse.orderId,
      message: 'Aceptada y enviada a Sierra',
    });

    logger.info(`Orden ${uberOrderId} ACEPTADA`, { sierraOrderId: sierraResponse.orderId });
    return {
      success: true,
      message: 'Orden aceptada',
      uberOrderId,
      sierraOrderId: sierraResponse.orderId,
    };
  }

  /**
   * DENEGAR: rechaza la orden en Uber (deny_pos_order) y la quita del POS.
   */
  async denyOrder(uberOrderId: string, reason = 'ITEM_UNAVAILABLE'): Promise<ProcessingResult> {
    const order = orderStore.get(uberOrderId);
    if (!order) {
      throw new Error(`Orden ${uberOrderId} no encontrada`);
    }

    logger.info(`Denegando orden ${uberOrderId} (motivo: ${reason})...`);
    await uberOrderService.denyOrder(uberOrderId, reason);

    orderStore.markDeniedAndRemove(uberOrderId, 'Rechazada por el operador');
    return { success: true, message: 'Orden rechazada', uberOrderId };
  }

  /** Calcula la fecha límite para aceptar (placed_at + ventana de Uber). */
  private computeDeadline(uberOrderDetails: any): string {
    const placedAt = Number(uberOrderDetails?.timestamp) || Date.now();
    return new Date(placedAt + ACCEPT_WINDOW_MS).toISOString();
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

        // No reintentar si es error de autenticación/cooldown: reintentar solo
        // martillaría el endpoint de token de Uber (que rate-limitea con 403/502).
        const msg = String(error.message || '');
        if (
          msg.includes('401') ||
          msg.includes('Token') ||
          msg.includes('autenticación') ||
          msg.includes('cooldown')
        ) {
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
   * Construye los detalles legibles de la orden (con nombres de producto) para mostrar en el POS.
   */
  private buildOrderDetails(uber: any) {
    const firstName = uber.customer?.first_name ?? '';
    const lastName = uber.customer?.last_name ?? '';
    return {
      orderNumber: uber.order_number ?? '',
      status: uber.status ?? '',
      customer: {
        name: `${firstName} ${lastName}`.trim() || 'Cliente Uber Eats',
        phone: uber.customer?.phone_number ?? '',
      },
      items: (uber.items ?? []).map((i: any) => ({
        name: i.title || i.id || 'Producto',
        plu: String(i.id ?? ''),
        quantity: i.quantity ?? 1,
        unitPrice: i.unit_price ?? 0,
        total: i.price ?? 0,
        customizations: (i.customizations ?? []).map((c: any) => ({
          title: c.title ?? '',
          selections: (c.selections ?? []).map((s: any) => s.title ?? ''),
        })),
      })),
      totals: uber.totals ?? {
        subtotal: 0,
        tax: 0,
        delivery_fee: 0,
        promotion: 0,
        total: 0,
        currency: 'MXN',
      },
    };
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
