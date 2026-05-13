# Middleware de Integración: Uber Eats ↔ Sistemas Sierra POS

Middleware profesional en Node.js + TypeScript + Express que integra la API de Uber Eats con un sistema de Punto de Venta (POS) llamado **Sistemas Sierra**.

## 🎯 Objetivo

Facilitar el flujo completamente automatizado de recepción de órdenes desde Uber Eats hacia el sistema POS Sierra, validando, mapeando y encolando las órdenes de forma segura y confiable.

## 📋 Flujo de Operación

```
┌─────────────────┐
│  Uber Eats App  │
└────────┬────────┘
         │ (order.created webhook)
         ▼
┌──────────────────────────┐
│ Middleware Webhook Endpoint│
│ POST /webhook/uber/orders │
└────────┬─────────────────┘
         │ (200 OK inmediato)
         ▼
┌──────────────────────────────────────┐
│ Procesamiento en Segundo Plano       │
├──────────────────────────────────────┤
│ 1. Obtener token OAuth2 Uber         │
│ 2. Fetch detalles de orden (Uber API)│
│ 3. Mapear a formato OrderTicket      │
│ 4. POST a Sierra (/api/v1/orders)    │
│ 5. Logging y manejo de errores       │
└──────────────────────────────────────┘
         │
         ▼
   ✓ Sierra POS integrado
```

## 📦 Estructura del Proyecto

```
src/
├── index.ts                          # Punto de entrada, configuración Express
├── config/
│   └── config.ts                     # Configuración centralizada (env variables)
├── interfaces/
│   ├── uber.interface.ts             # Tipos para payloads de Uber
│   └── sierra.interface.ts           # Tipos para payloads de Sierra
├── services/
│   ├── uber-auth.service.ts          # OAuth2 y obtención de tokens Uber
│   ├── uber-order.service.ts         # Obtención de detalles de órdenes
│   ├── order-mapper.service.ts       # Mapeo Uber → Sierra
│   ├── sierra-integration.service.ts # Integración con API Sierra
│   └── webhook-processing.service.ts # Orquestación del flujo
├── controllers/
│   └── uber-webhook.controller.ts    # Controlador HTTP del webhook
├── routes/
│   └── webhook.routes.ts             # Definición de rutas
└── utils/
    └── logger.ts                     # Sistema de logging centralizado
```

## 🚀 Instalación

### Requisitos Previos
- Node.js 16+ 
- npm o yarn
- Las credenciales de Uber Eats y Sistemas Sierra

### Pasos

1. **Clonar/Descargar el repositorio**
   ```bash
   cd SistemaSierra
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**
   ```bash
   # Copiar el archivo de ejemplo
   cp .env.example .env
   
   # Editar .env con tus credenciales reales
   ```

4. **Compilar TypeScript**
   ```bash
   npm run build
   ```

5. **Iniciar el servidor**
   - **Desarrollo** (con reinicio automático):
     ```bash
     npm run dev
     ```
   
   - **Producción**:
     ```bash
     npm run build
     npm start
     ```

## 🔌 API Endpoints

### Webhook de Uber Eats

**POST** `/webhook/uber/orders`

Recibe webhooks de Uber Eats cuando ocurren eventos de órdenes.

**Payload Esperado:**
```json
{
  "event_id": "evt_12345",
  "timestamp": 1704067200,
  "event_type": "order.created",
  "data": {
    "order_id": "order_abc123",
    "store_id": "store_xyz",
    "timestamp": 1704067200,
    "platform": "eats"
  }
}
```

**Respuesta (200 OK - Inmediata):**
```json
{
  "success": true,
  "message": "Webhook recibido y en procesamiento",
  "eventId": "evt_12345"
}
```

### Health Check

**GET** `/webhook/uber/health`

Verifica el estado del middleware y la conectividad con Sistemas Sierra.

**Respuesta:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-01-02T10:30:45.123Z",
  "services": {
    "sierra": "ok"
  }
}
```

### Intro

**GET** `/api/v1/intro`

Información sobre el middleware.

## 🔐 Variables de Entorno

```bash
# Server
PORT=3000
NODE_ENV=development|production

# Uber Eats OAuth2
UBER_CLIENT_ID=tu_client_id
UBER_CLIENT_SECRET=tu_client_secret
UBER_AUTH_URL=https://auth.uber.com/oauth/v2/token

# Sistemas Sierra
SIERRA_API_URL=https://demo-services-alternative.sierraerp.com
SIERRA_API_KEY=tu_api_key

# Webhook
WEBHOOK_SIGNATURE_SECRET=your-secret-key

# Logging
LOG_LEVEL=debug|info|warn|error
```

## 🔄 Flujo Detallado de Procesamiento

### 1. Recepción del Webhook
- Express recibe el POST en `/webhook/uber/orders`
- Se valida que el payload sea estructuralmente válido
- Se retorna 200 OK inmediatamente a Uber
- El procesamiento continúa en segundo plano

### 2. Autenticación OAuth2 con Uber
- `UberAuthService` solicita un token usando Client Credentials Flow
- Los tokens se cachean en memoria y se reutilizan hasta su expiración
- Si el token expira, se solicita uno nuevo automáticamente

### 3. Obtención de Detalles de Orden
- `UberOrderService` hace un GET a `/v2/orders/{orderId}` en Uber
- Obtiene información completa: items, cliente, totales, etc.
- Si falla (401), invalida el caché de tokens y reintentar

### 4. Mapeo a Formato Sierra
- `OrderMapperService` convierte la orden de Uber a `OrderTicket`
- Mapea items (PLUs), precios, impuestos, etc.
- Construye observaciones con instrucciones especiales y datos del cliente
- **Nota**: El mapeo de PLUs entre catálogos es un placeholder que debe implementarse

### 5. Integración con Sierra
- `SierraIntegrationService` hace un POST a `/api/v1/orders`
- Incluye el header `X-Api-Key` para autenticación
- Maneja errores específicos (400, 401, 403, 500, etc.)

### 6. Logging y Auditoría
- Cada paso es registrado con niveles INFO, DEBUG, ERROR
- Tiempos de procesamiento se incluyen en los logs
- Errores incluyen stack traces y detalles contextuales

## 📊 Esquema de Datos

### OrderTicket (Salida hacia Sierra)
```typescript
{
  order: string;              // ID único de Uber
  subTotal: number;           // Subtotal en pesos
  tax: number;                // Impuestos
  orderType: string;          // "ORDEN WEB ONLINE"
  plus: PluOrder[];           // Array de productos
  observation?: string;       // Instrucciones especiales
  salesType?: string;         // "DELIVERY"
  tableNumber?: number;       // Opcional
  employeeNumber?: number;    // Opcional (0 = automático)
}
```

### PluOrder
```typescript
{
  plu: string;                // Código de producto en Sierra
  quantity: number;           // Cantidad
  unitPrice: number;          // Precio unitario
  subTotal: number;           // Subtotal del item
  tax: number;                // Impuestos (0 a nivel de item)
  customizations?: string;    // Personalizaciones
}
```

## ⚠️ Consideraciones Importantes

### 1. Mapeo de PLUs
Actualmente, el middleware usa los IDs de Uber directamente como PLUs en Sierra. 
**Debe implementarse** una tabla de mapeo (base de datos) que relacione:
- `uber_item_id` → `sierra_plu_code`

### 2. Validación de Firma de Webhook
La función `validateWebhookSignature()` es actualmente un placeholder.
**Debe implementarse** validación HMAC-SHA256 con `WEBHOOK_SIGNATURE_SECRET`.

### 3. Manejo de Errores de Sierra
Si Sierra retorna un error 400 (validación):
- La orden se registra en logs
- Debe implementarse un sistema de reintentos con backoff exponencial
- Considerar una cola de mensajes (Redis, RabbitMQ) para orders fallidas

### 4. Concurrencia
El middleware puede procesar múltiples webhooks simultáneamente.
- Cada orden se procesa de forma independiente
- No hay sincronización de estado compartido

## 🧪 Testing Manual

### 1. Verificar la API Sierra primero
```bash
curl -X GET "https://demo-services-alternative.sierraerp.com/api/v1/maintenance/version" \
  -H "X-Api-Key: CxzKRteOXeAr5fpa1D2wOm4tlMs64Jsz6wPoYQye8Kdz6sgZ9r0w9JOh3JbJZmlV"
```

### 2. Simular webhook de Uber
```bash
curl -X POST "http://localhost:3000/webhook/uber/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_test_001",
    "timestamp": '$(date +%s)',
    "event_type": "order.created",
    "data": {
      "order_id": "test_order_001",
      "store_id": "store_123",
      "timestamp": '$(date +%s)',
      "platform": "eats"
    }
  }'
```

### 3. Verificar Health Check
```bash
curl -X GET "http://localhost:3000/webhook/uber/health"
```

## 📝 Logs

Los logs se generan en consola con formato:
```
[2024-01-02T10:30:45.123Z] [INFO] Mensaje de log
[2024-01-02T10:30:46.456Z] [DEBUG] Detalles adicionales
[2024-01-02T10:30:47.789Z] [ERROR] Error crítico
```

Niveles disponibles:
- `DEBUG`: Información detallada de desarrollo
- `INFO`: Eventos importantes
- `WARN`: Advertencias
- `ERROR`: Errores críticos

Controla el nivel con `LOG_LEVEL` en `.env`

## 🚨 Troubleshooting

### Error: "Variables de entorno faltantes"
- Verifica que `.env` existe y tiene todos los valores requeridos
- Compara con `.env.example`

### Error: "Fallo en la autenticación con Uber Eats"
- Verifica que `UBER_CLIENT_ID` y `UBER_CLIENT_SECRET` son correctos
- Comprueba la conectividad a `https://auth.uber.com`

### Error: "No se pudieron obtener los detalles de la orden"
- Verifica que el token OAuth2 sea válido
- Revisa los logs para ver el error exacto de Uber

### Error: "Error de autenticación/autorización en Sierra"
- Verifica que `SIERRA_API_KEY` es correcto
- Comprueba que la API Key tiene permisos de creación de órdenes

## 🔗 Referencias Útiles

- [Uber Eats Partner API Documentation](https://developer.uber.com/docs/eats)
- [Sistemas Sierra API Documentation](https://demo-services-alternative.sierraerp.com)
- [Express.js Guide](https://expressjs.com)
- [TypeScript Documentation](https://www.typescriptlang.org)

## 📄 Licencia

Apache 2.0 License

## 👨‍💻 Autor

Ing. Roberto E Gaxiola V.  
Sistemas Sierra - Integration Development  
[www.sierra.com.mx](https://www.sierra.com.mx)

---

**Última actualización:** 2024-01-02  
**Versión:** 1.0.0
