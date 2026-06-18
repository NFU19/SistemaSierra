/**
 * Servicio de OAuth2 para Uber Eats
 * Maneja la obtención y gestión de tokens de acceso
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { UberOAuthTokenResponse } from '../interfaces/uber.interface';

class UberAuthService {
  private readonly axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  // Tras un fallo, no volver a pedir token hasta que pase este tiempo (evita martillar a Uber)
  private cooldownUntil: number = 0;
  private readonly COOLDOWN_MS = 60000;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
    });
  }

  /**
   * Obtiene un token de acceso (Client Credentials), reusando el cacheado.
   * El token de Uber dura ~30 días: se debe REUSAR, no pedir uno por cada llamada.
   * Si una petición falla, entra en cooldown para no saturar el endpoint de Uber
   * (Uber bloquea con 403/502 si se piden tokens en exceso).
   */
  async getAccessToken(): Promise<string> {
    // 1) Token válido en caché → reusar
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      logger.debug('Usando token de Uber almacenado en caché');
      return this.accessToken;
    }

    // 2) En cooldown tras un fallo reciente → no pegarle al endpoint
    if (Date.now() < this.cooldownUntil) {
      const secs = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
      throw new Error(
        `Autenticación con Uber en cooldown (${secs}s) tras un fallo reciente — evitando saturar el endpoint de token`
      );
    }

    try {
      logger.info('Solicitando nuevo token OAuth2 a Uber Eats...');

      const response = await this.axiosInstance.post<UberOAuthTokenResponse>(
        config.uber.authUrl,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.uber.clientId,
          client_secret: config.uber.clientSecret,
          scope: config.uber.scopes,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in } = response.data;

      this.accessToken = access_token;
      this.tokenExpiresAt = Date.now() + (expires_in - 60) * 1000;
      this.cooldownUntil = 0;

      logger.info('Token OAuth2 obtenido exitosamente', { expiresIn: expires_in });

      return access_token;
    } catch (error: any) {
      const status = error.response?.status;
      // Activar cooldown para no martillar (clave cuando Uber rate-limitea con 403/502)
      this.cooldownUntil = Date.now() + this.COOLDOWN_MS;
      // Log compacto (sin volcar el objeto axios entero)
      logger.error(
        `Error al obtener token OAuth2 de Uber (status=${status ?? 'sin-respuesta'}) — cooldown ${this.COOLDOWN_MS / 1000}s`,
        error.message
      );
      throw new Error(`Fallo en la autenticación con Uber Eats (${status ?? 'sin status'})`);
    }
  }

  /**
   * Invalida el token almacenado para forzar una nueva obtención
   */
  invalidateToken(): void {
    logger.debug('Invalidando token de Uber almacenado en caché');
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }
}

export const uberAuthService = new UberAuthService();
