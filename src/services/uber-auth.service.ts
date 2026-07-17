/**
 * Servicio de OAuth2 para Uber Eats
 * Maneja la obtención y gestión de tokens de acceso.
 *
 * El token de Uber dura ~30 días, así que pedir uno por arranque es un desperdicio y
 * provoca que Uber bloquee con 403 por exceso de peticiones. Por eso el token se
 * conserva en tres niveles, de más a menos duradero:
 *   1. UBER_ACCESS_TOKEN (variable de entorno) — sobrevive deploys y reinicios.
 *   2. Archivo de caché en disco — sobrevive reinicios mientras el disco persista.
 *   3. Memoria del proceso — se pierde en cada reinicio.
 */

import fs from 'node:fs';
import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { UberOAuthTokenResponse } from '../interfaces/uber.interface';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

class UberAuthService {
  private readonly axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  // Tras un fallo, no volver a pedir token hasta que pase este tiempo (evita martillar a Uber)
  private cooldownUntil = 0;
  private readonly cooldownMs = config.uber.tokenCooldownMs;
  private readonly cachePath = config.uber.tokenCachePath;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
    });
    this.restoreToken();
  }

  /**
   * Obtiene un token de acceso (Client Credentials), reusando el que ya se tenga.
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
      this.writeCache(access_token, this.tokenExpiresAt);

      logger.info('Token OAuth2 obtenido exitosamente', {
        expiresIn: expires_in,
        expiraEl: new Date(this.tokenExpiresAt).toISOString(),
      });

      return access_token;
    } catch (error: any) {
      const status = error.response?.status;
      // Activar cooldown para no martillar (clave cuando Uber rate-limitea con 403/502)
      this.cooldownUntil = Date.now() + this.cooldownMs;
      // Log compacto (sin volcar el objeto axios entero)
      logger.error(
        `Error al obtener token OAuth2 de Uber (status=${status ?? 'sin-respuesta'}) — cooldown ${this.cooldownMs / 1000}s`,
        error.message
      );
      if (status === 403) {
        logger.warn(
          'Uber respondió 403 al pedir token: normalmente es bloqueo por exceso de peticiones. ' +
            'Evita redesplegar; considera fijar UBER_ACCESS_TOKEN y UBER_SET_ONLINE_ON_STARTUP=false.'
        );
      }
      throw new Error(`Fallo en la autenticación con Uber Eats (${status ?? 'sin status'})`);
    }
  }

  /**
   * Invalida el token almacenado para forzar una nueva obtención.
   * También borra la caché en disco para no volver a restaurar un token muerto.
   */
  invalidateToken(): void {
    logger.debug('Invalidando token de Uber almacenado en caché');
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.clearCache();
  }

  /**
   * Recupera un token previo (variable de entorno o archivo) para no pedir uno nuevo
   * en cada arranque. Si el token resultara inválido, la primera llamada con 401 lo
   * invalidará y se pedirá uno nuevo automáticamente.
   */
  private restoreToken(): void {
    if (config.uber.accessToken) {
      this.accessToken = config.uber.accessToken;
      this.tokenExpiresAt = this.resolveSeedExpiry();
      logger.info('Token de Uber tomado de UBER_ACCESS_TOKEN — no se pedirá uno nuevo al arrancar');
      return;
    }

    const cached = this.readCache();
    if (cached && Date.now() < cached.expiresAt) {
      this.accessToken = cached.accessToken;
      this.tokenExpiresAt = cached.expiresAt;
      logger.info('Token de Uber restaurado desde la caché en disco', {
        expiraEl: new Date(cached.expiresAt).toISOString(),
      });
    }
  }

  /** Vencimiento del token semilla: el declarado, o se asume vigente 30 días. */
  private resolveSeedExpiry(): number {
    const raw = config.uber.accessTokenExpiresAt.trim();
    if (raw) {
      const ts = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
      if (Number.isFinite(ts) && ts > 0) {
        return ts;
      }
      logger.warn(`UBER_ACCESS_TOKEN_EXPIRES_AT no se pudo interpretar ("${raw}") — se ignora`);
    }
    return Date.now() + THIRTY_DAYS_MS;
  }

  private readCache(): CachedToken | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (typeof parsed?.accessToken === 'string' && typeof parsed?.expiresAt === 'number') {
        return parsed as CachedToken;
      }
    } catch {
      // Sin caché previa o disco no legible: se arranca sin token y se pedirá cuando haga falta.
    }
    return null;
  }

  private writeCache(accessToken: string, expiresAt: number): void {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify({ accessToken, expiresAt }), 'utf8');
    } catch (error: any) {
      logger.debug('No se pudo guardar la caché de token en disco', error.message);
    }
  }

  private clearCache(): void {
    try {
      fs.rmSync(this.cachePath, { force: true });
    } catch {
      // Si no se puede borrar, la validación de vencimiento evita reusar un token muerto.
    }
  }
}

export const uberAuthService = new UberAuthService();
