/**
 * Servicio de Mapeo: Translada órdenes de Uber Eats al formato de Sistemas Sierra
 */

import { OrderTicket, PluOrder, ClientOrder } from '../interfaces/sierra.interface';
import { UberOrderDetails } from '../interfaces/uber.interface';
import { logger } from '../utils/logger';

class OrderMapperService {
  /**
   * Mapea una orden de Uber al formato OrderTicket de Sierra
   * @param uberOrder Orden obtenida desde Uber Eats
   * @returns Orden formateada para Sierra
   */
  mapUberOrderToSierraTicket(uberOrder: UberOrderDetails): OrderTicket {
    logger.info(`Mapeando orden de Uber ${uberOrder.id} a formato Sierra`);

    try {
      // Mapear items
      const mappedPlus = this.mapUberItemsToSierraPlus(uberOrder.items);

      // Calcular totales
      const subTotal = mappedPlus.reduce((acc, item) => acc + item.subTotal, 0);
      const tax = uberOrder.totals.tax;

      const client: ClientOrder[] = [{
        nombre: `${uberOrder.customer.first_name} ${uberOrder.customer.last_name}`.trim() || 'Uber Eats',
        telefono: uberOrder.customer.phone_number || '0000000000',
      }];

      const orderTicket: OrderTicket = {
        order: uberOrder.id, // Usar el order_id de Uber como identificador único
        subTotal: Math.round(subTotal * 100) / 100, // Redondear a 2 decimales
        tax: Math.round(tax * 100) / 100,
        orderType: 'ORDEN WEB ONLINE',
        plus: mappedPlus,
        client,
        observation: this.buildObservation(uberOrder),
        salesType: 'DELIVERY',
        employeeNumber: 0, // El sistema asignará un empleado automático
      };

      logger.debug('Orden mapeada exitosamente', {
        orderId: orderTicket.order,
        itemsCount: orderTicket.plus.length,
        total: subTotal + tax,
      });

      return orderTicket;
    } catch (error) {
      logger.error(`Error al mapear orden ${uberOrder.id}`, error);
      throw new Error('No se pudo mapear la orden de Uber');
    }
  }

  /**
   * Mapea los items de Uber a PLUs de Sierra
   * @param uberItems Items de la orden en Uber
   * @returns Array de PLUs para Sierra
   */
  private mapUberItemsToSierraPlus(
    uberItems: any[]
  ): PluOrder[] {
    return uberItems.map((item) => {
      const unitPrice = item.unit_price;
      const quantity = item.quantity;
      const subTotal = unitPrice * quantity;

      return {
        plu: this.mapUberItemIdToPlus(item.id, item.title),
        quantity,
        unitPrice: Math.round(unitPrice * 100) / 100,
        subTotal: Math.round(subTotal * 100) / 100,
        tax: 0, // Tax se calcula a nivel de orden en Sierra
        customizations: this.buildCustomizationString(item.customizations),
      };
    });
  }

  /**
   * Mapea un ID de item de Uber a un código PLU de Sierra
   * @param uberItemId ID del item en Uber
   * @param itemTitle Título del item (para fallback)
   * @returns Código PLU
   */
  private mapUberItemIdToPlus(uberItemId: string, itemTitle: string): string {
    // TODO: Implementar tabla de mapeo entre catálogos
    // Por ahora, usamos una estrategia simple: prefijo + ID de Uber
    logger.debug(`Mapeando Uber item ${uberItemId} (${itemTitle}) a PLU`);

    // Ejemplo: si Uber item es "12345", PLU sería "UE12345"
    // Esto debe reemplazarse con un mapeo real de base de datos
    return `${uberItemId}`;
  }

  /**
   * Construye el string de observaciones/customizaciones para Sierra
   * @param customizations Array de customizaciones
   * @returns String de observaciones
   */
  private buildCustomizationString(
    customizations?: any[]
  ): string | undefined {
    if (!customizations || customizations.length === 0) {
      return undefined;
    }

    const customizationTexts = customizations.map((custom) => {
      const selections = custom.selections
        .map((sel: any) => sel.title)
        .join(', ');
      return `${custom.title}: ${selections}`;
    });

    return customizationTexts.join('; ');
  }

  /**
   * Construye el campo de observaciones de la orden
   * @param uberOrder Orden de Uber
   * @returns String de observaciones
   */
  private buildObservation(uberOrder: UberOrderDetails): string {
    const observations: string[] = [];

    if (uberOrder.special_instructions) {
      observations.push(`Instrucciones especiales: ${uberOrder.special_instructions}`);
    }

    observations.push(
      `Cliente: ${uberOrder.customer.first_name} ${uberOrder.customer.last_name}`
    );
    observations.push(`Teléfono: ${uberOrder.customer.phone_number}`);

    return observations.join(' | ');
  }
}

export const orderMapperService = new OrderMapperService();
