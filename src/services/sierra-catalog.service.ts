/**
 * Servicio de catalogo para Sistemas Sierra POS
 * Obtiene PLUs para construir menu de Uber Eats
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { SierraPluItem, SierraPluStockData } from '../interfaces/sierra.interface';

class SierraCatalogService {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.sierra.apiUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.sierra.apiKey,
      },
    });
  }

  async getPlusCatalog(): Promise<SierraPluItem[]> {
    try {
      logger.info('Obteniendo catalogo de PLUs desde Sierra...');

      const response = await this.axiosInstance.get<SierraPluItem[]>('/api/v1/plus');

      if (!Array.isArray(response.data)) {
        throw new Error('Respuesta invalida de catalogo Sierra');
      }

      logger.info('Catalogo Sierra obtenido', { count: response.data.length });
      return response.data;
    } catch (error) {
      logger.error('Error al obtener catalogo Sierra', error);
      throw error;
    }
  }

  async getCategories(): Promise<string[]> {
    const categories = await this.fetchCategoryList('/api/v1/plus/categories');
    const subCategories = await this.fetchCategoryList('/api/v1/plus/sub-categories');

    return Array.from(new Set([...categories, ...subCategories]));
  }

  async getPlusByCategory(category: string, amount = 0): Promise<SierraPluItem[]> {
    try {
      const encodedCategory = encodeURIComponent(category);
      const response = await this.axiosInstance.get<SierraPluItem[]>(
        `/api/v1/plus/categories/${encodedCategory}/${amount}`
      );

      if (!Array.isArray(response.data)) {
        throw new Error('Respuesta invalida de categoria Sierra');
      }

      return response.data;
    } catch (error) {
      logger.error('Error al obtener categoria Sierra', { category, error });
      throw error;
    }
  }

  async getStock(): Promise<SierraPluStockData[]> {
    try {
      const response = await this.axiosInstance.get<SierraPluStockData[]>('/api/v1/plus/stock');

      if (!Array.isArray(response.data)) {
        throw new Error('Respuesta invalida de stock Sierra');
      }

      return response.data;
    } catch (error) {
      logger.error('Error al obtener stock Sierra', error);
      throw error;
    }
  }

  private async fetchCategoryList(endpoint: string): Promise<string[]> {
    try {
      const response = await this.axiosInstance.get<SierraPluItem[]>(endpoint);

      if (!Array.isArray(response.data)) {
        throw new Error('Respuesta invalida de categorias Sierra');
      }

      return response.data
        .map((item) => this.getCategoryName(item))
        .filter((name): name is string => Boolean(name));
    } catch (error) {
      logger.error('Error al obtener categorias Sierra', { endpoint, error });
      return [];
    }
  }

  private getCategoryName(item: SierraPluItem): string | null {
    const name = item.nombre_largo || item.nombre_corto || item.id;
    if (!name) {
      return null;
    }

    return String(name).trim() || null;
  }
}

export const sierraCatalogService = new SierraCatalogService();
