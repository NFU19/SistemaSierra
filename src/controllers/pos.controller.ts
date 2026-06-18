/**
 * Controlador para la Interfaz de POS
 * Sirve la UI y maneja Server-Sent Events para actualizaciones en tiempo real.
 * Expone acciones de la orden: aceptar, denegar y completar.
 */

import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { orderStore } from '../services/event.service';
import { webhookProcessingService } from '../services/webhook-processing.service';

class POSController {
  /** GET /pos — Sirve la página HTML del POS */
  getPOSInterface(_req: Request, res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(this.getHTMLInterface());
  }

  /** GET /api/pos/stream — Server-Sent Events: stream de órdenes en tiempo real */
  streamOrders(_req: Request, res: Response): void {
    logger.info('Cliente conectado al stream de órdenes POS');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Enviar el estado actual completo al conectar
    res.write(`data: ${JSON.stringify({ type: 'orders', orders: orderStore.list() })}\n\n`);

    const ordersListener = (orders: any[]) => {
      res.write(`data: ${JSON.stringify({ type: 'orders', orders })}\n\n`);
    };
    orderStore.on('orders-updated', ordersListener);

    const keepAliveInterval = setInterval(() => {
      res.write(`:keep-alive ${new Date().toISOString()}\n\n`);
    }, 30000);

    res.on('close', () => {
      logger.info('Cliente desconectado del stream de órdenes POS');
      orderStore.removeListener('orders-updated', ordersListener);
      clearInterval(keepAliveInterval);
      res.end();
    });
  }

  /** GET /api/pos/orders — Historial de órdenes en JSON */
  getOrdersHistory(_req: Request, res: Response): void {
    const orders = orderStore.list();
    res.json({ success: true, count: orders.length, orders });
  }

  /** POST /api/pos/orders/:id/accept — Acepta: crea en Sierra + confirma en Uber */
  async acceptOrder(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    try {
      const result = await webhookProcessingService.acceptOrder(id);
      res.status(200).json(result);
    } catch (error: any) {
      logger.error(`Error al aceptar orden ${id}`, error.message);
      res.status(502).json({ success: false, error: error.message });
    }
  }

  /** POST /api/pos/orders/:id/deny — Rechaza en Uber y elimina del POS */
  async denyOrder(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const reason = req.body?.reason || 'ITEM_UNAVAILABLE';
    try {
      const result = await webhookProcessingService.denyOrder(id, reason);
      res.status(200).json(result);
    } catch (error: any) {
      logger.error(`Error al denegar orden ${id}`, error.message);
      res.status(502).json({ success: false, error: error.message });
    }
  }

  /** POST /api/pos/orders/:id/complete — Marca la orden como completada */
  completeOrder(req: Request, res: Response): void {
    const { id } = req.params;
    const order = orderStore.setStatus(id, 'completed', { message: 'Completada' });
    if (!order) {
      res.status(404).json({ success: false, error: 'Orden no encontrada' });
      return;
    }
    logger.info(`Orden ${id} marcada como COMPLETADA`);
    res.status(200).json({ success: true, message: 'Orden completada', uberOrderId: id });
  }

  /** Genera el HTML de la interfaz del POS */
  private getHTMLInterface(): string {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>POS - Órdenes Uber Eats</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh; padding: 20px; color: #333;
        }
        .container { max-width: 1280px; margin: 0 auto; }
        header {
            background: white; padding: 20px; border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 20px;
            display: flex; justify-content: space-between; align-items: center;
        }
        header h1 { color: #2a5298; font-size: 26px; }
        .status { display: flex; align-items: center; gap: 10px; font-weight: bold; }
        .status-indicator { width: 12px; height: 12px; border-radius: 50%; animation: pulse 2s infinite; }
        .status-indicator.connected { background: #06C167; }
        .status-indicator.disconnected { background: #f44336; animation: none; }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.5;} }

        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 15px; border-radius: 10px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .stat-card h3 { color: #666; font-size: 12px; text-transform: uppercase; margin-bottom: 10px; }
        .stat-card .number { font-size: 28px; font-weight: bold; color: #2a5298; }

        .orders-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(390px, 1fr)); gap: 18px; }
        .order-card {
            background: white; border-radius: 10px; overflow: hidden;
            box-shadow: 0 4px 15px rgba(0,0,0,0.12);
            transition: transform .2s ease, box-shadow .2s ease; animation: slideIn .4s ease;
        }
        @keyframes slideIn { from{transform:translateY(20px);opacity:0;} to{transform:translateY(0);opacity:1;} }
        .order-card:hover { transform: translateY(-4px); box-shadow: 0 8px 22px rgba(0,0,0,0.16); }
        .order-card.pending { border-top: 5px solid #f9a825; }
        .order-card.preparing { border-top: 5px solid #2a5298; }
        .order-card.completed { border-top: 5px solid #06C167; opacity: .85; }
        .order-card.denied, .order-card.expired { border-top: 5px solid #9e9e9e; opacity: .7; }
        .order-card.error { border-top: 5px solid #f44336; }

        .order-header { padding: 15px; border-bottom: 2px solid #f5f5f5; display: flex; justify-content: space-between; align-items: flex-start; }
        .order-header-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .uber-badge { background: #06C167; color: white; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: .5px; }
        .order-number { font-size: 18px; font-weight: 800; color: #111; }
        .order-time { font-size: 12px; color: #999; }
        .order-uuid { font-size: 10px; color: #bbb; font-family: monospace; margin-top: 2px; }

        .order-status { display: inline-block; padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; white-space: nowrap; }
        .order-status.pending { background: #fff3cd; color: #b8860b; }
        .order-status.preparing { background: #d6e4ff; color: #1a3a7a; }
        .order-status.completed { background: #c8e6c9; color: #2e7d32; }
        .order-status.denied, .order-status.expired { background: #eee; color: #777; }
        .order-status.error { background: #ffcdd2; color: #c62828; }

        .countdown-bar { padding: 8px 15px; background: #fffaf0; border-bottom: 1px solid #f0e6d2; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #b8860b; font-weight: 600; }
        .countdown-bar.urgent { background: #ffebee; color: #c62828; }
        .countdown-time { font-family: monospace; font-size: 16px; font-weight: 800; }

        .order-body { padding: 15px; }
        .order-items h4 { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        .item { display: flex; justify-content: space-between; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #f2f2f2; gap: 10px; }
        .item:last-child { border-bottom: none; }
        .item-main { display: flex; align-items: flex-start; gap: 10px; flex: 1; }
        .item-qty-badge { background: #2a5298; color: white; font-weight: 700; font-size: 13px; min-width: 30px; height: 26px; padding: 0 6px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .item-info { display: flex; flex-direction: column; gap: 2px; }
        .item-name { font-size: 14px; font-weight: 600; color: #222; line-height: 1.3; }
        .item-plu { font-size: 11px; color: #999; font-family: monospace; }
        .item-mods { font-size: 12px; color: #e67e22; background: #fff6ec; padding: 3px 7px; border-radius: 4px; margin-top: 3px; line-height: 1.3; }
        .item-prices { text-align: right; flex-shrink: 0; }
        .item-price { font-weight: 700; color: #111; font-size: 14px; display: block; }
        .item-unit { font-size: 11px; color: #aaa; display: block; }

        .order-totals { background: #f9f9f9; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-top: 12px; }
        .total-row { display: flex; justify-content: space-between; margin: 4px 0; }
        .total-row.subtotal, .total-row.tax, .total-row.delivery { color: #666; }
        .total-row.promotion span:last-child { color: #06C167; }
        .total-row.total { font-weight: bold; color: #2a5298; font-size: 16px; padding-top: 6px; border-top: 1px solid #ddd; margin-top: 6px; }

        .order-customer { background: #f0f7ff; padding: 12px; border-radius: 8px; margin-top: 12px; }
        .customer-grid { display: flex; flex-direction: column; gap: 6px; }
        .customer-grid .row { display: flex; align-items: center; gap: 8px; }
        .customer-grid .label { font-size: 11px; color: #888; text-transform: uppercase; min-width: 65px; }
        .customer-grid .value { font-size: 13px; color: #333; font-weight: 600; }

        .error-detail { background: #ffebee; padding: 10px; border-left: 3px solid #f44336; border-radius: 3px; font-size: 12px; color: #c62828; word-break: break-word; margin-top: 10px; }

        .actions { display: flex; gap: 10px; padding: 15px; border-top: 1px solid #f0f0f0; }
        .btn { flex: 1; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; transition: filter .15s ease, transform .05s ease; }
        .btn:active { transform: scale(.98); }
        .btn:disabled { opacity: .6; cursor: not-allowed; }
        .btn-accept { background: #06C167; color: white; }
        .btn-deny { background: #fff; color: #c62828; border: 2px solid #f3c0c0; }
        .btn-complete { background: #2a5298; color: white; }
        .btn:hover:not(:disabled) { filter: brightness(1.05); }

        .empty-state { grid-column: 1 / -1; text-align: center; padding: 50px 20px; color: white; }
        .empty-state h2 { font-size: 24px; margin-bottom: 10px; }
        .empty-state p { font-size: 14px; opacity: .85; }

        @media (max-width: 768px) {
            .stats { grid-template-columns: repeat(2, 1fr); }
            .orders-container { grid-template-columns: 1fr; }
            header { flex-direction: column; gap: 15px; text-align: center; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🛎️ POS - Sistema Sierra</h1>
            <div class="status">
                <span class="status-indicator connected" id="status-indicator"></span>
                <span id="status-text">Conectado</span>
            </div>
        </header>

        <div class="stats">
            <div class="stat-card"><h3>Pendientes</h3><div class="number" id="stat-pending" style="color:#f9a825;">0</div></div>
            <div class="stat-card"><h3>En Preparación</h3><div class="number" id="stat-preparing">0</div></div>
            <div class="stat-card"><h3>Completadas</h3><div class="number" id="stat-completed" style="color:#06C167;">0</div></div>
            <div class="stat-card"><h3>Monto Activo</h3><div class="number" id="stat-amount">$0.00</div></div>
        </div>

        <div class="orders-container" id="orders-container">
            <div class="empty-state">
                <h2>Esperando órdenes...</h2>
                <p>Las órdenes de Uber Eats aparecerán aquí en tiempo real</p>
            </div>
        </div>
    </div>

    <script>
        let orders = [];
        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        const ordersContainer = document.getElementById('orders-container');

        const STATUS_LABELS = {
            pending: 'Pendiente', preparing: 'En preparación', completed: 'Completada',
            denied: 'Rechazada', expired: 'Expirada', error: 'Error'
        };

        function escapeHtml(value) {
            return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
        function money(value) { return '$' + (Number(value) || 0).toFixed(2); }
        function formatTime(iso) { try { return new Date(iso).toLocaleTimeString('es-MX'); } catch(e){ return ''; } }

        function updateStats() {
            const pending = orders.filter(o => o.status === 'pending').length;
            const preparing = orders.filter(o => o.status === 'preparing').length;
            const completed = orders.filter(o => o.status === 'completed').length;
            const amount = orders
                .filter(o => ['pending','preparing','completed'].includes(o.status) && o.details && o.details.totals)
                .reduce((sum, o) => sum + (o.details.totals.total || 0), 0);
            document.getElementById('stat-pending').textContent = pending;
            document.getElementById('stat-preparing').textContent = preparing;
            document.getElementById('stat-completed').textContent = completed;
            document.getElementById('stat-amount').textContent = money(amount);
        }

        function itemsHTML(d) {
            if (!d || !d.items || !d.items.length) return '';
            return d.items.map(it => {
                const mods = (it.customizations || [])
                    .filter(c => c.selections && c.selections.length)
                    .map(c => escapeHtml(c.title) + ': ' + c.selections.map(escapeHtml).join(', '))
                    .join(' · ');
                return \`
                    <div class="item">
                        <div class="item-main">
                            <span class="item-qty-badge">\${it.quantity}×</span>
                            <div class="item-info">
                                <span class="item-name">\${escapeHtml(it.name)}</span>
                                <span class="item-plu">PLU \${escapeHtml(it.plu)}</span>
                                \${mods ? '<span class="item-mods">' + mods + '</span>' : ''}
                            </div>
                        </div>
                        <div class="item-prices">
                            <span class="item-price">\${money(it.total)}</span>
                            <span class="item-unit">\${money(it.unitPrice)} c/u</span>
                        </div>
                    </div>\`;
            }).join('');
        }

        function totalsHTML(d) {
            if (!d || !d.totals) return '';
            const t = d.totals;
            return \`
                <div class="total-row subtotal"><span>Subtotal</span><span>\${money(t.subtotal)}</span></div>
                \${t.delivery_fee ? '<div class="total-row delivery"><span>Envío</span><span>' + money(t.delivery_fee) + '</span></div>' : ''}
                \${t.promotion ? '<div class="total-row promotion"><span>Promoción</span><span>-' + money(t.promotion) + '</span></div>' : ''}
                <div class="total-row tax"><span>Impuesto</span><span>\${money(t.tax)}</span></div>
                <div class="total-row total"><span>Total</span><span>\${money(t.total || t.subtotal)}</span></div>\`;
        }

        function customerHTML(d) {
            if (!d || !d.customer || (!d.customer.name && !d.customer.phone)) return '';
            return \`
                <div class="order-customer"><div class="customer-grid">
                    <div class="row"><span class="label">Cliente</span><span class="value">\${escapeHtml(d.customer.name)}</span></div>
                    \${d.customer.phone ? '<div class="row"><span class="label">Teléfono</span><span class="value">' + escapeHtml(d.customer.phone) + '</span></div>' : ''}
                </div></div>\`;
        }

        function actionsHTML(order) {
            if (order.status === 'pending') {
                return \`
                    <div class="actions">
                        <button class="btn btn-deny" onclick="denyOrder('\${order.id}', this)">✕ Denegar</button>
                        <button class="btn btn-accept" onclick="acceptOrder('\${order.id}', this)">✓ Aceptar</button>
                    </div>\`;
            }
            if (order.status === 'preparing') {
                return \`<div class="actions"><button class="btn btn-complete" onclick="completeOrder('\${order.id}', this)">Marcar como completada</button></div>\`;
            }
            return '';
        }

        function countdownHTML(order) {
            if (order.status !== 'pending' || !order.deadline) return '';
            return \`<div class="countdown-bar" data-deadline="\${order.deadline}">⏱ Aceptar antes de: <span class="countdown-time">--:--</span></div>\`;
        }

        function createOrderCard(order) {
            const card = document.createElement('div');
            card.className = 'order-card ' + order.status;
            const d = order.details;
            const orderNumber = order.orderNumber || (order.id || '').slice(0, 8);
            const items = itemsHTML(d);
            const errorHTML = (order.status === 'error' || order.message && order.status !== 'pending' && order.status !== 'preparing' && order.status !== 'completed')
                ? (order.message ? '<div class="error-detail">' + escapeHtml(order.message) + '</div>' : '')
                : '';

            card.innerHTML = \`
                <div class="order-header">
                    <div>
                        <div class="order-header-top">
                            <span class="uber-badge">UBER EATS</span>
                            <span class="order-number">#\${escapeHtml(orderNumber)}</span>
                        </div>
                        <div class="order-time">\${formatTime(order.receivedAt)}</div>
                        <div class="order-uuid">\${escapeHtml(order.id || '')}</div>
                    </div>
                    <div class="order-status \${order.status}">\${STATUS_LABELS[order.status] || order.status}</div>
                </div>
                \${countdownHTML(order)}
                <div class="order-body">
                    \${items ? '<div class="order-items"><h4>Productos</h4>' + items + '</div>' : ''}
                    \${items ? '<div class="order-totals">' + totalsHTML(d) + '</div>' : ''}
                    \${customerHTML(d)}
                    \${errorHTML}
                </div>
                \${actionsHTML(order)}\`;
            return card;
        }

        function renderOrders() {
            if (!orders.length) {
                ordersContainer.innerHTML = '<div class="empty-state"><h2>Esperando órdenes...</h2><p>Las órdenes de Uber Eats aparecerán aquí en tiempo real</p></div>';
                updateStats();
                return;
            }
            ordersContainer.innerHTML = '';
            orders.forEach(o => ordersContainer.appendChild(createOrderCard(o)));
            updateStats();
            updateCountdowns();
        }

        function updateCountdowns() {
            const now = Date.now();
            document.querySelectorAll('.countdown-bar').forEach(bar => {
                const deadline = new Date(bar.getAttribute('data-deadline')).getTime();
                let diff = Math.max(0, deadline - now);
                const m = Math.floor(diff / 60000);
                const s = Math.floor((diff % 60000) / 1000);
                const span = bar.querySelector('.countdown-time');
                if (span) span.textContent = (diff <= 0) ? 'Expirado' : (String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0'));
                bar.classList.toggle('urgent', diff <= 120000);
            });
        }

        async function postAction(url, btn, errMsg) {
            const card = btn.closest('.order-card');
            const buttons = card ? card.querySelectorAll('.btn') : [btn];
            buttons.forEach(b => b.disabled = true);
            const original = btn.textContent;
            btn.textContent = 'Procesando...';
            try {
                const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Error');
                // El servidor emitirá la lista actualizada por SSE
            } catch (e) {
                alert(errMsg + ': ' + e.message);
                buttons.forEach(b => b.disabled = false);
                btn.textContent = original;
            }
        }

        function acceptOrder(id, btn) { postAction('/api/pos/orders/' + id + '/accept', btn, 'No se pudo aceptar'); }
        function denyOrder(id, btn) {
            if (!confirm('¿Rechazar este pedido? Se cancelará en Uber.')) return;
            postAction('/api/pos/orders/' + id + '/deny', btn, 'No se pudo denegar');
        }
        function completeOrder(id, btn) { postAction('/api/pos/orders/' + id + '/complete', btn, 'No se pudo completar'); }

        function connectSSE() {
            const es = new EventSource('/api/pos/stream');
            es.onopen = () => { statusIndicator.className = 'status-indicator connected'; statusText.textContent = 'Conectado'; };
            es.onerror = () => { statusIndicator.className = 'status-indicator disconnected'; statusText.textContent = 'Reconectando...'; es.close(); setTimeout(connectSSE, 3000); };
            es.onmessage = (event) => {
                if (event.data.startsWith(':')) return;
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'orders') { orders = data.orders || []; renderOrders(); }
                } catch (err) { console.error('Error al parsear:', err); }
            };
        }

        connectSSE();
        renderOrders();
        setInterval(updateCountdowns, 1000);
    </script>
</body>
</html>
    `;
  }
}

export const posController = new POSController();
