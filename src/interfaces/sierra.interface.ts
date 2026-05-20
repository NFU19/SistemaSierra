/**
 * Interfaces para los tipos de datos de Sistemas Sierra POS
 */

export interface OrderTicket {
  order: string;
  subTotal: number;
  tax: number;
  orderType: string;
  plus: PluOrder[];
  observation?: string;
  salesType?: string;
  tableNumber?: number;
  employeeNumber?: number;
}

export interface PluOrder {
  plu: string;
  quantity: number;
  unitPrice: number;
  subTotal: number;
  tax: number;
  customizations?: string;
}

export interface SierraApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  statusCode?: number;
}

export interface SierraOrderResponse {
  orderId: string;
  folio: number;
  timestamp: string;
  status: string;
}

export interface SierraPluItem {
  id?: string | null;
  nombre_largo?: string | null;
  nombre_corto?: string | null;
  precio1?: number | string | null;
  precio2?: number | string | null;
  precio3?: number | string | null;
  precio4?: number | string | null;
  precio5?: number | string | null;
  precio6?: number | string | null;
  precio7?: number | string | null;
  precio8?: number | string | null;
  precio9?: number | string | null;
  tabla_iva?: string | null;
  mod?: string | null;
  inv?: number | string | null;
  category?: string | number | boolean | null;
}

export interface SierraPluStockData {
  plu?: string | null;
  usesOnlineInventory?: number | string | null;
  onlineInventory?: number | string | null;
  isSoldOut?: number | string | null;
}
