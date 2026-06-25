/**
 * Servicio de Integración con Sistemas Sierra POS
 * Maneja la comunicación con la API de Sierra
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { OrderTicket, SierraOrderResponse } from '../interfaces/sierra.interface';

class SierraIntegrationService {
  private readonly axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.sierra.apiUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.sierra.apiKey,
      },
    });

    // Agregar interceptor para logging
    this.axiosInstance.interceptors.request.use(
      (request) => {
        logger.debug(`[Sierra API] ${request.method?.toUpperCase()} ${request.url}`);
        return request;
      },
      (error) => {
        logger.error('[Sierra API] Error en request', error);
        return Promise.reject(error);
      }
    );

    this.axiosInstance.interceptors.response.use(
      (response) => {
        logger.debug(`[Sierra API] Response ${response.status}`, {
          url: response.config.url,
          dataSize: JSON.stringify(response.data).length,
        });
        return response;
      },
      (error) => {
        logger.error('[Sierra API] Error en response', {
          status: error.response?.status,
          url: error.config?.url,
          data: error.response?.data,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Crea una nueva orden en Sistemas Sierra
   * @param orderTicket Orden formateada para Sierra
   * @returns Respuesta del servidor
   */
  async createOrder(orderTicket: OrderTicket): Promise<SierraOrderResponse> {
    try {
      logger.info(`Creando orden en Sierra: ${orderTicket.order}`);

      // La API de Sierra responde con el objeto OrderResponse directamente en el cuerpo.
      const response = await this.axiosInstance.post<SierraOrderResponse>(
        '/api/v1/orders',
        orderTicket
      );

      if (!response.data || response.status !== 200) {
        logger.error('Respuesta inesperada de Sierra', response.data);
        throw new Error('Respuesta inválida de Sierra POS');
      }

      const sierraResponse = response.data;

      logger.info('Orden creada exitosamente en Sierra', {
        order: sierraResponse.order ?? orderTicket.order,
        folio: sierraResponse.folio,
        con: sierraResponse.con,
        msg: sierraResponse.msg,
      });

      return sierraResponse;
    } catch (error) {
      logger.error(`Error al crear orden en Sierra: ${orderTicket.order}`, error);
      this.handleSierraError(error);
      throw error;
    }
  }

  /**
   * Obtiene el estado de una orden en Sierra.
   * @param orderId ID de la orden
   * @returns Datos de la orden
   * Sin uso actual — disponible para consultas de estado futuras.
   */
  async getOrderStatus(orderId: string): Promise<any> {
    try {
      logger.debug(`Obteniendo estado de orden en Sierra: ${orderId}`);

      const response = await this.axiosInstance.get(`/api/v1/orders/${orderId}`);

      return response.data;
    } catch (error) {
      logger.error(`Error al obtener estado de orden ${orderId}`, error);
      throw error;
    }
  }

  /**
   * Maneja los errores específicos de Sierra
   * @param error Error del request
   */
  private handleSierraError(error: any): void {
    const status = error.response?.status;
    const data = error.response?.data;

    switch (status) {
      case 400:
        logger.error('Error de validación en Sierra', data);
        break;
      case 401:
      case 403:
        logger.error('Error de autenticación/autorización en Sierra', {
          message: 'Verifica que SIERRA_API_KEY sea válido',
        });
        break;
      case 404:
        logger.error('Endpoint no encontrado en Sierra', {
          url: error.config?.url,
        });
        break;
      case 500:
        logger.error('Error interno del servidor Sierra', data);
        break;
      default:
        logger.error('Error desconocido en Sierra', error.message);
    }
  }

  /**
   * Verifica la conectividad con la API de Sierra
   * @returns true si la API es accesible
   */
  async healthCheck(): Promise<boolean> {
    try {
      logger.debug('Realizando health check a Sierra API');

      const response = await this.axiosInstance.get('/api/v1/maintenance/version');

      logger.info('Health check exitoso', {
        version: response.data?.version || 'unknown',
      });

      return true;
    } catch (error) {
      logger.error('Health check fallido', error);
      return false;
    }
  }
}

export const sierraIntegrationService = new SierraIntegrationService();
