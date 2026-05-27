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
