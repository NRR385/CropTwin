/**
 * Satellite Imagery Processing Lambda Function
 * Processes satellite data from ISRO/NASA APIs for vegetation indices
 * Scheduled to run weekly via EventBridge
 */

import { Handler, ScheduledEvent } from 'aws-lambda';
import { EventBridge, S3 } from 'aws-sdk';
import axios, { AxiosResponse } from 'axios';
import { createLambdaLogger, Logger } from '../shared/utils/logger';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { Validator } from '../shared/utils/validation';
import { getEnvironment } from '../shared/config/environment';
import { 
  SatelliteData, 
  VegetationIndex, 
  DataQuality,
  ExternalData 
} from '../types/external-data';
import { Coordinates, ValidationResult } from '../types/core';

interface NASAModisResponse {
  dates: string[];
  data: {
    [date: string]: {
      '250m_16_days_NDVI': number[][];
      '250m_16_days_EVI': number[][];
      'Lai_500m': number[][];
      'Fpar_500m': number[][];
      'cloud_mask': number[][];
    };
  };
  metadata: {
    product: string;
    version: string;
    resolution: string;
    projection: string;
  };
}

interface ISROResourceSatResponse {
  scene_id: string;
  acquisition_date: string;
  cloud_cover: number;
  bands: {
    red: number[][];
    nir: number[][];
    swir1: number[][];
    swir2: number[][];
  };
  metadata: {
    satellite: string;
    sensor: string;
    resolution: number;
    path_row: string;
  };
}

interface SatelliteCollectionEvent extends ScheduledEvent {
  regions?: string[];
  forceRefresh?: boolean;
  satellite?: 'modis' | 'resourcesat' | 'landsat';
}

export class SatelliteProcessingService {
  private logger: Logger;
  private dynamoHelper: DynamoDBHelper;
  private eventBridge: EventBridge;
  private s3: S3;
  private config: any;

  constructor(logger: Logger) {
    this.logger = logger;
    this.dynamoHelper = new DynamoDBHelper();
    this.eventBridge = new EventBridge();
    this.s3 = new S3();
    this.config = getEnvironment();
  }

  /**
   * Main handler for satellite data processing
   */
  async processSatelliteData(event: SatelliteCollectionEvent): Promise<void> {
    this.logger.info('Starting satellite data processing', { 
      regions: event.regions,
      forceRefresh: event.forceRefresh,
      satellite: event.satellite 
    });

    try {
      // Get list of regions to collect data for
      const regions = event.regions || await this.getActiveRegions();
      const satellite = event.satellite || 'modis';
      
      const processingResults = [];
      
      for (const region of regions) {
        try {
          const coordinates = await this.parseRegionCoordinates(region);
          const satelliteData = await this.fetchSatelliteDataForLocation(
            coordinates, 
            region, 
            satellite
          );
          
          if (satelliteData) {
            await this.storeSatelliteData(satelliteData);
            await this.publishSatelliteDataEvent(satelliteData);
            processingResults.push({ region, status: 'success' });
            
            this.logger.info('Satellite data processed successfully', { 
              region, 
              location: coordinates,
              satellite 
            });
          }
        } catch (error) {
          this.logger.error('Failed to process satellite data for region', error as Error, { region });
          processingResults.push({ region, status: 'failed', error: (error as Error).message });
          
          // Try to use cached data as fallback
          await this.handleSatelliteDataFailure(region, error as Error);
        }
      }

      this.logger.info('Satellite data processing completed', { 
        totalRegions: regions.length,
        successful: processingResults.filter(r => r.status === 'success').length,
        failed: processingResults.filter(r => r.status === 'failed').length
      });

    } catch (error) {
      this.logger.error('Satellite data processing failed', error as Error);
      throw error;
    }
  }

  /**
   * Fetch satellite data from NASA/ISRO APIs for a specific location
   */
  private async fetchSatelliteDataForLocation(
    coordinates: Coordinates, 
    region: string,
    satellite: string
  ): Promise<SatelliteData | null> {
    const startTime = Date.now();
    
    try {
      // Validate coordinates
      const coordValidation = Validator.validateCoordinates(coordinates);
      if (!coordValidation.isValid) {
        throw new Error(`Invalid coordinates: ${coordValidation.errors.join(', ')}`);
      }

      // Check if we have recent data (within last 5 days) unless force refresh
      const existingData = await this.getExistingSatelliteData(coordinates);
      if (existingData && !this.shouldRefreshData(existingData)) {
        this.logger.info('Using existing satellite data', { 
          region, 
          lastUpdated: existingData.captureDate 
        });
        return existingData;
      }

      let satelliteData: SatelliteData;

      // Fetch from appropriate satellite API
      switch (satellite) {
        case 'modis':
          satelliteData = await this.fetchModisData(coordinates, region);
          break;
        case 'resourcesat':
          satelliteData = await this.fetchResourceSatData(coordinates, region);
          break;
        case 'landsat':
          satelliteData = await this.fetchLandsatData(coordinates, region);
          break;
        default:
          throw new Error(`Unsupported satellite: ${satellite}`);
      }
      
      // Validate the satellite data
      const validation = this.validateSatelliteData(satelliteData);
      if (!validation.isValid) {
        throw new Error(`Invalid satellite data: ${validation.errors.join(', ')}`);
      }

      const duration = Date.now() - startTime;
      this.logger.performance('fetchSatelliteDataForLocation', duration, { region, satellite });

      return satelliteData;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.performance('fetchSatelliteDataForLocation', duration, { 
        region, 
        satellite,
        error: true 
      });
      
      this.logger.error('Failed to fetch satellite data', error as Error, { 
        region, 
        coordinates,
        satellite 
      });
      
      throw error;
    }
  }

  /**
   * Fetch MODIS data from NASA API
   */
  private async fetchModisData(coordinates: Coordinates, region: string): Promise<SatelliteData> {
    const apiUrl = this.buildNASAModisUrl(coordinates);
    const response = await this.makeNASAApiCall(apiUrl);
    
    if (!response || !response.data) {
      throw new Error('No data received from NASA MODIS API');
    }

    return this.transformModisResponse(response.data, coordinates, region);
  }

  /**
   * Fetch ResourceSat data from ISRO API
   */
  private async fetchResourceSatData(coordinates: Coordinates, region: string): Promise<SatelliteData> {
    const apiUrl = this.buildISROResourceSatUrl(coordinates);
    const response = await this.makeISROApiCall(apiUrl);
    
    if (!response || !response.data) {
      throw new Error('No data received from ISRO ResourceSat API');
    }

    return this.transformResourceSatResponse(response.data, coordinates, region);
  }

  /**
   * Fetch Landsat data from NASA API (fallback)
   */
  private async fetchLandsatData(coordinates: Coordinates, region: string): Promise<SatelliteData> {
    const apiUrl = this.buildNASALandsatUrl(coordinates);
    const response = await this.makeNASAApiCall(apiUrl);
    
    if (!response || !response.data) {
      throw new Error('No data received from NASA Landsat API');
    }

    return this.transformLandsatResponse(response.data, coordinates, region);
  }

  /**
   * Build NASA MODIS API URL
   */
  private buildNASAModisUrl(coordinates: Coordinates): string {
    const baseUrl = this.config.satelliteApiUrl;
    const apiKey = this.config.satelliteApiKey;
    
    if (!apiKey) {
      throw new Error('NASA API key not configured');
    }

    // NASA MODIS API endpoint for vegetation indices
    const product = 'MOD13Q1'; // 250m 16-day NDVI/EVI
    const startDate = this.getDateDaysAgo(16);
    const endDate = new Date().toISOString().split('T')[0];
    
    return `${baseUrl}/modis/v6/${product}?lat=${coordinates.latitude}&lon=${coordinates.longitude}&startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`;
  }

  /**
   * Build ISRO ResourceSat API URL
   */
  private buildISROResourceSatUrl(coordinates: Coordinates): string {
    const baseUrl = 'https://bhuvan-app1.nrsc.gov.in/api/resourcesat';
    const apiKey = this.config.satelliteApiKey;
    
    if (!apiKey) {
      throw new Error('ISRO API key not configured');
    }

    // ISRO ResourceSat API endpoint
    const startDate = this.getDateDaysAgo(7);
    const endDate = new Date().toISOString().split('T')[0];
    
    return `${baseUrl}/data?lat=${coordinates.latitude}&lon=${coordinates.longitude}&startDate=${startDate}&endDate=${endDate}&sensor=LISS3&api_key=${apiKey}`;
  }

  /**
   * Build NASA Landsat API URL
   */
  private buildNASALandsatUrl(coordinates: Coordinates): string {
    const baseUrl = this.config.satelliteApiUrl;
    const apiKey = this.config.satelliteApiKey;
    
    if (!apiKey) {
      throw new Error('NASA API key not configured');
    }

    // NASA Landsat API endpoint
    const startDate = this.getDateDaysAgo(16);
    const endDate = new Date().toISOString().split('T')[0];
    
    return `${baseUrl}/landsat/v1/data?lat=${coordinates.latitude}&lon=${coordinates.longitude}&startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`;
  }

  /**
   * Make API call to NASA with retry logic
   */
  private async makeNASAApiCall(url: string): Promise<AxiosResponse<any>> {
    return this.makeApiCall(url, 'NASA');
  }

  /**
   * Make API call to ISRO with retry logic
   */
  private async makeISROApiCall(url: string): Promise<AxiosResponse<any>> {
    return this.makeApiCall(url, 'ISRO');
  }

  /**
   * Generic API call with retry logic and error handling
   */
  private async makeApiCall(url: string, provider: string): Promise<AxiosResponse<any>> {
    const maxRetries = this.config.maxRetries;
    const timeout = this.config.defaultTimeout;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`Making ${provider} API call`, { url, attempt });
        
        const response = await axios.get(url, {
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
        this.logger.warn(`${provider} API call failed`, { 
          attempt, 
          maxRetries, 
          error: (error as Error).message 
        });

        if (attempt === maxRetries) {
          throw new Error(`${provider} API call failed after ${maxRetries} attempts: ${(error as Error).message}`);
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await this.sleep(delay);
      }
    }

    throw new Error(`Unexpected error in ${provider} API call`);
  }

  /**
   * Transform NASA MODIS response to SatelliteData format
   */
  private transformModisResponse(
    modisData: NASAModisResponse, 
    coordinates: Coordinates, 
    region: string
  ): SatelliteData {
    const latestDate = modisData.dates[modisData.dates.length - 1];
    const latestData = modisData.data[latestDate];

    // Calculate vegetation indices from MODIS data
    const vegetationIndex = this.calculateVegetationIndicesFromModis(latestData);
    
    // Calculate cloud cover from cloud mask
    const cloudCover = this.calculateCloudCover(latestData.cloud_mask);
    
    // Calculate data quality
    const quality = this.calculateSatelliteDataQuality(modisData, cloudCover);

    return {
      location: coordinates,
      captureDate: new Date(latestDate),
      source: 'NASA MODIS',
      satellite: 'Terra/Aqua',
      vegetationIndex,
      cloudCover,
      resolution: 250, // meters
      quality,
      processingLevel: 'L3',
    };
  }

  /**
   * Transform ISRO ResourceSat response to SatelliteData format
   */
  private transformResourceSatResponse(
    resourceSatData: ISROResourceSatResponse, 
    coordinates: Coordinates, 
    region: string
  ): SatelliteData {
    // Calculate vegetation indices from raw bands
    const vegetationIndex = this.calculateVegetationIndicesFromBands(resourceSatData.bands);
    
    // Calculate data quality
    const quality = this.calculateResourceSatDataQuality(resourceSatData);

    return {
      location: coordinates,
      captureDate: new Date(resourceSatData.acquisition_date),
      source: 'ISRO ResourceSat',
      satellite: resourceSatData.metadata.satellite,
      vegetationIndex,
      cloudCover: resourceSatData.cloud_cover,
      resolution: resourceSatData.metadata.resolution,
      quality,
      processingLevel: 'L2A',
    };
  }

  /**
   * Transform NASA Landsat response to SatelliteData format
   */
  private transformLandsatResponse(
    landsatData: any, 
    coordinates: Coordinates, 
    region: string
  ): SatelliteData {
    // Calculate vegetation indices from Landsat bands
    const vegetationIndex = this.calculateVegetationIndicesFromBands(landsatData.bands);
    
    // Calculate data quality
    const quality = this.calculateLandsatDataQuality(landsatData);

    return {
      location: coordinates,
      captureDate: new Date(landsatData.acquisition_date),
      source: 'NASA Landsat',
      satellite: landsatData.metadata.satellite,
      vegetationIndex,
      cloudCover: landsatData.cloud_cover || 0,
      resolution: 30, // meters for Landsat
      quality,
      processingLevel: 'L2',
    };
  }

  /**
   * Calculate vegetation indices from MODIS processed data
   */
  private calculateVegetationIndicesFromModis(data: any): VegetationIndex {
    // MODIS provides pre-calculated NDVI and EVI
    const ndviArray = data['250m_16_days_NDVI'];
    const eviArray = data['250m_16_days_EVI'];
    const laiArray = data['Lai_500m'];
    const fparArray = data['Fpar_500m'];

    // Calculate mean values from arrays (removing invalid pixels)
    const ndvi = this.calculateMeanFromArray(ndviArray, 0.0001); // MODIS scale factor
    const evi = this.calculateMeanFromArray(eviArray, 0.0001);
    const lai = this.calculateMeanFromArray(laiArray, 0.1);
    const fpar = this.calculateMeanFromArray(fparArray, 0.01);

    return {
      ndvi: Math.max(-1, Math.min(1, ndvi)),
      evi: Math.max(-1, Math.min(1, evi)),
      lai: Math.max(0, Math.min(8, lai)),
      fpar: Math.max(0, Math.min(1, fpar)),
      confidence: 0.85, // High confidence for MODIS processed data
    };
  }

  /**
   * Calculate vegetation indices from raw spectral bands
   */
  private calculateVegetationIndicesFromBands(bands: any): VegetationIndex {
    const red = this.calculateMeanFromArray(bands.red);
    const nir = this.calculateMeanFromArray(bands.nir);
    const swir1 = bands.swir1 ? this.calculateMeanFromArray(bands.swir1) : null;

    // Calculate NDVI: (NIR - Red) / (NIR + Red)
    const ndvi = (nir - red) / (nir + red);

    // Calculate EVI: 2.5 * ((NIR - Red) / (NIR + 6 * Red - 7.5 * Blue + 1))
    // Simplified EVI without blue band
    const evi = 2.5 * ((nir - red) / (nir + 2.4 * red + 1));

    // Estimate LAI from NDVI using empirical relationship
    const lai = this.estimateLAIFromNDVI(ndvi);

    // Estimate FPAR from LAI
    const fpar = this.estimateFPARFromLAI(lai);

    return {
      ndvi: Math.max(-1, Math.min(1, ndvi)),
      evi: Math.max(-1, Math.min(1, evi)),
      lai: Math.max(0, Math.min(8, lai)),
      fpar: Math.max(0, Math.min(1, fpar)),
      confidence: 0.75, // Medium confidence for calculated indices
    };
  }

  /**
   * Calculate mean from 2D array, applying scale factor and filtering invalid values
   */
  private calculateMeanFromArray(array: number[][], scaleFactor: number = 1): number {
    let sum = 0;
    let count = 0;

    for (const row of array) {
      for (const value of row) {
        // Filter out invalid/fill values (typically negative or very large values)
        if (value >= 0 && value < 32767) {
          sum += value * scaleFactor;
          count++;
        }
      }
    }

    return count > 0 ? sum / count : 0;
  }

  /**
   * Estimate LAI from NDVI using empirical relationship
   */
  private estimateLAIFromNDVI(ndvi: number): number {
    // Empirical relationship: LAI = -ln(1 - NDVI) / k
    // where k is extinction coefficient (typically 0.5 for crops)
    const k = 0.5;
    const adjustedNDVI = Math.max(0.1, Math.min(0.95, ndvi));
    return -Math.log(1 - adjustedNDVI) / k;
  }

  /**
   * Estimate FPAR from LAI using Beer's law
   */
  private estimateFPARFromLAI(lai: number): number {
    // FPAR = 1 - exp(-k * LAI)
    const k = 0.5;
    return 1 - Math.exp(-k * lai);
  }

  /**
   * Calculate cloud cover percentage from cloud mask
   */
  private calculateCloudCover(cloudMask: number[][]): number {
    let totalPixels = 0;
    let cloudPixels = 0;

    for (const row of cloudMask) {
      for (const value of row) {
        totalPixels++;
        // Cloud mask values: 0=clear, 1=cloud, 2=shadow, 3=snow
        if (value === 1 || value === 2) {
          cloudPixels++;
        }
      }
    }

    return totalPixels > 0 ? (cloudPixels / totalPixels) * 100 : 0;
  }

  /**
   * Calculate data quality for satellite data
   */
  private calculateSatelliteDataQuality(data: any, cloudCover: number): DataQuality {
    const issues: string[] = [];
    let completeness = 1.0;
    let accuracy = 0.9;
    let timeliness = 1.0;

    // Check cloud cover impact
    if (cloudCover > 50) {
      issues.push('High cloud cover affecting data quality');
      accuracy -= 0.3;
      completeness -= 0.2;
    } else if (cloudCover > 20) {
      issues.push('Moderate cloud cover');
      accuracy -= 0.1;
    }

    // Check data age
    const dataAge = Date.now() - new Date(data.dates[data.dates.length - 1]).getTime();
    const daysSinceCapture = dataAge / (1000 * 60 * 60 * 24);
    
    if (daysSinceCapture > 16) {
      issues.push('Data older than 16 days');
      timeliness -= 0.2;
    }

    // Check data availability
    if (!data.data || Object.keys(data.data).length === 0) {
      issues.push('No satellite data available');
      completeness = 0;
    }

    return {
      completeness: Math.max(0, completeness),
      accuracy: Math.max(0, accuracy),
      timeliness: Math.max(0, timeliness),
      lastValidated: new Date(),
      issues,
    };
  }

  /**
   * Calculate data quality for ResourceSat data
   */
  private calculateResourceSatDataQuality(data: ISROResourceSatResponse): DataQuality {
    const issues: string[] = [];
    let completeness = 1.0;
    let accuracy = 0.85; // Slightly lower than MODIS
    let timeliness = 1.0;

    // Check cloud cover
    if (data.cloud_cover > 30) {
      issues.push('High cloud cover in ResourceSat data');
      accuracy -= 0.2;
    }

    // Check data completeness
    if (!data.bands || !data.bands.red || !data.bands.nir) {
      issues.push('Missing essential spectral bands');
      completeness -= 0.5;
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
   * Calculate data quality for Landsat data
   */
  private calculateLandsatDataQuality(data: any): DataQuality {
    const issues: string[] = [];
    let completeness = 1.0;
    let accuracy = 0.8; // Good but lower resolution
    let timeliness = 1.0;

    // Check cloud cover
    if (data.cloud_cover > 40) {
      issues.push('High cloud cover in Landsat data');
      accuracy -= 0.2;
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
   * Validate satellite data before storage
   */
  private validateSatelliteData(satelliteData: SatelliteData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate coordinates
    const coordValidation = Validator.validateCoordinates(satelliteData.location);
    errors.push(...coordValidation.errors);
    warnings.push(...coordValidation.warnings);

    // Validate vegetation indices
    const vi = satelliteData.vegetationIndex;
    
    if (vi.ndvi < -1 || vi.ndvi > 1) {
      errors.push('NDVI out of valid range (-1 to 1)');
    }
    
    if (vi.evi < -1 || vi.evi > 1) {
      errors.push('EVI out of valid range (-1 to 1)');
    }
    
    if (vi.lai < 0 || vi.lai > 8) {
      errors.push('LAI out of reasonable range (0 to 8)');
    }
    
    if (vi.fpar < 0 || vi.fpar > 1) {
      errors.push('FPAR out of valid range (0 to 1)');
    }

    // Validate cloud cover
    if (satelliteData.cloudCover < 0 || satelliteData.cloudCover > 100) {
      errors.push('Cloud cover out of valid range (0-100%)');
    }

    // Check data quality
    if (satelliteData.quality.completeness < 0.3) {
      warnings.push('Very low data completeness');
    }

    if (satelliteData.quality.accuracy < 0.5) {
      warnings.push('Low data accuracy');
    }

    // Check capture date
    const captureAge = Date.now() - satelliteData.captureDate.getTime();
    const daysOld = captureAge / (1000 * 60 * 60 * 24);
    
    if (daysOld > 30) {
      warnings.push('Satellite data is more than 30 days old');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Store satellite data in DynamoDB and S3
   */
  private async storeSatelliteData(satelliteData: SatelliteData): Promise<void> {
    try {
      // Store metadata in DynamoDB
      await this.storeSatelliteMetadata(satelliteData);
      
      // Store raw data in S3 for detailed analysis
      await this.storeSatelliteRawData(satelliteData);
      
      this.logger.info('Satellite data stored successfully', { 
        location: satelliteData.location,
        source: satelliteData.source 
      });

    } catch (error) {
      this.logger.error('Failed to store satellite data', error as Error);
      throw error;
    }
  }

  /**
   * Store satellite metadata in DynamoDB
   */
  private async storeSatelliteMetadata(satelliteData: SatelliteData): Promise<void> {
    const tableName = this.config.externalDataTableName;
    const locationKey = `${satelliteData.location.latitude},${satelliteData.location.longitude}`;
    const dataKey = this.dynamoHelper.createExternalDataKey(
      'satellite',
      locationKey,
      satelliteData.captureDate.toISOString().split('T')[0]
    );

    const externalData: ExternalData = {
      dataType: 'satellite',
      source: satelliteData.source,
      timestamp: new Date(),
      location: satelliteData.location,
      data: satelliteData,
      metadata: {
        version: '1.0',
        processingDate: new Date(),
        processingNotes: [],
        validationResult: this.validateSatelliteData(satelliteData),
        retentionPolicy: `${this.config.externalDataRetentionDays} days`,
      },
    };

    const item = {
      dataKey,
      timestamp: satelliteData.captureDate.toISOString(),
      dataType: 'satellite',
      location: locationKey,
      source: satelliteData.source,
      data: JSON.stringify(externalData),
      ttl: this.dynamoHelper.generateTTL(this.config.externalDataRetentionDays),
    };

    await this.dynamoHelper.putItem(tableName, item);
  }

  /**
   * Store raw satellite data in S3
   */
  private async storeSatelliteRawData(satelliteData: SatelliteData): Promise<void> {
    const bucketName = this.config.satelliteDataBucketName;
    const key = `satellite-data/${satelliteData.source.toLowerCase().replace(/\s+/g, '-')}/${satelliteData.captureDate.toISOString().split('T')[0]}/${satelliteData.location.latitude}_${satelliteData.location.longitude}.json`;

    const params = {
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(satelliteData, null, 2),
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256',
      Metadata: {
        source: satelliteData.source,
        satellite: satelliteData.satellite,
        captureDate: satelliteData.captureDate.toISOString(),
        location: `${satelliteData.location.latitude},${satelliteData.location.longitude}`,
      },
    };

    await this.s3.putObject(params).promise();
  }

  /**
   * Publish satellite data event to EventBridge
   */
  private async publishSatelliteDataEvent(satelliteData: SatelliteData): Promise<void> {
    try {
      const eventDetail = {
        dataType: 'satellite',
        location: satelliteData.location,
        captureDate: satelliteData.captureDate.toISOString(),
        source: satelliteData.source,
        satellite: satelliteData.satellite,
        vegetationIndex: satelliteData.vegetationIndex,
        quality: satelliteData.quality,
      };

      const params = {
        Entries: [
          {
            Source: 'croptwin.data-ingestion',
            DetailType: 'Satellite Data Processed',
            Detail: JSON.stringify(eventDetail),
            EventBusName: this.config.eventBusName,
          },
        ],
      };

      await this.eventBridge.putEvents(params).promise();
      
      this.logger.info('Satellite data event published', { 
        location: satelliteData.location,
        source: satelliteData.source 
      });

    } catch (error) {
      this.logger.error('Failed to publish satellite data event', error as Error);
      // Don't throw - event publishing failure shouldn't stop data processing
    }
  }

  /**
   * Get existing satellite data from cache
   */
  private async getExistingSatelliteData(coordinates: Coordinates): Promise<SatelliteData | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = `${coordinates.latitude},${coordinates.longitude}`;
      const today = new Date().toISOString().split('T')[0];
      const dataKey = this.dynamoHelper.createExternalDataKey('satellite', locationKey, today);

      const item = await this.dynamoHelper.getItem(tableName, { 
        dataKey, 
        timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() } 
      });

      if (item && item.data) {
        const externalData: ExternalData = JSON.parse(item.data);
        return externalData.data as SatelliteData;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get existing satellite data', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Check if satellite data should be refreshed
   */
  private shouldRefreshData(satelliteData: SatelliteData): boolean {
    const now = new Date();
    const dataAge = now.getTime() - satelliteData.captureDate.getTime();
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    
    return dataAge > fiveDays;
  }

  /**
   * Handle satellite data processing failure with fallback mechanisms
   */
  private async handleSatelliteDataFailure(region: string, error: Error): Promise<void> {
    this.logger.warn('Attempting fallback for satellite data failure', { region, error: error.message });

    try {
      // Try to get cached data from the last 14 days
      const coordinates = await this.parseRegionCoordinates(region);
      const cachedData = await this.getCachedSatelliteData(coordinates, 14);
      
      if (cachedData) {
        // Publish event indicating degraded service
        await this.publishDegradedServiceEvent(region, 'satellite', error.message);
        this.logger.info('Using cached satellite data as fallback', { region });
      } else {
        this.logger.error('No cached satellite data available for fallback', { region });
      }
    } catch (fallbackError) {
      this.logger.error('Fallback mechanism failed', fallbackError as Error, { region });
    }
  }

  /**
   * Get cached satellite data within specified days
   */
  private async getCachedSatelliteData(coordinates: Coordinates, daysBack: number): Promise<SatelliteData | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = `${coordinates.latitude},${coordinates.longitude}`;
      const cutoffTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

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
        return externalData.data as SatelliteData;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get cached satellite data', error as Error);
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
      this.logger.error('Failed to publish degraded service event', error as Error);
    }
  }

  /**
   * Get list of active regions that need satellite data
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
          const lat = Math.round(item.location.latitude * 100) / 100; // Higher precision for satellite
          const lon = Math.round(item.location.longitude * 100) / 100;
          regions.add(`${lat},${lon}`);
        }
      }

      return Array.from(regions);
    } catch (error) {
      this.logger.error('Failed to get active regions', error as Error);
      // Return default regions for major agricultural areas in India
      return [
        '28.60,77.20', // Delhi NCR
        '19.08,72.88', // Mumbai
        '13.08,80.27', // Chennai
        '22.57,88.36', // Kolkata
        '12.29,76.64', // Mysore
        '23.03,72.58', // Ahmedabad
        '26.91,75.79', // Jaipur
        '17.38,78.49', // Hyderabad
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
   * Get date string for days ago
   */
  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
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
export const handler: Handler<SatelliteCollectionEvent, void> = async (event, context) => {
  const logger = createLambdaLogger('satellite-processing', context.awsRequestId);
  
  try {
    logger.info('Satellite processing Lambda started', { event });
    
    const service = new SatelliteProcessingService(logger);
    await service.processSatelliteData(event);
    
    logger.info('Satellite processing Lambda completed successfully');
  } catch (error) {
    logger.error('Satellite processing Lambda failed', error as Error);
    throw error;
  }
};