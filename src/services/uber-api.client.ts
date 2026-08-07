/**
 * Cliente HTTP compartido para la API de Uber Eats.
 *
 * Centraliza la autenticación y, sobre todo, CONSERVA EL CÓDIGO HTTP incluso cuando la
 * llamada falla: la certificación de producción exige mostrar evidencia del status que
 * devuelve cada endpoint, así que nunca se lanza excepción — se devuelve el resultado.
 */

import axios from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { uberAuthService } from './uber-auth.service';
import { UberCallResult } from '../interfaces/uber.interface';

const client = axios.create({
  timeout: 10000,
  baseURL: config.uber.apiBaseUrl,
});

export type UberHttpMethod = 'get' | 'post' | 'patch' | 'put';

/** Sustituye {orderId} / {storeId} en las plantillas de ruta configuradas. */
export function buildUberPath(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? '');
}

/**
 * Ejecuta una llamada autenticada contra la API de Uber.
 * @returns Resultado con el status HTTP; nunca lanza por error de respuesta.
 */
export async function uberCall(
  method: UberHttpMethod,
  path: string,
  body?: unknown
): Promise<UberCallResult> {
  let accessToken: string;
  try {
    accessToken = await uberAuthService.getAccessToken();
  } catch (error: any) {
    // Fallo de autenticación (o cooldown activo): se reporta como resultado, no como excepción.
    return { ok: false, status: 0, method, path, error: error.message };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    const response =
      method === 'get'
        ? await client.get(path, { headers })
        : await client[method](path, body ?? {}, { headers });

    logger.info(`Uber ${method.toUpperCase()} ${path} → ${response.status}`);
    return { ok: true, status: response.status, method, path, data: response.data };
  } catch (error: any) {
    const status = error.response?.status ?? 0;
    logger.error(`Uber ${method.toUpperCase()} ${path} → ${status || 'sin respuesta'}`, {
      data: error.response?.data,
      message: error.message,
    });
    if (status === 401) {
      uberAuthService.invalidateToken();
    }
    return { ok: false, status, method, path, data: error.response?.data, error: error.message };
  }
}
