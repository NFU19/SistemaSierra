/**
 * Interfaces para los tipos de datos de Uber Eats
 */

export interface UberWebhookPayload {
  event_id: string;
  event_time?: number;
  timestamp?: number;
  event_type: 'orders.notification' | 'order.created' | 'order.updated' | 'order.cancelled' | (string & {});
  order_id?: string; // Formato orders.notification (root-level)
  type?: string;     // Formato orders.notification (NEW, CANCELLED, etc.)
  meta?: {
    user_id?: string;
    resource_id: string; // Este es el UUID de la orden en el formato eats.order
    status?: string;
  };
  resource_href?: string;
  data?: UberOrderEvent; // Formato alternativo
}

export interface UberOrderEvent {
  order_id: string;
  store_id: string;
  timestamp: number;
  platform: 'eats' | (string & {});
}

export interface UberOrderDetails {
  id: string;
  store_id: string;
  order_number: string;
  timestamp: number;
  status: string;
  items: UberOrderItem[];
  customer: UberCustomer;
  totals: UberTotals;
  special_instructions: string | null;
}

export interface UberOrderItem {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  price: number;
  currency: string;
  customizations?: UberCustomization[];
}

export interface UberCustomization {
  id: string;
  title: string;
  selections: {
    id: string;
    title: string;
    price: number;
  }[];
}

export interface UberCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
}

export interface UberTotals {
  subtotal: number;
  tax: number;
  delivery_fee: number;
  promotion: number;
  total: number;
  currency: string;
}

export interface UberOAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}
