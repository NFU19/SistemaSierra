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

    // Diagnóstico: ver EXACTAMENTE qué precio manda Uber por producto y por modificador,
    // para decidir cómo desglosar los modificadores sin duplicar el cobro.
    logger.info(
      '[Diagnóstico precios Uber] ' +
        JSON.stringify(
          (uberOrder.items ?? []).map((i: any) => ({
            title: i.title,
            unit_price: i.unit_price,
            price: i.price,
            mods: (i.customizations ?? []).flatMap((c: any) =>
              (c.selections ?? []).map((s: any) => ({ title: s.title, price: s.price }))
            ),
          }))
        )
    );

    try {
      // Productos (PLUs) con sus modificadores (subPlus)
      const mappedPlus = this.mapUberItemsToSierraPlus(uberOrder.items);

      // Subtotal real de la orden (suma de productos + modificadores).
      const subTotal = money(
        mappedPlus.reduce(
          (acc, item) =>
            acc + item.subTotal + (item.subPlus ?? []).reduce((s, sp) => s + (sp.subTotal ?? 0), 0),
          0
        )
      );

      // Formato OrderSierra (ORDEN WEB ONLINE): es el que usan las órdenes web normales.
      // El pago se indica con paymentIdentifierString + paymentTransactionId; payments[] va
      // vacío. Se deja que Sierra aplique su configuración por orderType.
      const orderTicket: OrderTicket = {
        order: uberOrder.order_number || uberOrder.id,
        subTotal,
        // El pago de Uber ya se cobró en línea → se marca saldada.
        credits: subTotal,
        paymentTransactionId: uberOrder.id,
        paymentIdentifierString: config.sierra.order.paymentLabel,
        tableNumber: null,
        orderComments: uberOrder.special_instructions || null,
        client: this.mapClient(uberOrder),
        plus: mappedPlus,
        // El pago se refleja en paymentIdentifierString; payments[] queda vacío salvo que se
        // habilite explícitamente (con el PLU de forma de pago correcto, 91101).
        payments: config.sierra.order.registerPayment
          ? [
              {
                plu: config.sierra.order.paymentPlu,
                description: config.sierra.order.paymentLabel,
                unitPrice: subTotal,
              },
            ]
          : [],
        openStatus: config.sierra.order.openStatus,
        server: config.sierra.order.server || null,
        orderType: config.sierra.order.type,
        routeProducts: config.sierra.order.routeProducts,
      };

      logger.debug('Orden mapeada exitosamente', {
        order: orderTicket.order,
        itemsCount: orderTicket.plus.length,
        subTotal,
        orderType: orderTicket.orderType,
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
    const phone = customer?.phone_number || null;

    return [
      {
        clientId: customer?.id || null,
        name,
        address: null,
        city: null,
        zipCode: null,
        email: customer?.email || null,
        telephone: phone,
        mobilPhone: phone,
        memo1: null,
        memo2: null,
        memo3: null,
        memo4: null,
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
        quantity,
        unitPrice,
        subTotal,
        comments: item.special_instructions || '',
        subPlus: this.mapCustomizationsToSubPlus(item.customizations),
        description: item.title || '',
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
          comments: '',
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
}

export const orderMapperService = new OrderMapperService();
