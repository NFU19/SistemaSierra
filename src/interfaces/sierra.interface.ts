/**
 * Interfaces para los tipos de datos de Sistemas Sierra POS
 * Reflejan el esquema documentado en la Web Api de Sierra (OpenAPI v1):
 *   - OrderTicket  → cuerpo de POST /api/v1/orders
 *   - OrderResponse → respuesta de POST /api/v1/orders
 */

/** Datos del cliente de la orden (schema ClientOrder de Sierra). */
export interface ClientOrder {
  /** Numero de Cliente */
  clientId?: string;
  /** Nombre */
  name?: string;
  /** Calle y Numero */
  address?: string;
  /** Colonia */
  address2?: string;
  /** Ciudad */
  city?: string;
  /** Codigo Postal */
  zipCode?: string;
  /** Correo Electronico */
  email?: string;
  /** Telefono */
  telephone?: string;
  /** Telefono Celular */
  mobilPhone?: string;
  memo1?: string;
  memo2?: string;
  memo3?: string;
  memo4?: string;
}

/** Modificador de un producto (schema SubPlus de Sierra). */
export interface SubPlus {
  /** Numero de PLU (opcional) */
  plu?: string;
  /** Descripcion */
  description?: string;
  /** Cantidad */
  quantity?: number;
  /** Precio Unitario */
  unitPrice?: number;
  /** Subtotal */
  subTotal?: number;
  /** Total Iva */
  tax?: number;
  /** Tabla de Iva */
  taxTable?: string;
  /** Comentarios para el modificador */
  comments?: string;
}

/** Detalle de un producto de la orden (schema PluOrder de Sierra). */
export interface PluOrder {
  /** Numero de PLU */
  plu: string;
  /** Descripcion */
  description?: string;
  /** Cantidad */
  quantity: number;
  /** Precio Unitario */
  unitPrice: number;
  /** Subtotal */
  subTotal: number;
  /** Total Iva */
  tax: number;
  /** Tabla de Iva */
  taxTable?: string;
  /** Comentarios para el producto */
  comments?: string;
  /** Modificadores del producto */
  subPlus?: SubPlus[];
}

/** Pago de la orden (schema PaymentOrder de Sierra). */
export interface PaymentOrder {
  /** Numero de PLU del metodo de pago */
  plu?: string;
  /** Descripcion */
  description?: string;
  /** Importe del pago */
  unitPrice?: number;
}

/** Cuerpo enviado a POST /api/v1/orders (schema OrderTicket de Sierra). */
export interface OrderTicket {
  /** Numero de Orden Original */
  order: string;
  /** Numero de Terminal */
  terminal?: string;
  /** Mesero */
  server?: string;
  /** Cajero */
  cashier?: string;
  /** Subtotal */
  subTotal: number;
  /** Iva */
  tax: number;
  /** Pagos */
  credits?: number;
  /** Cambio */
  change?: number;
  /** Tipo de Venta segun catalogo de tipos de venta */
  salesType?: string;
  /** Tipo de Orden segun origen (ORDEN WEB ONLINE, ORDEN WEB LOCAL, etc) */
  orderType: string;
  /** "0" = la cuenta se cierra automaticamente, "1" = el cliente debe cerrar la cuenta */
  openStatus?: string;
  /** API en demo (false) o produccion (true) */
  production?: boolean;
  /** Enviar productos a cocina(s)/barra(s) */
  routeProducts?: boolean;
  /** Folio del sistema de pagos (Stripe, etc.) */
  paymentTransactionId?: string;
  /** Comentarios para la orden */
  orderComments?: string;
  /** Datos del Cliente */
  client: ClientOrder[];
  /** Lista de Plus en orden */
  plus: PluOrder[];
  /** Lista de Pagos (opcional) */
  payments?: PaymentOrder[];
  /** Nombre del metodo de pago (para concatenar donde se muestra la orden en PDV) */
  paymentIdentifierString?: string;
  /** Numero de mesa (para cuentas QR locales) */
  tableNumber?: string;
  /** Nombre de la orden (para identificarla en el PDV) */
  orderName?: string;
}

/** Respuesta de POST /api/v1/orders (schema OrderResponse de Sierra). */
export interface SierraOrderResponse {
  /** Estado */
  status?: number;
  /** Mensaje */
  msg?: string;
  /** Numero de Nota Original */
  order?: string;
  /** Numero de Nota en Sistema PDV */
  folio?: string;
  /** Numero consecutivo de orden en Sistema PDV */
  con?: number;
  /** Fecha/Hora de Registro */
  time?: string;
}

export interface SierraPluItem {
  id?: string;
  nombre_corto?: string;
  nombre_largo?: string;
  descripcion?: string;
  precio1?: number;
  precio?: number;
  imagen?: string;
  categoria?: string;
  [key: string]: any;
}

export interface SierraPluStockData {
  plu?: string;
  cantidad?: number;
  [key: string]: any;
}
