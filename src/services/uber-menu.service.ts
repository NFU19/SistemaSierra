/**
 * Servicio para construir y subir menus a Uber Eats
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { uberAuthService } from './uber-auth.service';
import { sierraCatalogService } from './sierra-catalog.service';
import { SierraPluItem, SierraPluStockData } from '../interfaces/sierra.interface';

interface UberMenuPayload {
  items: any[];
  modifier_groups: any[];
  categories: any[];
  menus: any[];
  display_options: Record<string, any>;
}

interface SyncMenuResult {
  menuId: string;
  categoryIds: string[];
  itemCount: number;
  payload: UberMenuPayload;
}

interface SierraCategoryMapping {
  name: string;
  items: SierraPluItem[];
}

class UberMenuService {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.uber.apiBaseUrl,
      timeout: 15000,
    });
  }

  async syncMenu(dryRun = false): Promise<SyncMenuResult> {
    const [plusCatalog, stock, categories] = await Promise.all([
      sierraCatalogService.getPlusCatalog(),
      sierraCatalogService.getStock(),
      sierraCatalogService.getCategories(),
    ]);

    const categoryMappings = await this.buildCategoryMappings(categories);
    const stockMap = this.buildStockMap(stock);
    const menuResult = this.buildMenuPayload(plusCatalog, stockMap, categoryMappings);

    if (dryRun) {
      return menuResult;
    }

    try {
      const accessToken = await uberAuthService.getAccessToken();

      const menuPath = this.resolveMenuPath();

      await this.axiosInstance.put(
        menuPath,
        menuResult.payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Menu subido a Uber Eats', {
        storeId: config.uber.storeId,
        itemCount: menuResult.itemCount,
      });

      return menuResult;
    } catch (error) {
      logger.error('Error al subir menu a Uber Eats', error);
      throw error;
    }
  }

  private resolveMenuPath(): string {
    const rawPath = config.uber.menuPath || '';
    const withStore = rawPath.replace('{storeId}', config.uber.storeId);

    if (withStore.startsWith('/')) {
      return withStore;
    }

    return `/${withStore}`;
  }

  private buildMenuPayload(
    plusCatalog: SierraPluItem[],
    stockMap: Map<string, SierraPluStockData>,
    categoryMappings: SierraCategoryMapping[]
  ): SyncMenuResult {
    const storeName = config.uber.storeName || 'Menu';
    const menuId = `menu-${this.toSlug(storeName) || 'all-day'}`;

    const modifierItems = plusCatalog
      .filter((item) => this.isModifier(item))
      .filter((item) => !this.isSoldOut(item, stockMap))
      .map((item) => this.mapPluToItem(item))
      .filter((item) => item !== null);

    const modifierGroupId = modifierItems.length > 0 ? 'modifiers' : null;

    const items = plusCatalog
      .filter((item) => this.isMenuItem(item))
      .filter((item) => !this.isSoldOut(item, stockMap))
      .map((item) => this.mapPluToItem(item, modifierGroupId))
      .filter((item) => item !== null);

    const allItems = [...items, ...modifierItems];
    const itemIds = new Set(items.map((item) => item.id));

    const categories = this.buildCategories(categoryMappings, itemIds, storeName);

    if (categories.length === 0) {
      const fallbackCategoryId = `cat-${this.toSlug(storeName) || 'catalogo'}`;
      categories.push({
        id: fallbackCategoryId,
        title: { translations: { en_us: storeName } },
        entities: items.map((item) => ({ type: 'ITEM', id: item.id })),
      });
    }

    const categoryIds = categories.map((category) => category.id);

    const payload: UberMenuPayload = {
      items: allItems as any[],
      modifier_groups: modifierGroupId
        ? [
            {
              id: modifierGroupId,
              title: {
                translations: {
                  en_us: 'Modificadores',
                },
              },
              quantity_info: {
                quantity: {
                  max_permitted: 5,
                },
              },
              modifier_options: modifierItems.map((item) => ({
                type: 'ITEM',
                id: item.id,
              })),
            },
          ]
        : [],
      categories,
      menus: [
        {
          id: menuId,
          title: {
            translations: {
              en_us: storeName,
            },
          },
          service_availability: this.getFullWeekAvailability(),
          category_ids: categories.map((category) => category.id),
        },
      ],
      display_options: {
        disable_item_instructions: true,
      },
    };

    return {
      menuId,
      categoryIds,
      itemCount: items.length,
      payload,
    };
  }

  private mapPluToItem(item: SierraPluItem, modifierGroupId?: string | null): any | null {
    if (!item.id) {
      return null;
    }

    const priceCents = this.parsePriceToCents(item.precio1);
    if (priceCents === null) {
      return null;
    }

    const title = item.nombre_largo || item.nombre_corto || item.id;

    const mappedItem: any = {
      id: String(item.id),
      title: {
        translations: {
          en_us: title,
        },
      },
      description: {
        translations: {
          en_us: item.nombre_corto || title,
        },
      },
      price_info: {
        price: priceCents,
      },
      external_data: `plu:${item.id}`,
    };

    if (modifierGroupId) {
      mappedItem.modifier_group_ids = {
        ids: [modifierGroupId],
      };
    }

    return mappedItem;
  }

  private isMenuItem(item: SierraPluItem): boolean {
    if (!item.id) {
      return false;
    }

    if (item.category) {
      return false;
    }

    if (this.isModifier(item)) {
      return false;
    }

    return true;
  }

  private isModifier(item: SierraPluItem): boolean {
    if (item.mod === undefined || item.mod === null) {
      return false;
    }

    const modValue = String(item.mod).toLowerCase();
    return modValue === '1' || modValue === 'true' || modValue === 'yes';
  }

  private isSoldOut(item: SierraPluItem, stockMap: Map<string, SierraPluStockData>): boolean {
    if (!item.id) {
      return false;
    }

    const stock = stockMap.get(String(item.id));
    if (!stock) {
      return false;
    }

    const soldOut = this.toNumber(stock.isSoldOut);
    if (soldOut !== null && soldOut > 0) {
      return true;
    }

    const usesOnlineInventory = this.toNumber(stock.usesOnlineInventory);
    const onlineInventory = this.toNumber(stock.onlineInventory);
    if (usesOnlineInventory !== null && usesOnlineInventory > 0) {
      return onlineInventory !== null && onlineInventory <= 0;
    }

    return false;
  }

  private parsePriceToCents(value?: number | string | null): number | null {
    if (value === undefined || value === null) {
      return null;
    }

    const parsed = typeof value === 'string' ? parseFloat(value) : value;
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.round(parsed * 100);
  }

  private toNumber(value?: number | string | null): number | null {
    if (value === undefined || value === null) {
      return null;
    }

    const parsed = typeof value === 'string' ? parseFloat(value) : value;
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return parsed;
  }

  private toSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private getFullWeekAvailability(): any[] {
    const days = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];

    return days.map((day) => ({
      day_of_week: day,
      time_periods: [{ start_time: '00:00', end_time: '23:59' }],
    }));
  }

  private async buildCategoryMappings(
    categories: string[]
  ): Promise<SierraCategoryMapping[]> {
    if (categories.length === 0) {
      return [];
    }

    const mappings = await Promise.all(
      categories.map(async (category) => {
        try {
          const items = await sierraCatalogService.getPlusByCategory(category);
          return { name: category, items };
        } catch (error) {
          logger.warn('No se pudo obtener items de categoria', { category, error });
          return { name: category, items: [] };
        }
      })
    );

    return mappings.filter((mapping) => mapping.items.length > 0);
  }

  private buildStockMap(stockItems: SierraPluStockData[]): Map<string, SierraPluStockData> {
    const map = new Map<string, SierraPluStockData>();

    stockItems.forEach((item) => {
      if (item.plu) {
        map.set(String(item.plu), item);
      }
    });

    return map;
  }

  private buildCategories(
    mappings: SierraCategoryMapping[],
    itemIds: Set<string>,
    fallbackName: string
  ): any[] {
    const categories: any[] = [];

    mappings.forEach((mapping) => {
      const entities = mapping.items
        .map((item) => String(item.id || ''))
        .filter((id) => id && itemIds.has(id))
        .map((id) => ({ type: 'ITEM', id }));

      if (entities.length === 0) {
        return;
      }

      categories.push({
        id: `cat-${this.toSlug(mapping.name) || this.toSlug(fallbackName)}`,
        title: {
          translations: {
            en_us: mapping.name,
          },
        },
        entities,
      });
    });

    return categories;
  }
}

export const uberMenuService = new UberMenuService();
