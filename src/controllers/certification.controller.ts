/**
 * Controlador del panel de Certificación de Uber Eats.
 *
 * Sirve una página pensada para CAPTURAR EVIDENCIA: muestra, por cada requisito de Uber,
 * el método, la ruta y el código HTTP devuelto, además del registro de webhooks recibidos
 * con su código de reconocimiento.
 */

import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { orderStore } from '../services/event.service';
import {
  CertificationCheck,
  CheckId,
  certificationService,
} from '../services/certification.service';

class CertificationController {
  /** GET /certification — Panel HTML con las verificaciones de solo lectura ya ejecutadas. */
  async getPanel(req: Request, res: Response): Promise<void> {
    const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : undefined;
    const checks = await certificationService.runReadOnly(orderId);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(this.renderHTML(checks, orderId));
  }

  /** POST /api/certification/run/:checkId — Ejecuta una verificación concreta. */
  async runCheck(req: Request, res: Response): Promise<void> {
    const checkId = req.params.checkId as CheckId;
    const orderId =
      (typeof req.query.orderId === 'string' && req.query.orderId) || req.body?.orderId;

    try {
      const result = await certificationService.runCheck(checkId, orderId);
      res.status(200).json({ success: result.ok, checkId, result });
    } catch (error: any) {
      logger.error(`Error ejecutando verificación ${checkId}`, error);
      res.status(500).json({ success: false, checkId, error: error.message });
    }
  }

  /** GET /api/certification — Mismo contenido del panel, en JSON. */
  async getJSON(req: Request, res: Response): Promise<void> {
    const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : undefined;
    const checks = await certificationService.runReadOnly(orderId);
    res.json({
      success: true,
      context: certificationService.getContext(),
      checks,
      webhooks: certificationService.getWebhookLog(),
    });
  }

  private renderHTML(checks: CertificationCheck[], orderId?: string): string {
    const ctx = certificationService.getContext();
    const webhooks = certificationService.getWebhookLog();

    const rows = checks
      .map((check) => {
        const status = check.result?.status;
        const badge = check.skipped
          ? `<span class="badge pending">Pendiente</span>`
          : status && status >= 200 && status < 300
            ? `<span class="badge ok">${status}</span>`
            : `<span class="badge fail">${status || 'sin respuesta'}</span>`;

        let detail: string;
        if (check.skipped) {
          detail = this.escape(check.skipped);
        } else {
          const call = `<code>${this.escape((check.result?.method || '').toUpperCase())} ${this.escape(check.result?.path || '')}</code>`;
          const err =
            check.result?.error && !check.result.ok
              ? `<div class="err">${this.escape(check.result.error)}</div>`
              : '';
          const ran = check.ranAt
            ? `<div class="ts">Ejecutado: ${this.escape(check.ranAt)}</div>`
            : '';
          // Uber exige que la evidencia incluya endpoint, status Y cuerpo de la respuesta.
          detail = call + err + this.renderBody(check.result) + ran;
        }

        // Los que necesitan una orden se deshabilitan mientras no haya orderId seleccionado.
        const needsOrder = check.requiresOrderId && !orderId;
        const action = check.mutating
          ? `<button onclick="runCheck('${check.id}', this)"${needsOrder ? ' disabled title="Selecciona primero una orden"' : ''}>Ejecutar</button>`
          : '';

        return `
          <tr>
            <td>${this.escape(check.requirement)}</td>
            <td>${detail}</td>
            <td class="center">${badge}</td>
            <td class="center">${action}</td>
          </tr>`;
      })
      .join('');

    const webhookRows = webhooks.length
      ? webhooks
          .map(
            (w) => `
          <tr>
            <td>${this.escape(w.receivedAt)}</td>
            <td><code>${this.escape(w.eventType)}</code></td>
            <td><code>${this.escape(w.orderId || '—')}</code></td>
            <td class="center"><span class="badge ok">${w.ackStatus}</span></td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="4" class="empty">Aún no se reciben webhooks. Genera un pedido de prueba en Uber.</td></tr>`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Certificación Uber Eats — Sistema Sierra</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f4f6fa; color: #1c2536; padding: 28px; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 4px; color: #10233f; }
  .sub { color: #64748b; font-size: 13px; margin-bottom: 20px; }
  .ctx { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-bottom: 22px; font-size: 13px; }
  .ctx div { margin: 3px 0; }
  .ctx b { color: #475569; display: inline-block; min-width: 110px; }
  h2 { font-size: 15px; margin: 24px 0 10px; color: #10233f; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  th { background: #f8fafc; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #64748b; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; }
  td { padding: 11px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  .center { text-align: center; }
  code { font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; color: #334155; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; }
  .badge.ok { background: #dcfce7; color: #15803d; }
  .badge.fail { background: #fee2e2; color: #b91c1c; }
  .badge.pending { background: #f1f5f9; color: #64748b; }
  button { background: #2a5298; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; }
  button:hover { filter: brightness(1.1); }
  button:disabled { opacity: .55; cursor: not-allowed; }
  .empty { text-align: center; color: #94a3b8; padding: 22px; }
  .note { font-size: 12px; color: #64748b; margin-top: 10px; line-height: 1.5; }
  .picker { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-bottom: 22px; }
  .picker label { font-size: 13px; margin-right: 10px; }
  .picker input { font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; width: 340px; max-width: 100%; }
  button.ghost { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
  .err { color: #b91c1c; font-size: 11px; margin-top: 5px; }
  .ts { font-size: 11px; color: #94a3b8; }
  pre.body { background: #0f172a; color: #e2e8f0; font-family: 'Cascadia Code', Consolas, monospace; font-size: 11px; line-height: 1.45; padding: 9px 11px; border-radius: 6px; margin-top: 6px; max-height: 240px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  pre.body.empty-body { background: #f1f5f9; color: #64748b; font-style: italic; }
  td a { text-decoration: none; }
  td a code { color: #1d4ed8; background: #eff6ff; }
  td a:hover code { background: #dbeafe; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Certificación de Integración — Uber Eats</h1>
  <div class="sub">Evidencia de respuestas por endpoint · Sistema Sierra POS</div>

  <div class="ctx">
    <div><b>Ambiente:</b> <code>${this.escape(ctx.apiBaseUrl)}</code></div>
    <div><b>Store ID:</b> <code>${this.escape(ctx.storeId || 'no configurado')}</code></div>
    <div><b>Scopes:</b> <code>${this.escape(ctx.scopes)}</code></div>
    <div><b>Generado:</b> ${this.escape(ctx.generatedAt)}</div>
    ${orderId ? `<div><b>Order ID:</b> <code>${this.escape(orderId)}</code></div>` : ''}
  </div>

  <div class="picker">
    <label for="orderId"><b>Orden de prueba</b></label>
    <input id="orderId" list="orders" placeholder="UUID de la orden" value="${this.escape(orderId || '')}">
    <datalist id="orders">${this.renderOrderOptions()}</datalist>
    <button onclick="loadOrder()">Cargar</button>
    ${orderId ? '<button class="ghost" onclick="clearOrder()">Quitar</button>' : ''}
    <div class="note" style="margin-top:8px">
      ${this.renderOrderHint()}
    </div>
  </div>

  <h2>Endpoints requeridos</h2>
  <table>
    <thead><tr><th>Requisito</th><th>Llamada</th><th class="center">Status</th><th class="center">Acción</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="note">
    Las verificaciones marcadas como <b>Pendiente</b> modifican datos reales (aceptan, deniegan o
    cancelan una orden) y por eso se ejecutan de forma individual con el botón <b>Ejecutar</b>.
    Para las que requieren una orden, abre esta página con <code>?orderId=UUID</code>.
  </div>

  <h2>Órdenes detectadas por el middleware</h2>
  <table>
    <thead><tr><th>UUID</th><th>Eventos</th><th>Qué pasó con ella</th><th>Último evento</th></tr></thead>
    <tbody>${this.renderSeenOrders()}</tbody>
  </table>
  <div class="note">
    Incluye órdenes que <b>nunca llegaron al POS</b> (canceladas, denegadas o programadas).
    Haz clic en un UUID para cargarlo arriba y ejecutar las verificaciones sobre esa orden.
  </div>

  <h2>Webhooks recibidos y reconocidos</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Evento</th><th>Orden</th><th class="center">Ack</th></tr></thead>
    <tbody>${webhookRows}</tbody>
  </table>
</div>

<script>
  function esc(v) {
    return String(v == null ? '' : v)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }

  function currentOrderId() {
    const input = document.getElementById('orderId');
    return (input && input.value.trim()) || new URLSearchParams(location.search).get('orderId') || '';
  }

  function loadOrder() {
    const id = currentOrderId();
    if (!id) { alert('Escribe o selecciona el UUID de una orden.'); return; }
    location.search = '?orderId=' + encodeURIComponent(id);
  }

  function clearOrder() { location.search = ''; }

  async function runCheck(id, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Ejecutando...';
    try {
      const orderId = currentOrderId();
      const url = '/api/certification/run/' + id + (orderId ? '?orderId=' + encodeURIComponent(orderId) : '');
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      const result = data.result || {};
      const status = result.status;
      const okRange = status >= 200 && status < 300;

      const row = btn.closest('tr');
      row.querySelector('td.center').innerHTML =
        '<span class="badge ' + (okRange ? 'ok' : 'fail') + '">' + (status || 'error') + '</span>';

      // Mostrar la llamada real y, si falló, el motivo — sin esto sólo se veía "error".
      let detail = '';
      if (result.path && result.path !== '-') {
        detail = '<code>' + (result.method || '').toUpperCase() + ' ' + result.path + '</code>';
      }
      if (!okRange && result.error) {
        detail += '<div class="err">' + esc(result.error) + '</div>';
      }
      // Uber exige el cuerpo de la respuesta en la evidencia.
      if (result.data !== undefined && result.data !== null && result.data !== '') {
        let body;
        try { body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2); }
        catch (e) { body = String(result.data); }
        if (body.length > 1200) body = body.slice(0, 1200) + '\n… (recortado)';
        detail += '<pre class="body">' + esc(body) + '</pre>';
      } else if (status === 204) {
        detail += '<pre class="body empty-body">204 No Content — sin cuerpo de respuesta</pre>';
      }
      detail += '<div class="ts">Ejecutado: ' + new Date().toISOString() + '</div>';
      if (detail) row.children[1].innerHTML = detail;
    } catch (e) {
      alert('Error al ejecutar: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
</script>
</body>
</html>`;
  }

  /**
   * Cuerpo de la respuesta de Uber. Es obligatorio en la evidencia de certificación
   * ("include the endpoint, status code, and response body in your screenshots").
   * Un 204 no lleva cuerpo: se indica explícitamente para que no parezca un dato faltante.
   */
  private renderBody(result?: CertificationCheck['result']): string {
    if (!result) return '';

    if (result.data === undefined || result.data === null || result.data === '') {
      return result.status === 204
        ? `<pre class="body empty-body">204 No Content — sin cuerpo de respuesta</pre>`
        : '';
    }

    let text: string;
    try {
      text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
    } catch {
      text = String(result.data);
    }

    // Recortar respuestas largas para que la captura siga siendo legible.
    const MAX = 1200;
    const clipped = text.length > MAX ? `${text.slice(0, MAX)}\n… (recortado)` : text;
    return `<pre class="body">${this.escape(clipped)}</pre>`;
  }

  /** Tabla de órdenes vistas por el middleware, hayan llegado o no al POS. */
  private renderSeenOrders(): string {
    const orders = certificationService.getSeenOrders();
    if (!orders.length) {
      return `<tr><td colspan="4" class="empty">Aún no se detectan órdenes. Genera un pedido de prueba en Uber.</td></tr>`;
    }

    return orders
      .map(
        (o) => `
        <tr>
          <td><a href="?orderId=${encodeURIComponent(o.orderId)}"><code>${this.escape(o.orderId)}</code></a></td>
          <td>${o.events.map((e) => `<code>${this.escape(e)}</code>`).join(' ') || '—'}</td>
          <td>${this.escape(o.disposition || 'Sin registrar')}</td>
          <td><span class="ts">${this.escape(o.lastSeenAt)}</span></td>
        </tr>`
      )
      .join('');
  }

  /** Opciones del selector: órdenes que el POS tiene en memoria. */
  private renderOrderOptions(): string {
    return orderStore
      .list()
      .map(
        (o) =>
          `<option value="${this.escape(o.id)}">#${this.escape(o.orderNumber)} — ${this.escape(o.status)}</option>`
      )
      .join('');
  }

  /** Ayuda contextual: qué órdenes hay disponibles y para qué sirve cada estado. */
  private renderOrderHint(): string {
    const orders = orderStore.list();
    if (!orders.length) {
      return 'No hay órdenes en memoria. Genera un pedido de prueba en Uber, o pega el UUID manualmente.';
    }
    const pending = orders.filter((o) => o.status === 'pending').length;
    const accepted = orders.filter((o) => o.status === 'preparing').length;
    return (
      `${orders.length} orden(es) en memoria — ${pending} pendiente(s), ${accepted} aceptada(s). ` +
      'Deny requiere una orden <b>pendiente</b>; Cancel, Mark Ready y Resolve requieren una <b>aceptada</b>.'
    );
  }

  private escape(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export const certificationController = new CertificationController();
