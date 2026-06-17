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

      // Logging detallado: distingue error HTTP (status/data) de error de red o de parseo (code/message)
      logger.error(`Error al obtener orden ${orderId} (status=${status ?? 'sin-respuesta-HTTP'})`, {
        url: error.config?.url,
        code: error.code,
        message: error.message,
        errorData: error.response?.data,
      });

      if (status === 401) {
        uberAuthService.invalidateToken();
      }

      throw new Error(
        `No se pudieron obtener los detalles de la orden ${orderId}: ${error.message}`
      );
    }
  }

  /**
   * Normaliza la respuesta de la Eats Order API v2 al formato UberOrderDetails.
   *
   * Formato real verificado contra test-api (GET /v2/eats/order/{id}):
   *   { id, display_id, current_state, store:{id,name}, eater:{first_name,last_name,phone},
   *     cart:{ items:[{ id, title, external_data:"plu:XXXX", quantity,
   *                      price:{ unit_price:{amount}, total_price:{amount} } }] },
   *     payment:{ charges:{ sub_total:{amount}, total:{amount}, tax?, delivery_fee? } },
   *     placed_at }
   *
   * También soporta variantes: carts[] (plural), customers[], items[] sueltos, y el
   * formato legacy (/v1) con order_items[] + price string en centavos.
   */
  private normalizeOrderResponse(raw: any, orderId: string): UberOrderDetails {
    // Items: cart.items (singular) | carts[].items (plural) | order_items (v1) | items (legacy)
    const items: any[] =
      raw.cart?.items ??
      (raw.carts ? raw.carts.flatMap((c: any) => c.items ?? []) : null) ??
      raw.order_items ??
      raw.items ??
      [];

    const hasStructured =
      raw.cart || raw.carts || raw.eater || raw.customers || raw.order_items || raw.payment;

    // Si no reconocemos la estructura, devolvemos tal cual (último recurso)
    if (!hasStructured) {
      return raw as UberOrderDetails;
    }

    const eater = raw.eater ?? raw.customers?.[0] ?? raw.eater_info ?? {};

    const mappedItems = items.map((item: any) => {
      const quantity = item.quantity ?? 1;
      const unitPrice = this.extractAmount(item.price?.unit_price ?? item.unit_price ?? item.price);
      const totalPrice = this.extractAmount(item.price?.total_price ?? item.total_price);
      return {
        id: String(item.id ?? this.pluFromExternal(item.external_data) ?? item.item_id ?? ''),
        title: item.title ?? item.name ?? '',
        quantity,
        unit_price: unitPrice,
        price: totalPrice || unitPrice * quantity,
        currency:
          item.price?.unit_price?.currency_code ?? item.currency ?? raw.currency_code ?? 'MXN',
        customizations: this.mapModifierGroups(
          item.selected_modifier_groups ?? item.selected_options ?? item.customizations
        ),
      };
    });

    // Cargos: en v2 es un objeto { sub_total:{amount}, total:{amount}, ... };
    // en v1 es un array [{ charge_type, price }]. Normalizamos ambos.
    const charges = this.normalizeCharges(raw.payment?.charges ?? raw.charges);

    return {
      id: raw.id ?? orderId,
      store_id: raw.store?.id ?? raw.store_id ?? '',
      order_number: raw.display_id ?? raw.order_num ?? raw.id ?? orderId,
      timestamp: this.resolveTimestamp(raw),
      status: raw.current_state ?? raw.state ?? raw.status ?? 'CREATED',
      items: mappedItems,
      customer: {
        id: eater.id ?? '',
        first_name: eater.first_name ?? 'Uber',
        last_name: eater.last_name ?? 'Eats',
        phone_number: eater.phone ?? eater.phone_number ?? '',
        email: eater.email ?? '',
      },
      totals: {
        subtotal: charges.subtotal,
        tax: charges.tax,
        delivery_fee: charges.delivery_fee,
        promotion: charges.promotion,
        total: charges.total || charges.subtotal,
        currency: 'MXN',
      },
      special_instructions: raw.store_instructions ?? raw.special_instructions ?? null,
    };
  }

  /** Normaliza los cargos tanto del formato v2 (objeto) como v1 (array). Devuelve pesos. */
  private normalizeCharges(charges: any): {
    subtotal: number;
    tax: number;
    delivery_fee: number;
    promotion: number;
    total: number;
  } {
    const result = { subtotal: 0, tax: 0, delivery_fee: 0, promotion: 0, total: 0 };
    if (!charges) return result;

    // Formato v1: array de { charge_type, price }
    if (Array.isArray(charges)) {
      for (const c of charges) {
        const amount = this.extractAmount(c.price);
        switch (c.charge_type) {
          case 'subtotal': result.subtotal = amount; break;
          case 'tax': result.tax = amount; break;
          case 'delivery_fee': result.delivery_fee = amount; break;
          case 'promotion': result.promotion = amount; break;
          case 'total': result.total = amount; break;
        }
      }
      return result;
    }

    // Formato v2: objeto con sub_total/total/tax/delivery_fee
    result.subtotal = this.extractAmount(charges.sub_total ?? charges.subtotal);
    result.tax = this.extractAmount(charges.tax ?? charges.taxes);
    result.delivery_fee = this.extractAmount(charges.delivery_fee);
    result.promotion = this.extractAmount(charges.promotion);
    result.total = this.extractAmount(charges.total);
    return result;
  }

  /** Resuelve el timestamp del pedido desde placed_at (ISO) o created_time (epoch ms) */
  private resolveTimestamp(raw: any): number {
    if (raw.placed_at) return new Date(raw.placed_at).getTime();
    if (raw.created_time) return Number(raw.created_time);
    return Date.now();
  }

  /** Extrae el código PLU de un external_data tipo "plu:11105" → "11105" */
  private pluFromExternal(ext: any): string | null {
    if (typeof ext === 'string' && ext.toLowerCase().startsWith('plu:')) {
      return ext.slice(4);
    }
    return null;
  }

  /**
   * Convierte un monto de Uber a pesos.
   * Acepta: objeto { amount: 4900 } (centavos), número, o string "4900" (centavos).
   */
  private extractAmount(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'object' && value.amount !== undefined) {
      return value.amount / 100;
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return 0;
    // Montos enteros de Uber vienen en centavos; heurística para no romper datos legacy ya en pesos
    return num > 500 ? num / 100 : num;
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
        price: this.extractAmount(s.price),
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
