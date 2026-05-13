# 🚀 Inicio Rápido - Sierra Uber Eats Middleware

## En 5 Minutos

### 1. Instalar Dependencias
```bash
npm install
```

### 2. Compilar el Proyecto
```bash
npm run build
```

### 3. Iniciar el Servidor (Desarrollo)
```bash
npm run dev
```

Deberías ver:
```
[2024-01-02T10:30:45.123Z] [INFO] ✓ Servidor iniciado en puerto 3000
```

### 4. Verificar que Funciona
```bash
curl http://localhost:3000/webhook/uber/health
```

Respuesta esperada:
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

## Estructura del Proyecto

```
src/
├── index.ts                              # Servidor Express
├── config/config.ts                      # Configuración (variables de entorno)
├── interfaces/
│   ├── uber.interface.ts                 # Tipos de Uber
│   └── sierra.interface.ts               # Tipos de Sierra
├── services/
│   ├── uber-auth.service.ts              # OAuth2 Uber
│   ├── uber-order.service.ts             # Fetch órdenes Uber
│   ├── order-mapper.service.ts           # Mapeo Uber → Sierra
│   ├── sierra-integration.service.ts     # API Sierra
│   └── webhook-processing.service.ts     # Orquestación
├── controllers/
│   └── uber-webhook.controller.ts        # Controlador HTTP
├── routes/
│   └── webhook.routes.ts                 # Rutas
└── utils/logger.ts                       # Sistema de logging
```

## Endpoints Disponibles

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/v1/intro` | Información del middleware |
| `GET` | `/health` | Health check general |
| `GET` | `/webhook/uber/health` | Estado del middleware + Sierra |
| `POST` | `/webhook/uber/orders` | Recibe webhooks de Uber |

## Flujo de Procesamiento

```
Webhook POST → 200 OK (inmediato) → Procesa en background:
  1. Obtiene token OAuth2 Uber
  2. Fetch detalles de orden
  3. Mapea a OrderTicket
  4. POST a Sierra /api/v1/orders
  5. Logs y manejo de errores
```

## Variables de Entorno

| Variable | Valor Actual |
|----------|-------------|
| `PORT` | 3000 |
| `NODE_ENV` | development |
| `UBER_CLIENT_ID` | ✓ Configurado |
| `UBER_CLIENT_SECRET` | ✓ Configurado |
| `SIERRA_API_URL` | ✓ Configurado |
| `SIERRA_API_KEY` | ✓ Configurado |
| `LOG_LEVEL` | debug |

Ver `.env` para detalles completos.

## Comandos Útiles

```bash
# Desarrollo con hot reload
npm run dev

# Compilar TypeScript
npm run build

# Ejecutar en producción
npm start

# Ver logs detallados
# (el servidor ya muestra logs en la consola)

# Ejecutar pruebas de integración
npx ts-node tests/integration-test.ts
```

## Testing del Webhook

### PowerShell
```powershell
$body = @{
    event_id = "evt_test_123"
    timestamp = [int][double]::Parse((Get-Date -UFormat %s))
    event_type = "order.created"
    data = @{
        order_id = "order_abc123"
        store_id = "store_xyz"
        timestamp = [int][double]::Parse((Get-Date -UFormat %s))
        platform = "eats"
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/webhook/uber/orders" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

### Bash
```bash
curl -X POST http://localhost:3000/webhook/uber/orders \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_test_123",
    "timestamp": '$(date +%s)',
    "event_type": "order.created",
    "data": {
      "order_id": "order_abc123",
      "store_id": "store_xyz",
      "timestamp": '$(date +%s)',
      "platform": "eats"
    }
  }'
```

## Próximos Pasos

1. **Mapeo de PLUs**: Implementar tabla de mapeo entre catálogos Uber ↔ Sierra
2. **Validación de Firma**: Implementar HMAC-SHA256 para validar webhooks
3. **Reintentos**: Agregar cola de mensajes para órdenes fallidas
4. **Tests**: Implementar test suite completo
5. **Documentación**: Agregar diagramas de arquitectura

## 📚 Documentación Completa

- [README.md](./README.md) - Documentación completa
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Guía de desarrollo
- [.env.example](./.env.example) - Variables de entorno

## 🆘 Soporte

Si encuentras problemas:

1. **Revisa los logs**: `LOG_LEVEL=debug` en `.env`
2. **Verifica la conectividad**: `curl https://demo-services-alternative.sierraerp.com/api/v1/maintenance/version -H "X-Api-Key: ..."`
3. **Comprueba variables de entorno**: `echo $env:SIERRA_API_KEY` (PowerShell)

---

**¡Listo para integrar Uber Eats con tu POS! 🎉**
