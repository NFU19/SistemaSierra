/**
 * Servicio de OAuth2 para Uber Eats
 * Maneja la obtención y gestión de tokens de acceso
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { UberOAuthTokenResponse } from '../interfaces/uber.interface';

class UberAuthService {
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
    });
  }

  /**
   * Obtiene un nuevo token de acceso usando Client Credentials Flow
   * @returns Token de acceso de Uber
   */
  async getAccessToken(): Promise<string> {
    try {
      // Si tenemos un token válido, lo retornamos
      if (this.accessToken && Date.now() < this.tokenExpiresAt) {
        logger.debug('Usando token de Uber almacenado en caché');
        return this.accessToken;
      }

      logger.info('Solicitando nuevo token OAuth2 a Uber Eats...');

      const response = await this.axiosInstance.post<UberOAuthTokenResponse>(
        config.uber.authUrl,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.uber.clientId,
          client_secret: config.uber.clientSecret,
          scope: 'eats.order',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in } = response.data;

      // Almacenamos el token y calculamos su expiración
      // Restamos 60 segundos para refrescar antes de que expire completamente
      this.accessToken = access_token;
      this.tokenExpiresAt = Date.now() + (expires_in - 60) * 1000;

      logger.info('Token OAuth2 obtenido exitosamente', {
        expiresIn: expires_in,
      });

      return access_token;
    } catch (error) {
      logger.error('Error al obtener token OAuth2 de Uber', error);
      throw new Error('Fallo en la autenticación con Uber Eats');
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
