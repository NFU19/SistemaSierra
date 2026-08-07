/**
 * Servicio de Configuración de Integración (Integration Config) en Uber Eats.
 *
 * Permite activar la integración de una tienda contra esta aplicación y consultar
 * su estado. Uber exige ambos endpoints para certificar el pase a producción.
 *
 * Endpoints (verificados contra la documentación pública de Uber):
 *   POST /v1/eats/stores/{store_id}/pos_data   → Activate Integration
 *   GET  /v1/eats/stores/{store_id}/pos_data   → Get Integration Details
 *
 * OJO: Activate Integration requiere el scope `eats.pos_provisioning`, que no viene
 * habilitado por defecto. Se agrega con UBER_EXTRA_SCOPES cuando el soporte de Uber
 * lo concede al client ID; sin él la llamada responde 401/403.
 */

import { config } from '../config/config';
import { logger } from '../utils/logger';
import { buildUberPath, uberCall } from './uber-api.client';
import { UberCallResult } from '../interfaces/uber.interface';

interface ActivateIntegrationOptions {
  /** Identificador con el que esta app referencia la tienda (mapeo interno). */
  integratorStoreId?: string;
  /** Blob de configuración arbitrario que Uber almacena como fuente de verdad. */
  storeConfigurationData?: string;
}

class UberIntegrationService {
  /**
   * Activate Integration — da de alta la tienda contra esta integración.
   * POST /v1/eats/stores/{store_id}/pos_data
   */
  async activateIntegration(
    storeId: string = config.uber.storeId,
    opts: ActivateIntegrationOptions = {}
  ): Promise<UberCallResult> {
    const missing = this.requireStoreId(storeId, 'post');
    if (missing) return missing;

    const body: Record<string, unknown> = {
      integration_enabled: true,
      integrator_store_id: opts.integratorStoreId || storeId,
    };
    if (opts.storeConfigurationData) {
      body.store_configuration_data = opts.storeConfigurationData;
    }

    logger.info(`Activando integración de la tienda ${storeId} en Uber...`);
    const result = await uberCall('post', this.buildPath(storeId), body);
    this.warnIfScopeIssue(result);
    return result;
  }

  /**
   * Get Integration Details — consulta el estado de la integración de la tienda.
   * GET /v1/eats/stores/{store_id}/pos_data
   */
  async getIntegrationDetails(storeId: string = config.uber.storeId): Promise<UberCallResult> {
    const missing = this.requireStoreId(storeId, 'get');
    if (missing) return missing;

    logger.info(`Consultando detalles de integración de la tienda ${storeId}...`);
    return uberCall('get', this.buildPath(storeId));
  }

  private buildPath(storeId: string): string {
    return buildUberPath(config.uber.paths.posData, { storeId });
  }

  /** Devuelve un resultado de error si falta el store id; null si todo bien. */
  private requireStoreId(storeId: string, method: 'get' | 'post'): UberCallResult | null {
    if (storeId) return null;
    return {
      ok: false,
      status: 0,
      method,
      path: config.uber.paths.posData,
      error: 'UBER_STORE_ID no está configurado',
    };
  }

  private warnIfScopeIssue(result: UberCallResult): void {
    if (result.status === 401 || result.status === 403) {
      logger.warn(
        'Activate Integration falló por permisos: verifica que el scope eats.pos_provisioning ' +
          'esté habilitado en el client ID y agregado en UBER_EXTRA_SCOPES.'
      );
    }
  }
}

export const uberIntegrationService = new UberIntegrationService();
