/**
 * Servicio de Eventos - Sistema de broadcast para órdenes procesadas
 * Permite que múltiples clientes reciban actualizaciones en tiempo real
 */

import { EventEmitter } from 'node:events';
import { OrderTicket } from '../interfaces/sierra.interface';

interface ProcessedOrder {
  id: string;
  uberOrderId: string;
  timestamp: string;
  status: 'processing' | 'success' | 'error';
  message: string;
  orderData?: OrderTicket;
  errorDetails?: any;
}

class EventService extends EventEmitter {
  private processedOrders: ProcessedOrder[] = [];
  private readonly MAX_ORDERS_HISTORY = 100;

  /**
   * Emite un evento de orden procesada
   */
  emitOrderProcessed(order: ProcessedOrder): void {
    // Agregar al historial (mantener últimas 100)
    this.processedOrders.unshift(order);
    if (this.processedOrders.length > this.MAX_ORDERS_HISTORY) {
      this.processedOrders.pop();
    }

    // Emitir a todos los listeners
    this.emit('order-processed', order);
  }

  /**
   * Emite un evento de error en procesamiento
   */
  emitOrderError(orderId: string, error: any): void {
    const order: ProcessedOrder = {
      id: `err_${orderId}_${Date.now()}`,
      uberOrderId: orderId,
      timestamp: new Date().toISOString(),
      status: 'error',
      message: error.message || 'Error desconocido',
      errorDetails: error,
    };

    this.emitOrderProcessed(order);
  }

  /**
   * Obtiene el historial de órdenes
   */
  getOrdersHistory(): ProcessedOrder[] {
    return [...this.processedOrders];
  }

  /**
   * Limpia el historial de órdenes.
   * Sin uso actual — disponible para endpoints de administración futuros.
   */
  clearHistory(): void {
    this.processedOrders = [];
  }
}

export const eventService = new EventService();
