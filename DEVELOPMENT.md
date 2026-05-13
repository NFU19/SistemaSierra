# Guía de Desarrollo

## 🚀 Iniciando el Servidor

### Modo Desarrollo (con Hot Reload)

```bash
npm run dev
```

Esto ejecutará `ts-node` que compila TypeScript al vuelo y reinicia automáticamente cuando cambias archivos.

**Output esperado:**
```
[2024-01-02T10:30:45.123Z] [INFO] ✓ Servidor iniciado en puerto 3000
[2024-01-02T10:30:45.124Z] [INFO] ✓ Ambiente: development
[2024-01-02T10:30:45.125Z] [INFO] ✓ Base URL Sierra: https://demo-services-alternative.sierraerp.com
[2024-01-02T10:30:45.126Z] [INFO] ✓ Health check: http://localhost:3000/health
[2024-01-02T10:30:45.127Z] [INFO] ✓ Intro: http://localhost:3000/api/v1/intro
```

### Modo Producción

```bash
npm run build  # Compilar
npm start      # Ejecutar
```

## 🧪 Testing del Webhook

### 1. Health Check Rápido

```bash
curl http://localhost:3000/webhook/uber/health
```

### 2. Simular Webhook de Uber (Bash/Git Bash)

```bash
curl -X POST http://localhost:3000/webhook/uber/orders \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_test_123",
    "timestamp": 1704067200,
    "event_type": "order.created",
    "data": {
      "order_id": "order_abc123",
      "store_id": "store_xyz",
      "timestamp": 1704067200,
      "platform": "eats"
    }
  }'
```

### 2b. Simular Webhook de Uber (PowerShell)

```powershell
$body = @{
    event_id = "evt_test_456"
    timestamp = [int][double]::Parse((Get-Date -UFormat %s))
    event_type = "order.created"
    data = @{
        order_id = "order_xyz789"
        store_id = "store_abc"
        timestamp = [int][double]::Parse((Get-Date -UFormat %s))
        platform = "eats"
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/webhook/uber/orders" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

## 📊 Ver Logs en Detalle

El servicio de logging registra eventos con diferentes niveles. Para ver todos los detalles:

1. Asegúrate de que `.env` tiene `LOG_LEVEL=debug`
2. Ejecuta el servidor: `npm run dev`
3. Realiza una acción (por ejemplo, simular un webhook)
4. Los logs aparecerán en la consola con timestamps y contexto

### Ejemplo de Log Output

```
[2024-01-02T10:31:00.123Z] [DEBUG] Webhook recibido de Uber {
  headers: {
    host: 'localhost:3000',
    'user-agent': 'curl/7.85.0',
    'content-type': 'application/json'
  },
  body: { event_id: 'evt_test_123', ... }
}

[2024-01-02T10:31:00.124Z] [INFO] Webhook evt_test_123 aceptado, procesando en segundo plano

[2024-01-02T10:31:00.125Z] [INFO] Iniciando procesamiento de orden Uber: order_abc123

[2024-01-02T10:31:00.126Z] [DEBUG] Paso 1: Obteniendo detalles de orden de Uber...

[2024-01-02T10:31:00.500Z] [INFO] Solicitando nuevo token OAuth2 a Uber Eats...

[2024-01-02T10:31:01.234Z] [INFO] Token OAuth2 obtenido exitosamente {
  expiresIn: 3600
}

[2024-01-02T10:31:01.235Z] [DEBUG] [Sierra API] GET /api/v2/orders/order_abc123

[2024-01-02T10:31:01.500Z] [DEBUG] Detalles de orden obtenidos {
  orderId: 'order_abc123',
  status: 'accepted',
  itemsCount: 3
}

[2024-01-02T10:31:01.501Z] [DEBUG] Paso 2: Mapeando orden a formato Sierra...

[2024-01-02T10:31:01.502Z] [INFO] Mapeando orden de Uber order_abc123 a formato Sierra

[2024-01-02T10:31:01.503Z] [DEBUG] Orden mapeada exitosamente {
  orderId: 'order_abc123',
  itemsCount: 3,
  total: 500.50
}

[2024-01-02T10:31:01.504Z] [DEBUG] Paso 3: Creando orden en Sierra...

[2024-01-02T10:31:01.505Z] [INFO] Creando orden en Sierra: order_abc123

[2024-01-02T10:31:01.506Z] [DEBUG] [Sierra API] POST /api/v1/orders

[2024-01-02T10:31:02.234Z] [DEBUG] [Sierra API] Response 200 {
  url: '/api/v1/orders',
  dataSize: 287
}

[2024-01-02T10:31:02.235Z] [INFO] Orden creada exitosamente en Sierra {
  orderId: 'order_abc123',
  sierraResponse: { success: true, data: { folio: 12345, ... } },
  processingTime: 2112
}

[2024-01-02T10:31:02.236Z] [INFO] Orden procesada exitosamente en 2112ms {
  uberOrderId: 'order_abc123',
  sierraOrderId: 'folio_12345',
  processingTime: 2112
}
```

## 🔍 Debugging

### Habilitar Debug Detallado

Edita `.env`:
```
LOG_LEVEL=debug
NODE_ENV=development
```

### Breakpoints en VS Code

1. Abre la paleta de comandos: `Ctrl+Shift+D`
2. Click en "Create a launch.json file"
3. Selecciona "Node.js"
4. Modifica la configuración:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Program",
      "program": "${workspaceFolder}/src/index.ts",
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "runtimeArgs": ["-r", "ts-node/register"]
    }
  ]
}
```

4. Presiona `F5` para iniciar el debugger
5. Establece breakpoints en el editor (click en el margen izquierdo)

## 📦 Estructura de Scripts npm

```json
{
  "dev": "ts-node src/index.ts",      // Desarrollo con hot reload
  "build": "tsc",                      // Compilar TypeScript
  "start": "node dist/index.js",       // Ejecutar código compilado
  "watch": "tsc --watch"               // Compilar en modo watch
}
```

## 🛠️ Herramientas Recomendadas

### Postman
Importa esta colección para testear fácilmente:

```json
{
  "info": {
    "name": "Sierra Uber Eats Middleware",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Health Check",
      "request": {
        "method": "GET",
        "url": "http://localhost:3000/webhook/uber/health"
      }
    },
    {
      "name": "Test Webhook",
      "request": {
        "method": "POST",
        "url": "http://localhost:3000/webhook/uber/orders",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\"event_id\":\"evt_test_123\",\"timestamp\":1704067200,\"event_type\":\"order.created\",\"data\":{\"order_id\":\"order_abc123\",\"store_id\":\"store_xyz\",\"timestamp\":1704067200,\"platform\":\"eats\"}}"
        }
      }
    }
  ]
}
```

## 🚨 Common Issues

### Issue: "Module not found: axios"
```bash
npm install
```

### Issue: "Cannot find module 'dotenv'"
```bash
npm install dotenv
```

### Issue: TypeScript compilation errors
```bash
npm run build
# Revisar los errores reportados
```

### Issue: Puerto 3000 ya está en uso
```bash
# Cambiar puerto en .env
PORT=3001
```

## 📝 Convenciones de Código

- **Nombres de variables**: camelCase
- **Nombres de clases**: PascalCase
- **Nombres de constantes**: UPPER_SNAKE_CASE
- **Métodos privados**: prefijo `private`
- **Métodos sin usar parámetros**: prefijo con `_` (ej: `_req`)

Ejemplo:
```typescript
class UberOrderService {
  private readonly logger = logger;
  private readonly MAX_RETRIES = 3;
  
  async getOrderDetails(orderId: string): Promise<UberOrderDetails> {
    // implementación
  }
  
  private mapUberItemToSierraPlu(_itemId: string): string {
    // implementación
  }
}
```

---

**¡Listo para desarrollar! 🎉**
