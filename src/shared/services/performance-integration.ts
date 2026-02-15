/**
 * Performance Integration Module
 * Provides easy integration of performance monitoring into Lambda functions
 * 
 * **Validates: Requirements 7.3, 7.4, 7.6**
 */

import { PerformanceMonitor } from './performance-monitor';
import { Logger } from '../utils/logger';

/**
 * Singleton instance of PerformanceMonitor
 */
let performanceMonitorInstance: PerformanceMonitor | null = null;

/**
 * Get or create the PerformanceMonitor singleton instance
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  if (!performanceMonitorInstance) {
    const logger = new Logger({ functionName: 'PerformanceMonitor' });
    performanceMonitorInstance = new PerformanceMonitor(logger);
  }
  return performanceMonitorInstance;
}

/**
 * Decorator to track farm registration performance
 * Wraps a Lambda handler to automatically track registration time
 */
export function trackFarmRegistration<T extends (...args: any[]) => Promise<any>>(
  handler: T
): T {
  return (async (...args: any[]) => {
    const startTime = new Date();
    let farmTwinId: string | undefined;
    
    try {
      const result = await handler(...args);
      
      // Extract farmTwinId from result if available
      if (result && typeof result === 'object') {
        const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
        farmTwinId = body?.twinId || body?.farmTwinId;
      }
      
      // Track successful registration
      if (farmTwinId) {
        const endTime = new Date();
        const monitor = getPerformanceMonitor();
        await monitor.trackFarmRegistration(farmTwinId, startTime, endTime, {
          success: true,
          statusCode: result?.statusCode
        });
      }
      
      return result;
    } catch (error) {
      // Track failed registration
      const endTime = new Date();
      const monitor = getPerformanceMonitor();
      
      if (farmTwinId) {
        await monitor.trackFarmRegistration(farmTwinId, startTime, endTime, {
          success: false,
          error: (error as Error).message
        });
      }
      
      throw error;
    }
  }) as T;
}

/**
 * Decorator to track advisory delivery performance
 * Wraps a function to automatically track delivery time
 */
export function trackAdvisoryDelivery<T extends (...args: any[]) => Promise<any>>(
  handler: T
): T {
  return (async (...args: any[]) => {
    const detectionTime = new Date();
    let advisoryId: string | undefined;
    let priority: string = 'medium';
    
    try {
      const result = await handler(...args);
      const deliveryTime = new Date();
      
      // Extract advisory info from arguments or result
      if (args.length > 0 && typeof args[0] === 'object') {
        advisoryId = args[0].advisoryId || args[0].id;
        priority = args[0].priority || args[0].urgency || 'medium';
      }
      
      // Track successful delivery
      if (advisoryId) {
        const monitor = getPerformanceMonitor();
        await monitor.trackAdvisoryDelivery(
          advisoryId,
          detectionTime,
          deliveryTime,
          priority,
          {
            success: true,
            channel: args[0]?.channel || 'unknown'
          }
        );
      }
      
      return result;
    } catch (error) {
      // Track failed delivery
      const deliveryTime = new Date();
      const monitor = getPerformanceMonitor();
      
      if (advisoryId) {
        await monitor.trackAdvisoryDelivery(
          advisoryId,
          detectionTime,
          deliveryTime,
          priority,
          {
            success: false,
            error: (error as Error).message
          }
        );
      }
      
      throw error;
    }
  }) as T;
}

/**
 * Manual tracking helper for farm registration
 * Use when decorator pattern is not suitable
 */
export async function manualTrackFarmRegistration(
  farmTwinId: string,
  startTime: Date,
  endTime: Date,
  metadata?: any
): Promise<void> {
  const monitor = getPerformanceMonitor();
  await monitor.trackFarmRegistration(farmTwinId, startTime, endTime, metadata);
}

/**
 * Manual tracking helper for advisory delivery
 * Use when decorator pattern is not suitable
 */
export async function manualTrackAdvisoryDelivery(
  advisoryId: string,
  detectionTime: Date,
  deliveryTime: Date,
  priority: string,
  metadata?: any
): Promise<void> {
  const monitor = getPerformanceMonitor();
  await monitor.trackAdvisoryDelivery(advisoryId, detectionTime, deliveryTime, priority, metadata);
}

/**
 * Track concurrent twins count
 */
export async function trackConcurrentTwins(count: number, metadata?: any): Promise<void> {
  const monitor = getPerformanceMonitor();
  await monitor.trackConcurrentTwins(count, metadata);
}

/**
 * Trigger auto-scaling analysis
 */
export async function triggerAutoScaling(timeWindowMinutes: number = 60): Promise<any> {
  const monitor = getPerformanceMonitor();
  return await monitor.analyzeDemandAndScale(timeWindowMinutes);
}

/**
 * Get performance summary
 */
export async function getPerformanceSummary(hoursBack: number = 1): Promise<any> {
  const monitor = getPerformanceMonitor();
  return await monitor.getPerformanceSummary(hoursBack);
}

/**
 * Identify demand patterns
 */
export async function identifyDemandPatterns(hoursBack: number = 24): Promise<any> {
  const monitor = getPerformanceMonitor();
  return await monitor.identifyDemandPatterns(hoursBack);
}
