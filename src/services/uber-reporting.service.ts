/**
 * Servicio de Reportes de Uber Eats.
 *
 * Igual que Promotions, este módulo NO forma parte del flujo operativo con Sierra POS:
 * existe porque Uber exige ejercitar el endpoint de reportes para certificar el pase a
 * producción.
 *
 * Ruta configurable con UBER_PATH_REPORT_FILES — SIN VERIFICAR contra la documentación
 * pública (la referencia de la suite de Reporting carga por JavaScript).
 * Confirmar el path con el soporte de Uber y ajustar por variable de entorno.
 */

import { config } from '../config/config';
import { logger } from '../utils/logger';
import { uberCall } from './uber-api.client';
import { UberCallResult } from '../interfaces/uber.interface';

export interface GetReportFilesInput {
  /** ISO 8601 (por defecto: hace 7 días). */
  startDate?: string;
  /** ISO 8601 (por defecto: hoy). */
  endDate?: string;
  reportType?: string;
}

class UberReportingService {
  /** Consulta los archivos de reporte disponibles para la tienda configurada. */
  async getReportFiles(input: GetReportFilesInput = {}): Promise<UberCallResult> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      start_date: input.startDate ?? weekAgo.toISOString().slice(0, 10),
      end_date: input.endDate ?? now.toISOString().slice(0, 10),
    });
    if (config.uber.storeId) {
      params.set('store_id', config.uber.storeId);
    }
    if (input.reportType) {
      params.set('report_type', input.reportType);
    }

    const path = `${config.uber.paths.reportFiles}?${params.toString()}`;
    logger.info('Consultando archivos de reporte en Uber...');
    return uberCall('get', path);
  }
}

export const uberReportingService = new UberReportingService();
