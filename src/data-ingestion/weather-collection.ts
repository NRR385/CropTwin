/**
 * Weather Data Collection Lambda Function
 * Collects weather data from IMD (India Meteorological Department) API
 * Scheduled to run every 6 hours via EventBridge
 */

import { Handler, ScheduledEvent } from 'aws-lambda';
import { EventBridge } from 'aws-sdk';
import axios, { AxiosResponse } from 'axios';
import { createLambdaLogger, Logger } from '../shared/utils/logger';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { Validator } from '../shared/utils/validation';
import { getEnvironment } from '../shared/config/environment';
import { 
  WeatherData, 
  CurrentWeather, 
  WeatherForecast, 
  WeatherRecord, 
  DataQuality,
  ExternalData,
  ExternalDataMetadata 
} from '../types/external-data';
import { Coordinates, ValidationResult } from '../types/core';

interface IMDWeatherResponse {
  current: {
    temp: number;
    humidity: number;
    wind_speed: number;
    wind_deg: number;
    pressure: number;
    visibility: number;
    uv: number;
    clouds: number;
    dew_point: number;
    rain?: {
      '1h'?: number;
    };
  };
  daily: Array<{
    dt: number;
    temp: {
      min: number;
      max: number;
      day: number;
    };
    humidity: number;
    pop: number;
    rain?: number;
    wind_speed: number;
    weather: Array<{
      main: string;
      description: string;
    }>;
  }>;
  hourly: Array<{
    dt: number;
    temp: number;
    humidity: number;
    rain?: {
      '1h'?: number;
    };
    wind_speed: number;
  }>;
}

interface WeatherCollectionEvent extends ScheduledEvent {
  regions?: string[];
  forceRefresh?: boolean;
}

export class WeatherCollectionService {
  private logger: Logger;
  private dynamoHelper: DynamoDBHelper;
  private eventBridge: EventBridge;
  private config: any;

  constructor(logger: Logger) {
    this.logger = logger;
    this.dynamoHelper = new DynamoDBHelper();
    this.eventBridge = new EventBridge();
    this.config = getEnvironment();
  }

  /**
   * Main handler for weather data collection
   */
  async collectWeatherData(event: WeatherCollectionEvent): Promise<void> {
    this.logger.info('Starting weather data collection', { 
      regions: event.regions,
      forceRefresh: event.forceRefresh 
    });

    try {
      // Get list of regions to collect data for
      const regions = event.regions || await this.getActiveRegions();
      
      const collectionResults = [];
      
      for (const region of regions) {
        try {
          const coordinates = await this.parseRegionCoordinates(region);
          const weatherData = await this.fetchWeatherDataForLocation(coordinates, region);
          
          if (weatherData) {
            await this.storeWeatherData(weatherData);
            await this.publishWeatherDataEvent(weatherData);
            collectionResults.push({ region, status: 'success' });
            
            this.logger.info('Weather data collected successfully', { 
              region, 
              location: coordinates 
            });
          }
        } catch (error) {
          this.logger.error('Failed to collect weather data for region', error, { region });
          collectionResults.push({ region, status: 'failed', error: (error as Error).message });
          
          // Try to use cached data as fallback
          await this.handleWeatherDataFailure(region, error as Error);
        }
      }

      this.logger.info('Weather data collection completed', { 
        totalRegions: regions.length,
        successful: collectionResults.filter(r => r.status === 'success').length,
        failed: collectionResults.filter(r => r.status === 'failed').length
      });

    } catch (error) {
      this.logger.error('Weather data collection failed', error);
      throw error;
    }
  }

  /**
   * Fetch weather data from IMD API for a specific location
   */
  private async fetchWeatherDataForLocation(
    coordinates: Coordinates, 
    region: string
  ): Promise<WeatherData | null> {
    const startTime = Date.now();
    
    try {
      // Validate coordinates
      const coordValidation = Validator.validateCoordinates(coordinates);
      if (!coordValidation.isValid) {
        throw new Error(`Invalid coordinates: ${coordValidation.errors.join(', ')}`);
      }

      // Check if we have recent data (within last 4 hours) unless force refresh
      const existingData = await this.getExistingWeatherData(coordinates);
      if (existingData && !this.shouldRefreshData(existingData)) {
        this.logger.info('Using existing weather data', { 
          region, 
          lastUpdated: existingData.timestamp 
        });
        return existingData;
      }

      // Fetch from IMD API
      const apiUrl = this.buildIMDApiUrl(coordinates);
      const response = await this.makeIMDApiCall(apiUrl);
      
      if (!response || !response.data) {
        throw new Error('No data received from IMD API');
      }

      // Transform IMD response to our weather data format
      const weatherData = this.transformIMDResponse(response.data, coordinates, region);
      
      // Validate the transformed data
      const validation = this.validateWeatherData(weatherData);
      if (!validation.isValid) {
        throw new Error(`Invalid weather data: ${validation.errors.join(', ')}`);
      }

      const duration = Date.now() - startTime;
      this.logger.performance('fetchWeatherDataForLocation', duration, { region });

      return weatherData;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.performance('fetchWeatherDataForLocation', duration, { 
        region, 
        error: true 
      });
      
      this.logger.error('Failed to fetch weather data', error, { 
        region, 
        coordinates 
      });
      
      throw error;
    }
  }

  /**
   * Build IMD API URL for weather data request
   */
  private buildIMDApiUrl(coordinates: Coordinates): string {
    const baseUrl = this.config.imdApiUrl;
    const apiKey = this.config.imdApiKey;
    
    if (!apiKey) {
      throw new Error('IMD API key not configured');
    }

    // IMD API endpoint for current weather and forecast
    return `${baseUrl}/data/2.5/onecall?lat=${coordinates.latitude}&lon=${coordinates.longitude}&appid=${apiKey}&units=metric&exclude=minutely,alerts`;
  }

  /**
   * Make API call to IMD with retry logic and error handling
   */
  private async makeIMDApiCall(url: string): Promise<AxiosResponse<IMDWeatherResponse>> {
    const maxRetries = this.config.maxRetries;
    const timeout = this.config.defaultTimeout;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug('Making IMD API call', { url, attempt });
        
        const response = await axios.get<IMDWeatherResponse>(url, {
          timeout,
          headers: {
            'User-Agent': 'CropTwin/1.0',
            'Accept': 'application/json',
          },
        });

        if (response.status === 200) {
          return response;
        }

        throw new Error(`API returned status ${response.status}`);

      } catch (error) {
        this.logger.warn('IMD API call failed', { 
          attempt, 
          maxRetries, 
          error: (error as Error).message 
        });

        if (attempt === maxRetries) {
          throw new Error(`IMD API call failed after ${maxRetries} attempts: ${(error as Error).message}`);
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await this.sleep(delay);
      }
    }

    throw new Error('Unexpected error in IMD API call');
  }

  /**
   * Transform IMD API response to our WeatherData format
   */
  private transformIMDResponse(
    imdData: IMDWeatherResponse, 
    coordinates: Coordinates, 
    region: string
  ): WeatherData {
    const now = new Date();

    // Transform current weather
    const current: CurrentWeather = {
      temperature: imdData.current.temp,
      humidity: imdData.current.humidity,
      windSpeed: imdData.current.wind_speed * 3.6, // Convert m/s to km/h
      windDirection: imdData.current.wind_deg,
      precipitation: imdData.current.rain?.['1h'] || 0,
      pressure: imdData.current.pressure,
      visibility: imdData.current.visibility / 1000, // Convert m to km
      uvIndex: imdData.current.uv,
      cloudCover: imdData.current.clouds,
      dewPoint: imdData.current.dew_point,
    };

    // Transform forecast data (next 7 days)
    const forecast: WeatherForecast[] = imdData.daily.slice(0, 7).map(day => ({
      date: new Date(day.dt * 1000),
      temperature: {
        min: day.temp.min,
        max: day.temp.max,
        average: day.temp.day,
      },
      humidity: {
        min: day.humidity - 10, // Estimate based on daily average
        max: day.humidity + 10,
        average: day.humidity,
      },
      precipitation: {
        probability: day.pop * 100,
        amount: day.rain || 0,
      },
      windSpeed: day.wind_speed * 3.6, // Convert m/s to km/h
      conditions: day.weather.map(w => w.description),
      confidence: 0.8, // Default confidence for IMD data
    }));

    // Transform historical data (last 24 hours from hourly data)
    const historical: WeatherRecord[] = imdData.hourly
      .filter(hour => hour.dt * 1000 < now.getTime())
      .slice(-24)
      .map(hour => ({
        date: new Date(hour.dt * 1000),
        temperature: {
          min: hour.temp - 2, // Estimate hourly range
          max: hour.temp + 2,
        },
        precipitation: hour.rain?.['1h'] || 0,
        humidity: hour.humidity,
        windSpeed: hour.wind_speed * 3.6,
      }));

    // Calculate data quality
    const quality: DataQuality = this.calculateDataQuality(imdData);

    return {
      location: coordinates,
      timestamp: now,
      source: 'IMD',
      current,
      forecast,
      historical,
      quality,
    };
  }

  /**
   * Calculate data quality metrics
   */
  private calculateDataQuality(imdData: IMDWeatherResponse): DataQuality {
    const issues: string[] = [];
    let completeness = 1.0;
    let accuracy = 0.9; // Default high accuracy for IMD
    let timeliness = 1.0;

    // Check completeness
    if (!imdData.current) {
      issues.push('Missing current weather data');
      completeness -= 0.3;
    }

    if (!imdData.daily || imdData.daily.length < 5) {
      issues.push('Insufficient forecast data');
      completeness -= 0.2;
    }

    if (!imdData.hourly || imdData.hourly.length < 20) {
      issues.push('Limited historical data');
      completeness -= 0.1;
    }

    // Check for missing critical fields
    if (imdData.current && (
      imdData.current.temp === undefined ||
      imdData.current.humidity === undefined ||
      imdData.current.pressure === undefined
    )) {
      issues.push('Missing critical weather parameters');
      completeness -= 0.2;
      accuracy -= 0.1;
    }

    return {
      completeness: Math.max(0, completeness),
      accuracy: Math.max(0, accuracy),
      timeliness,
      lastValidated: new Date(),
      issues,
    };
  }

  /**
   * Validate weather data before storage
   */
  private validateWeatherData(weatherData: WeatherData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate coordinates
    const coordValidation = Validator.validateCoordinates(weatherData.location);
    errors.push(...coordValidation.errors);
    warnings.push(...coordValidation.warnings);

    // Validate current weather
    if (weatherData.current) {
      const current = weatherData.current;
      
      if (current.temperature < -50 || current.temperature > 60) {
        errors.push('Temperature out of reasonable range');
      }
      
      if (current.humidity < 0 || current.humidity > 100) {
        errors.push('Humidity out of valid range (0-100%)');
      }
      
      if (current.windSpeed < 0 || current.windSpeed > 500) {
        errors.push('Wind speed out of reasonable range');
      }
      
      if (current.precipitation < 0) {
        errors.push('Precipitation cannot be negative');
      }
    } else {
      errors.push('Missing current weather data');
    }

    // Validate forecast data
    if (!weatherData.forecast || weatherData.forecast.length === 0) {
      warnings.push('No forecast data available');
    }

    // Validate data quality
    if (weatherData.quality.completeness < 0.5) {
      warnings.push('Low data completeness');
    }

    if (weatherData.quality.accuracy < 0.7) {
      warnings.push('Low data accuracy');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Store weather data in DynamoDB
   */
  private async storeWeatherData(weatherData: WeatherData): Promise<void> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = `${weatherData.location.latitude},${weatherData.location.longitude}`;
      const dataKey = this.dynamoHelper.createExternalDataKey(
        'weather',
        locationKey,
        weatherData.timestamp.toISOString().split('T')[0]
      );

      const externalData: ExternalData = {
        dataType: 'weather',
        source: weatherData.source,
        timestamp: weatherData.timestamp,
        location: weatherData.location,
        data: weatherData,
        metadata: {
          version: '1.0',
          processingDate: new Date(),
          processingNotes: [],
          validationResult: this.validateWeatherData(weatherData),
          retentionPolicy: `${this.config.externalDataRetentionDays} days`,
        },
      };

      const item = {
        dataKey,
        timestamp: weatherData.timestamp.toISOString(),
        dataType: 'weather',
        location: locationKey,
        source: weatherData.source,
        data: JSON.stringify(externalData),
        ttl: this.dynamoHelper.generateTTL(this.config.externalDataRetentionDays),
      };

      await this.dynamoHelper.putItem(tableName, item);
      
      this.logger.info('Weather data stored successfully', { 
        dataKey, 
        location: locationKey 
      });

    } catch (error) {
      this.logger.error('Failed to store weather data', error);
      throw error;
    }
  }

  /**
   * Publish weather data event to EventBridge
   */
  private async publishWeatherDataEvent(weatherData: WeatherData): Promise<void> {
    try {
      const eventDetail = {
        dataType: 'weather',
        location: weatherData.location,
        timestamp: weatherData.timestamp.toISOString(),
        source: weatherData.source,
        quality: weatherData.quality,
      };

      const params = {
        Entries: [
          {
            Source: 'croptwin.data-ingestion',
            DetailType: 'Weather Data Collected',
            Detail: JSON.stringify(eventDetail),
            EventBusName: this.config.eventBusName,
          },
        ],
      };

      await this.eventBridge.putEvents(params).promise();
      
      this.logger.info('Weather data event published', { 
        location: weatherData.location 
      });

    } catch (error) {
      this.logger.error('Failed to publish weather data event', error);
      // Don't throw - event publishing failure shouldn't stop data collection
    }
  }

  /**
   * Get existing weather data from cache
   */
  private async getExistingWeatherData(coordinates: Coordinates): Promise<WeatherData | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = `${coordinates.latitude},${coordinates.longitude}`;
      const today = new Date().toISOString().split('T')[0];
      const dataKey = this.dynamoHelper.createExternalDataKey('weather', locationKey, today);

      const item = await this.dynamoHelper.getItem(tableName, { 
        dataKey, 
        timestamp: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() } 
      });

      if (item && item.data) {
        const externalData: ExternalData = JSON.parse(item.data);
        return externalData.data as WeatherData;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get existing weather data', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Check if weather data should be refreshed
   */
  private shouldRefreshData(weatherData: WeatherData): boolean {
    const now = new Date();
    const dataAge = now.getTime() - weatherData.timestamp.getTime();
    const fourHours = 4 * 60 * 60 * 1000;
    
    return dataAge > fourHours;
  }

  /**
   * Handle weather data collection failure with fallback mechanisms
   */
  private async handleWeatherDataFailure(region: string, error: Error): Promise<void> {
    this.logger.warn('Attempting fallback for weather data failure', { region, error: error.message });

    try {
      // Try to get cached data from the last 24 hours
      const coordinates = await this.parseRegionCoordinates(region);
      const cachedData = await this.getCachedWeatherData(coordinates, 24);
      
      if (cachedData) {
        // Publish event indicating degraded service
        await this.publishDegradedServiceEvent(region, 'weather', error.message);
        this.logger.info('Using cached weather data as fallback', { region });
      } else {
        this.logger.error('No cached weather data available for fallback', { region });
      }
    } catch (fallbackError) {
      this.logger.error('Fallback mechanism failed', fallbackError, { region });
    }
  }

  /**
   * Get cached weather data within specified hours
   */
  private async getCachedWeatherData(coordinates: Coordinates, hoursBack: number): Promise<WeatherData | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = `${coordinates.latitude},${coordinates.longitude}`;
      const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      const items = await this.dynamoHelper.queryItems(
        tableName,
        'location = :location AND #timestamp >= :cutoff',
        {
          ':location': locationKey,
          ':cutoff': cutoffTime.toISOString(),
        },
        'LocationIndex',
        1,
        false // Most recent first
      );

      if (items.length > 0 && items[0].data) {
        const externalData: ExternalData = JSON.parse(items[0].data);
        return externalData.data as WeatherData;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get cached weather data', error);
      return null;
    }
  }

  /**
   * Publish degraded service event
   */
  private async publishDegradedServiceEvent(region: string, dataType: string, reason: string): Promise<void> {
    try {
      const eventDetail = {
        region,
        dataType,
        reason,
        timestamp: new Date().toISOString(),
        severity: 'warning',
      };

      const params = {
        Entries: [
          {
            Source: 'croptwin.data-ingestion',
            DetailType: 'Degraded Service Alert',
            Detail: JSON.stringify(eventDetail),
            EventBusName: this.config.eventBusName,
          },
        ],
      };

      await this.eventBridge.putEvents(params).promise();
    } catch (error) {
      this.logger.error('Failed to publish degraded service event', error);
    }
  }

  /**
   * Get list of active regions that need weather data
   */
  private async getActiveRegions(): Promise<string[]> {
    try {
      // Query farm twins to get unique locations
      const tableName = this.config.farmTwinsTableName;
      const items = await this.dynamoHelper.scanItems(
        tableName,
        undefined,
        undefined,
        1000 // Limit to prevent large scans
      );

      const regions = new Set<string>();
      
      for (const item of items) {
        if (item.location && item.location.latitude && item.location.longitude) {
          // Round coordinates to reduce API calls for nearby farms
          const lat = Math.round(item.location.latitude * 10) / 10;
          const lon = Math.round(item.location.longitude * 10) / 10;
          regions.add(`${lat},${lon}`);
        }
      }

      return Array.from(regions);
    } catch (error) {
      this.logger.error('Failed to get active regions', error);
      // Return default regions for major agricultural areas in India
      return [
        '28.6,77.2', // Delhi
        '19.1,72.9', // Mumbai
        '13.1,80.3', // Chennai
        '22.6,88.4', // Kolkata
        '12.3,76.6', // Mysore
        '23.0,72.6', // Ahmedabad
      ];
    }
  }

  /**
   * Parse region coordinates from string format
   */
  private async parseRegionCoordinates(region: string): Promise<Coordinates> {
    const parts = region.split(',');
    if (parts.length !== 2) {
      throw new Error(`Invalid region format: ${region}`);
    }

    const latitude = parseFloat(parts[0]);
    const longitude = parseFloat(parts[1]);

    if (isNaN(latitude) || isNaN(longitude)) {
      throw new Error(`Invalid coordinates in region: ${region}`);
    }

    return { latitude, longitude };
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Lambda handler function
 */
export const handler: Handler<WeatherCollectionEvent, void> = async (event, context) => {
  const logger = createLambdaLogger('weather-collection', context.awsRequestId);
  
  try {
    logger.info('Weather collection Lambda started', { event });
    
    const service = new WeatherCollectionService(logger);
    await service.collectWeatherData(event);
    
    logger.info('Weather collection Lambda completed successfully');
  } catch (error) {
    logger.error('Weather collection Lambda failed', error);
    throw error;
  }
};