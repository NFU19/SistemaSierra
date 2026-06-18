/**
 * Order Store + broadcaster en tiempo real para el POS.
 *
 * Mantiene las órdenes con su estado (máquina de estados) y notifica a los
 * clientes SSE cada vez que algo cambia, empujando la lista completa.
 *
 * Estados:
 *   pending   → llegó de Uber, espera acción del operador (Aceptar/Denegar)
 *   preparing → aceptada: creada en Sierra + confirmada en Uber
 *   completed → el operador la marcó como completada
 *   denied    → rechazada (se elimina poco después)
 *   expired   → no se aceptó dentro del límite de Uber (se elimina)
 *   error     → falló el procesamiento
 */

import { EventEmitter } from 'node:events';
import { OrderTicket } from '../interfaces/sierra.interface';

interface OrderDetailItem {
  name: string;
  plu: string;
  quantity: number;
  unitPrice: number;
  total: number;
  customizations: { title: string; selections: string[] }[];
}

export interface OrderDetails {
  orderNumber: string;
  status: string;
  customer: { name: string; phone: string };
  items: OrderDetailItem[];
  totals: {
    subtotal: number;
    tax: number;
    delivery_fee: number;
    promotion: number;
    total: number;
    currency: string;
  };
}

export type OrderStatus =
  | 'pending'
  | 'preparing'
  | 'completed'
  | 'denied'
  | 'expired'
  | 'error';

export interface PosOrder {
  id: string; // UUID de la orden en Uber
  orderNumber: string;
  status: OrderStatus;
  receivedAt: string; // ISO
  deadline: string | null; // ISO: fecha límite para aceptar
  details?: OrderDetails;
  ticket?: OrderTicket; // Ticket listo para enviar a Sierra al aceptar
  sierraOrderId?: string;
  message?: string;
}

class OrderStore extends EventEmitter {
  private readonly orders = new Map<string, PosOrder>();
  private readonly MAX_ORDERS = 100;
  // Tiempo que una orden denegada/expirada permanece visible antes de quitarse (ms)
  private readonly REMOVE_DELAY = 10000;

  constructor() {
    super();
    // Revisar expiraciones cada 10s. unref() para no impedir que el proceso termine.
    const timer = setInterval(() => this.checkExpirations(), 10000);
    timer.unref?.();
  }

  /** Inserta o reemplaza una orden y notifica. */
  upsert(order: PosOrder): void {
    this.orders.set(order.id, order);
    this.trim();
    this.broadcast();
  }

  get(id: string): PosOrder | undefined {
    return this.orders.get(id);
  }

  /** Lista las órdenes ordenadas de más reciente a más antigua. */
  list(): PosOrder[] {
    return [...this.orders.values()].sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt)
    );
  }

  /** Actualiza el estado (y campos opcionales) de una orden. */
  setStatus(id: string, status: OrderStatus, patch: Partial<PosOrder> = {}): PosOrder | undefined {
    const order = this.orders.get(id);
    if (!order) return undefined;
    Object.assign(order, patch, { status });
    this.broadcast();
    return order;
  }

  /** Elimina una orden inmediatamente. */
  remove(id: string): void {
    if (this.orders.delete(id)) {
      this.broadcast();
    }
  }

  /** Marca como denegada y la quita tras un breve periodo. */
  markDeniedAndRemove(id: string, message = 'Rechazada'): void {
    if (!this.orders.has(id)) return;
    this.setStatus(id, 'denied', { message });
    setTimeout(() => this.remove(id), this.REMOVE_DELAY);
  }

  /** Quita las órdenes terminales más antiguas si excedemos el máximo. */
  private trim(): void {
    if (this.orders.size <= this.MAX_ORDERS) return;
    const terminal: OrderStatus[] = ['completed', 'denied', 'expired', 'error'];
    const removable = this.list()
      .reverse()
      .filter((o) => terminal.includes(o.status));
    while (this.orders.size > this.MAX_ORDERS && removable.length > 0) {
      const old = removable.shift();
      if (old) this.orders.delete(old.id);
    }
  }

  private checkExpirations(): void {
    const now = Date.now();
    let changed = false;
    for (const order of this.orders.values()) {
      if (order.status === 'pending' && order.deadline) {
        if (new Date(order.deadline).getTime() <= now) {
          order.status = 'expired';
          order.message = 'No se aceptó a tiempo (Uber la canceló)';
          changed = true;
          setTimeout(() => this.remove(order.id), this.REMOVE_DELAY);
        }
      }
    }
    if (changed) this.broadcast();
  }

  private broadcast(): void {
    this.emit('orders-updated', this.list());
  }
}

export const orderStore = new OrderStore();
