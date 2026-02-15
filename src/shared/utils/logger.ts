/**
 * Logging utility for CropTwin platform
 * Provides structured logging with different levels and context
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogContext {
  farmerId?: string;
  twinId?: string;
  advisoryId?: string;
  functionName?: string;
  requestId?: string;
  correlationId?: string;
  [key: string]: any;
}

export class Logger {
  private context: LogContext;
  private logLevel: LogLevel;

  constructor(context: LogContext = {}, logLevel: LogLevel = LogLevel.INFO) {
    this.context = context;
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL || logLevel);
  }

  private parseLogLevel(level: string): LogLevel {
    const upperLevel = level.toUpperCase();
    return Object.values(LogLevel).includes(upperLevel as LogLevel) 
      ? (upperLevel as LogLevel) 
      : LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.context,
      data,
    };

    return JSON.stringify(logEntry);
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, data));
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage(LogLevel.INFO, message, data));
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, data));
    }
  }

  error(message: string, error?: Error | any, data?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorData = {
        ...data,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : error,
      };
      console.error(this.formatMessage(LogLevel.ERROR, message, errorData));
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext }, this.logLevel);
  }

  /**
   * Add context to the current logger
   */
  addContext(additionalContext: LogContext): void {
    this.context = { ...this.context, ...additionalContext };
  }

  /**
   * Log performance metrics
   */
  performance(operation: string, duration: number, data?: any): void {
    this.info(`Performance: ${operation}`, {
      operation,
      duration,
      unit: 'ms',
      ...data,
    });
  }

  /**
   * Log audit events
   */
  audit(action: string, resource: string, userId?: string, data?: any): void {
    this.info(`Audit: ${action}`, {
      action,
      resource,
      userId,
      auditEvent: true,
      ...data,
    });
  }

  /**
   * Log security events
   */
  security(event: string, severity: 'low' | 'medium' | 'high' | 'critical', data?: any): void {
    this.warn(`Security: ${event}`, {
      event,
      severity,
      securityEvent: true,
      ...data,
    });
  }
}

/**
 * Create a logger instance for Lambda functions
 */
export function createLambdaLogger(functionName: string, requestId?: string): Logger {
  return new Logger({
    functionName,
    requestId: requestId || process.env.AWS_REQUEST_ID,
    correlationId: process.env.CORRELATION_ID,
  });
}

/**
 * Performance measurement decorator
 */
export function measurePerformance(logger: Logger, operation: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      try {
        const result = await method.apply(this, args);
        const duration = Date.now() - startTime;
        logger.performance(operation, duration);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.performance(operation, duration, { error: true });
        throw error;
      }
    };

    return descriptor;
  };
}