/**
 * Configuración centralizada de variables de entorno
 */

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Uber Eats OAuth2
  uber: {
    clientId: process.env.UBER_CLIENT_ID || '',
    clientSecret: process.env.UBER_CLIENT_SECRET || '',
    authUrl: process.env.UBER_AUTH_URL || 'https://auth.uber.com/oauth/v2/token',
  },

  // Sistemas Sierra
  sierra: {
    apiUrl: process.env.SIERRA_API_URL || 'https://demo-services-alternative.sierraerp.com',
    apiKey: process.env.SIERRA_API_KEY || '',
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
