/**
 * Servicio de Promociones de Uber Eats.
 *
 * Este módulo NO forma parte del flujo operativo con Sierra POS: existe porque Uber
 * exige ejercitar el endpoint de creación de promociones para certificar el pase a
 * producción. Se implementa al mínimo necesario para obtener una respuesta válida.
 *
 * Ruta configurable con UBER_PATH_CREATE_PROMOTION — SIN VERIFICAR contra la
 * documentación pública (la referencia de la suite de Promotions carga por JavaScript).
 * Confirmar el path con el soporte de Uber y ajustar por variable de entorno.
 */

import { config } from '../config/config';
import { logger } from '../utils/logger';
import { buildUberPath, uberCall } from './uber-api.client';
import { UberCallResult } from '../interfaces/uber.interface';

export interface CreatePromotionInput {
  title?: string;
  /** Porcentaje de descuento (1-100). */
  discountPercentage?: number;
  /** ISO 8601 */
  startsAt?: string;
  /** ISO 8601 */
  endsAt?: string;
}

class UberPromotionsService {
  /** Crea una promoción en la tienda configurada. */
  async createPromotion(
    input: CreatePromotionInput = {},
    storeId: string = config.uber.storeId
  ): Promise<UberCallResult> {
    const path = buildUberPath(config.uber.paths.createPromotion, { storeId });

    if (!storeId) {
      return { ok: false, status: 0, method: 'post', path, error: 'UBER_STORE_ID no configurado' };
    }

    const now = new Date();
    const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const body = {
      title: input.title ?? 'Promoción de prueba - certificación',
      store_ids: [storeId],
      discount: {
        type: 'PERCENTAGE_OFF',
        value: input.discountPercentage ?? 10,
      },
      start_time: input.startsAt ?? now.toISOString(),
      end_time: input.endsAt ?? inAWeek.toISOString(),
    };

    logger.info(`Creando promoción de prueba en la tienda ${storeId}...`);
    return uberCall('post', path, body);
  }
}

export const uberPromotionsService = new UberPromotionsService();
