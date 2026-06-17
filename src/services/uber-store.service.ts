/**
 * Servicio de Estado de Tienda en Uber Eats
 * Permite poner la tienda ONLINE (acepta pedidos) o PAUSED (no disponible).
 *
 * Mantener la tienda ONLINE es clave para que no se "desactive" sola: si la
 * integración no marca la tienda como disponible, Uber deja de enrutar pedidos.
 *
 * Endpoint (OJO: "store" en SINGULAR, verificado contra test-api):
 *   POST /v1/eats/store/{store_id}/status   (scope eats.store.status.write)
 *   GET  /v1/eats/store/{store_id}/status
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { uberAuthService } from './uber-auth.service';

export type UberStoreStatus = 'ONLINE' | 'PAUSED';

interface SetStatusOptions {
  reason?: string;
  /** ISO 8601, ej. "2026-06-18T03:00:00Z". Solo aplica a PAUSED. */
  pausedUntil?: string;
}

class UberStoreService {
  private readonly axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
      baseURL: config.uber.apiBaseUrl,
    });
  }

  /**
   * Actualiza el estado de la tienda en Uber.
   * @returns true si Uber aceptó el cambio
   */
  async setStoreStatus(status: UberStoreStatus, opts: SetStatusOptions = {}): Promise<boolean> {
    const storeId = config.uber.storeId;
    if (!storeId) {
      logger.warn('No se puede actualizar estado de tienda: UBER_STORE_ID no está configurado');
      return false;
    }

    const accessToken = await uberAuthService.getAccessToken();
    const body: Record<string, unknown> = { status };
    if (opts.reason) body.reason = opts.reason;
    if (opts.pausedUntil) body.paused_until = opts.pausedUntil;

    try {
      await this.axiosInstance.post(`/v1/eats/store/${storeId}/status`, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      logger.info(`Estado de tienda Uber actualizado a ${status}`, { storeId });
      return true;
    } catch (error: any) {
      const httpStatus = error.response?.status;
      logger.error(`Error al actualizar estado de tienda a ${status}`, {
        storeId,
        httpStatus,
        data: error.response?.data,
      });
      // 403/404 típicamente significa que la tienda aún no está provisionada contra la app
      if (httpStatus === 401) {
        uberAuthService.invalidateToken();
      }
      throw error;
    }
  }

  /** Pone la tienda en línea (disponible para recibir pedidos). */
  setOnline(): Promise<boolean> {
    return this.setStoreStatus('ONLINE');
  }

  /** Pausa la tienda (no disponible). Útil cuando la cocina está saturada. */
  setOffline(reason = 'Pausada manualmente desde el POS', pausedUntil?: string): Promise<boolean> {
    return this.setStoreStatus('PAUSED', { reason, pausedUntil });
  }

  /** Consulta el estado actual de la tienda en Uber. */
  async getStoreStatus(): Promise<any> {
    const storeId = config.uber.storeId;
    if (!storeId) {
      throw new Error('UBER_STORE_ID no está configurado');
    }

    const accessToken = await uberAuthService.getAccessToken();
    const response = await this.axiosInstance.get(`/v1/eats/store/${storeId}/status`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    return response.data;
  }
}

export const uberStoreService = new UberStoreService();
