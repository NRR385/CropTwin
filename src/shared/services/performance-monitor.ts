/**
 * Performance Monitoring and Auto-Scaling Service
 * Tracks system performance metrics and implements auto-scaling logic
 * 
 * **Validates: Requirements 7.3, 7.4, 7.6**
 */

import { Logger } from '../utils/logger';
import { DynamoDBHelper } from '../utils/dynamodb-helper';
import { EventBridge, CloudWatch } from 'aws-sdk';
import { getEnvironment } from '../config/environment';

/**
 * Performance metric types
 */
export enum MetricType {
  FARM_REGISTRATION_TIME = 'farm_registration_time',
  ADVISORY_DELIVERY_TIME = 'advisory_delivery_time',
  CONCURRENT_TWINS = 'concurrent_twins',
  API_RESPONSE_TIME = 'api_response_time',
  DATA_PROCESSING_TIME = 'data_processing_time',
  SYSTEM_LOAD = 'system_load'
}

/**
 * Performance metric data
 */
export interface PerformanceMetric {
  metricId: string;
  metricType: MetricType;
  value: number;
  unit: string;
  timestamp: Date;
  metadata?: {
    farmTwinId?: string;
    advisoryId?: string;
    operationType?: string;
    region?: string;
    [key: string]: any;
  };
}

/**
 * Performance threshold configuration
 */
export interface PerformanceThreshold {
  metricType: MetricType;
  warningThreshold: number;
  criticalThreshold: number;
  unit: string;
  evaluationPeriod: number; // seconds
}

/**
 * Auto-scaling decision
 */
export interface ScalingDecision {
  timestamp: Date;
  action: 'scale_up' | 'scale_down' | 'no_action';
  reason: string;
  currentLoad: number;
  targetCapacity: number;
  metrics: {
    avgRegistrationTime: number;
    avgDeliveryTime: number;
    concurrentTwins: number;
    systemLoad: number;
  };
}

/**
 * Performance alert
 */
export interface PerformanceAlert {
  alertId: string;
  metricType: MetricType;
  severity: 'warning' | 'critical';
  message: string;
  currentValue: number;
  threshold: number;
  timestamp: Date;
  metadata?: any;
}

/**
 * Demand pattern analysis
 */
export interface DemandPattern {
  timeWindow: string; // e.g., "2024-01-15T10:00:00Z to 2024-01-15T11:00:00Z"
  avgLoad: number;
  peakLoad: number;
  registrationCount: number;
  advisoryCount: number;
  pattern: 'low' | 'normal' | 'high' | 'peak';
  recommendation: string;
}

/**
 * Performance Monitoring Service
 */
export class PerformanceMonitor {
  private logger: Logger;
  private dynamoHelper: DynamoDBHelper;
  private eventBridge: EventBridge;
  private cloudWatch: CloudWatch;
  private config: any;
  private thresholds: Map<MetricType, PerformanceThreshold>;
  private metricsBuffer: PerformanceMetric[];
  private bufferFlushInterval: number = 60000; // 1 minute

  constructor(logger: Logger) {
    this.logger = logger;
    this.dynamoHelper = new DynamoDBHelper();
    this.eventBridge = new EventBridge();
    this.cloudWatch = new CloudWatch();
    this.config = getEnvironment();
    this.thresholds = this.initializeThresholds();
    this.metricsBuffer = [];
    
    // Start periodic buffer flush
    this.startBufferFlush();
  }

  /**
   * Track farm registration processing time
   * Requirement 7.3: Process new farm registrations within 5 minutes
   */
  async trackFarmRegistration(
    farmTwinId: string,
    startTime: Date,
    endTime: Date,
    metadata?: any
  ): Promise<void> {
    const processingTime = (endTime.getTime() - startTime.getTime()) / 1000; // seconds
    
    const metric: PerformanceMetric = {
      metricId: `reg-${farmTwinId}-${Date.now()}`,
      metricType: MetricType.FARM_REGISTRATION_TIME,
      value: processingTime,
      unit: 'seconds',
      timestamp: endTime,
      metadata: {
        farmTwinId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        ...metadata
      }
    };

    await this.recordMetric(metric);

    // Check against threshold (5 minutes = 300 seconds)
    const threshold = this.thresholds.get(MetricType.FARM_REGISTRATION_TIME);
    if (threshold && processingTime > threshold.warningThreshold) {
      await this.raisePerformanceAlert({
        alertId: `alert-reg-${farmTwinId}-${Date.now()}`,
        metricType: MetricType.FARM_REGISTRATION_TIME,
        severity: processingTime > threshold.criticalThreshold ? 'critical' : 'warning',
        message: `Farm registration took ${processingTime.toFixed(2)}s (threshold: ${threshold.warningThreshold}s)`,
        currentValue: processingTime,
        threshold: threshold.warningThreshold,
        timestamp: endTime,
        metadata: { farmTwinId, ...metadata }
      });
    }

    this.logger.info('Farm registration tracked', {
      farmTwinId,
      processingTime: `${processingTime.toFixed(2)}s`,
      withinSLA: processingTime <= 300
    });
  }

  /**
   * Track urgent advisory delivery time
   * Requirement 7.4: Deliver urgent advisories within 2 hours of detection
   */
  async trackAdvisoryDelivery(
    advisoryId: string,
    detectionTime: Date,
    deliveryTime: Date,
    priority: string,
    metadata?: any
  ): Promise<void> {
    const deliveryDuration = (deliveryTime.getTime() - detectionTime.getTime()) / 1000; // seconds
    
    const metric: PerformanceMetric = {
      metricId: `adv-${advisoryId}-${Date.now()}`,
      metricType: MetricType.ADVISORY_DELIVERY_TIME,
      value: deliveryDuration,
      unit: 'seconds',
      timestamp: deliveryTime,
      metadata: {
        advisoryId,
        priority,
        detectionTime: detectionTime.toISOString(),
        deliveryTime: deliveryTime.toISOString(),
        ...metadata
      }
    };

    await this.recordMetric(metric);

    // Check against threshold for urgent advisories (2 hours = 7200 seconds)
    if (priority === 'high') {
      const threshold = this.thresholds.get(MetricType.ADVISORY_DELIVERY_TIME);
      if (threshold && deliveryDuration > threshold.warningThreshold) {
        await this.raisePerformanceAlert({
          alertId: `alert-adv-${advisoryId}-${Date.now()}`,
          metricType: MetricType.ADVISORY_DELIVERY_TIME,
          severity: deliveryDuration > threshold.criticalThreshold ? 'critical' : 'warning',
          message: `Urgent advisory delivery took ${(deliveryDuration / 60).toFixed(2)} minutes (threshold: ${threshold.warningThreshold / 60} minutes)`,
          currentValue: deliveryDuration,
          threshold: threshold.warningThreshold,
          timestamp: deliveryTime,
          metadata: { advisoryId, priority, ...metadata }
        });
      }
    }

    this.logger.info('Advisory delivery tracked', {
      advisoryId,
      priority,
      deliveryDuration: `${(deliveryDuration / 60).toFixed(2)} minutes`,
      withinSLA: priority !== 'high' || deliveryDuration <= 7200
    });
  }

  /**
   * Track concurrent active farm twins
   * Requirement 7.5: Handle concurrent access from up to 100,000 active farm twins
   */
  async trackConcurrentTwins(count: number, metadata?: any): Promise<void> {
    const metric: PerformanceMetric = {
      metricId: `twins-${Date.now()}`,
      metricType: MetricType.CONCURRENT_TWINS,
      value: count,
      unit: 'count',
      timestamp: new Date(),
      metadata
    };

    await this.recordMetric(metric);

    this.logger.debug('Concurrent twins tracked', { count });
  }

  /**
   * Analyze demand patterns and make auto-scaling decisions
   * Requirement 7.6: Automatically scale computing resources based on demand
   */
  async analyzeDemandAndScale(timeWindowMinutes: number = 60): Promise<ScalingDecision> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - timeWindowMinutes * 60 * 1000);

    // Retrieve metrics from the time window
    const metrics = await this.getMetricsInTimeWindow(startTime, endTime);

    // Calculate average metrics
    const registrationMetrics = metrics.filter(m => m.metricType === MetricType.FARM_REGISTRATION_TIME);
    const deliveryMetrics = metrics.filter(m => m.metricType === MetricType.ADVISORY_DELIVERY_TIME);
    const twinMetrics = metrics.filter(m => m.metricType === MetricType.CONCURRENT_TWINS);

    const avgRegistrationTime = this.calculateAverage(registrationMetrics.map(m => m.value));
    const avgDeliveryTime = this.calculateAverage(deliveryMetrics.map(m => m.value));
    const concurrentTwins = twinMetrics.length > 0 ? Math.max(...twinMetrics.map(m => m.value)) : 0;

    // Calculate system load (0-1 scale)
    const systemLoad = this.calculateSystemLoad(avgRegistrationTime, avgDeliveryTime, concurrentTwins);

    // Make scaling decision
    const decision = this.makeScalingDecision(systemLoad, {
      avgRegistrationTime,
      avgDeliveryTime,
      concurrentTwins,
      systemLoad
    });

    // Publish scaling decision event
    await this.publishScalingEvent(decision);

    this.logger.info('Auto-scaling decision made', {
      action: decision.action,
      reason: decision.reason,
      systemLoad: decision.currentLoad.toFixed(2),
      targetCapacity: decision.targetCapacity
    });

    return decision;
  }

  /**
   * Identify demand patterns for capacity planning
   */
  async identifyDemandPatterns(hoursBack: number = 24): Promise<DemandPattern[]> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);

    const metrics = await this.getMetricsInTimeWindow(startTime, endTime);

    // Group metrics by hour
    const hourlyPatterns: DemandPattern[] = [];
    const hoursToAnalyze = Math.ceil(hoursBack);

    for (let i = 0; i < hoursToAnalyze; i++) {
      const windowStart = new Date(startTime.getTime() + i * 60 * 60 * 1000);
      const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);

      const windowMetrics = metrics.filter(m => {
        const metricTime = new Date(m.timestamp);
        return metricTime >= windowStart && metricTime < windowEnd;
      });

      const registrationCount = windowMetrics.filter(m => m.metricType === MetricType.FARM_REGISTRATION_TIME).length;
      const advisoryCount = windowMetrics.filter(m => m.metricType === MetricType.ADVISORY_DELIVERY_TIME).length;
      const twinCounts = windowMetrics
        .filter(m => m.metricType === MetricType.CONCURRENT_TWINS)
        .map(m => m.value);

      const avgLoad = twinCounts.length > 0 ? this.calculateAverage(twinCounts) : 0;
      const peakLoad = twinCounts.length > 0 ? Math.max(...twinCounts) : 0;

      // Classify pattern
      let pattern: 'low' | 'normal' | 'high' | 'peak';
      let recommendation: string;

      if (peakLoad < 10000) {
        pattern = 'low';
        recommendation = 'Consider scaling down to reduce costs';
      } else if (peakLoad < 50000) {
        pattern = 'normal';
        recommendation = 'Maintain current capacity';
      } else if (peakLoad < 80000) {
        pattern = 'high';
        recommendation = 'Monitor closely, prepare for scaling up';
      } else {
        pattern = 'peak';
        recommendation = 'Scale up immediately to handle load';
      }

      hourlyPatterns.push({
        timeWindow: `${windowStart.toISOString()} to ${windowEnd.toISOString()}`,
        avgLoad,
        peakLoad,
        registrationCount,
        advisoryCount,
        pattern,
        recommendation
      });
    }

    this.logger.info('Demand patterns identified', {
      hoursAnalyzed: hoursToAnalyze,
      patternsFound: hourlyPatterns.length
    });

    return hourlyPatterns;
  }

  /**
   * Get performance summary for monitoring dashboard
   */
  async getPerformanceSummary(hoursBack: number = 1): Promise<any> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);

    const metrics = await this.getMetricsInTimeWindow(startTime, endTime);

    const registrationMetrics = metrics.filter(m => m.metricType === MetricType.FARM_REGISTRATION_TIME);
    const deliveryMetrics = metrics.filter(m => m.metricType === MetricType.ADVISORY_DELIVERY_TIME);
    const twinMetrics = metrics.filter(m => m.metricType === MetricType.CONCURRENT_TWINS);

    // Calculate SLA compliance
    const registrationSLA = registrationMetrics.filter(m => m.value <= 300).length / Math.max(registrationMetrics.length, 1);
    const urgentDeliverySLA = deliveryMetrics
      .filter(m => m.metadata?.priority === 'high')
      .filter(m => m.value <= 7200).length / 
      Math.max(deliveryMetrics.filter(m => m.metadata?.priority === 'high').length, 1);

    return {
      timeWindow: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        durationHours: hoursBack
      },
      farmRegistrations: {
        count: registrationMetrics.length,
        avgTime: this.calculateAverage(registrationMetrics.map(m => m.value)),
        maxTime: registrationMetrics.length > 0 ? Math.max(...registrationMetrics.map(m => m.value)) : 0,
        minTime: registrationMetrics.length > 0 ? Math.min(...registrationMetrics.map(m => m.value)) : 0,
        slaCompliance: registrationSLA,
        slaTarget: 300 // 5 minutes
      },
      advisoryDelivery: {
        count: deliveryMetrics.length,
        urgentCount: deliveryMetrics.filter(m => m.metadata?.priority === 'high').length,
        avgTime: this.calculateAverage(deliveryMetrics.map(m => m.value)),
        maxTime: deliveryMetrics.length > 0 ? Math.max(...deliveryMetrics.map(m => m.value)) : 0,
        minTime: deliveryMetrics.length > 0 ? Math.min(...deliveryMetrics.map(m => m.value)) : 0,
        urgentSlaCompliance: urgentDeliverySLA,
        slaTarget: 7200 // 2 hours
      },
      concurrentTwins: {
        current: twinMetrics.length > 0 ? twinMetrics[twinMetrics.length - 1].value : 0,
        peak: twinMetrics.length > 0 ? Math.max(...twinMetrics.map(m => m.value)) : 0,
        avg: this.calculateAverage(twinMetrics.map(m => m.value)),
        capacity: 100000
      },
      systemHealth: {
        status: registrationSLA >= 0.95 && urgentDeliverySLA >= 0.95 ? 'healthy' : 'degraded',
        registrationSLA: `${(registrationSLA * 100).toFixed(2)}%`,
        deliverySLA: `${(urgentDeliverySLA * 100).toFixed(2)}%`
      }
    };
  }

  /**
   * Record a performance metric
   */
  private async recordMetric(metric: PerformanceMetric): Promise<void> {
    // Add to buffer
    this.metricsBuffer.push(metric);

    // Also send to CloudWatch for real-time monitoring
    try {
      await this.cloudWatch.putMetricData({
        Namespace: 'CropTwin/Performance',
        MetricData: [{
          MetricName: metric.metricType,
          Value: metric.value,
          Unit: this.mapUnitToCloudWatch(metric.unit),
          Timestamp: metric.timestamp,
          Dimensions: this.extractDimensions(metric.metadata)
        }]
      }).promise();
    } catch (error) {
      this.logger.warn('Failed to send metric to CloudWatch', { error: (error as Error).message });
    }
  }

  /**
   * Flush metrics buffer to DynamoDB
   */
  private async flushMetricsBuffer(): Promise<void> {
    if (this.metricsBuffer.length === 0) return;

    const metricsToFlush = [...this.metricsBuffer];
    this.metricsBuffer = [];

    try {
      const tableName = this.config.performanceMetricsTableName || 'performance-metrics';
      
      // Batch write to DynamoDB
      for (const metric of metricsToFlush) {
        await this.dynamoHelper.putItem(tableName, {
          metricId: metric.metricId,
          metricType: metric.metricType,
          value: metric.value,
          unit: metric.unit,
          timestamp: metric.timestamp.toISOString(),
          metadata: metric.metadata,
          ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30 days TTL
        });
      }

      this.logger.debug('Metrics buffer flushed', { count: metricsToFlush.length });
    } catch (error) {
      this.logger.error('Failed to flush metrics buffer', error);
      // Re-add failed metrics to buffer
      this.metricsBuffer.push(...metricsToFlush);
    }
  }

  /**
   * Start periodic buffer flush
   */
  private startBufferFlush(): void {
    setInterval(() => {
      this.flushMetricsBuffer().catch(error => {
        this.logger.error('Error in periodic buffer flush', error);
      });
    }, this.bufferFlushInterval);
  }

  /**
   * Get metrics within a time window
   */
  private async getMetricsInTimeWindow(startTime: Date, endTime: Date): Promise<PerformanceMetric[]> {
    try {
      const tableName = this.config.performanceMetricsTableName || 'performance-metrics';
      
      const items = await this.dynamoHelper.queryItems(
        tableName,
        '#timestamp BETWEEN :start AND :end',
        {
          ':start': startTime.toISOString(),
          ':end': endTime.toISOString()
        },
        'TimestampIndex',
        1000,
        false
      );

      return items.map(item => ({
        metricId: item.metricId,
        metricType: item.metricType,
        value: item.value,
        unit: item.unit,
        timestamp: new Date(item.timestamp),
        metadata: item.metadata
      }));
    } catch (error) {
      this.logger.error('Failed to retrieve metrics', error);
      return [];
    }
  }

  /**
   * Calculate system load based on metrics
   */
  private calculateSystemLoad(
    avgRegistrationTime: number,
    avgDeliveryTime: number,
    concurrentTwins: number
  ): number {
    // Normalize each metric to 0-1 scale
    const registrationLoad = Math.min(avgRegistrationTime / 300, 1); // 300s = 5 min threshold
    const deliveryLoad = Math.min(avgDeliveryTime / 7200, 1); // 7200s = 2 hour threshold
    const twinLoad = Math.min(concurrentTwins / 100000, 1); // 100k capacity

    // Weighted average (twins have highest weight)
    return (registrationLoad * 0.2 + deliveryLoad * 0.3 + twinLoad * 0.5);
  }

  /**
   * Make auto-scaling decision based on system load
   */
  private makeScalingDecision(systemLoad: number, metrics: any): ScalingDecision {
    const timestamp = new Date();
    let action: 'scale_up' | 'scale_down' | 'no_action';
    let reason: string;
    let targetCapacity: number;

    // Current capacity (simplified - in production would query actual infrastructure)
    const currentCapacity = 1.0;

    if (systemLoad > 0.8) {
      action = 'scale_up';
      reason = 'System load exceeds 80%, scaling up to maintain performance';
      targetCapacity = Math.min(currentCapacity * 1.5, 3.0); // Scale up by 50%, max 3x
    } else if (systemLoad < 0.3) {
      action = 'scale_down';
      reason = 'System load below 30%, scaling down to optimize costs';
      targetCapacity = Math.max(currentCapacity * 0.7, 0.5); // Scale down by 30%, min 0.5x
    } else {
      action = 'no_action';
      reason = 'System load within acceptable range (30-80%)';
      targetCapacity = currentCapacity;
    }

    return {
      timestamp,
      action,
      reason,
      currentLoad: systemLoad,
      targetCapacity,
      metrics
    };
  }

  /**
   * Publish scaling event to EventBridge
   */
  private async publishScalingEvent(decision: ScalingDecision): Promise<void> {
    if (decision.action === 'no_action') return;

    try {
      const params = {
        Entries: [{
          Source: 'croptwin.performance',
          DetailType: 'Auto-Scaling Decision',
          Detail: JSON.stringify({
            action: decision.action,
            reason: decision.reason,
            currentLoad: decision.currentLoad,
            targetCapacity: decision.targetCapacity,
            metrics: decision.metrics,
            timestamp: decision.timestamp.toISOString()
          }),
          EventBusName: this.config.eventBusName
        }]
      };

      await this.eventBridge.putEvents(params).promise();
      this.logger.info('Scaling event published', { action: decision.action });
    } catch (error) {
      this.logger.error('Failed to publish scaling event', error);
    }
  }

  /**
   * Raise performance alert
   */
  private async raisePerformanceAlert(alert: PerformanceAlert): Promise<void> {
    try {
      // Store alert in DynamoDB
      const tableName = this.config.performanceAlertsTableName || 'performance-alerts';
      await this.dynamoHelper.putItem(tableName, {
        ...alert,
        timestamp: alert.timestamp.toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days TTL
      });

      // Publish alert event
      const params = {
        Entries: [{
          Source: 'croptwin.performance',
          DetailType: 'Performance Alert',
          Detail: JSON.stringify(alert),
          EventBusName: this.config.eventBusName
        }]
      };

      await this.eventBridge.putEvents(params).promise();
      
      this.logger.warn('Performance alert raised', {
        alertId: alert.alertId,
        severity: alert.severity,
        metricType: alert.metricType,
        message: alert.message
      });
    } catch (error) {
      this.logger.error('Failed to raise performance alert', error);
    }
  }

  /**
   * Initialize performance thresholds
   */
  private initializeThresholds(): Map<MetricType, PerformanceThreshold> {
    const thresholds = new Map<MetricType, PerformanceThreshold>();

    // Farm registration: 5 minutes (300s) target
    thresholds.set(MetricType.FARM_REGISTRATION_TIME, {
      metricType: MetricType.FARM_REGISTRATION_TIME,
      warningThreshold: 240, // 4 minutes
      criticalThreshold: 300, // 5 minutes
      unit: 'seconds',
      evaluationPeriod: 300
    });

    // Urgent advisory delivery: 2 hours (7200s) target
    thresholds.set(MetricType.ADVISORY_DELIVERY_TIME, {
      metricType: MetricType.ADVISORY_DELIVERY_TIME,
      warningThreshold: 5400, // 90 minutes
      criticalThreshold: 7200, // 2 hours
      unit: 'seconds',
      evaluationPeriod: 7200
    });

    // Concurrent twins: 100,000 capacity
    thresholds.set(MetricType.CONCURRENT_TWINS, {
      metricType: MetricType.CONCURRENT_TWINS,
      warningThreshold: 80000, // 80% capacity
      criticalThreshold: 95000, // 95% capacity
      unit: 'count',
      evaluationPeriod: 300
    });

    return thresholds;
  }

  /**
   * Calculate average of numeric array
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }

  /**
   * Map unit to CloudWatch unit
   */
  private mapUnitToCloudWatch(unit: string): string {
    const unitMap: { [key: string]: string } = {
      'seconds': 'Seconds',
      'milliseconds': 'Milliseconds',
      'count': 'Count',
      'percent': 'Percent',
      'bytes': 'Bytes'
    };
    return unitMap[unit] || 'None';
  }

  /**
   * Extract dimensions from metadata for CloudWatch
   */
  private extractDimensions(metadata?: any): any[] {
    if (!metadata) return [];

    const dimensions: any[] = [];
    
    if (metadata.region) {
      dimensions.push({ Name: 'Region', Value: metadata.region });
    }
    if (metadata.priority) {
      dimensions.push({ Name: 'Priority', Value: metadata.priority });
    }
    if (metadata.operationType) {
      dimensions.push({ Name: 'OperationType', Value: metadata.operationType });
    }

    return dimensions;
  }

  /**
   * Cleanup - flush remaining metrics
   */
  async cleanup(): Promise<void> {
    await this.flushMetricsBuffer();
  }
}
