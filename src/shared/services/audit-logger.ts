/**
 * Audit Logging Service
 * Implements comprehensive audit logging for all data access and modifications
 * Validates: Requirements 8.6
 */

export enum AuditEventType {
  // Data access events
  DATA_READ = 'data_read',
  DATA_QUERY = 'data_query',
  DATA_EXPORT = 'data_export',
  
  // Data modification events
  DATA_CREATE = 'data_create',
  DATA_UPDATE = 'data_update',
  DATA_DELETE = 'data_delete',
  
  // Security events
  AUTHENTICATION = 'authentication',
  AUTHORIZATION_FAILURE = 'authorization_failure',
  CONSENT_GRANTED = 'consent_granted',
  CONSENT_REVOKED = 'consent_revoked',
  
  // Privacy events
  DATA_ANONYMIZATION = 'data_anonymization',
  DATA_ENCRYPTION = 'data_encryption',
  DATA_DECRYPTION = 'data_decryption',
  
  // Lifecycle events
  DATA_ARCHIVED = 'data_archived',
  DATA_RESTORED = 'data_restored',
  DATA_PURGED = 'data_purged',
  
  // System events
  SYSTEM_ERROR = 'system_error',
  CONFIGURATION_CHANGE = 'configuration_change',
  COST_ALERT = 'cost_alert'
}

export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface AuditLogEntry {
  eventId: string;
  timestamp: Date;
  eventType: AuditEventType;
  severity: AuditSeverity;
  userId?: string;
  farmerId?: string;
  twinId?: string;
  resourceType: string;
  resourceId?: string;
  action: string;
  result: 'success' | 'failure' | 'partial';
  ipAddress?: string;
  userAgent?: string;
  metadata: Record<string, any>;
  errorMessage?: string;
  dataChanges?: DataChange[];
}

export interface DataChange {
  field: string;
  oldValue?: any;
  newValue?: any;
  changeType: 'create' | 'update' | 'delete';
}

export interface AuditQuery {
  startDate?: Date;
  endDate?: Date;
  eventTypes?: AuditEventType[];
  userId?: string;
  farmerId?: string;
  twinId?: string;
  resourceType?: string;
  severity?: AuditSeverity[];
  limit?: number;
  offset?: number;
}

export interface AuditSummary {
  totalEvents: number;
  eventsByType: Record<AuditEventType, number>;
  eventsBySeverity: Record<AuditSeverity, number>;
  failureRate: number;
  topUsers: Array<{ userId: string; eventCount: number }>;
  topResources: Array<{ resourceType: string; resourceId: string; eventCount: number }>;
  timeRange: { start: Date; end: Date };
}

export class AuditLogger {
  private logBuffer: AuditLogEntry[] = [];
  private readonly bufferSize: number = 100;
  private readonly flushIntervalMs: number = 5000;
  private flushTimer?: NodeJS.Timeout;

  constructor(
    private readonly persistLog: (entries: AuditLogEntry[]) => Promise<void>,
    bufferSize?: number,
    flushIntervalMs?: number
  ) {
    if (bufferSize) this.bufferSize = bufferSize;
    if (flushIntervalMs) this.flushIntervalMs = flushIntervalMs;
    this.startAutoFlush();
  }

  /**
   * Log a data access event
   */
  async logDataAccess(params: {
    userId?: string;
    farmerId?: string;
    twinId?: string;
    resourceType: string;
    resourceId?: string;
    action: string;
    result: 'success' | 'failure';
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const entry: AuditLogEntry = {
      eventId: this.generateEventId(),
      timestamp: new Date(),
      eventType: AuditEventType.DATA_READ,
      severity: params.result === 'failure' ? AuditSeverity.WARNING : AuditSeverity.INFO,
      userId: params.userId,
      farmerId: params.farmerId,
      twinId: params.twinId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      action: params.action,
      result: params.result,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: params.metadata || {}
    };

    await this.addToBuffer(entry);
  }

  /**
   * Log a data modification event
   */
  async logDataModification(params: {
    userId?: string;
    farmerId?: string;
    twinId?: string;
    resourceType: string;
    resourceId?: string;
    action: string;
    result: 'success' | 'failure' | 'partial';
    dataChanges?: DataChange[];
    metadata?: Record<string, any>;
    errorMessage?: string;
  }): Promise<void> {
    let eventType: AuditEventType;
    if (params.action.includes('create')) {
      eventType = AuditEventType.DATA_CREATE;
    } else if (params.action.includes('delete')) {
      eventType = AuditEventType.DATA_DELETE;
    } else {
      eventType = AuditEventType.DATA_UPDATE;
    }

    const entry: AuditLogEntry = {
      eventId: this.generateEventId(),
      timestamp: new Date(),
      eventType,
      severity: params.result === 'failure' ? AuditSeverity.ERROR : AuditSeverity.INFO,
      userId: params.userId,
      farmerId: params.farmerId,
      twinId: params.twinId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      action: params.action,
      result: params.result,
      metadata: params.metadata || {},
      errorMessage: params.errorMessage,
      dataChanges: params.dataChanges
    };

    await this.addToBuffer(entry);
  }

  /**
   * Log a security event
   */
  async logSecurityEvent(params: {
    eventType: AuditEventType.AUTHENTICATION | AuditEventType.AUTHORIZATION_FAILURE | 
                AuditEventType.CONSENT_GRANTED | AuditEventType.CONSENT_REVOKED;
    userId?: string;
    farmerId?: string;
    action: string;
    result: 'success' | 'failure';
    metadata?: Record<string, any>;
    ipAddress?: string;
    errorMessage?: string;
  }): Promise<void> {
    const entry: AuditLogEntry = {
      eventId: this.generateEventId(),
      timestamp: new Date(),
      eventType: params.eventType,
      severity: params.result === 'failure' ? AuditSeverity.WARNING : AuditSeverity.INFO,
      userId: params.userId,
      farmerId: params.farmerId,
      resourceType: 'security',
      action: params.action,
      result: params.result,
      ipAddress: params.ipAddress,
      metadata: params.metadata || {},
      errorMessage: params.errorMessage
    };

    await this.addToBuffer(entry);
  }

  /**
   * Log a privacy event
   */
  async logPrivacyEvent(params: {
    eventType: AuditEventType.DATA_ANONYMIZATION | AuditEventType.DATA_ENCRYPTION | 
                AuditEventType.DATA_DECRYPTION;
    userId?: string;
    farmerId?: string;
    resourceType: string;
    resourceId?: string;
    action: string;
    result: 'success' | 'failure';
    metadata?: Record<string, any>;
  }): Promise<void> {
    const entry: AuditLogEntry = {
      eventId: this.generateEventId(),
      timestamp: new Date(),
      eventType: params.eventType,
      severity: params.result === 'failure' ? AuditSeverity.ERROR : AuditSeverity.INFO,
      userId: params.userId,
      farmerId: params.farmerId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      action: params.action,
      result: params.result,
      metadata: params.metadata || {}
    };

    await this.addToBuffer(entry);
  }

  /**
   * Log a lifecycle event
   */
  async logLifecycleEvent(params: {
    eventType: AuditEventType.DATA_ARCHIVED | AuditEventType.DATA_RESTORED | 
                AuditEventType.DATA_PURGED;
    userId?: string;
    resourceType: string;
    resourceId?: string;
    action: string;
    result: 'success' | 'failure';
    metadata?: Record<string, any>;
  }): Promise<void> {
    const entry: AuditLogEntry = {
      eventId: this.generateEventId(),
      timestamp: new Date(),
      eventType: params.eventType,
      severity: AuditSeverity.INFO,
      userId: params.userId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      action: params.action,
      result: params.result,
      metadata: params.metadata || {}
    };

    await this.addToBuffer(entry);
  }

  /**
   * Log a system event
   */
  async logSystemEvent(params: {
    eventType: AuditEventType.SYSTEM_ERROR | AuditEventType.CONFIGURATION_CHANGE | 
                AuditEventType.COST_ALERT;
    severity: AuditSeverity;
    action: string;
    result: 'success' | 'failure';
    metadata?: Record<string, any>;
    errorMessage?: string;
  }): Promise<void> {
    const entry: AuditLogEntry = {
      eventId: this.generateEventId(),
      timestamp: new Date(),
      eventType: params.eventType,
      severity: params.severity,
      resourceType: 'system',
      action: params.action,
      result: params.result,
      metadata: params.metadata || {},
      errorMessage: params.errorMessage
    };

    await this.addToBuffer(entry);
  }

  /**
   * Query audit logs
   */
  async queryLogs(
    query: AuditQuery,
    retrieveLogs: (query: AuditQuery) => Promise<AuditLogEntry[]>
  ): Promise<AuditLogEntry[]> {
    // Flush buffer before querying to ensure latest logs are included
    await this.flush();
    return retrieveLogs(query);
  }

  /**
   * Generate audit summary
   */
  async generateSummary(
    query: AuditQuery,
    retrieveLogs: (query: AuditQuery) => Promise<AuditLogEntry[]>
  ): Promise<AuditSummary> {
    const logs = await this.queryLogs(query, retrieveLogs);

    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = {};
    const userCounts: Record<string, number> = {};
    const resourceCounts: Record<string, number> = {};
    let failureCount = 0;

    for (const log of logs) {
      // Count by type
      eventsByType[log.eventType] = (eventsByType[log.eventType] || 0) + 1;

      // Count by severity
      eventsBySeverity[log.severity] = (eventsBySeverity[log.severity] || 0) + 1;

      // Count failures
      if (log.result === 'failure') {
        failureCount++;
      }

      // Count by user
      if (log.userId) {
        userCounts[log.userId] = (userCounts[log.userId] || 0) + 1;
      }

      // Count by resource
      if (log.resourceId) {
        const key = `${log.resourceType}:${log.resourceId}`;
        resourceCounts[key] = (resourceCounts[key] || 0) + 1;
      }
    }

    const topUsers = Object.entries(userCounts)
      .map(([userId, eventCount]) => ({ userId, eventCount }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 10);

    const topResources = Object.entries(resourceCounts)
      .map(([key, eventCount]) => {
        const [resourceType, resourceId] = key.split(':');
        return { resourceType, resourceId, eventCount };
      })
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 10);

    const timeRange = {
      start: query.startDate || new Date(Math.min(...logs.map(l => l.timestamp.getTime()))),
      end: query.endDate || new Date(Math.max(...logs.map(l => l.timestamp.getTime())))
    };

    return {
      totalEvents: logs.length,
      eventsByType: eventsByType as Record<AuditEventType, number>,
      eventsBySeverity: eventsBySeverity as Record<AuditSeverity, number>,
      failureRate: logs.length > 0 ? failureCount / logs.length : 0,
      topUsers,
      topResources,
      timeRange
    };
  }

  /**
   * Flush buffered logs to persistent storage
   */
  async flush(): Promise<void> {
    if (this.logBuffer.length === 0) {
      return;
    }

    const entries = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await this.persistLog(entries);
    } catch (error) {
      // If persistence fails, restore entries to buffer
      this.logBuffer.unshift(...entries);
      throw error;
    }
  }

  /**
   * Stop auto-flush timer
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private async addToBuffer(entry: AuditLogEntry): Promise<void> {
    this.logBuffer.push(entry);

    if (this.logBuffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        console.error('Auto-flush failed:', error);
      });
    }, this.flushIntervalMs);
  }

  private generateEventId(): string {
    return `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
