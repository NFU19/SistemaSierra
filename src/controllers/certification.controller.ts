/**
 * Controlador del panel de Certificación de Uber Eats.
 *
 * Sirve una página pensada para CAPTURAR EVIDENCIA: muestra, por cada requisito de Uber,
 * el método, la ruta y el código HTTP devuelto, además del registro de webhooks recibidos
 * con su código de reconocimiento.
 */

import { Request, Response } from 'express';
import { logger } from '../utils/logger';
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

        const detail = check.skipped
          ? this.escape(check.skipped)
          : `<code>${this.escape((check.result?.method || '').toUpperCase())} ${this.escape(check.result?.path || '')}</code>`;

        const action = check.mutating
          ? `<button onclick="runCheck('${check.id}', this)">Ejecutar</button>`
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

  <h2>Webhooks recibidos y reconocidos</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Evento</th><th>Orden</th><th class="center">Ack</th></tr></thead>
    <tbody>${webhookRows}</tbody>
  </table>
</div>

<script>
  const params = new URLSearchParams(location.search);
  async function runCheck(id, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Ejecutando...';
    try {
      const orderId = params.get('orderId') || '';
      const url = '/api/certification/run/' + id + (orderId ? '?orderId=' + encodeURIComponent(orderId) : '');
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      const status = data.result && data.result.status;
      const cell = btn.closest('tr').querySelector('td.center');
      const okRange = status >= 200 && status < 300;
      cell.innerHTML = '<span class="badge ' + (okRange ? 'ok' : 'fail') + '">' + (status || 'error') + '</span>';
      const callCell = btn.closest('tr').children[1];
      if (data.result && data.result.path) {
        callCell.innerHTML = '<code>' + (data.result.method || '').toUpperCase() + ' ' + data.result.path + '</code>';
      }
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

  private escape(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export const certificationController = new CertificationController();
