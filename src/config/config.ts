/**
 * Configuración centralizada de variables de entorno
 */

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: Number.parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Uber Eats OAuth2
  uber: {
    clientId: process.env.UBER_CLIENT_ID || '',
    clientSecret: process.env.UBER_CLIENT_SECRET || '',
    authUrl: process.env.UBER_AUTH_URL || 'https://auth.uber.com/oauth/v2/token',
    apiBaseUrl: process.env.UBER_API_BASE_URL || 'https://test-api.uber.com',
    storeId: process.env.UBER_STORE_ID || '',
    storeName: process.env.UBER_STORE_NAME || '',
    menuPath: process.env.UBER_MENU_PATH || '',
    // Scopes solicitados al obtener el token client_credentials.
    // Incluye los de tienda (eats.store / eats.store.status.write) para poner la tienda online.
    scopes:
      process.env.UBER_SCOPES ||
      'eats.order eats.store.orders.read eats.store eats.store.status.write',
    // Poner la tienda ONLINE automáticamente al arrancar el servidor
    setOnlineOnStartup: process.env.UBER_SET_ONLINE_ON_STARTUP !== 'false',
    // Rechazar automáticamente órdenes que no se pueden cumplir (sin items/PLU) en lugar de dejarlas vencer
    autoDenyUnfulfillable: process.env.UBER_AUTO_DENY_UNFULFILLABLE === 'true',
  },

  // Sistemas Sierra
  sierra: {
    apiUrl: process.env.SIERRA_API_URL || 'https://demo-services-alternative.sierraerp.com',
    apiKey: process.env.SIERRA_API_KEY || '',
    // Valores por defecto aplicados al OrderTicket que se envía a Sierra al aceptar una orden.
    order: {
      // Tipo de orden según origen (catálogo de Sierra). Para Uber Eats: "ORDEN WEB ONLINE".
      type: process.env.SIERRA_ORDER_TYPE || 'ORDEN WEB ONLINE',
      // Tipo de venta: clave NUMÉRICA del catálogo de tipos de venta de Sierra (GET /api/v1/tables/salestype).
      salesType: process.env.SIERRA_ORDER_SALES_TYPE || '1',
      // Estado de apertura: "0" cierra automáticamente, "1" el cliente debe cerrar la cuenta.
      openStatus: process.env.SIERRA_ORDER_OPEN_STATUS || '0',
      // Mesero/empleado al que se asigna la orden (clave de empleado).
      server: process.env.SIERRA_ORDER_SERVER || '',
      // Cajero (opcional).
      cashier: process.env.SIERRA_ORDER_CASHIER || '',
      // Enviar productos a cocina(s)/barra(s).
      routeProducts: process.env.SIERRA_ORDER_ROUTE_PRODUCTS !== 'false',
      // Marca la orden como producción (true) o demo/pruebas (false).
      production: process.env.SIERRA_ORDER_PRODUCTION === 'true',
      // Etiqueta del método de pago a mostrar en el PDV.
      paymentLabel: process.env.SIERRA_ORDER_PAYMENT_LABEL || 'Uber Eats',
      // PLU fijo del método de pago usado para registrar el pago de la orden en Sierra.
      paymentPlu: process.env.SIERRA_ORDER_PAYMENT_PLU || '99103',
    },
  },

  // Webhook
  webhook: {
    signatureSecret: process.env.WEBHOOK_SIGNATURE_SECRET || 'default-secret',
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

/**
 * Valida que las variables de entorno requeridas estén presentes
 */
export function validateConfig(): void {
  const requiredVars = [
    'UBER_CLIENT_ID',
    'UBER_CLIENT_SECRET',
    'SIERRA_API_URL',
    'SIERRA_API_KEY',
  ];

  const missing = requiredVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Variables de entorno faltantes: ${missing.join(', ')}. Copia .env.example a .env y llena los valores.`
    );
  }
}
