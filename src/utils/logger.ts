/**
 * Production-safe logger utility
 * Logs are only shown in development mode to avoid exposing internal details in production
 */

const isDev = import.meta.env.DEV || import.meta.env.VITE_APP_ENV === 'development';

type LogLevel = 'debug' | 'log' | 'warn' | 'error';

interface LoggerOptions {
  prefix?: string;
  forceLog?: boolean;
}

class Logger {
  private prefix: string;
  private forceLog: boolean;

  constructor(options: LoggerOptions = {}) {
    this.prefix = options.prefix || '';
    this.forceLog = options.forceLog || false;
  }

  private shouldLog(level: LogLevel): boolean {
    // Always log errors
    if (level === 'error') return true;
    // In dev mode, log everything
    if (isDev) return true;
    // Force log if configured
    if (this.forceLog) return true;
    // Otherwise, don't log in production
    return false;
  }

  private formatMessage(emoji: string, ...args: unknown[]): unknown[] {
    if (this.prefix) {
      return [`${emoji} [${this.prefix}]`, ...args];
    }
    return [emoji, ...args];
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(...this.formatMessage('🔍', ...args));
    }
  }

  log(...args: unknown[]): void {
    if (this.shouldLog('log')) {
      console.log(...this.formatMessage('📋', ...args));
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog('log')) {
      console.info(...this.formatMessage('ℹ️', ...args));
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(...this.formatMessage('⚠️', ...args));
    }
  }

  error(...args: unknown[]): void {
    // Errors are always logged
    console.error(...this.formatMessage('❌', ...args));
  }

  // Performance logging
  time(label: string): void {
    if (this.shouldLog('debug')) {
      console.time(`⏱️ ${this.prefix ? `[${this.prefix}] ` : ''}${label}`);
    }
  }

  timeEnd(label: string): void {
    if (this.shouldLog('debug')) {
      console.timeEnd(`⏱️ ${this.prefix ? `[${this.prefix}] ` : ''}${label}`);
    }
  }

  // Create a child logger with a prefix
  child(prefix: string): Logger {
    return new Logger({
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
      forceLog: this.forceLog,
    });
  }
}

// Default logger instance
export const logger = new Logger();

// Named loggers for different modules
export const routingLogger = new Logger({ prefix: 'Routing' });
export const cacheLogger = new Logger({ prefix: 'Cache' });
export const configLogger = new Logger({ prefix: 'Config' });

// Export class for custom instances
export { Logger };
