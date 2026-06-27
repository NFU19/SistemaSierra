/**
 * Servicio de Mapeo: Translada órdenes de Uber Eats al formato de Sistemas Sierra
 * El OrderTicket resultante se ajusta al esquema documentado en la Web Api de Sierra
 * (cuerpo de POST /api/v1/orders).
 */

import { OrderTicket, PluOrder, ClientOrder, SubPlus } from '../interfaces/sierra.interface';
import { UberOrderDetails, UberCustomization } from '../interfaces/uber.interface';
import { config } from '../config/config';
import { logger } from '../utils/logger';

/** Redondea a 2 decimales (evita arrastre de flotantes en importes). */
const money = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

class OrderMapperService {
  /**
   * Mapea una orden de Uber al formato OrderTicket de Sierra
   * @param uberOrder Orden obtenida desde Uber Eats
   * @returns Orden formateada para Sierra
   */
  mapUberOrderToSierraTicket(uberOrder: UberOrderDetails): OrderTicket {
    logger.info(`Mapeando orden de Uber ${uberOrder.id} a formato Sierra`);

    try {
      // Productos (PLUs) con sus modificadores (subPlus)
      const mappedPlus = this.mapUberItemsToSierraPlus(uberOrder.items);

      // Totales: subtotal real de la orden (suma de productos + modificadores) e IVA
      const subTotal = money(
        mappedPlus.reduce(
          (acc, item) =>
            acc + item.subTotal + (item.subPlus ?? []).reduce((s, sp) => s + (sp.subTotal ?? 0), 0),
          0
        )
      );
      const tax = money(uberOrder.totals?.tax ?? 0);

      // Orden de Uber: el pago ya se cobró en línea → se marca como pagada (credits)
      // para que la cuenta quede saldada en el PDV.
      const credits = money(subTotal + tax);

      const orderTicket: OrderTicket = {
        order: uberOrder.order_number || uberOrder.id,
        subTotal,
        tax,
        credits,
        change: 0,
        orderType: config.sierra.order.type,
        salesType: config.sierra.order.salesType,
        openStatus: config.sierra.order.openStatus,
        production: config.sierra.order.production,
        routeProducts: config.sierra.order.routeProducts,
        server: config.sierra.order.server || undefined,
        cashier: config.sierra.order.cashier || undefined,
        paymentTransactionId: uberOrder.id,
        paymentIdentifierString: config.sierra.order.paymentLabel,
        orderName: this.buildOrderName(uberOrder),
        orderComments: this.buildOrderComments(uberOrder),
        client: this.mapClient(uberOrder),
        plus: mappedPlus,
        // Pago de la orden: PLU y descripción fijos (config), importe = total de la cuenta.
        // Se omite si SIERRA_ORDER_REGISTER_PAYMENT=false (p.ej. si el PLU de pago no existe aún).
        payments: config.sierra.order.registerPayment
          ? [
              {
                plu: config.sierra.order.paymentPlu,
                description: config.sierra.order.paymentLabel,
                unitPrice: credits,
              },
            ]
          : [],
      };

      logger.debug('Orden mapeada exitosamente', {
        order: orderTicket.order,
        itemsCount: orderTicket.plus.length,
        subTotal,
        tax,
        total: credits,
      });

      return orderTicket;
    } catch (error) {
      logger.error(`Error al mapear orden ${uberOrder.id}`, error);
      throw new Error('No se pudo mapear la orden de Uber');
    }
  }

  /**
   * Mapea los datos del cliente de Uber al schema ClientOrder de Sierra.
   */
  private mapClient(uberOrder: UberOrderDetails): ClientOrder[] {
    const customer = uberOrder.customer;
    const name =
      `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim() || 'Uber Eats';
    const phone = customer?.phone_number || undefined;

    return [
      {
        clientId: customer?.id || undefined,
        name,
        telephone: phone,
        mobilPhone: phone,
        email: customer?.email || undefined,
      },
    ];
  }

  /**
   * Mapea los items de Uber a PLUs de Sierra (con sus modificadores como subPlus).
   * @param uberItems Items de la orden en Uber
   * @returns Array de PLUs para Sierra
   */
  private mapUberItemsToSierraPlus(uberItems: any[]): PluOrder[] {
    return (uberItems ?? []).map((item) => {
      const unitPrice = money(item.unit_price);
      const quantity = Number(item.quantity) || 1;
      const subTotal = money(unitPrice * quantity);

      return {
        plu: this.mapUberItemIdToPlus(item.id, item.title),
        description: item.title || undefined,
        quantity,
        unitPrice,
        subTotal,
        tax: 0, // El IVA se maneja a nivel de orden en Sierra
        comments: item.special_instructions || undefined,
        subPlus: this.mapCustomizationsToSubPlus(item.customizations),
      };
    });
  }

  /**
   * Convierte las customizaciones de un item de Uber en modificadores (subPlus) de Sierra.
   * Cada selección se convierte en un subPlus con su descripción y precio.
   * @param customizations Customizaciones del item
   * @returns Array de subPlus (vacío si no hay customizaciones)
   */
  private mapCustomizationsToSubPlus(customizations?: UberCustomization[]): SubPlus[] {
    if (!customizations || customizations.length === 0) {
      return [];
    }

    const subPlus: SubPlus[] = [];
    for (const custom of customizations) {
      for (const selection of custom.selections ?? []) {
        const price = money(selection.price);
        subPlus.push({
          plu: selection.id || undefined,
          description: custom.title ? `${custom.title}: ${selection.title}` : selection.title,
          quantity: 1,
          unitPrice: price,
          subTotal: price,
          tax: 0,
        });
      }
    }
    return subPlus;
  }

  /**
   * Mapea un ID de item de Uber a un código PLU de Sierra
   * @param uberItemId ID del item en Uber
   * @param itemTitle Título del item (para fallback)
   * @returns Código PLU
   */
  private mapUberItemIdToPlus(uberItemId: string, itemTitle: string): string {
    // Mapeo directo por ID: el ID de Uber se usa como PLU en Sierra.
    // Implementar tabla de equivalencias real cuando se disponga del catalogo final.
    logger.debug(`Mapeando Uber item ${uberItemId} (${itemTitle}) a PLU`);
    return `${uberItemId}`;
  }

  /**
   * Nombre legible de la orden para identificarla en el PDV.
   */
  private buildOrderName(uberOrder: UberOrderDetails): string {
    const number = uberOrder.order_number || uberOrder.id.slice(0, 8);
    const customer = `${uberOrder.customer?.first_name ?? ''} ${
      uberOrder.customer?.last_name ?? ''
    }`.trim();
    return customer ? `Uber #${number} - ${customer}` : `Uber #${number}`;
  }

  /**
   * Construye el campo de comentarios de la orden (orderComments de Sierra).
   * @param uberOrder Orden de Uber
   * @returns String de comentarios
   */
  private buildOrderComments(uberOrder: UberOrderDetails): string {
    const parts: string[] = [];

    if (uberOrder.special_instructions) {
      parts.push(`Instrucciones: ${uberOrder.special_instructions}`);
    }

    const customer = `${uberOrder.customer?.first_name ?? ''} ${
      uberOrder.customer?.last_name ?? ''
    }`.trim();
    if (customer) parts.push(`Cliente: ${customer}`);
    if (uberOrder.customer?.phone_number) {
      parts.push(`Tel: ${uberOrder.customer.phone_number}`);
    }

    return parts.join(' | ');
  }
}

export const orderMapperService = new OrderMapperService();
