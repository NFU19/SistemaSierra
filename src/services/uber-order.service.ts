/**
 * Servicio para obtener detalles de órdenes desde Uber Eats
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { uberAuthService } from './uber-auth.service';
import { UberOrderDetails } from '../interfaces/uber.interface';

class UberOrderService {
  private axiosInstance: AxiosInstance;
  private baseUrl = 'https://api.uber.com';

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
      baseURL: this.baseUrl,
    });
  }

  /**
   * Obtiene los detalles completos de una orden de Uber
   * @param orderId ID de la orden en Uber
   * @returns Detalles de la orden
   */
  async getOrderDetails(orderId: string): Promise<UberOrderDetails> {
    try {
      logger.info(`Obteniendo detalles de orden de Uber: ${orderId}`);

      const accessToken = await uberAuthService.getAccessToken();

      const response = await this.axiosInstance.get<UberOrderDetails>(
        `/v2/orders/${orderId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );

      logger.debug('Detalles de orden obtenidos', {
        orderId,
        status: response.data.status,
        itemsCount: response.data.items.length,
      });

      return response.data;
    } catch (error: any) {
      logger.error(`Error al obtener detalles de orden ${orderId}`, error);

      if (error.response?.status === 401) {
        logger.warn('Token expirado, invalidando caché');
        uberAuthService.invalidateToken();
      }

      throw new Error(`No se pudieron obtener los detalles de la orden ${orderId}`);
    }
  }

  /**
   * Mapea un ID de producto de Uber a un código PLU de Sierra
   * Esta es una función placeholder que debe ser implementada según la lógica de negocio
   * @param uberItemId ID del ítem en Uber
   * @returns Código PLU en Sierra
   */
  mapUberItemToSierraPlu(uberItemId: string): string {
    // TODO: Implementar mapeo de catálogos entre Uber y Sierra
    // Por ahora, usamos el ID de Uber como PLU
    logger.debug(`Mapeando Uber item ${uberItemId} a PLU`);
    return uberItemId;
  }
}

export const uberOrderService = new UberOrderService();
