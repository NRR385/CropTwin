/**
 * System Resilience Service
 * Provides centralized resilience and fallback mechanisms for external service failures
 * Implements cached data usage, historical pattern fallback, and degraded service indicators
 * 
 * **Validates: Requirements 7.2**
 */

import { Logger } from '../utils/logger';
import { DynamoDBHelper } from '../utils/dynamodb-helper';
import { EventBridge } from 'aws-sdk';
import { getEnvironment } from '../config/environment';
import { 
  WeatherData, 
  SatelliteData, 
  SoilData, 
  CropCalendar,
  DataQuality,
  ExternalData 
} from '../../types/external-data';
import { Coordinates } from '../../types/core';

/**
 * Service health status enumeration
 */
export enum ServiceStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNAVAILABLE = 'unavailable'
}

/**
 * Service health information
 */
export interface ServiceHealth {
  serviceName: string;
  status: ServiceStatus;
  lastSuccessfulCall?: Date;
  lastFailure?: Date;
  failureCount: number;
  usingFallback: boolean;
  fallbackType?: 'cached' | 'historical' | 'regional_default';
  message?: string;
}

/**
 * Fallback data options
 */
export interface FallbackOptions {
  maxCacheAge?: number; // Maximum age of cached data in hours
  useHistoricalPatterns?: boolean;
  useRegionalDefaults?: boolean;
  confidencePenalty?: number; // Penalty to apply to data quality (0-1)
}

/**
 * Degraded service event
 */
export interface DegradedServiceEvent {
  serviceName: string;
  dataType: string;
  reason: string;
  fallbackUsed: boolean;
  fallbackType?: string;
  timestamp: Date;
  severity: 'warning' | 'error' | 'critical';
  location?: Coordinates;
  region?: string;
}

/**
 * System Resilience Service
 * Manages fallback mechanisms and service health tracking
 */
export class ResilienceService {
  private logger: Logger;
  private dynamoHelper: DynamoDBHelper;
  private eventBridge: EventBridge;
  private config: any;
  private serviceHealthMap: Map<string, ServiceHealth>;

  constructor(logger: Logger) {
    this.logger = logger;
    this.dynamoHelper = new DynamoDBHelper();
    this.eventBridge = new EventBridge();
    this.config = getEnvironment();
    this.serviceHealthMap = new Map();
  }

  /**
   * Get cached data for a specific data type and location
   * Returns most recent data within the specified maximum age
   */
  async getCachedData<T>(
    dataType: 'weather' | 'satellite' | 'soil' | 'crop_calendar',
    location: Coordinates | string,
    maxAgeHours: number = 24
  ): Promise<T | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = typeof location === 'string' 
        ? location 
        : `${location.latitude},${location.longitude}`;
      
      const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

      this.logger.debug('Retrieving cached data', { 
        dataType, 
        locationKey, 
        maxAgeHours,
        cutoffTime 
      });

      // Query for recent data
      const items = await this.dynamoHelper.queryItems(
        tableName,
        'dataType = :dataType AND #timestamp >= :cutoff',
        {
          ':dataType': dataType,
          ':cutoff': cutoffTime.toISOString(),
        },
        'DataTypeIndex',
        10,
        false // Most recent first
      );

      // Filter by location and get most recent
      const matchingItems = items.filter(item => {
        if (item.location === locationKey) {
          return true;
        }
        // For crop calendar, match by state
        if (dataType === 'crop_calendar' && item.location && item.location.includes(locationKey)) {
          return true;
        }
        return false;
      });

      if (matchingItems.length > 0 && matchingItems[0].data) {
        const externalData: ExternalData = JSON.parse(matchingItems[0].data);
        
        this.logger.info('Cached data retrieved successfully', { 
          dataType, 
          locationKey,
          dataAge: Date.now() - new Date(externalData.timestamp).getTime(),
          quality: externalData.data.quality 
        });

        // Apply confidence penalty to indicate data is cached
        const cachedData = this.applyCachePenalty(externalData.data, maxAgeHours);
        return cachedData as T;
      }

      this.logger.warn('No cached data found', { dataType, locationKey, maxAgeHours });
      return null;

    } catch (error) {
      this.logger.error('Failed to retrieve cached data', error, { dataType, location });
      return null;
    }
  }

  /**
   * Get historical pattern data for fallback
   * Analyzes historical data to provide pattern-based estimates
   */
  async getHistoricalPatternData<T>(
    dataType: 'weather' | 'satellite' | 'soil' | 'crop_calendar',
    location: Coordinates | string,
    daysBack: number = 30
  ): Promise<T | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = typeof location === 'string' 
        ? location 
        : `${location.latitude},${location.longitude}`;
      
      const cutoffTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      this.logger.debug('Retrieving historical pattern data', { 
        dataType, 
        locationKey, 
        daysBack 
      });

      // Query for historical data
      const items = await this.dynamoHelper.queryItems(
        tableName,
        'dataType = :dataType AND #timestamp >= :cutoff',
        {
          ':dataType': dataType,
          ':cutoff': cutoffTime.toISOString(),
        },
        'DataTypeIndex',
        100, // Get more items for pattern analysis
        false
      );

      // Filter by location
      const matchingItems = items.filter(item => item.location === locationKey);

      if (matchingItems.length === 0) {
        this.logger.warn('No historical data found for pattern analysis', { 
          dataType, 
          locationKey, 
          daysBack 
        });
        return null;
      }

      // Analyze patterns based on data type
      let patternData: any;
      switch (dataType) {
        case 'weather':
          patternData = this.analyzeWeatherPatterns(matchingItems);
          break;
        case 'satellite':
          patternData = this.analyzeSatellitePatterns(matchingItems);
          break;
        case 'soil':
          // Soil data doesn't change rapidly, use most recent
          patternData = matchingItems[0] ? JSON.parse(matchingItems[0].data).data : null;
          break;
        case 'crop_calendar':
          // Crop calendar is seasonal, use most recent
          patternData = matchingItems[0] ? JSON.parse(matchingItems[0].data).data : null;
          break;
        default:
          patternData = null;
      }

      if (patternData) {
        this.logger.info('Historical pattern data generated', { 
          dataType, 
          locationKey,
          samplesUsed: matchingItems.length 
        });

        // Apply confidence penalty for historical patterns
        const penalizedData = this.applyHistoricalPenalty(patternData);
        return penalizedData as T;
      }

      return null;

    } catch (error) {
      this.logger.error('Failed to retrieve historical pattern data', error, { 
        dataType, 
        location 
      });
      return null;
    }
  }

  /**
   * Analyze weather patterns from historical data
   */
  private analyzeWeatherPatterns(items: any[]): WeatherData | null {
    if (items.length === 0) return null;

    try {
      const weatherDataPoints = items.map(item => {
        const externalData: ExternalData = JSON.parse(item.data);
        return externalData.data as WeatherData;
      });

      // Calculate averages for current weather
      const avgTemp = this.calculateAverage(weatherDataPoints.map(w => w.current.temperature));
      const avgHumidity = this.calculateAverage(weatherDataPoints.map(w => w.current.humidity));
      const avgWindSpeed = this.calculateAverage(weatherDataPoints.map(w => w.current.windSpeed));
      const avgPressure = this.calculateAverage(weatherDataPoints.map(w => w.current.pressure));

      // Use most recent data as template
      const template = weatherDataPoints[0];

      // Create pattern-based weather data
      const patternData: WeatherData = {
        ...template,
        timestamp: new Date(),
        current: {
          ...template.current,
          temperature: avgTemp,
          humidity: avgHumidity,
          windSpeed: avgWindSpeed,
          pressure: avgPressure,
        },
        quality: {
          completeness: 0.7,
          accuracy: 0.6,
          timeliness: 0.5,
          lastValidated: new Date(),
          issues: ['Generated from historical patterns', 'Reduced accuracy due to fallback'],
        },
      };

      return patternData;

    } catch (error) {
      this.logger.error('Failed to analyze weather patterns', error);
      return null;
    }
  }

  /**
   * Analyze satellite patterns from historical data
   */
  private analyzeSatellitePatterns(items: any[]): SatelliteData | null {
    if (items.length === 0) return null;

    try {
      const satelliteDataPoints = items.map(item => {
        const externalData: ExternalData = JSON.parse(item.data);
        return externalData.data as SatelliteData;
      });

      // Calculate averages for vegetation indices
      const avgNDVI = this.calculateAverage(satelliteDataPoints.map(s => s.vegetationIndex.ndvi));
      const avgEVI = this.calculateAverage(satelliteDataPoints.map(s => s.vegetationIndex.evi));
      const avgLAI = this.calculateAverage(satelliteDataPoints.map(s => s.vegetationIndex.lai));
      const avgFPAR = this.calculateAverage(satelliteDataPoints.map(s => s.vegetationIndex.fpar));

      // Use most recent data as template
      const template = satelliteDataPoints[0];

      // Create pattern-based satellite data
      const patternData: SatelliteData = {
        ...template,
        captureDate: new Date(),
        vegetationIndex: {
          ndvi: avgNDVI,
          evi: avgEVI,
          lai: avgLAI,
          fpar: avgFPAR,
          confidence: 0.5, // Lower confidence for pattern-based data
        },
        quality: {
          completeness: 0.7,
          accuracy: 0.5,
          timeliness: 0.4,
          lastValidated: new Date(),
          issues: ['Generated from historical patterns', 'Reduced accuracy due to fallback'],
        },
      };

      return patternData;

    } catch (error) {
      this.logger.error('Failed to analyze satellite patterns', error);
      return null;
    }
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
   * Apply confidence penalty to cached data
   */
  private applyCachePenalty(data: any, cacheAgeHours: number): any {
    if (!data || !data.quality) return data;

    // Calculate penalty based on cache age
    const agePenalty = Math.min(cacheAgeHours / 24, 1) * 0.2; // Up to 20% penalty

    const penalizedData = {
      ...data,
      quality: {
        ...data.quality,
        timeliness: Math.max(0, data.quality.timeliness - agePenalty),
        issues: [
          ...(data.quality.issues || []),
          `Using cached data (${cacheAgeHours}h old)`,
        ],
      },
    };

    return penalizedData;
  }

  /**
   * Apply confidence penalty to historical pattern data
   */
  private applyHistoricalPenalty(data: any): any {
    if (!data || !data.quality) return data;

    const penalizedData = {
      ...data,
      quality: {
        ...data.quality,
        accuracy: Math.max(0, data.quality.accuracy - 0.3),
        timeliness: Math.max(0, data.quality.timeliness - 0.4),
        issues: [
          ...(data.quality.issues || []),
          'Generated from historical patterns',
          'Reduced accuracy and timeliness',
        ],
      },
    };

    return penalizedData;
  }

  /**
   * Record service failure and update health status
   */
  async recordServiceFailure(
    serviceName: string,
    error: Error,
    context?: any
  ): Promise<void> {
    try {
      const health = this.serviceHealthMap.get(serviceName) || {
        serviceName,
        status: ServiceStatus.HEALTHY,
        failureCount: 0,
        usingFallback: false,
      };

      health.lastFailure = new Date();
      health.failureCount += 1;
      health.message = error.message;

      // Update status based on failure count
      if (health.failureCount >= 3) {
        health.status = ServiceStatus.UNAVAILABLE;
      } else if (health.failureCount >= 1) {
        health.status = ServiceStatus.DEGRADED;
      }

      this.serviceHealthMap.set(serviceName, health);

      this.logger.error('Service failure recorded', error, {
        serviceName,
        failureCount: health.failureCount,
        status: health.status,
        ...context,
      });

      // Publish degraded service event if status changed
      if (health.status !== ServiceStatus.HEALTHY) {
        await this.publishDegradedServiceEvent({
          serviceName,
          dataType: context?.dataType || 'unknown',
          reason: error.message,
          fallbackUsed: health.usingFallback,
          fallbackType: health.fallbackType,
          timestamp: new Date(),
          severity: health.status === ServiceStatus.UNAVAILABLE ? 'critical' : 'warning',
          location: context?.location,
          region: context?.region,
        });
      }

    } catch (err) {
      this.logger.error('Failed to record service failure', err);
    }
  }

  /**
   * Record successful service call and update health status
   */
  recordServiceSuccess(serviceName: string): void {
    const health = this.serviceHealthMap.get(serviceName) || {
      serviceName,
      status: ServiceStatus.HEALTHY,
      failureCount: 0,
      usingFallback: false,
    };

    health.lastSuccessfulCall = new Date();
    health.failureCount = 0;
    health.status = ServiceStatus.HEALTHY;
    health.usingFallback = false;
    health.fallbackType = undefined;
    health.message = undefined;

    this.serviceHealthMap.set(serviceName, health);

    this.logger.debug('Service success recorded', { serviceName });
  }

  /**
   * Mark service as using fallback
   */
  markServiceUsingFallback(
    serviceName: string,
    fallbackType: 'cached' | 'historical' | 'regional_default'
  ): void {
    const health = this.serviceHealthMap.get(serviceName) || {
      serviceName,
      status: ServiceStatus.DEGRADED,
      failureCount: 0,
      usingFallback: true,
      fallbackType,
    };

    health.usingFallback = true;
    health.fallbackType = fallbackType;
    health.status = ServiceStatus.DEGRADED;

    this.serviceHealthMap.set(serviceName, health);

    this.logger.info('Service using fallback', { 
      serviceName, 
      fallbackType,
      status: health.status 
    });
  }

  /**
   * Get service health status
   */
  getServiceHealth(serviceName: string): ServiceHealth | null {
    return this.serviceHealthMap.get(serviceName) || null;
  }

  /**
   * Get all service health statuses
   */
  getAllServiceHealth(): ServiceHealth[] {
    return Array.from(this.serviceHealthMap.values());
  }

  /**
   * Check if system is in degraded state
   */
  isSystemDegraded(): boolean {
    const services = this.getAllServiceHealth();
    return services.some(s => s.status !== ServiceStatus.HEALTHY);
  }

  /**
   * Get degraded services
   */
  getDegradedServices(): ServiceHealth[] {
    return this.getAllServiceHealth().filter(
      s => s.status === ServiceStatus.DEGRADED || s.status === ServiceStatus.UNAVAILABLE
    );
  }

  /**
   * Publish degraded service event to EventBridge
   */
  private async publishDegradedServiceEvent(event: DegradedServiceEvent): Promise<void> {
    try {
      const eventDetail = {
        serviceName: event.serviceName,
        dataType: event.dataType,
        reason: event.reason,
        fallbackUsed: event.fallbackUsed,
        fallbackType: event.fallbackType,
        timestamp: event.timestamp.toISOString(),
        severity: event.severity,
        location: event.location,
        region: event.region,
      };

      const params = {
        Entries: [
          {
            Source: 'croptwin.resilience',
            DetailType: 'Degraded Service Alert',
            Detail: JSON.stringify(eventDetail),
            EventBusName: this.config.eventBusName,
          },
        ],
      };

      await this.eventBridge.putEvents(params).promise();
      
      this.logger.warn('Degraded service event published', eventDetail);

    } catch (error) {
      this.logger.error('Failed to publish degraded service event', error);
      // Don't throw - event publishing failure shouldn't stop fallback mechanisms
    }
  }

  /**
   * Execute operation with automatic fallback
   * Wraps an operation with resilience mechanisms
   */
  async executeWithFallback<T>(
    serviceName: string,
    dataType: 'weather' | 'satellite' | 'soil' | 'crop_calendar',
    location: Coordinates | string,
    primaryOperation: () => Promise<T>,
    options: FallbackOptions = {}
  ): Promise<T> {
    const {
      maxCacheAge = 24,
      useHistoricalPatterns = true,
      useRegionalDefaults = false,
      confidencePenalty = 0.2,
    } = options;

    try {
      // Try primary operation
      const result = await primaryOperation();
      this.recordServiceSuccess(serviceName);
      return result;

    } catch (primaryError) {
      this.logger.warn('Primary operation failed, attempting fallback', {
        serviceName,
        dataType,
        error: (primaryError as Error).message,
      });

      await this.recordServiceFailure(serviceName, primaryError as Error, {
        dataType,
        location,
      });

      // Try cached data first
      try {
        const cachedData = await this.getCachedData<T>(dataType, location, maxCacheAge);
        if (cachedData) {
          this.markServiceUsingFallback(serviceName, 'cached');
          this.logger.info('Using cached data as fallback', { 
            serviceName, 
            dataType,
            maxCacheAge 
          });
          return cachedData;
        }
      } catch (cacheError) {
        this.logger.warn('Cached data fallback failed', { 
          error: (cacheError as Error).message 
        });
      }

      // Try historical patterns if enabled
      if (useHistoricalPatterns) {
        try {
          const historicalData = await this.getHistoricalPatternData<T>(
            dataType,
            location,
            30
          );
          if (historicalData) {
            this.markServiceUsingFallback(serviceName, 'historical');
            this.logger.info('Using historical patterns as fallback', { 
              serviceName, 
              dataType 
            });
            return historicalData;
          }
        } catch (historicalError) {
          this.logger.warn('Historical pattern fallback failed', { 
            error: (historicalError as Error).message 
          });
        }
      }

      // If all fallbacks fail, throw the original error
      this.logger.error('All fallback mechanisms exhausted', primaryError as Error, {
        serviceName,
        dataType,
        location,
      });

      throw primaryError;
    }
  }

  /**
   * Clear service health status (useful for testing)
   */
  clearServiceHealth(serviceName?: string): void {
    if (serviceName) {
      this.serviceHealthMap.delete(serviceName);
    } else {
      this.serviceHealthMap.clear();
    }
  }
}
