/**
 * Servicio para obtener detalles de órdenes desde Uber Eats
 * Usa la Eats Order API v2: GET /v2/eats/order/{order_id}
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { uberAuthService } from './uber-auth.service';
import { UberOrderDetails } from '../interfaces/uber.interface';

class UberOrderService {
  private readonly axiosInstance: AxiosInstance;
  private readonly baseUrl = 'https://test-api.uber.com';

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
      baseURL: this.baseUrl,
    });
  }

  /**
   * Obtiene los detalles completos de una orden de Uber
   * Endpoint: GET /v2/eats/order/{order_id}
   */
  async getOrderDetails(orderId: string): Promise<UberOrderDetails> {
    logger.info(`Obteniendo detalles de orden de Uber: ${orderId}`);

    const accessToken = await uberAuthService.getAccessToken();

    try {
      logger.debug(`Intentando endpoint: /v2/eats/order/${orderId}`);

      const response = await this.axiosInstance.get(
        `/v2/eats/order/${orderId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );

      // La API devuelve { order: {...} } — normalizamos al formato interno
      const raw = response.data?.order ?? response.data;
      const normalized = this.normalizeOrderResponse(raw, orderId);

      logger.debug(`Orden obtenida exitosamente`, {
        orderId,
        itemsCount: normalized.items.length,
        status: normalized.status,
      });

      return normalized;
    } catch (error: any) {
      const status = error.response?.status;

      logger.error(`Error al obtener orden ${orderId} (${status})`, {
        url: error.config?.url,
        errorData: error.response?.data,
      });

      if (status === 401) {
        uberAuthService.invalidateToken();
      }

      throw new Error(`No se pudieron obtener los detalles de la orden ${orderId}`);
    }
  }

  /**
   * Normaliza la respuesta de la Order Fulfillment API al formato UberOrderDetails
   * Soporta tanto la nueva estructura ({ order: {...}, carts: [...] })
   * como la estructura legacy ({ id, items, customer, totals }).
   */
  private normalizeOrderResponse(raw: any, orderId: string): UberOrderDetails {
    // Formato nuevo: customers[] y carts[]
    if (raw.customers || raw.carts) {
      const customer = raw.customers?.[0] ?? {};
      // Los items pueden estar en carts[].items o directo en items[]
      const items: any[] = raw.carts
        ? raw.carts.flatMap((cart: any) => cart.items ?? [])
        : raw.items ?? [];

      const mappedItems = items.map((item: any) => ({
        id: item.id ?? item.external_id ?? '',
        title: item.title ?? item.name ?? '',
        quantity: item.quantity ?? 1,
        unit_price: this.parseCentAmount(item.unit_price ?? item.price),
        price: this.parseCentAmount(item.price ?? item.unit_price),
        currency: item.currency ?? 'MXN',
        customizations: this.mapModifierGroups(item.selected_modifier_groups ?? item.customizations),
      }));

      const charges = raw.payment?.charges ?? {};
      const subTotalCents = charges.sub_total?.amount ?? charges.subtotal?.amount ?? 0;
      const taxCents = charges.tax?.amount ?? charges.taxes?.amount ?? 0;

      return {
        id: raw.id ?? orderId,
        store_id: raw.store?.id ?? '',
        order_number: raw.display_id ?? raw.id ?? orderId,
        timestamp: raw.created_time ? new Date(raw.created_time).getTime() : Date.now(),
        status: raw.state ?? raw.status ?? 'CREATED',
        items: mappedItems,
        customer: {
          id: customer.id ?? '',
          first_name: customer.first_name ?? 'Uber',
          last_name: customer.last_name ?? 'Eats',
          phone_number: customer.phone ?? customer.phone_number ?? '',
          email: customer.email ?? '',
        },
        totals: {
          subtotal: subTotalCents / 100,
          tax: taxCents / 100,
          delivery_fee: (charges.delivery_fee?.amount ?? 0) / 100,
          promotion: (charges.promotion?.amount ?? 0) / 100,
          total: (charges.total?.amount ?? 0) / 100,
          currency: 'MXN',
        },
        special_instructions: raw.store_instructions ?? raw.special_instructions ?? null,
      };
    }

    // Formato legacy ya compatible (items[] + customer + totals)
    return raw as UberOrderDetails;
  }

  /** Convierte centavos → pesos (Uber devuelve montos en enteros × 10^2) */
  private parseCentAmount(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'object' && value.amount !== undefined) {
      return value.amount / 100;
    }
    if (typeof value === 'number') {
      // Heurística: si el valor parece estar en centavos (> 500), dividir
      return value > 500 ? value / 100 : value;
    }
    return Number(value) || 0;
  }

  /** Convierte selected_modifier_groups al formato customizations[] */
  private mapModifierGroups(groups: any[]): any[] | undefined {
    if (!groups?.length) return undefined;
    return groups.map((g: any) => ({
      id: g.id ?? '',
      title: g.title ?? g.name ?? '',
      selections: (g.selected_items ?? g.selections ?? []).map((s: any) => ({
        id: s.id ?? '',
        title: s.title ?? s.name ?? '',
        price: this.parseCentAmount(s.price),
      })),
    }));
  }

  /**
   * Acepta una orden en Uber — obligatorio dentro de 11.5 min o se auto-cancela.
   * Endpoint POS Marketplace: POST /v1/eats/orders/{order_id}/accept_pos_order
   */
  async acceptOrder(orderId: string): Promise<void> {
    logger.info(`Aceptando orden Uber: ${orderId}`);
    const accessToken = await uberAuthService.getAccessToken();
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    try {
      await this.axiosInstance.post(
        `/v1/eats/orders/${orderId}/accept_pos_order`,
        {},
        { headers }
      );
      logger.info(`Orden ${orderId} aceptada en Uber`);
    } catch (error: any) {
      logger.error(`Error al aceptar orden ${orderId} en Uber`, {
        status: error.response?.status,
        data: error.response?.data,
      });
      // No lanzamos — Sierra ya creó la orden, no queremos revertir por esto
    }
  }

  /**
   * Rechaza una orden en Uber.
   * Endpoint POS Marketplace: POST /v1/eats/orders/{order_id}/deny_pos_order
   * Sin uso actual — disponible para flujos de rechazo futuros.
   */
  async denyOrder(orderId: string, reason: string = 'ITEM_UNAVAILABLE'): Promise<void> {
    logger.info(`Rechazando orden Uber: ${orderId}`);
    const accessToken = await uberAuthService.getAccessToken();

    try {
      await this.axiosInstance.post(
        `/v1/eats/orders/${orderId}/deny_pos_order`,
        { reason },
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
      logger.info(`Orden ${orderId} rechazada en Uber`);
    } catch (error: any) {
      logger.error(`Error al rechazar orden ${orderId} en Uber`, {
        status: error.response?.status,
        data: error.response?.data,
      });
    }
  }
}

export const uberOrderService = new UberOrderService();
