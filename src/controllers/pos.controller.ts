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
    // Código del enum de Uber (ver UberDenyReasonCode); cualquier otro valor devuelve 400.
    const reason = req.body?.reason || 'ITEM_AVAILABILITY';
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
    <title>Punto de Venta — Sistema Sierra</title>
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        /* Paleta alineada a la identidad de Sistemas Sierra: azul marino corporativo,
           superficies blancas, grises de apoyo y esquinas rectas (radio mínimo).
           Para ajustar la marca basta con cambiar --primary y --primary-dark. */
        :root {
            --bg: #f4f6f8;
            --surface: #ffffff;
            --border: #d9dfe6;
            --border-soft: #edf0f4;
            --text: #1a2536;
            --text-muted: #61707f;
            --text-faint: #93a0ad;
            --primary: #17293f;
            --primary-dark: #0f1c2e;
            --primary-soft: #e8ecf1;
            --accent: #1f4e79;
            --amber: #9a6300;
            --amber-soft: #fbf2e0;
            --green: #14654a;
            --green-soft: #e3f1ea;
            --red: #a82820;
            --red-soft: #fbeae8;
            --slate: #59646f;
            --slate-soft: #edf0f3;
            --radius: 4px;
            --radius-lg: 6px;
        }
        body {
            font-family: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--bg); min-height: 100vh; padding: 28px 24px; color: var(--text);
            -webkit-font-smoothing: antialiased;
        }
        .container { max-width: 1320px; margin: 0 auto; }
        svg { display: block; flex-shrink: 0; }

        header {
            background: var(--surface); padding: 18px 24px; border-radius: var(--radius-lg);
            border: 1px solid var(--border); margin-bottom: 20px;
            display: flex; justify-content: space-between; align-items: center; gap: 16px;
        }
        .brand { display: flex; align-items: center; gap: 14px; }
        .brand-mark {
            width: 42px; height: 42px; border-radius: var(--radius); background: var(--primary);
            color: #fff; display: flex; align-items: center; justify-content: center;
        }
        .brand h1 { font-size: 19px; font-weight: 650; letter-spacing: -.2px; }
        .brand p { font-size: 12.5px; color: var(--text-muted); margin-top: 2px; }

        .status {
            display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600;
            padding: 7px 14px; border-radius: 999px; border: 1px solid var(--border);
            background: var(--green-soft); color: var(--green);
        }
        .status.offline { background: var(--red-soft); color: var(--red); }
        .status-indicator { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 2s infinite; }
        .status.offline .status-indicator { animation: none; }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.35;} }

        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 22px; }
        .stat-card {
            background: var(--surface); padding: 16px 18px; border-radius: var(--radius-lg);
            border: 1px solid var(--border); display: flex; align-items: center; gap: 14px;
        }
        .stat-icon { width: 38px; height: 38px; border-radius: var(--radius); display: flex; align-items: center; justify-content: center; }
        .stat-icon.amber { background: var(--amber-soft); color: var(--amber); }
        .stat-icon.blue { background: #e6eef6; color: var(--accent); }
        .stat-icon.green { background: var(--green-soft); color: var(--green); }
        .stat-icon.slate { background: var(--slate-soft); color: var(--slate); }
        .stat-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .stat-meta h3 { font-size: 11px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted); }
        .stat-meta .number { font-size: 23px; font-weight: 680; letter-spacing: -.5px; line-height: 1.15; }

        .orders-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(392px, 1fr)); gap: 18px; align-items: start; }
        .order-card {
            background: var(--surface); border-radius: var(--radius-lg); overflow: hidden;
            border: 1px solid var(--border); border-top: 3px solid var(--slate);
            transition: box-shadow .18s ease; animation: slideIn .3s ease;
        }
        @keyframes slideIn { from{transform:translateY(10px);opacity:0;} to{transform:translateY(0);opacity:1;} }
        .order-card:hover { box-shadow: 0 6px 20px rgba(22,32,46,.09); }
        .order-card.pending   { border-top-color: #c8860d; }
        .order-card.preparing { border-top-color: var(--primary); }
        .order-card.completed { border-top-color: var(--green); }
        .order-card.denied, .order-card.expired, .order-card.cancelled { border-top-color: #aab3c0; }
        .order-card.error     { border-top-color: var(--red); }

        .order-header { padding: 16px 18px; border-bottom: 1px solid var(--border-soft); display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .order-header-top { display: flex; align-items: center; gap: 9px; margin-bottom: 5px; }
        .platform-badge {
            font-size: 9.5px; font-weight: 700; letter-spacing: .7px; text-transform: uppercase;
            padding: 3px 8px; border-radius: var(--radius); background: var(--primary); color: #fff;
        }
        .order-number { font-size: 17px; font-weight: 680; letter-spacing: -.3px; }
        .order-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
        .order-uuid { font-size: 10px; color: var(--text-faint); font-family: ui-monospace, Consolas, monospace; margin-top: 3px; }

        .order-status { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: var(--radius); font-size: 10.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; white-space: nowrap; }
        .order-status.pending { background: var(--amber-soft); color: var(--amber); }
        .order-status.preparing { background: #e6eef6; color: var(--accent); }
        .order-status.completed { background: var(--green-soft); color: var(--green); }
        .order-status.denied, .order-status.expired, .order-status.cancelled { background: var(--slate-soft); color: var(--slate); }
        .order-status.error { background: var(--red-soft); color: var(--red); }

        .countdown-bar { padding: 9px 18px; background: var(--amber-soft); border-bottom: 1px solid #f2e6ce; display: flex; align-items: center; justify-content: center; gap: 9px; font-size: 12.5px; color: var(--amber); font-weight: 600; }
        .countdown-bar.urgent { background: var(--red-soft); color: var(--red); border-bottom-color: #f7d9d6; }
        .countdown-time { font-family: ui-monospace, Consolas, monospace; font-size: 15px; font-weight: 700; letter-spacing: -.3px; }

        .order-body { padding: 16px 18px; }
        .section-label { font-size: 10.5px; font-weight: 700; letter-spacing: .7px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; }
        .item { display: flex; justify-content: space-between; align-items: flex-start; padding: 11px 0; border-bottom: 1px solid var(--border-soft); gap: 12px; }
        .item:first-of-type { padding-top: 0; }
        .item:last-child { border-bottom: none; padding-bottom: 0; }
        .item-main { display: flex; align-items: flex-start; gap: 11px; flex: 1; min-width: 0; }
        .item-qty-badge { background: var(--primary-soft); color: var(--primary); font-weight: 700; font-size: 12.5px; min-width: 30px; height: 25px; padding: 0 7px; border-radius: var(--radius); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .item-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .item-name { font-size: 13.5px; font-weight: 600; line-height: 1.35; }
        .item-plu { font-size: 11px; color: var(--text-faint); font-family: ui-monospace, Consolas, monospace; }
        .item-mods { font-size: 11.5px; color: #8a5a12; background: #fdf6ea; border-left: 2px solid #e0b877; padding: 5px 8px; border-radius: var(--radius); margin-top: 4px; line-height: 1.4; }
        .item-prices { text-align: right; flex-shrink: 0; }
        .item-price { font-weight: 650; font-size: 13.5px; display: block; }
        .item-unit { font-size: 11px; color: var(--text-faint); display: block; margin-top: 1px; }

        .order-totals { background: #f8fafb; border: 1px solid var(--border-soft); padding: 12px 14px; border-radius: var(--radius); font-size: 12.5px; margin-top: 14px; }
        .total-row { display: flex; justify-content: space-between; margin: 5px 0; color: var(--text-muted); }
        .total-row.promotion span:last-child { color: var(--green); }
        .total-row.total { font-weight: 700; color: var(--text); font-size: 15px; padding-top: 9px; border-top: 1px solid var(--border); margin-top: 9px; }

        .order-customer { border: 1px solid var(--border-soft); padding: 12px 14px; border-radius: var(--radius); margin-top: 12px; }
        .customer-grid { display: flex; flex-direction: column; gap: 8px; }
        .customer-grid .row { display: flex; align-items: center; gap: 10px; color: var(--text-muted); }
        .customer-grid .value { font-size: 12.5px; color: var(--text); font-weight: 600; }

        .error-detail { background: var(--red-soft); padding: 10px 12px; border-left: 3px solid var(--red); border-radius: 4px; font-size: 12px; color: var(--red); word-break: break-word; margin-top: 12px; line-height: 1.45; }

        .actions { display: flex; gap: 10px; padding: 14px 18px; border-top: 1px solid var(--border-soft); background: #fafbfc; }
        .btn { flex: 1; padding: 11px 14px; border: 1px solid transparent; border-radius: var(--radius); font-size: 13.5px; font-weight: 620; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 7px; transition: background .15s ease, border-color .15s ease; font-family: inherit; }
        .btn:disabled { opacity: .5; cursor: not-allowed; }
        .btn-accept { background: var(--green); color: #fff; }
        .btn-accept:hover:not(:disabled) { background: #0f5039; }
        .btn-deny { background: var(--surface); color: var(--red); border-color: #f0cdca; }
        .btn-deny:hover:not(:disabled) { background: var(--red-soft); }
        .btn-complete { background: var(--primary); color: #fff; }
        .btn-complete:hover:not(:disabled) { background: var(--primary-dark); }

        .empty-state { grid-column: 1 / -1; text-align: center; padding: 64px 24px; background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius-lg); }
        .empty-state .empty-icon { width: 52px; height: 52px; border-radius: var(--radius-lg); background: var(--slate-soft); color: var(--text-faint); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
        .empty-state h2 { font-size: 16px; font-weight: 650; margin-bottom: 6px; }
        .empty-state p { font-size: 13px; color: var(--text-muted); }

        @media (max-width: 900px) { .stats { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 640px) {
            body { padding: 16px 14px; }
            .orders-container { grid-template-columns: 1fr; }
            header { flex-direction: column; align-items: flex-start; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="brand">
                <div class="brand-mark">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 9h18M3 9l1.5-4.5A2 2 0 0 1 6.4 3h11.2a2 2 0 0 1 1.9 1.5L21 9M3 9v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/>
                        <path d="M9 13h6"/>
                    </svg>
                </div>
                <div>
                    <h1>Punto de Venta — Sistema Sierra</h1>
                    <p>Órdenes en línea en tiempo real</p>
                </div>
            </div>
            <div class="status" id="status-pill">
                <span class="status-indicator" id="status-indicator"></span>
                <span id="status-text">Conectado</span>
            </div>
        </header>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-icon amber">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                </div>
                <div class="stat-meta"><h3>Pendientes</h3><div class="number" id="stat-pending">0</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon blue">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M5 20a7 7 0 0 1 14 0"/><path d="M9 6.5c0-1 1.5-1.5 1.5-3M13 6.5c0-1 1.5-1.5 1.5-3"/></svg>
                </div>
                <div class="stat-meta"><h3>En preparación</h3><div class="number" id="stat-preparing">0</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon green">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.1V12a9 9 0 1 1-5.3-8.2"/><path d="m9 11 3 3 9-9"/></svg>
                </div>
                <div class="stat-meta"><h3>Completadas</h3><div class="number" id="stat-completed">0</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon slate">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>
                </div>
                <div class="stat-meta"><h3>Monto activo</h3><div class="number" id="stat-amount">$0.00</div></div>
            </div>
        </div>

        <div class="orders-container" id="orders-container"></div>
    </div>

    <script>
        let orders = [];
        const statusPill = document.getElementById('status-pill');
        const statusText = document.getElementById('status-text');
        const ordersContainer = document.getElementById('orders-container');

        const STATUS_LABELS = {
            pending: 'Pendiente', preparing: 'En preparación', completed: 'Completada',
            denied: 'Rechazada', cancelled: 'Cancelada', expired: 'Expirada', error: 'Error'
        };

        // Iconos SVG en línea (sin dependencias externas, trazo heredando el color del contenedor)
        const svg = (paths, size) => '<svg width="' + (size || 14) + '" height="' + (size || 14) +
            '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';

        const ICONS = {
            clock:    svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
            check:    svg('<path d="m5 12 5 5L20 7"/>'),
            close:    svg('<path d="M18 6 6 18M6 6l12 12"/>'),
            checkAll: svg('<path d="M21 11.1V12a9 9 0 1 1-5.3-8.2"/><path d="m9 11 3 3 9-9"/>'),
            user:     svg('<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>'),
            phone:    svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>'),
            alert:    svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'),
            ban:      svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
            inbox:    svg('<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5.5 5h13l2.5 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z"/>', 26)
        };

        // Icono que acompaña a cada estado en la etiqueta de la tarjeta
        const STATUS_ICONS = {
            pending: ICONS.clock, preparing: ICONS.clock, completed: ICONS.check,
            denied: ICONS.ban, cancelled: ICONS.ban, expired: ICONS.ban, error: ICONS.alert
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
                    <div class="row">\${ICONS.user}<span class="value">\${escapeHtml(d.customer.name)}</span></div>
                    \${d.customer.phone ? '<div class="row">' + ICONS.phone + '<span class="value">' + escapeHtml(d.customer.phone) + '</span></div>' : ''}
                </div></div>\`;
        }

        function actionsHTML(order) {
            if (order.status === 'pending') {
                return \`
                    <div class="actions">
                        <button class="btn btn-deny" onclick="denyOrder('\${order.id}', this)">\${ICONS.close} Denegar</button>
                        <button class="btn btn-accept" onclick="acceptOrder('\${order.id}', this)">\${ICONS.check} Aceptar</button>
                    </div>\`;
            }
            if (order.status === 'preparing') {
                return \`<div class="actions"><button class="btn btn-complete" onclick="completeOrder('\${order.id}', this)">\${ICONS.checkAll} Marcar como completada</button></div>\`;
            }
            return '';
        }

        function countdownHTML(order) {
            if (order.status !== 'pending' || !order.deadline) return '';
            return \`<div class="countdown-bar" data-deadline="\${order.deadline}">\${ICONS.clock}<span>Aceptar antes de</span><span class="countdown-time">--:--</span></div>\`;
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
                            <span class="platform-badge">Uber Eats</span>
                            <span class="order-number">#\${escapeHtml(orderNumber)}</span>
                        </div>
                        <div class="order-meta">\${ICONS.clock}<span>\${formatTime(order.receivedAt)}</span></div>
                        <div class="order-uuid">\${escapeHtml(order.id || '')}</div>
                    </div>
                    <div class="order-status \${order.status}">\${STATUS_ICONS[order.status] || ''}\${STATUS_LABELS[order.status] || order.status}</div>
                </div>
                \${countdownHTML(order)}
                <div class="order-body">
                    \${items ? '<div class="section-label">Productos</div>' + items : ''}
                    \${items ? '<div class="order-totals">' + totalsHTML(d) + '</div>' : ''}
                    \${customerHTML(d)}
                    \${errorHTML}
                </div>
                \${actionsHTML(order)}\`;
            return card;
        }

        function renderOrders() {
            if (!orders.length) {
                ordersContainer.innerHTML =
                    '<div class="empty-state">' +
                    '<div class="empty-icon">' + ICONS.inbox + '</div>' +
                    '<h2>Sin órdenes activas</h2>' +
                    '<p>Las órdenes entrantes se mostrarán aquí en tiempo real</p>' +
                    '</div>';
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
            // innerHTML, no textContent: los botones contienen un icono SVG que se perdería.
            const original = btn.innerHTML;
            btn.textContent = 'Procesando...';
            try {
                const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Error');
                // El servidor emitirá la lista actualizada por SSE
            } catch (e) {
                alert(errMsg + ': ' + e.message);
                buttons.forEach(b => b.disabled = false);
                btn.innerHTML = original;
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
            es.onopen = () => { statusPill.className = 'status'; statusText.textContent = 'Conectado'; };
            es.onerror = () => { statusPill.className = 'status offline'; statusText.textContent = 'Reconectando...'; es.close(); setTimeout(connectSSE, 3000); };
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
