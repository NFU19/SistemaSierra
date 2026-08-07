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

class CertificationService {
  private readonly webhookLog: WebhookRecord[] = [];

  /** Catálogo de verificaciones disponibles (sin ejecutar). */
  listChecks(): Omit<CertificationCheck, 'result' | 'skipped'>[] {
    return CHECKS;
  }

  /**
   * Registra un webhook recibido junto con el código de reconocimiento.
   * Es la evidencia de "webhooks acknowledged with a 200 from the Partner".
   */
  recordWebhook(eventType: string, orderId: string | undefined, ackStatus: number): void {
    this.webhookLog.unshift({
      receivedAt: new Date().toISOString(),
      eventType: eventType || 'desconocido',
      orderId,
      ackStatus,
    });
    if (this.webhookLog.length > MAX_WEBHOOK_RECORDS) {
      this.webhookLog.length = MAX_WEBHOOK_RECORDS;
    }
  }

  getWebhookLog(): WebhookRecord[] {
    return [...this.webhookLog];
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
