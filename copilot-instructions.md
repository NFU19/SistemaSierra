# Middleware Uber Eats ↔ Sistemas Sierra - Instrucciones de Copilot

## 🎯 Contexto del Proyecto

Este es un middleware Node.js + TypeScript + Express que integra Uber Eats con un sistema POS llamado Sistemas Sierra. 

**Objetivo:** Facilitar el flujo automatizado de recepción de órdenes desde Uber Eats hacia Sierra POS.

## 📋 Stack Tecnológico

- **Runtime:** Node.js 16+
- **Lenguaje:** TypeScript (strict mode)
- **Framework:** Express.js
- **Autenticación:** OAuth2 (Uber), API Key (Sierra)
- **HTTP Client:** Axios
- **Environment:** dotenv

## 🏗️ Arquitectura General

```
Webhook (Uber) 
    ↓
  Controller 
    ↓
  Webhook Processor 
    ├─→ Auth Service (OAuth2)
    ├─→ Order Service (Fetch details)
    ├─→ Mapper Service (Transform)
    ├─→ Sierra Service (POST order)
    └─→ Logger
    ↓
  Sierra POS
```

## 📁 Estructura de Carpetas

```
src/
├── config/          # Configuración centralizada
├── controllers/     # Controladores HTTP
├── interfaces/      # Tipos TypeScript
├── routes/          # Definición de rutas
├── services/        # Lógica de negocio
└── utils/           # Utilidades (logging, etc.)

dist/               # Código compilado (generado)
tests/              # Pruebas automáticas
```

## 🔐 Credenciales Configuradas

Todas las credenciales están en `.env`:
- UBER_CLIENT_ID: sYOHLc-1Pxx7911FDp63a5ML_gV8gLpj
- UBER_CLIENT_SECRET: HKnI6_m5WldhMMaCmFVJoVjHW5enjCoKP0jFCtKb
- SIERRA_API_URL: https://demo-services-alternative.sierraerp.com
- SIERRA_API_KEY: CxzKRteOXeAr5fpa1D2wOm4tlMs64Jsz6wPoYQye8Kdz6sgZ9r0w9JOh3JbJZmlV

## 🔌 Endpoints Principales

| Método | Ruta | Controlador |
|--------|------|-------------|
| POST | /webhook/uber/orders | UberWebhookController.handleOrderWebhook |
| GET | /webhook/uber/health | UberWebhookController.healthCheck |
| GET | /api/v1/intro | index.ts |
| GET | /health | index.ts |

## 🛠️ Servicios Principales

### UberAuthService (`services/uber-auth.service.ts`)
- Obtiene tokens OAuth2 de Uber
- Cachea tokens hasta expiración
- Responsable: autenticación con Uber

### UberOrderService (`services/uber-order.service.ts`)
- Fetch de detalles de órdenes desde Uber API
- Responsable: obtener datos de Uber

### OrderMapperService (`services/order-mapper.service.ts`)
- Traduce UberOrderDetails → OrderTicket Sierra
- Maneja mapeo de items, precios, observaciones
- Responsable: transformación de datos

### SierraIntegrationService (`services/sierra-integration.service.ts`)
- POST a /api/v1/orders de Sierra
- Autenticación con X-Api-Key
- Responsable: comunicación con Sierra

### WebhookProcessingService (`services/webhook-processing.service.ts`)
- Orquesta el flujo completo
- Responsable: coordinación del procesamiento

## 📝 Pautas de Código

1. **TypeScript Strict:** Todo tiene tipos explícitos
2. **Modularidad:** Cada servicio tiene una responsabilidad clara
3. **Logging:** Usar `logger.info()`, `logger.debug()`, `logger.error()`
4. **Nombres:** 
   - Clases: PascalCase (UberAuthService)
   - Funciones: camelCase (handleOrderWebhook)
   - Constantes: UPPER_SNAKE_CASE (MAX_RETRIES)
5. **Variables sin usar:** Prefijo `_` (ej: `_req`)

## 🚀 Comandos Rápidos

```bash
npm run dev          # Desarrollo (hot reload)
npm run build        # Compilar TypeScript
npm start            # Producción
npm run watch        # Compilar en modo watch
```

## 🧪 Testing

```bash
# Pruebas de integración
npx ts-node tests/integration-test.ts

# Health check manual
curl http://localhost:3000/webhook/uber/health
```

## 🔍 Debugging

1. Editar `.env` con `LOG_LEVEL=debug` para logs detallados
2. Ver logs en consola al ejecutar `npm run dev`
3. Usar VS Code debugger con breakpoints en `src/`

## 📚 Documentación

- **README.md** - Documentación completa
- **QUICK_START.md** - Inicio rápido (5 min)
- **DEVELOPMENT.md** - Guía de desarrollo
- **PROJECT_STRUCTURE.md** - Estructura visual
- **.env.example** - Template de variables

## 🎯 Próximos Pasos (Fase 2)

1. **Mapeo de PLUs:** Implementar tabla de mapeo Uber ↔ Sierra
2. **Validación de Firma:** HMAC-SHA256 para webhooks
3. **Reintentos:** Sistema con backoff exponencial
4. **Cola de Mensajes:** Redis/RabbitMQ para órdenes fallidas
5. **Tests:** Unit tests + coverage
6. **Monitoreo:** Alertas y métricas

## ⚠️ Cosas Importantes

1. **OAuth2 Tokens:** Se cachean automáticamente, renovación en 3540s
2. **Procesamiento:** Fire-and-forget (200 OK inmediato)
3. **Logging:** Incluir timestamps y contexto siempre
4. **Errores:** Siempre documentar el error y el contexto
5. **Variables de Entorno:** Validadas al iniciar (validateConfig)

## 🆘 Troubleshooting

### Error: "Variables de entorno faltantes"
→ Verifica `.env` tiene todos los valores

### Error: "Token OAuth2 expirado"
→ Sistema reinicia automáticamente, sin acción requerida

### Error: "No se puede conectar a Sierra"
→ Verifica SIERRA_API_URL y SIERRA_API_KEY en `.env`

## 💡 Tips de Desarrollo

- Usar `logger.debug()` generosamente para debugging
- Crear interfaces para todos los DTOs
- Mantener servicios pequeños y enfocados
- Documentar funciones complejas
- Testear cambios antes de commit

## 📞 Contacto / Referencias

- Sistemas Sierra: https://www.sierra.com.mx
- Contact: Ing. Roberto E Gaxiola V.
- Email: robertogaxiola@sierra.com.mx

---

**Última actualización:** 2024-01-02  
**Versión:** 1.0.0  
**Estado:** ✅ Fase 1 Completada
