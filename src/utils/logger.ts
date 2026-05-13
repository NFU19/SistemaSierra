/**
 * Utilidad de logging centralizada
 */

import { config } from '../config/config';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

class Logger {
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(
      (config.logLevel.toUpperCase() as LogLevel) || LogLevel.INFO
    );
    return levels.indexOf(level) >= currentLevelIndex;
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`[${this.getTimestamp()}] [${LogLevel.DEBUG}] ${message}`, data || '');
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`[${this.getTimestamp()}] [${LogLevel.INFO}] ${message}`, data || '');
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`[${this.getTimestamp()}] [${LogLevel.WARN}] ${message}`, data || '');
    }
  }

  error(message: string, error?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`[${this.getTimestamp()}] [${LogLevel.ERROR}] ${message}`, error || '');
    }
  }
}

export const logger = new Logger();
