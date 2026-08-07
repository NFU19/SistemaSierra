/**
 * Servicio de Certificación de Uber Eats.
 *
 * Uber exige, para liberar el acceso a producción, evidencia de que cada endpoint
 * responde 200/204 y de que los webhooks se reconocen con 200. Este servicio ejercita
 * esas llamadas y registra los webhooks recibidos para poder capturar la evidencia.
 *
 * Las verificaciones se separan en dos grupos:
 *   - readOnly:  seguras de ejecutar en cualquier momento (consultas).
 *   - mutating:  modifican una orden real o crean recursos; se ejecutan de forma
 *                individual y explícita, nunca en lote.
 */

import { logger } from '../utils/logger';
import { config } from '../config/config';
import { UberCallResult } from '../interfaces/uber.interface';
import { uberOrderService } from './uber-order.service';
import { uberIntegrationService } from './uber-integration.service';
import { uberPromotionsService } from './uber-promotions.service';
import { uberReportingService } from './uber-reporting.service';

/** Etiquetas tal como Uber las nombra en su lista de requisitos. */
export type CheckId =
  | 'get-integration-details'
  | 'activate-integration'
  | 'get-order-details'
  | 'accept-order'
  | 'deny-order'
  | 'cancel-order'
  | 'order-ready'
  | 'resolve-fulfillment'
  | 'create-promotion'
  | 'report-files';

export interface CertificationCheck {
  id: CheckId;
  /** Nombre del requisito según el correo de Uber. */
  requirement: string;
  mutating: boolean;
  requiresOrderId: boolean;
  result?: UberCallResult;
  skipped?: string;
}

export interface WebhookRecord {
  receivedAt: string;
  eventType: string;
  orderId?: string;
  /** Código con el que el middleware reconoció el webhook. */
  ackStatus: number;
}

/**
 * Orden detectada por el middleware, haya llegado o no al POS.
 * Es la única forma de recuperar el UUID de órdenes que se filtran antes del POS
 * (canceladas, denegadas o programadas).
 */
export interface SeenOrder {
  orderId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Tipos de evento recibidos para esta orden. */
  events: string[];
  /** Qué hizo el middleware con ella. */
  disposition?: string;
}

const CHECKS: Omit<CertificationCheck, 'result' | 'skipped'>[] = [
  {
    id: 'get-integration-details',
    requirement: 'Integration Config: Get Integration Details',
    mutating: false,
    requiresOrderId: false,
  },
  {
    id: 'report-files',
    requirement: 'Reporting: Get Report files',
    mutating: false,
    requiresOrderId: false,
  },
  {
    id: 'get-order-details',
    requirement: 'Order: Get Order Details',
    mutating: false,
    requiresOrderId: true,
  },
  {
    id: 'activate-integration',
    requirement: 'Integration Config: Activate Integration',
    mutating: true,
    requiresOrderId: false,
  },
  {
    id: 'create-promotion',
    requirement: 'Promotions: Create promotions',
    mutating: true,
    requiresOrderId: false,
  },
  {
    id: 'accept-order',
    requirement: 'Order: Accept Order (uAPI)',
    mutating: true,
    requiresOrderId: true,
  },
  {
    id: 'deny-order',
    requirement: 'Order: Deny Order (uAPI)',
    mutating: true,
    requiresOrderId: true,
  },
  {
    id: 'cancel-order',
    requirement: 'Order: Cancel Order (uAPI)',
    mutating: true,
    requiresOrderId: true,
  },
  {
    id: 'order-ready',
    requirement: 'Order: Mark Order as Ready',
    mutating: true,
    requiresOrderId: true,
  },
  {
    id: 'resolve-fulfillment',
    requirement: 'Order: Resolve for Fulfillment Issues',
    mutating: true,
    requiresOrderId: true,
  },
];

const MAX_WEBHOOK_RECORDS = 50;

const MAX_SEEN_ORDERS = 50;

class CertificationService {
  private readonly webhookLog: WebhookRecord[] = [];
  // Registro de órdenes vistas, en orden de aparición (más reciente primero).
  private readonly seenOrders = new Map<string, SeenOrder>();

  /** Catálogo de verificaciones disponibles (sin ejecutar). */
  listChecks(): Omit<CertificationCheck, 'result' | 'skipped'>[] {
    return CHECKS;
  }

  /**
   * Registra un webhook recibido junto con el código de reconocimiento.
   * Es la evidencia de "webhooks acknowledged with a 200 from the Partner".
   */
  recordWebhook(eventType: string, orderId: string | undefined, ackStatus: number): void {
    const event = eventType || 'desconocido';
    this.webhookLog.unshift({
      receivedAt: new Date().toISOString(),
      eventType: event,
      orderId,
      ackStatus,
    });
    if (this.webhookLog.length > MAX_WEBHOOK_RECORDS) {
      this.webhookLog.length = MAX_WEBHOOK_RECORDS;
    }
    if (orderId) {
      this.recordOrderSeen(orderId, event);
    }
  }

  getWebhookLog(): WebhookRecord[] {
    return [...this.webhookLog];
  }

  /**
   * Registra que se vio una orden, aunque nunca llegue al POS.
   * Sin esto, las órdenes canceladas o denegadas desaparecen sin dejar rastro del UUID.
   */
  recordOrderSeen(orderId: string, eventType: string): void {
    const now = new Date().toISOString();
    const existing = this.seenOrders.get(orderId);

    if (existing) {
      existing.lastSeenAt = now;
      if (eventType && !existing.events.includes(eventType)) {
        existing.events.push(eventType);
      }
      return;
    }

    this.seenOrders.set(orderId, {
      orderId,
      firstSeenAt: now,
      lastSeenAt: now,
      events: eventType ? [eventType] : [],
    });

    // Podar las más antiguas (Map conserva el orden de inserción).
    while (this.seenOrders.size > MAX_SEEN_ORDERS) {
      const oldest = this.seenOrders.keys().next().value;
      if (oldest === undefined) break;
      this.seenOrders.delete(oldest);
    }
  }

  /** Anota qué hizo el middleware con la orden (creada, cancelada, ignorada...). */
  setOrderDisposition(orderId: string, disposition: string): void {
    const existing = this.seenOrders.get(orderId);
    if (existing) {
      existing.disposition = disposition;
      existing.lastSeenAt = new Date().toISOString();
      return;
    }
    this.recordOrderSeen(orderId, '');
    const created = this.seenOrders.get(orderId);
    if (created) created.disposition = disposition;
  }

  /** Órdenes vistas, de la más reciente a la más antigua. */
  getSeenOrders(): SeenOrder[] {
    return [...this.seenOrders.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  /**
   * Ejecuta únicamente las verificaciones seguras (consultas).
   * Las que modifican datos se dejan pendientes y se disparan de forma individual.
   */
  async runReadOnly(orderId?: string): Promise<CertificationCheck[]> {
    const results: CertificationCheck[] = [];

    for (const check of CHECKS) {
      if (check.mutating) {
        results.push({ ...check, skipped: 'Requiere ejecución manual (modifica datos)' });
        continue;
      }
      if (check.requiresOrderId && !orderId) {
        results.push({ ...check, skipped: 'Requiere un orderId de prueba' });
        continue;
      }
      results.push({ ...check, result: await this.runCheck(check.id, orderId) });
    }

    return results;
  }

  /** Ejecuta una verificación concreta. */
  async runCheck(id: CheckId, orderId?: string): Promise<UberCallResult> {
    logger.info(`[Certificación] Ejecutando verificación: ${id}`);

    switch (id) {
      case 'get-integration-details':
        return uberIntegrationService.getIntegrationDetails();

      case 'activate-integration':
        return uberIntegrationService.activateIntegration();

      case 'report-files':
        return uberReportingService.getReportFiles();

      case 'create-promotion':
        return uberPromotionsService.createPromotion();

      case 'get-order-details':
        return this.withOrderId(orderId, async (oid) => {
          try {
            const details = await uberOrderService.getOrderDetails(oid);
            return {
              ok: true,
              status: 200,
              method: 'get',
              path: `/v2/eats/order/${oid}`,
              data: { id: details.id, status: details.status, items: details.items.length },
            };
          } catch (error: any) {
            return {
              ok: false,
              status: 0,
              method: 'get',
              path: `/v2/eats/order/${oid}`,
              error: error.message,
            };
          }
        });

      case 'accept-order':
        return this.withOrderId(orderId, (oid) => uberOrderService.acceptOrder(oid));

      case 'deny-order':
        return this.withOrderId(orderId, (oid) => uberOrderService.denyOrder(oid));

      case 'cancel-order':
        return this.withOrderId(orderId, (oid) => uberOrderService.cancelOrder(oid));

      case 'order-ready':
        return this.withOrderId(orderId, (oid) => uberOrderService.markOrderReady(oid));

      case 'resolve-fulfillment':
        return this.withOrderId(orderId, (oid) =>
          uberOrderService.resolveFulfillmentIssue(oid, {
            reason: 'ITEM_OUT_OF_STOCK',
          })
        );

      default:
        return {
          ok: false,
          status: 0,
          method: '-',
          path: '-',
          error: `Verificación desconocida: ${id}`,
        };
    }
  }

  private async withOrderId(
    orderId: string | undefined,
    fn: (orderId: string) => Promise<UberCallResult>
  ): Promise<UberCallResult> {
    if (!orderId) {
      return {
        ok: false,
        status: 0,
        method: '-',
        path: '-',
        error: 'Falta el parámetro orderId',
      };
    }
    return fn(orderId);
  }

  /** Contexto mostrado en la evidencia: ambiente contra el que se ejecutan las pruebas. */
  getContext() {
    return {
      apiBaseUrl: config.uber.apiBaseUrl,
      storeId: config.uber.storeId,
      storeName: config.uber.storeName,
      scopes: config.uber.scopes,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const certificationService = new CertificationService();
