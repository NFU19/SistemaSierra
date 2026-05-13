SistemaSierra/
├── src/
│   ├── index.ts                           # ⭐ Punto de entrada - Servidor Express
│   │
│   ├── config/
│   │   └── config.ts                      # 🔧 Configuración centralizada (env variables)
│   │
│   ├── interfaces/                        # 📋 Tipos TypeScript
│   │   ├── uber.interface.ts              # Tipos: UberWebhookPayload, UberOrderDetails, etc.
│   │   └── sierra.interface.ts            # Tipos: OrderTicket, PluOrder, SierraApiResponse, etc.
│   │
│   ├── services/                          # 🛠️ Lógica de negocio
│   │   ├── uber-auth.service.ts           # OAuth2: obtención y caché de tokens Uber
│   │   ├── uber-order.service.ts          # Obtención de detalles de órdenes desde Uber API
│   │   ├── order-mapper.service.ts        # Mapeo: Uber OrderDetails → Sierra OrderTicket
│   │   ├── sierra-integration.service.ts  # Integración: POST a /api/v1/orders de Sierra
│   │   └── webhook-processing.service.ts  # Orquestación: flujo completo de procesamiento
│   │
│   ├── controllers/                       # 🎮 Controladores HTTP
│   │   └── uber-webhook.controller.ts     # Manejo de webhooks POST y health checks GET
│   │
│   ├── routes/                            # 🛣️ Definición de rutas
│   │   └── webhook.routes.ts              # Routes: POST /webhook/uber/orders, GET /webhook/uber/health
│   │
│   └── utils/                             # 🔨 Utilidades
│       └── logger.ts                      # Sistema de logging centralizado (DEBUG, INFO, WARN, ERROR)
│
├── dist/                                  # 📦 Código compilado (generado por npm run build)
│   ├── index.js
│   ├── config/
│   │   └── config.js
│   ├── interfaces/
│   │   ├── uber.interface.js
│   │   └── sierra.interface.js
│   ├── services/
│   │   ├── uber-auth.service.js
│   │   ├── uber-order.service.js
│   │   ├── order-mapper.service.js
│   │   ├── sierra-integration.service.js
│   │   └── webhook-processing.service.js
│   ├── controllers/
│   │   └── uber-webhook.controller.js
│   ├── routes/
│   │   └── webhook.routes.js
│   └── utils/
│       └── logger.js
│
├── tests/
│   └── integration-test.ts                # 🧪 Suite de pruebas automáticas
│
├── .env                                   # 🔐 Variables de entorno (con valores reales)
├── .env.example                           # 📝 Template de variables de entorno
├── .gitignore                             # 📦 Archivos ignorados por Git
│
├── package.json                           # 📋 Dependencias y scripts npm
├── tsconfig.json                          # ⚙️ Configuración TypeScript (strict mode)
│
├── README.md                              # 📖 Documentación completa
├── QUICK_START.md                         # 🚀 Guía de inicio rápido (5 minutos)
├── DEVELOPMENT.md                         # 👨‍💻 Guía de desarrollo y debugging
│
└── PROJECT_STRUCTURE.md                   # 📁 Este archivo


═══════════════════════════════════════════════════════════════════════════════

🔄 FLUJO DE PROCESOS:

┌─────────────────────────────────────────────────────────────────────────────┐
│                      RECEPCIÓN DE WEBHOOK UBER                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Uber Eats App → POST /webhook/uber/orders                               │
│                                                                              │
│  2. UberWebhookController.handleOrderWebhook()                              │
│     - Valida estructura del payload                                         │
│     - Retorna 200 OK inmediatamente ✓                                       │
│     - Inicia procesamiento asincrónico                                      │
│                                                                              │
│  3. WebhookProcessingService.processWebhookAsync()                          │
│     a) UberAuthService.getAccessToken()                                     │
│        → OAuth2 Client Credentials Flow                                     │
│        → Tokens cacheados (expire en 3600s - 60s = 3540s)                   │
│                                                                              │
│     b) UberOrderService.getOrderDetails(orderId)                            │
│        → GET /v2/orders/{orderId} en Uber API                               │
│        → Obtiene: items, cliente, totales, instrucciones especiales         │
│                                                                              │
│     c) OrderMapperService.mapUberOrderToSierraTicket()                      │
│        → Transforma UberOrderDetails → OrderTicket                          │
│        → Mapea items (PLUs), precios, impuestos                             │
│        → Construye observaciones con datos del cliente                      │
│                                                                              │
│     d) SierraIntegrationService.createOrder()                               │
│        → POST /api/v1/orders en Sierra API                                  │
│        → Headers: X-Api-Key, Content-Type: application/json                 │
│        → Retorna: OrderId, Folio, Status                                    │
│                                                                              │
│  4. Logger registra:                                                        │
│     - Timestamps ISO 8601                                                   │
│     - Tiempo total de procesamiento                                         │
│     - Detalles de cada paso                                                 │
│     - Errores si ocurren                                                    │
│                                                                              │
│  ✓ Orden completada en Sierra POS                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════

📊 INTERFACES Y DATOS:

ENTRADA (Uber Webhook):
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

SALIDA (Sierra OrderTicket):
{
  "order": "order_abc123",
  "subTotal": 500.50,
  "tax": 50.05,
  "orderType": "ORDEN WEB ONLINE",
  "plus": [
    {
      "plu": "item_001",
      "quantity": 2,
      "unitPrice": 200.00,
      "subTotal": 400.00,
      "tax": 0,
      "customizations": "Sin cebolla, con extra queso"
    }
  ],
  "observation": "Instrucciones especiales: ... | Cliente: Juan Pérez | Teléfono: ...",
  "salesType": "DELIVERY",
  "employeeNumber": 0
}


═══════════════════════════════════════════════════════════════════════════════

🔌 ENDPOINTS DISPONIBLES:

GET /api/v1/intro
  Información del middleware

GET /health
  Health check general

GET /webhook/uber/health
  Estado del middleware + conectividad con Sierra

POST /webhook/uber/orders
  Recibe webhooks de Uber Eats
  Request Body: UberWebhookPayload
  Response: { success: true, message: "...", eventId: "..." }


═══════════════════════════════════════════════════════════════════════════════

🎯 SERVICIOS Y RESPONSABILIDADES:

UberAuthService
  - Obtiene tokens OAuth2 de Uber
  - Cachea tokens hasta su expiración
  - Reinvoca obtención si token expira

UberOrderService
  - Obtiene detalles completos de órdenes
  - Maneja errores de autenticación
  - Placeholder para mapeo de items

OrderMapperService
  - Traduce orden Uber → OrderTicket Sierra
  - Calcula totales y redondeos
  - Construye observaciones

SierraIntegrationService
  - Comunica con API de Sierra
  - Autenticación con X-Api-Key
  - Manejo específico de errores HTTP
  - Health check de conectividad

WebhookProcessingService
  - Orquesta el flujo completo
  - Validación de firma (placeholder)
  - Procesamiento asincrónico


═══════════════════════════════════════════════════════════════════════════════

🚀 COMANDOS PRINCIPALES:

npm install             # Instalar dependencias
npm run build          # Compilar TypeScript → JavaScript
npm run dev            # Iniciar servidor (hot reload)
npm start              # Ejecutar en producción
npm run watch          # Compilar en modo watch


═══════════════════════════════════════════════════════════════════════════════

✨ CARACTERÍSTICAS:

✓ Tipado estricto con TypeScript
✓ Arquitectura modular y mantenible
✓ OAuth2 con caché de tokens
✓ Logging centralizado (DEBUG, INFO, WARN, ERROR)
✓ Manejo robusto de errores
✓ Procesamiento asincrónico (no bloquea respuesta)
✓ Validación de payloads
✓ Interceptores para debugging
✓ Variables de entorno centralizadas
✓ Health checks
✓ Documentación completa

🎯 TODO/ROADMAP:

[ ] Mapeo real de PLUs (base de datos)
[ ] Validación de firma HMAC
[ ] Sistema de reintentos con backoff
[ ] Cola de mensajes (Redis/RabbitMQ)
[ ] Unit tests y coverage
[ ] Performance monitoring
[ ] Rate limiting
[ ] Caching de catálogos
[ ] Sincronización de ordenes rechazadas

