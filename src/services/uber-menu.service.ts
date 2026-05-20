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
  modifiers: SierraPluItem[];
}

interface CategoryBuildResult {
  sections: Map<string, SierraCategoryMapping>;
  uncategorizedItems: SierraPluItem[];
  uncategorizedModifiers: SierraPluItem[];
}

interface GeneralCategoryBucket {
  name: string;
  items: any[];
}

const GENERAL_CATEGORY_DEFINITIONS: Record<string, string[]> = {
  BEBIDAS: [
    'REFRESCOS',
    'CAFES CALIENTES',
    'AGUAS MEDIANAS',
    'AGUAS GRANDES',
    'CERVEZAS',
    'CHABELAS',
    'MICHELADAS',
  ],
  COMIDA: [
    'TACOS MAIZ',
    'TACOS HARINA',
    'TOSTADAS',
    'QUESADILLAS MAIZ',
    'QUESADILLAS HARINA',
    'CUATAS GRINGAS',
    'PAPAS CLASICA',
    'PAPA ESPECIAL',
    'PAPAS SUPER',
    'PAPAS SAZONADAS',
    'VAMPIROS',
    'QUESOS',
    'FRIJOLES CHARROS',
    'FRIJOLES OLLA',
  ],
  ENTRADAS: ['CHILES', 'JUGOS', 'PENCA NOPAL', 'BARRA DE SALSAS'],
};

const MODIFIER_CATEGORY_TARGETS: Record<string, string[]> = {
  'MODIFICADORES TACOS': ['TACOS MAIZ', 'TACOS HARINA'],
  'MODIFICADOR QUESADILLA': ['QUESADILLAS MAIZ', 'QUESADILLAS HARINAS'],
  'MODIFICADOR PARRILLAS': ['PARRILLADAS'],
  LECHES: ['CAFES CALIENTES'],
  JARABES: ['POSTRES'],
};

const IGNORED_MODIFIER_CATEGORIES = new Set(['MODIFICADORES']);

const PASSTHROUGH_CATEGORIES = new Set(['PARRILLADAS', 'SOPAS', 'POSTRES']);

class UberMenuService {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.uber.apiBaseUrl,
      timeout: 15000,
    });
  }

  async syncMenu(dryRun = false): Promise<SyncMenuResult> {
    const [plusCatalog, stock] = await Promise.all([
      sierraCatalogService.getPlusCatalog(),
      sierraCatalogService.getStock(),
    ]);

    const stockMap = this.buildStockMap(stock);
    const menuResult = this.buildMenuPayload(plusCatalog, stockMap);

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
    stockMap: Map<string, SierraPluStockData>
  ): SyncMenuResult {
    const storeName = config.uber.storeName || 'Menu';
    const menuId = `menu-${this.toSlug(storeName) || 'all-day'}-v2`;

    const categoryBuild = this.buildCategoryMappingsFromCatalog(plusCatalog, stockMap);
    const generalCategoryMap = this.buildGeneralCategoryMap();

    const categories: any[] = [];
    const mappedItems: any[] = [];
    const mappedModifiers: any[] = [];
    const modifierGroups: any[] = [];
    const generalBuckets = new Map<string, GeneralCategoryBucket>();
    const modifierItemsBySection = this.buildModifierItemsBySection(categoryBuild.sections);
    const modifierGroupIdBySection = new Map<string, string>();

    modifierItemsBySection.forEach((modifierItems, sectionKey) => {
      if (modifierItems.length === 0) {
        return;
      }

      const uniqueModifierItems = this.mapUniqueModifiers(modifierItems);
      if (uniqueModifierItems.length === 0) {
        return;
      }

      const modifierGroupId = `mods-${this.toSlug(sectionKey)}`;
      modifierGroupIdBySection.set(sectionKey, modifierGroupId);
      mappedModifiers.push(...uniqueModifierItems);
      modifierGroups.push({
        id: modifierGroupId,
        title: {
          translations: {
            en_us: `Modificadores ${sectionKey}`,
          },
        },
        quantity_info: {
          quantity: {
            max_permitted: 5,
          },
        },
        modifier_options: uniqueModifierItems.map((item) => ({
          type: 'ITEM',
          id: item.id,
        })),
      });
    });

    categoryBuild.sections.forEach((section, sectionKey) => {
      if (this.isModifierCategory(sectionKey)) {
        return;
      }

      if (!this.isAllowedSection(sectionKey, generalCategoryMap)) {
        return;
      }

      const generalCategoryName = this.resolveGeneralCategoryName(
        sectionKey,
        generalCategoryMap,
        storeName
      );
      const modifierGroupId = modifierGroupIdBySection.get(sectionKey) || null;

      const categoryItems = section.items
        .map((item) =>
          this.mapPluToItem(item, modifierGroupId ? [modifierGroupId] : undefined)
        )
        .filter((item) => item !== null);

      if (categoryItems.length === 0) {
        return;
      }

      mappedItems.push(...categoryItems);
      this.addToGeneralBucket(generalBuckets, generalCategoryName, categoryItems);
    });

    const mappedUncategorizedItems = categoryBuild.uncategorizedItems
      .map((item) => this.mapPluToItem(item))
      .filter((item) => item !== null);

    if (mappedUncategorizedItems.length > 0 && generalCategoryMap.size === 0) {
      mappedItems.push(...mappedUncategorizedItems);
      this.addToGeneralBucket(generalBuckets, storeName, mappedUncategorizedItems);
    }


    generalBuckets.forEach((bucket, name) => {
      const slug = this.toSlug(name) || this.toSlug(storeName) || 'catalogo';
      const uniqueItems = this.dedupeMappedItems(bucket.items);
      categories.push({
        id: `cat-${slug}`,
        title: { translations: { en_us: name } },
        entities: uniqueItems.map((item) => ({ type: 'ITEM', id: item.id })),
      });
    });

    if (categories.length === 0) {
      categories.push({
        id: `cat-${this.toSlug(storeName) || 'catalogo'}`,
        title: { translations: { en_us: storeName } },
        entities: [],
      });
    }

    const allItems = this.dedupeMappedItems([...mappedItems, ...mappedModifiers]);
    const categoryIds = categories.map((category) => category.id);

    const payload: UberMenuPayload = {
      items: allItems as any[],
      modifier_groups: modifierGroups,
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
      itemCount: mappedItems.length,
      payload,
    };
  }

  private mapPluToItem(
    item: SierraPluItem,
    modifierGroupIds?: string[] | null
  ): any | null {
    if (!item.id) {
      return null;
    }

    const priceCents = this.parsePriceToCents(item.precio1);
    if (priceCents === null || priceCents <= 0) {
      return null;
    }

    const title = this.getDisplayName(item);

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

    if (modifierGroupIds && modifierGroupIds.length > 0) {
      mappedItem.modifier_group_ids = {
        ids: modifierGroupIds,
      };
    }

    return mappedItem;
  }

  private isMenuItem(item: SierraPluItem): boolean {
    if (!item.id) {
      return false;
    }

    if (item.category === true) {
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

  private buildCategoryMappingsFromCatalog(
    plusCatalog: SierraPluItem[],
    stockMap: Map<string, SierraPluStockData>
  ): CategoryBuildResult {
    const map = new Map<string, SierraCategoryMapping>();
    const uncategorizedItems: SierraPluItem[] = [];
    const uncategorizedModifiers: SierraPluItem[] = [];
    let currentCategoryName: string | null = null;
    let currentCategoryKey: string | null = null;

    plusCatalog.forEach((item) => {
      if (item.category === true) {
        currentCategoryName = this.getCategoryLabel(item);
        if (!currentCategoryName) {
          currentCategoryKey = null;
          return;
        }

        currentCategoryKey = this.normalizeCategoryName(currentCategoryName);

        if (!map.has(currentCategoryKey)) {
          map.set(currentCategoryKey, {
            name: currentCategoryName,
            items: [],
            modifiers: [],
          });
        }

        return;
      }

      const isIgnoredModifierSection =
        currentCategoryKey && IGNORED_MODIFIER_CATEGORIES.has(currentCategoryKey);

      if (isIgnoredModifierSection) {
        return;
      }

      if (this.isSoldOut(item, stockMap)) {
        return;
      }

      const isModifierSection =
        currentCategoryKey && this.isModifierCategory(currentCategoryKey);

      if (isModifierSection || this.isModifier(item)) {
        if (currentCategoryKey && map.has(currentCategoryKey)) {
          map.get(currentCategoryKey)?.modifiers.push(item);
        } else {
          uncategorizedModifiers.push(item);
        }

        return;
      }

      if (this.isMenuItem(item)) {
        if (currentCategoryKey && map.has(currentCategoryKey)) {
          map.get(currentCategoryKey)?.items.push(item);
        } else {
          uncategorizedItems.push(item);
        }
      }
    });

    return {
      sections: map,
      uncategorizedItems,
      uncategorizedModifiers,
    };
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

  private getCategoryLabel(item: SierraPluItem): string | null {
    const label = item.nombre_largo || item.nombre_corto || item.id;
    if (!label) {
      return null;
    }

    const name = String(label).trim();
    return name.length > 0 ? name : null;
  }

  private getDisplayName(item: SierraPluItem): string {
    const longName = item.nombre_largo ? String(item.nombre_largo).trim() : '';
    const shortName = item.nombre_corto ? String(item.nombre_corto).trim() : '';

    if (longName && /[A-Za-z]/.test(longName)) {
      return longName;
    }

    if (shortName) {
      return shortName;
    }

    return String(item.id || '').trim() || 'Item';
  }

  private normalizeCategoryName(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toUpperCase();
  }

  private buildGeneralCategoryMap(): Map<string, string> {
    const map = new Map<string, string>();

    Object.entries(GENERAL_CATEGORY_DEFINITIONS).forEach(([general, sections]) => {
      sections.forEach((section) => {
        map.set(this.normalizeCategoryName(section), general);
      });
    });

    return map;
  }

  private isModifierCategory(sectionKey: string): boolean {
    const normalized = this.normalizeCategoryName(sectionKey);
    if (IGNORED_MODIFIER_CATEGORIES.has(normalized)) {
      return true;
    }

    return normalized in MODIFIER_CATEGORY_TARGETS;
  }

  private buildModifierItemsBySection(
    sections: Map<string, SierraCategoryMapping>
  ): Map<string, SierraPluItem[]> {
    const modifiersBySection = new Map<string, SierraPluItem[]>();

    sections.forEach((section, sectionKey) => {
      if (section.modifiers.length === 0) {
        return;
      }

      const normalized = this.normalizeCategoryName(sectionKey);
      if (IGNORED_MODIFIER_CATEGORIES.has(normalized)) {
        return;
      }

      if (normalized in MODIFIER_CATEGORY_TARGETS) {
        MODIFIER_CATEGORY_TARGETS[normalized].forEach((target) => {
          const targetKey = this.normalizeCategoryName(target);
          if (!sections.has(targetKey)) {
            return;
          }
          const list = modifiersBySection.get(targetKey) || [];
          list.push(...section.modifiers);
          modifiersBySection.set(targetKey, list);
        });

        return;
      }

      if (PASSTHROUGH_CATEGORIES.has(normalized)) {
        return;
      }

      modifiersBySection.set(sectionKey, section.modifiers);
    });

    return modifiersBySection;
  }

  private mapUniqueModifiers(items: SierraPluItem[]): any[] {
    const seen = new Set<string>();
    const mapped: any[] = [];

    items.forEach((item) => {
      const mappedItem = this.mapPluToItem(item);
      if (!mappedItem || !mappedItem.id || seen.has(mappedItem.id)) {
        return;
      }

      seen.add(mappedItem.id);
      mapped.push(mappedItem);
    });

    return mapped;
  }

  private dedupeMappedItems(items: any[]): any[] {
    const seen = new Set<string>();
    const deduped: any[] = [];

    items.forEach((item) => {
      if (!item || !item.id || seen.has(item.id)) {
        return;
      }

      seen.add(item.id);
      deduped.push(item);
    });

    return deduped;
  }

  private addToGeneralBucket(
    buckets: Map<string, GeneralCategoryBucket>,
    name: string,
    items: any[]
  ): void {
    const bucket = buckets.get(name) || { name, items: [] };
    bucket.items = this.dedupeMappedItems([...bucket.items, ...items]);
    buckets.set(name, bucket);
  }

  private isAllowedSection(
    sectionKey: string,
    generalCategoryMap: Map<string, string>
  ): boolean {
    const normalized = this.normalizeCategoryName(sectionKey);
    if (generalCategoryMap.size === 0) {
      return true;
    }

    if (generalCategoryMap.has(normalized)) {
      return true;
    }

    return PASSTHROUGH_CATEGORIES.has(normalized);
  }

  private resolveGeneralCategoryName(
    sectionKey: string,
    generalCategoryMap: Map<string, string>,
    fallbackName: string
  ): string {
    const normalized = this.normalizeCategoryName(sectionKey);
    if (PASSTHROUGH_CATEGORIES.has(normalized)) {
      return sectionKey;
    }

    return generalCategoryMap.get(normalized) || fallbackName;
  }
}

export const uberMenuService = new UberMenuService();
