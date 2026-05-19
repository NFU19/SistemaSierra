/**
 * Controlador para sincronizacion de menus a Uber Eats
 */

import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { uberMenuService } from '../services/uber-menu.service';
import { config } from '../config/config';

class UberMenuController {
  /**
   * POST /api/uber/menus/sync
   * Sincroniza el menu desde Sierra hacia Uber Eats
   */
  async syncMenu(req: Request, res: Response): Promise<void> {
    try {
      const dryRun = String(req.query.dryRun || '').toLowerCase() === 'true';

      const result = await uberMenuService.syncMenu(dryRun);

      logger.info('Sync de menu finalizado', {
        storeId: config.uber.storeId,
        itemCount: result.itemCount,
        dryRun,
      });

      res.status(200).json({
        success: true,
        dryRun,
        storeId: config.uber.storeId,
        storeName: config.uber.storeName,
        menuId: result.menuId,
        categoryIds: result.categoryIds,
        itemCount: result.itemCount,
        payload: dryRun ? result.payload : undefined,
      });
    } catch (error: any) {
      logger.error('Error en sync de menu', error);
      res.status(500).json({
        success: false,
        error: 'Error al sincronizar menu con Uber Eats',
        message: config.nodeEnv === 'development' ? error.message : undefined,
      });
    }
  }
}

export const uberMenuController = new UberMenuController();
