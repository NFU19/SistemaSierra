/**
 * Controlador para la Interfaz de POS
 * Sirve la UI y maneja Server-Sent Events para actualizaciones en tiempo real
 */

import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { eventService } from '../services/event.service';

class POSController {
  /**
   * GET /pos
   * Sirve la página HTML del POS
   */
  getPOSInterface(_req: Request, res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(this.getHTMLInterface());
  }

  /**
   * GET /api/pos/stream
   * Server-Sent Events: stream de órdenes en tiempo real
   */
  streamOrders(_req: Request, res: Response): void {
    logger.info('Cliente conectado al stream de órdenes POS');

    // Headers para SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Enviar histórico de órdenes
    const history = eventService.getOrdersHistory();
    if (history.length > 0) {
      res.write(`data: ${JSON.stringify({ type: 'history', orders: history })}\n\n`);
    }

    // Listener para nuevas órdenes
    const orderListener = (order: any) => {
      res.write(`data: ${JSON.stringify({ type: 'order', order })}\n\n`);
    };

    eventService.on('order-processed', orderListener);

    // Cleanup al desconectar
    res.on('close', () => {
      logger.info('Cliente desconectado del stream de órdenes POS');
      eventService.removeListener('order-processed', orderListener);
      res.end();
    });

    // Keep-alive cada 30 segundos
    const keepAliveInterval = setInterval(() => {
      res.write(`:keep-alive ${new Date().toISOString()}\n\n`);
    }, 30000);

    res.on('close', () => {
      clearInterval(keepAliveInterval);
    });
  }

  /**
   * GET /api/pos/orders
   * Obtiene el historial de órdenes en JSON
   */
  getOrdersHistory(_req: Request, res: Response): void {
    const orders = eventService.getOrdersHistory();
    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  }

  /**
   * Genera el HTML de la interfaz del POS
   */
  private getHTMLInterface(): string {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>POS - Órdenes Uber Eats</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            padding: 20px;
            color: #333;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        header {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        header h1 {
            color: #2a5298;
            font-size: 28px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .status {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: bold;
        }

        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        .status-indicator.connected {
            background: #4CAF50;
        }

        .status-indicator.disconnected {
            background: #f44336;
            animation: none;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            margin-bottom: 20px;
        }

        .stat-card {
            background: white;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }

        .stat-card h3 {
            color: #666;
            font-size: 12px;
            text-transform: uppercase;
            margin-bottom: 10px;
        }

        .stat-card .number {
            font-size: 28px;
            font-weight: bold;
            color: #2a5298;
        }

        .orders-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
            gap: 15px;
        }

        .order-card {
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            animation: slideIn 0.4s ease;
        }

        @keyframes slideIn {
            from {
                transform: translateY(20px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        .order-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.15);
        }

        .order-header {
            padding: 15px;
            border-bottom: 2px solid #f5f5f5;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .order-id {
            font-weight: bold;
            font-size: 14px;
            color: #333;
        }

        .order-time {
            font-size: 12px;
            color: #999;
        }

        .order-status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
        }

        .order-status.success {
            background: #c8e6c9;
            color: #2e7d32;
        }

        .order-status.error {
            background: #ffcdd2;
            color: #c62828;
        }

        .order-status.processing {
            background: #fff9c4;
            color: #f57f17;
        }

        .order-body {
            padding: 15px;
        }

        .order-items {
            margin-bottom: 15px;
        }

        .order-items h4 {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 8px;
            border-bottom: 1px solid #eee;
            padding-bottom: 5px;
        }

        .item {
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            padding: 5px 0;
            color: #555;
        }

        .item-name {
            flex: 1;
        }

        .item-qty {
            color: #999;
            margin: 0 10px;
        }

        .item-price {
            font-weight: bold;
            color: #2a5298;
        }

        .order-totals {
            background: #f9f9f9;
            padding: 10px;
            border-radius: 5px;
            font-size: 13px;
        }

        .total-row {
            display: flex;
            justify-content: space-between;
            margin: 4px 0;
        }

        .total-row.subtotal {
            color: #666;
        }

        .total-row.tax {
            color: #666;
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
        }

        .total-row.total {
            font-weight: bold;
            color: #2a5298;
            font-size: 15px;
            padding-top: 5px;
        }

        .order-customer {
            background: #f0f7ff;
            padding: 10px;
            border-radius: 5px;
            margin-top: 10px;
            font-size: 12px;
        }

        .order-notes {
            margin-top: 10px;
            padding: 10px;
            background: #fffbf0;
            border-left: 3px solid #ff9800;
            border-radius: 3px;
            font-size: 12px;
            color: #666;
        }

        .error-detail {
            background: #ffebee;
            padding: 10px;
            border-left: 3px solid #f44336;
            border-radius: 3px;
            font-size: 12px;
            color: #c62828;
            word-break: break-word;
        }

        .empty-state {
            grid-column: 1 / -1;
            text-align: center;
            padding: 40px 20px;
            color: white;
        }

        .empty-state h2 {
            font-size: 24px;
            margin-bottom: 10px;
        }

        .empty-state p {
            font-size: 14px;
            opacity: 0.8;
        }

        /* ===== Vista detallada de orden ===== */
        .order-card.success { border-top: 4px solid #06C167; }
        .order-card.error { border-top: 4px solid #f44336; }
        .order-card.processing { border-top: 4px solid #f9a825; }

        .order-header-top {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
        }

        .uber-badge {
            background: #06C167;
            color: white;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 4px;
            letter-spacing: 0.5px;
        }

        .order-number {
            font-size: 18px;
            font-weight: 800;
            color: #111;
        }

        .order-uuid {
            font-size: 10px;
            color: #aaa;
            font-family: monospace;
            margin-top: 2px;
        }

        .item {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 10px 0;
            border-bottom: 1px solid #f2f2f2;
            gap: 10px;
        }
        .item:last-child { border-bottom: none; }

        .item-main { display: flex; align-items: flex-start; gap: 10px; flex: 1; }

        .item-qty-badge {
            background: #2a5298;
            color: white;
            font-weight: 700;
            font-size: 13px;
            min-width: 30px;
            height: 26px;
            padding: 0 6px;
            border-radius: 6px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .item-info { display: flex; flex-direction: column; gap: 2px; }

        .item-name {
            font-size: 14px;
            font-weight: 600;
            color: #222;
            line-height: 1.3;
        }

        .item-plu { font-size: 11px; color: #999; font-family: monospace; }

        .item-mods {
            font-size: 12px;
            color: #e67e22;
            background: #fff6ec;
            padding: 3px 7px;
            border-radius: 4px;
            margin-top: 3px;
            line-height: 1.3;
        }

        .item-prices { text-align: right; flex-shrink: 0; }
        .item-price { font-weight: 700; color: #111; font-size: 14px; display: block; }
        .item-unit { font-size: 11px; color: #aaa; display: block; }

        .total-row.delivery, .total-row.promotion { color: #666; }
        .total-row.promotion span:last-child { color: #06C167; }

        .customer-grid {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .customer-grid .row { display: flex; align-items: center; gap: 8px; }
        .customer-grid .label { font-size: 11px; color: #888; text-transform: uppercase; min-width: 60px; }
        .customer-grid .value { font-size: 13px; color: #333; font-weight: 600; }

        @media (max-width: 768px) {
            .stats {
                grid-template-columns: repeat(2, 1fr);
            }

            .orders-container {
                grid-template-columns: 1fr;
            }

            header {
                flex-direction: column;
                gap: 15px;
                text-align: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1> POS - Sistema Sierra</h1>
            <div class="status">
                <span class="status-indicator connected" id="status-indicator"></span>
                <span id="status-text">Conectado</span>
            </div>
        </header>

        <div class="stats">
            <div class="stat-card">
                <h3>Total Órdenes</h3>
                <div class="number" id="stat-total">0</div>
            </div>
            <div class="stat-card">
                <h3>Exitosas</h3>
                <div class="number" id="stat-success" style="color: #4CAF50;">0</div>
            </div>
            <div class="stat-card">
                <h3>Errores</h3>
                <div class="number" id="stat-errors" style="color: #f44336;">0</div>
            </div>
            <div class="stat-card">
                <h3>Monto Total</h3>
                <div class="number" id="stat-amount">$0.00</div>
            </div>
        </div>

        <div class="orders-container" id="orders-container">
            <div class="empty-state">
                <h2> Esperando órdenes...</h2>
                <p>Las órdenes de Uber Eats aparecerán aquí en tiempo real</p>
            </div>
        </div>
    </div>

    <script>
        let orders = [];
        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        const ordersContainer = document.getElementById('orders-container');

        function updateStats() {
            const total = orders.length;
            const success = orders.filter(o => o.status === 'success').length;
            const errors = orders.filter(o => o.status === 'error').length;
            const amount = orders.reduce((sum, o) => {
                if (o.details && o.details.totals && o.details.totals.total) return sum + o.details.totals.total;
                if (o.orderData && o.orderData.subTotal) return sum + o.orderData.subTotal;
                return sum;
            }, 0);

            document.getElementById('stat-total').textContent = total;
            document.getElementById('stat-success').textContent = success;
            document.getElementById('stat-errors').textContent = errors;
            document.getElementById('stat-amount').textContent = \`$\${amount.toFixed(2)}\`;
        }

        function formatTime(isoString) {
            const date = new Date(isoString);
            return date.toLocaleTimeString('es-MX');
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function money(value) {
            return '$' + (Number(value) || 0).toFixed(2);
        }

        function createOrderCard(order) {
            const card = document.createElement('div');
            const statusClass = order.status === 'success' ? 'success' : order.status === 'error' ? 'error' : 'processing';
            const statusText = order.status === 'success' ? 'Exitosa' : order.status === 'error' ? 'Error' : 'Procesando';
            card.className = 'order-card ' + statusClass;

            const d = order.details;

            // Encabezado: número de orden + UUID
            const orderNumber = d && d.orderNumber ? d.orderNumber : (order.uberOrderId || '').slice(0, 8);
            const headerHTML = \`
                <div class="order-header">
                    <div>
                        <div class="order-header-top">
                            <span class="uber-badge">UBER EATS</span>
                            <span class="order-number">#\${escapeHtml(orderNumber)}</span>
                        </div>
                        <div class="order-time">\${formatTime(order.timestamp)}</div>
                        <div class="order-uuid">\${escapeHtml(order.uberOrderId || '')}</div>
                    </div>
                    <div class="order-status \${statusClass}">\${statusText}</div>
                </div>
            \`;

            // Items detallados (preferir details; si no, fallback a PLUs del ticket Sierra)
            let itemsHTML = '';
            if (d && d.items && d.items.length) {
                itemsHTML = d.items.map(it => {
                    const mods = (it.customizations || [])
                        .filter(c => c.selections && c.selections.length)
                        .map(c => \`\${escapeHtml(c.title)}: \${c.selections.map(escapeHtml).join(', ')}\`)
                        .join(' · ');
                    return \`
                        <div class="item">
                            <div class="item-main">
                                <span class="item-qty-badge">\${it.quantity}×</span>
                                <div class="item-info">
                                    <span class="item-name">\${escapeHtml(it.name)}</span>
                                    <span class="item-plu">PLU \${escapeHtml(it.plu)}</span>
                                    \${mods ? \`<span class="item-mods">\${mods}</span>\` : ''}
                                </div>
                            </div>
                            <div class="item-prices">
                                <span class="item-price">\${money(it.total)}</span>
                                <span class="item-unit">\${money(it.unitPrice)} c/u</span>
                            </div>
                        </div>
                    \`;
                }).join('');
            } else if (order.orderData && order.orderData.plus) {
                itemsHTML = order.orderData.plus.map(item => \`
                    <div class="item">
                        <div class="item-main">
                            <span class="item-qty-badge">\${item.quantity}×</span>
                            <div class="item-info"><span class="item-name">PLU \${escapeHtml(item.plu)}</span></div>
                        </div>
                        <div class="item-prices"><span class="item-price">\${money(item.subTotal)}</span></div>
                    </div>
                \`).join('');
            }

            // Totales (usa el desglose de Uber si está disponible)
            const t = d && d.totals ? d.totals : null;
            const subtotal = t ? t.subtotal : (order.orderData ? order.orderData.subTotal : 0);
            const tax = t ? t.tax : (order.orderData ? order.orderData.tax : 0);
            const deliveryFee = t ? t.delivery_fee : 0;
            const promotion = t ? t.promotion : 0;
            const total = t && t.total ? t.total : (subtotal + tax);

            let totalsHTML = '';
            if (itemsHTML) {
                totalsHTML = \`
                    <div class="total-row subtotal"><span>Subtotal</span><span>\${money(subtotal)}</span></div>
                    \${deliveryFee ? \`<div class="total-row delivery"><span>Envío</span><span>\${money(deliveryFee)}</span></div>\` : ''}
                    \${promotion ? \`<div class="total-row promotion"><span>Promoción</span><span>-\${money(promotion)}</span></div>\` : ''}
                    <div class="total-row tax"><span>Impuesto</span><span>\${money(tax)}</span></div>
                    <div class="total-row total"><span>Total</span><span>\${money(total)}</span></div>
                \`;
            }

            // Cliente
            let customerHTML = '';
            if (d && d.customer && (d.customer.name || d.customer.phone)) {
                customerHTML = \`
                    <div class="order-customer">
                        <div class="customer-grid">
                            <div class="row"><span class="label">Cliente</span><span class="value">\${escapeHtml(d.customer.name)}</span></div>
                            \${d.customer.phone ? \`<div class="row"><span class="label">Teléfono</span><span class="value">\${escapeHtml(d.customer.phone)}</span></div>\` : ''}
                        </div>
                    </div>
                \`;
            } else if (order.orderData && order.orderData.observation) {
                customerHTML = \`<div class="order-customer"><strong>Notas:</strong> \${escapeHtml(order.orderData.observation)}</div>\`;
            }

            const errorHTML = order.status === 'error'
                ? \`<div class="error-detail">\${escapeHtml(order.message)}</div>\`
                : '';

            card.innerHTML = headerHTML + \`
                <div class="order-body">
                    \${itemsHTML ? \`<div class="order-items"><h4>Productos</h4>\${itemsHTML}</div>\` : ''}
                    \${totalsHTML ? \`<div class="order-totals">\${totalsHTML}</div>\` : ''}
                    \${customerHTML}
                    \${errorHTML}
                </div>
            \`;

            return card;
        }

        function renderOrders() {
            ordersContainer.innerHTML = '';

            if (orders.length === 0) {
                ordersContainer.innerHTML = \`
                    <div class="empty-state">
                        <h2> Esperando órdenes...</h2>
                        <p>Las órdenes de Uber Eats aparecerán aquí en tiempo real</p>
                    </div>
                \`;
                return;
            }

            orders.forEach(order => {
                ordersContainer.appendChild(createOrderCard(order));
            });

            updateStats();
        }

        function connectSSE() {
            const eventSource = new EventSource('/api/pos/stream');

            eventSource.onopen = () => {
                statusIndicator.className = 'status-indicator connected';
                statusText.textContent = 'Conectado';
                console.log('Conectado al stream de órdenes');
            };

            eventSource.onerror = () => {
                statusIndicator.className = 'status-indicator disconnected';
                statusText.textContent = 'Desconectado - Reconectando...';
                eventSource.close();
                setTimeout(connectSSE, 3000);
            };

            eventSource.onmessage = (event) => {
                if (event.data.startsWith(':')) return; // Ignorar keep-alive

                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'history') {
                        orders = data.orders;
                        renderOrders();
                    } else if (data.type === 'order') {
                        orders.unshift(data.order);
                        renderOrders();
                    }
                } catch (error) {
                    console.error('Error al parsear dato:', error);
                }
            };
        }

        // Conectar al iniciar
        connectSSE();

        // Renderizar inicial
        renderOrders();

        // Actualizador de estadísticas cada 5 segundos
        setInterval(updateStats, 5000);
    </script>
</body>
</html>
    `;
  }
}

export const posController = new POSController();
