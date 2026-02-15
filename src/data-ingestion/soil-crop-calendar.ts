/**
 * Soil and Crop Calendar Data Integration Lambda Function
 * Integrates soil data from government databases and crop calendar information
 * Scheduled to run daily via EventBridge for soil data and weekly for crop calendar
 */

import { Handler, ScheduledEvent } from 'aws-lambda';
import { EventBridge } from 'aws-sdk';
import axios, { AxiosResponse } from 'axios';
import { createLambdaLogger, Logger } from '../shared/utils/logger';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { Validator } from '../shared/utils/validation';
import { getEnvironment } from '../shared/config/environment';
import { 
  SoilData, 
  SoilProperties, 
  SoilHealth, 
  SoilRecommendation,
  CropCalendar,
  CropCalendarEntry,
  MonthDay,
  CriticalStage,
  DataQuality,
  ExternalData,
  ExternalDataMetadata 
} from '../types/external-data';
import { Coordinates, ValidationResult, IndianState } from '../types/core';

interface NBSSLUPSoilResponse {
  location: {
    latitude: number;
    longitude: number;
    district: string;
    state: string;
  };
  soil_series: string;
  soil_type: string;
  texture: {
    sand: number;
    silt: number;
    clay: number;
  };
  chemical_properties: {
    ph: number;
    organic_carbon: number;
    nitrogen: number;
    phosphorus: number;
    potassium: number;
    sulfur?: number;
  };
  micronutrients: {
    zinc?: number;
    iron?: number;
    manganese?: number;
    copper?: number;
    boron?: number;
  };
  physical_properties: {
    bulk_density: number;
    water_holding_capacity: number;
    infiltration_rate: number;
    permeability: string;
  };
  health_score: {
    overall: number;
    chemical: number;
    physical: number;
    biological: number;
  };
  recommendations: Array<{
    category: string;
    recommendation: string;
    quantity?: string;
    timing?: string;
    benefit: string;
    cost?: number;
  }>;
  last_updated: string;
}

interface AgricultureDeptCropCalendarResponse {
  state: string;
  district?: string;
  crops: Array<{
    crop_name: string;
    variety?: string;
    season: string;
    sowing_period: {
      start_month: number;
      start_day: number;
      end_month: number;
      end_day: number;
      optimal_month: number;
      optimal_day: number;
    };
    harvest_period: {
      start_month: number;
      start_day: number;
      end_month: number;
      end_day: number;
      optimal_month: number;
      optimal_day: number;
    };
    duration_days: number;
    yield_potential: {
      min_yield: number;
      max_yield: number;
      avg_yield: number;
    };
    water_requirement: number;
    critical_stages: Array<{
      stage_name: string;
      days_after_sowing: number;
      duration_days: number;
      water_critical: boolean;
      nutrient_requirements: string[];
      common_issues: string[];
    }>;
    pests: string[];
    diseases: string[];
    marketing_period?: {
      start_month: number;
      start_day: number;
      end_month: number;
      end_day: number;
    };
  }>;
  last_updated: string;
}

interface SoilCropCalendarEvent extends ScheduledEvent {
  regions?: string[];
  states?: string[];
  forceRefresh?: boolean;
  dataType?: 'soil' | 'crop_calendar' | 'both';
}

export class SoilCropCalendarService {
  private logger: Logger;
  private dynamoHelper: DynamoDBHelper;
  private eventBridge: EventBridge;
  private config: any;
  private soilDataCache: Map<string, SoilData> = new Map();
  private cropCalendarCache: Map<string, CropCalendar> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
    this.dynamoHelper = new DynamoDBHelper();
    this.eventBridge = new EventBridge();
    this.config = getEnvironment();
  }

  /**
   * Main handler for soil and crop calendar data integration
   */
  async integrateSoilCropCalendarData(event: SoilCropCalendarEvent): Promise<void> {
    this.logger.info('Starting soil and crop calendar data integration', { 
      regions: event.regions,
      states: event.states,
      forceRefresh: event.forceRefresh,
      dataType: event.dataType 
    });

    try {
      const dataType = event.dataType || 'both';
      const integrationResults = [];

      if (dataType === 'soil' || dataType === 'both') {
        const soilResults = await this.integrateSoilData(event);
        integrationResults.push(...soilResults);
      }

      if (dataType === 'crop_calendar' || dataType === 'both') {
        const cropCalendarResults = await this.integrateCropCalendarData(event);
        integrationResults.push(...cropCalendarResults);
      }

      this.logger.info('Soil and crop calendar data integration completed', { 
        totalOperations: integrationResults.length,
        successful: integrationResults.filter(r => r.status === 'success').length,
        failed: integrationResults.filter(r => r.status === 'failed').length
      });

    } catch (error) {
      this.logger.error('Soil and crop calendar data integration failed', error as Error);
      throw error;
    }
  }

  /**
   * Integrate soil data from government databases
   */
  private async integrateSoilData(event: SoilCropCalendarEvent): Promise<any[]> {
    this.logger.info('Starting soil data integration');
    
    const regions = event.regions || await this.getActiveRegions();
    const results = [];

    for (const region of regions) {
      try {
        const coordinates = await this.parseRegionCoordinates(region);
        const soilData = await this.fetchSoilDataForLocation(coordinates, region, event.forceRefresh);
        
        if (soilData) {
          await this.storeSoilData(soilData);
          await this.publishSoilDataEvent(soilData);
          results.push({ region, type: 'soil', status: 'success' });
          
          this.logger.info('Soil data integrated successfully', { 
            region, 
            location: coordinates 
          });
        }
      } catch (error) {
        this.logger.error('Failed to integrate soil data for region', error as Error, { region });
        results.push({ region, type: 'soil', status: 'failed', error: (error as Error).message });
        
        // Try to use cached data as fallback
        await this.handleSoilDataFailure(region, error as Error);
      }
    }

    return results;
  }

  /**
   * Integrate crop calendar data from agricultural departments
   */
  private async integrateCropCalendarData(event: SoilCropCalendarEvent): Promise<any[]> {
    this.logger.info('Starting crop calendar data integration');
    
    const states = event.states || await this.getActiveStates();
    const results = [];

    for (const state of states) {
      try {
        const cropCalendar = await this.fetchCropCalendarForState(state, event.forceRefresh);
        
        if (cropCalendar) {
          await this.storeCropCalendarData(cropCalendar);
          await this.publishCropCalendarEvent(cropCalendar);
          results.push({ state, type: 'crop_calendar', status: 'success' });
          
          this.logger.info('Crop calendar data integrated successfully', { state });
        }
      } catch (error) {
        this.logger.error('Failed to integrate crop calendar data for state', error as Error, { state });
        results.push({ state, type: 'crop_calendar', status: 'failed', error: (error as Error).message });
        
        // Try to use cached data as fallback
        await this.handleCropCalendarFailure(state, error as Error);
      }
    }

    return results;
  }

  /**
   * Fetch soil data from government databases (NBSS&LUP)
   */
  private async fetchSoilDataForLocation(
    coordinates: Coordinates, 
    region: string,
    forceRefresh?: boolean
  ): Promise<SoilData | null> {
    const startTime = Date.now();
    
    try {
      // Validate coordinates
      const coordValidation = Validator.validateCoordinates(coordinates);
      if (!coordValidation.isValid) {
        throw new Error(`Invalid coordinates: ${coordValidation.errors.join(', ')}`);
      }

      // Check cache first unless force refresh
      const cacheKey = `${coordinates.latitude},${coordinates.longitude}`;
      if (!forceRefresh && this.soilDataCache.has(cacheKey)) {
        const cachedData = this.soilDataCache.get(cacheKey)!;
        if (!this.shouldRefreshSoilData(cachedData)) {
          this.logger.info('Using cached soil data', { region });
          return cachedData;
        }
      }

      // Check existing data in database
      const existingData = await this.getExistingSoilData(coordinates);
      if (existingData && !forceRefresh && !this.shouldRefreshSoilData(existingData)) {
        this.logger.info('Using existing soil data', { 
          region, 
          lastUpdated: existingData.lastUpdated 
        });
        this.soilDataCache.set(cacheKey, existingData);
        return existingData;
      }

      // Fetch from NBSS&LUP API
      const apiUrl = this.buildNBSSLUPApiUrl(coordinates);
      const response = await this.makeNBSSLUPApiCall(apiUrl);
      
      if (!response || !response.data) {
        throw new Error('No data received from NBSS&LUP API');
      }

      // Transform response to our soil data format
      const soilData = this.transformNBSSLUPResponse(response.data, coordinates, region);
      
      // Validate the transformed data
      const validation = this.validateSoilData(soilData);
      if (!validation.isValid) {
        throw new Error(`Invalid soil data: ${validation.errors.join(', ')}`);
      }

      // Cache the data
      this.soilDataCache.set(cacheKey, soilData);

      const duration = Date.now() - startTime;
      this.logger.performance('fetchSoilDataForLocation', duration, { region });

      return soilData;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.performance('fetchSoilDataForLocation', duration, { 
        region, 
        error: true 
      });
      
      this.logger.error('Failed to fetch soil data', error as Error, { 
        region, 
        coordinates 
      });
      
      throw error;
    }
  }

  /**
   * Fetch crop calendar data from agricultural departments
   */
  private async fetchCropCalendarForState(
    state: string,
    forceRefresh?: boolean
  ): Promise<CropCalendar | null> {
    const startTime = Date.now();
    
    try {
      // Check cache first unless force refresh
      if (!forceRefresh && this.cropCalendarCache.has(state)) {
        const cachedData = this.cropCalendarCache.get(state)!;
        if (!this.shouldRefreshCropCalendar(cachedData)) {
          this.logger.info('Using cached crop calendar data', { state });
          return cachedData;
        }
      }

      // Check existing data in database
      const existingData = await this.getExistingCropCalendar(state);
      if (existingData && !forceRefresh && !this.shouldRefreshCropCalendar(existingData)) {
        this.logger.info('Using existing crop calendar data', { 
          state, 
          lastUpdated: existingData.lastUpdated 
        });
        this.cropCalendarCache.set(state, existingData);
        return existingData;
      }

      // Fetch from agricultural department API
      const apiUrl = this.buildAgricultureDeptApiUrl(state);
      const response = await this.makeAgricultureDeptApiCall(apiUrl);
      
      if (!response || !response.data) {
        throw new Error('No data received from Agriculture Department API');
      }

      // Transform response to our crop calendar format
      const cropCalendar = this.transformAgricultureDeptResponse(response.data, state);
      
      // Validate the transformed data
      const validation = this.validateCropCalendar(cropCalendar);
      if (!validation.isValid) {
        throw new Error(`Invalid crop calendar data: ${validation.errors.join(', ')}`);
      }

      // Cache the data
      this.cropCalendarCache.set(state, cropCalendar);

      const duration = Date.now() - startTime;
      this.logger.performance('fetchCropCalendarForState', duration, { state });

      return cropCalendar;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.performance('fetchCropCalendarForState', duration, { 
        state, 
        error: true 
      });
      
      this.logger.error('Failed to fetch crop calendar data', error as Error, { state });
      
      throw error;
    }
  }

  /**
   * Build NBSS&LUP API URL for soil data request
   */
  private buildNBSSLUPApiUrl(coordinates: Coordinates): string {
    const baseUrl = this.config.soilApiUrl || 'https://api.nbsslup.in/soil';
    const apiKey = this.config.soilApiKey;
    
    if (!apiKey) {
      throw new Error('NBSS&LUP API key not configured');
    }

    // NBSS&LUP API endpoint for soil data
    return `${baseUrl}/data?lat=${coordinates.latitude}&lon=${coordinates.longitude}&api_key=${apiKey}&format=json&include_recommendations=true`;
  }

  /**
   * Build Agriculture Department API URL for crop calendar
   */
  private buildAgricultureDeptApiUrl(state: string): string {
    const baseUrl = this.config.cropCalendarApiUrl || 'https://api.agricoop.nic.in/cropcalendar';
    const apiKey = this.config.cropCalendarApiKey;
    
    if (!apiKey) {
      throw new Error('Agriculture Department API key not configured');
    }

    // Agriculture Department API endpoint for crop calendar
    return `${baseUrl}/state/${encodeURIComponent(state)}?api_key=${apiKey}&format=json&include_details=true`;
  }

  /**
   * Make API call to NBSS&LUP with retry logic
   */
  private async makeNBSSLUPApiCall(url: string): Promise<AxiosResponse<NBSSLUPSoilResponse>> {
    return this.makeApiCall(url, 'NBSS&LUP');
  }

  /**
   * Make API call to Agriculture Department with retry logic
   */
  private async makeAgricultureDeptApiCall(url: string): Promise<AxiosResponse<AgricultureDeptCropCalendarResponse>> {
    return this.makeApiCall(url, 'Agriculture Department');
  }

  /**
   * Generic API call with retry logic and error handling
   */
  private async makeApiCall(url: string, provider: string): Promise<AxiosResponse<any>> {
    const maxRetries = this.config.maxRetries || 3;
    const timeout = this.config.defaultTimeout || 30000;
    
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
   * Transform NBSS&LUP response to SoilData format
   */
  private transformNBSSLUPResponse(
    nbssData: NBSSLUPSoilResponse, 
    coordinates: Coordinates, 
    region: string
  ): SoilData {
    const soilProperties: SoilProperties = {
      soilType: nbssData.soil_type,
      texture: {
        sand: nbssData.texture.sand,
        silt: nbssData.texture.silt,
        clay: nbssData.texture.clay,
      },
      ph: nbssData.chemical_properties.ph,
      organicCarbon: nbssData.chemical_properties.organic_carbon,
      nitrogen: nbssData.chemical_properties.nitrogen,
      phosphorus: nbssData.chemical_properties.phosphorus,
      potassium: nbssData.chemical_properties.potassium,
      sulfur: nbssData.chemical_properties.sulfur,
      micronutrients: {
        zinc: nbssData.micronutrients.zinc,
        iron: nbssData.micronutrients.iron,
        manganese: nbssData.micronutrients.manganese,
        copper: nbssData.micronutrients.copper,
        boron: nbssData.micronutrients.boron,
      },
      physicalProperties: {
        bulkDensity: nbssData.physical_properties.bulk_density,
        waterHoldingCapacity: nbssData.physical_properties.water_holding_capacity,
        infiltrationRate: nbssData.physical_properties.infiltration_rate,
        permeability: nbssData.physical_properties.permeability,
      },
    };

    const soilHealth: SoilHealth = {
      overallScore: nbssData.health_score.overall,
      categories: {
        chemical: nbssData.health_score.chemical,
        physical: nbssData.health_score.physical,
        biological: nbssData.health_score.biological,
      },
      deficiencies: this.identifyDeficiencies(soilProperties),
      strengths: this.identifyStrengths(soilProperties),
      trends: [], // Would need historical data for trends
    };

    const recommendations: SoilRecommendation[] = nbssData.recommendations.map(rec => ({
      category: rec.category as 'fertilizer' | 'amendment' | 'management',
      recommendation: rec.recommendation,
      quantity: rec.quantity,
      timing: rec.timing,
      expectedBenefit: rec.benefit,
      cost: rec.cost,
    }));

    const quality = this.calculateSoilDataQuality(nbssData);

    return {
      location: coordinates,
      source: 'NBSS&LUP',
      lastUpdated: new Date(nbssData.last_updated),
      soilProperties,
      soilHealth,
      recommendations,
      quality,
    };
  }

  /**
   * Transform Agriculture Department response to CropCalendar format
   */
  private transformAgricultureDeptResponse(
    agriData: AgricultureDeptCropCalendarResponse, 
    state: string
  ): CropCalendar {
    const crops: CropCalendarEntry[] = agriData.crops.map(crop => {
      const sowingPeriod = {
        start: { month: crop.sowing_period.start_month, day: crop.sowing_period.start_day } as MonthDay,
        end: { month: crop.sowing_period.end_month, day: crop.sowing_period.end_day } as MonthDay,
        optimal: { month: crop.sowing_period.optimal_month, day: crop.sowing_period.optimal_day } as MonthDay,
      };

      const harvestPeriod = {
        start: { month: crop.harvest_period.start_month, day: crop.harvest_period.start_day } as MonthDay,
        end: { month: crop.harvest_period.end_month, day: crop.harvest_period.end_day } as MonthDay,
        optimal: { month: crop.harvest_period.optimal_month, day: crop.harvest_period.optimal_day } as MonthDay,
      };

      const criticalStages: CriticalStage[] = crop.critical_stages.map(stage => ({
        stage: stage.stage_name,
        daysAfterSowing: stage.days_after_sowing,
        duration: stage.duration_days,
        waterCritical: stage.water_critical,
        nutrientRequirements: stage.nutrient_requirements,
        commonIssues: stage.common_issues,
      }));

      const marketingPeriod = crop.marketing_period ? {
        start: { month: crop.marketing_period.start_month, day: crop.marketing_period.start_day } as MonthDay,
        end: { month: crop.marketing_period.end_month, day: crop.marketing_period.end_day } as MonthDay,
      } : undefined;

      return {
        cropType: crop.crop_name,
        variety: crop.variety,
        season: crop.season as 'kharif' | 'rabi' | 'zaid' | 'perennial',
        sowingPeriod,
        harvestPeriod,
        duration: crop.duration_days,
        yieldPotential: {
          min: crop.yield_potential.min_yield,
          max: crop.yield_potential.max_yield,
          average: crop.yield_potential.avg_yield,
        },
        waterRequirement: crop.water_requirement,
        criticalStages,
        commonPests: crop.pests,
        commonDiseases: crop.diseases,
        marketingPeriod,
      };
    });

    const quality = this.calculateCropCalendarDataQuality(agriData);

    return {
      state: state as IndianState,
      district: agriData.district,
      source: 'Agriculture Department',
      lastUpdated: new Date(agriData.last_updated),
      crops,
      quality,
    };
  }

  /**
   * Identify soil deficiencies based on properties
   */
  private identifyDeficiencies(properties: SoilProperties): string[] {
    const deficiencies: string[] = [];

    if (properties.ph < 6.0) {
      deficiencies.push('Acidic soil (low pH)');
    } else if (properties.ph > 8.5) {
      deficiencies.push('Alkaline soil (high pH)');
    }

    if (properties.organicCarbon < 0.5) {
      deficiencies.push('Low organic carbon');
    }

    if (properties.nitrogen < 280) {
      deficiencies.push('Nitrogen deficiency');
    }

    if (properties.phosphorus < 22) {
      deficiencies.push('Phosphorus deficiency');
    }

    if (properties.potassium < 108) {
      deficiencies.push('Potassium deficiency');
    }

    if (properties.micronutrients.zinc && properties.micronutrients.zinc < 0.6) {
      deficiencies.push('Zinc deficiency');
    }

    if (properties.micronutrients.iron && properties.micronutrients.iron < 4.5) {
      deficiencies.push('Iron deficiency');
    }

    return deficiencies;
  }

  /**
   * Identify soil strengths based on properties
   */
  private identifyStrengths(properties: SoilProperties): string[] {
    const strengths: string[] = [];

    if (properties.ph >= 6.0 && properties.ph <= 7.5) {
      strengths.push('Optimal pH range');
    }

    if (properties.organicCarbon > 0.75) {
      strengths.push('Good organic carbon content');
    }

    if (properties.nitrogen > 560) {
      strengths.push('Adequate nitrogen levels');
    }

    if (properties.phosphorus > 45) {
      strengths.push('Good phosphorus availability');
    }

    if (properties.potassium > 280) {
      strengths.push('Adequate potassium levels');
    }

    if (properties.physicalProperties.waterHoldingCapacity > 40) {
      strengths.push('Good water holding capacity');
    }

    return strengths;
  }

  /**
   * Calculate data quality for soil data
   */
  private calculateSoilDataQuality(data: NBSSLUPSoilResponse): DataQuality {
    const issues: string[] = [];
    let completeness = 1.0;
    let accuracy = 0.85; // Government data generally reliable
    let timeliness = 1.0;

    // Check completeness
    if (!data.chemical_properties || !data.physical_properties) {
      issues.push('Missing essential soil properties');
      completeness -= 0.3;
    }

    if (!data.micronutrients || Object.keys(data.micronutrients).length === 0) {
      issues.push('Limited micronutrient data');
      completeness -= 0.1;
    }

    if (!data.recommendations || data.recommendations.length === 0) {
      issues.push('No soil recommendations available');
      completeness -= 0.2;
    }

    // Check data age
    const dataAge = Date.now() - new Date(data.last_updated).getTime();
    const daysSinceUpdate = dataAge / (1000 * 60 * 60 * 24);
    
    if (daysSinceUpdate > 365) {
      issues.push('Soil data older than 1 year');
      timeliness -= 0.3;
    } else if (daysSinceUpdate > 180) {
      issues.push('Soil data older than 6 months');
      timeliness -= 0.1;
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
   * Calculate data quality for crop calendar data
   */
  private calculateCropCalendarDataQuality(data: AgricultureDeptCropCalendarResponse): DataQuality {
    const issues: string[] = [];
    let completeness = 1.0;
    let accuracy = 0.9; // Agricultural department data is highly reliable
    let timeliness = 1.0;

    // Check completeness
    if (!data.crops || data.crops.length === 0) {
      issues.push('No crop calendar entries');
      completeness = 0;
    } else {
      const incompleteCrops = data.crops.filter(crop => 
        !crop.sowing_period || !crop.harvest_period || !crop.duration_days
      );
      
      if (incompleteCrops.length > 0) {
        issues.push(`${incompleteCrops.length} crops missing essential timing data`);
        completeness -= (incompleteCrops.length / data.crops.length) * 0.5;
      }
    }

    // Check data age
    const dataAge = Date.now() - new Date(data.last_updated).getTime();
    const daysSinceUpdate = dataAge / (1000 * 60 * 60 * 24);
    
    if (daysSinceUpdate > 365) {
      issues.push('Crop calendar data older than 1 year');
      timeliness -= 0.2;
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
   * Validate soil data before storage
   */
  private validateSoilData(soilData: SoilData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate coordinates
    const coordValidation = Validator.validateCoordinates(soilData.location);
    errors.push(...coordValidation.errors);
    warnings.push(...coordValidation.warnings);

    // Validate soil properties
    const props = soilData.soilProperties;
    
    if (props.ph < 3 || props.ph > 11) {
      errors.push('pH out of reasonable range (3-11)');
    }
    
    if (props.organicCarbon < 0 || props.organicCarbon > 10) {
      errors.push('Organic carbon out of reasonable range (0-10%)');
    }
    
    if (props.texture.sand + props.texture.silt + props.texture.clay !== 100) {
      warnings.push('Soil texture percentages do not sum to 100%');
    }

    // Validate soil health scores
    const health = soilData.soilHealth;
    if (health.overallScore < 0 || health.overallScore > 100) {
      errors.push('Overall soil health score out of valid range (0-100)');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate crop calendar data before storage
   */
  private validateCropCalendar(cropCalendar: CropCalendar): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate crops
    if (!cropCalendar.crops || cropCalendar.crops.length === 0) {
      errors.push('No crops in calendar');
    } else {
      for (const crop of cropCalendar.crops) {
        // Validate sowing and harvest periods
        if (crop.sowingPeriod.start.month < 1 || crop.sowingPeriod.start.month > 12) {
          errors.push(`Invalid sowing start month for ${crop.cropType}`);
        }
        
        if (crop.harvestPeriod.start.month < 1 || crop.harvestPeriod.start.month > 12) {
          errors.push(`Invalid harvest start month for ${crop.cropType}`);
        }
        
        if (crop.duration <= 0 || crop.duration > 365) {
          errors.push(`Invalid crop duration for ${crop.cropType}`);
        }
        
        if (crop.yieldPotential.min > crop.yieldPotential.max) {
          warnings.push(`Minimum yield greater than maximum for ${crop.cropType}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Store soil data in DynamoDB
   */
  private async storeSoilData(soilData: SoilData): Promise<void> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = `${soilData.location.latitude},${soilData.location.longitude}`;
      const dataKey = this.dynamoHelper.createExternalDataKey(
        'soil',
        locationKey,
        soilData.lastUpdated.toISOString().split('T')[0]
      );

      const externalData: ExternalData = {
        dataType: 'soil',
        source: soilData.source,
        timestamp: new Date(),
        location: soilData.location,
        data: soilData,
        metadata: {
          version: '1.0',
          processingDate: new Date(),
          processingNotes: [],
          validationResult: this.validateSoilData(soilData),
          retentionPolicy: `${this.config.externalDataRetentionDays || 365} days`,
        },
      };

      const item = {
        dataKey,
        timestamp: soilData.lastUpdated.toISOString(),
        dataType: 'soil',
        location: locationKey,
        source: soilData.source,
        data: JSON.stringify(externalData),
        ttl: this.dynamoHelper.generateTTL(this.config.externalDataRetentionDays || 365),
      };

      await this.dynamoHelper.putItem(tableName, item);
      
      this.logger.info('Soil data stored successfully', { 
        dataKey, 
        location: locationKey 
      });

    } catch (error) {
      this.logger.error('Failed to store soil data', error as Error);
      throw error;
    }
  }

  /**
   * Store crop calendar data in DynamoDB
   */
  private async storeCropCalendarData(cropCalendar: CropCalendar): Promise<void> {
    try {
      const tableName = this.config.externalDataTableName;
      const stateKey = cropCalendar.state;
      const dataKey = this.dynamoHelper.createExternalDataKey(
        'crop_calendar',
        stateKey,
        cropCalendar.lastUpdated.toISOString().split('T')[0]
      );

      const externalData: ExternalData = {
        dataType: 'crop_calendar',
        source: cropCalendar.source,
        timestamp: new Date(),
        data: cropCalendar,
        metadata: {
          version: '1.0',
          processingDate: new Date(),
          processingNotes: [],
          validationResult: this.validateCropCalendar(cropCalendar),
          retentionPolicy: `${this.config.externalDataRetentionDays || 365} days`,
        },
      };

      const item = {
        dataKey,
        timestamp: cropCalendar.lastUpdated.toISOString(),
        dataType: 'crop_calendar',
        location: stateKey,
        source: cropCalendar.source,
        data: JSON.stringify(externalData),
        ttl: this.dynamoHelper.generateTTL(this.config.externalDataRetentionDays || 365),
      };

      await this.dynamoHelper.putItem(tableName, item);
      
      this.logger.info('Crop calendar data stored successfully', { 
        dataKey, 
        state: stateKey 
      });

    } catch (error) {
      this.logger.error('Failed to store crop calendar data', error as Error);
      throw error;
    }
  }

  /**
   * Publish soil data event to EventBridge
   */
  private async publishSoilDataEvent(soilData: SoilData): Promise<void> {
    try {
      const eventDetail = {
        dataType: 'soil',
        location: soilData.location,
        lastUpdated: soilData.lastUpdated.toISOString(),
        source: soilData.source,
        soilHealth: soilData.soilHealth,
        quality: soilData.quality,
      };

      const params = {
        Entries: [
          {
            Source: 'croptwin.data-ingestion',
            DetailType: 'Soil Data Integrated',
            Detail: JSON.stringify(eventDetail),
            EventBusName: this.config.eventBusName,
          },
        ],
      };

      await this.eventBridge.putEvents(params).promise();
      
      this.logger.info('Soil data event published', { 
        location: soilData.location 
      });

    } catch (error) {
      this.logger.error('Failed to publish soil data event', error as Error);
      // Don't throw - event publishing failure shouldn't stop data integration
    }
  }

  /**
   * Publish crop calendar event to EventBridge
   */
  private async publishCropCalendarEvent(cropCalendar: CropCalendar): Promise<void> {
    try {
      const eventDetail = {
        dataType: 'crop_calendar',
        state: cropCalendar.state,
        district: cropCalendar.district,
        lastUpdated: cropCalendar.lastUpdated.toISOString(),
        source: cropCalendar.source,
        cropCount: cropCalendar.crops.length,
        quality: cropCalendar.quality,
      };

      const params = {
        Entries: [
          {
            Source: 'croptwin.data-ingestion',
            DetailType: 'Crop Calendar Data Integrated',
            Detail: JSON.stringify(eventDetail),
            EventBusName: this.config.eventBusName,
          },
        ],
      };

      await this.eventBridge.putEvents(params).promise();
      
      this.logger.info('Crop calendar event published', { 
        state: cropCalendar.state 
      });

    } catch (error) {
      this.logger.error('Failed to publish crop calendar event', error as Error);
      // Don't throw - event publishing failure shouldn't stop data integration
    }
  }

  /**
   * Get existing soil data from database
   */
  private async getExistingSoilData(coordinates: Coordinates): Promise<SoilData | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = `${coordinates.latitude},${coordinates.longitude}`;
      
      const items = await this.dynamoHelper.queryItems(
        tableName,
        'location = :location AND dataType = :dataType',
        {
          ':location': locationKey,
          ':dataType': 'soil',
        },
        'LocationTypeIndex',
        1,
        false // Most recent first
      );

      if (items.length > 0 && items[0].data) {
        const externalData: ExternalData = JSON.parse(items[0].data);
        return externalData.data as SoilData;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get existing soil data', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Get existing crop calendar data from database
   */
  private async getExistingCropCalendar(state: string): Promise<CropCalendar | null> {
    try {
      const tableName = this.config.externalDataTableName;
      
      const items = await this.dynamoHelper.queryItems(
        tableName,
        'location = :state AND dataType = :dataType',
        {
          ':state': state,
          ':dataType': 'crop_calendar',
        },
        'LocationTypeIndex',
        1,
        false // Most recent first
      );

      if (items.length > 0 && items[0].data) {
        const externalData: ExternalData = JSON.parse(items[0].data);
        return externalData.data as CropCalendar;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get existing crop calendar data', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Check if soil data should be refreshed
   */
  private shouldRefreshSoilData(soilData: SoilData): boolean {
    const now = new Date();
    const dataAge = now.getTime() - soilData.lastUpdated.getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    
    return dataAge > thirtyDays;
  }

  /**
   * Check if crop calendar data should be refreshed
   */
  private shouldRefreshCropCalendar(cropCalendar: CropCalendar): boolean {
    const now = new Date();
    const dataAge = now.getTime() - cropCalendar.lastUpdated.getTime();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    
    return dataAge > ninetyDays;
  }

  /**
   * Handle soil data failure with fallback mechanisms
   */
  private async handleSoilDataFailure(region: string, error: Error): Promise<void> {
    this.logger.warn('Attempting fallback for soil data failure', { region, error: error.message });

    try {
      // Try to get cached data from the last 90 days
      const coordinates = await this.parseRegionCoordinates(region);
      const cachedData = await this.getCachedSoilData(coordinates, 90);
      
      if (cachedData) {
        // Publish event indicating degraded service
        await this.publishDegradedServiceEvent(region, 'soil', error.message);
        this.logger.info('Using cached soil data as fallback', { region });
      } else {
        this.logger.error('No cached soil data available for fallback', { region });
      }
    } catch (fallbackError) {
      this.logger.error('Fallback mechanism failed', fallbackError as Error, { region });
    }
  }

  /**
   * Handle crop calendar failure with fallback mechanisms
   */
  private async handleCropCalendarFailure(state: string, error: Error): Promise<void> {
    this.logger.warn('Attempting fallback for crop calendar failure', { state, error: error.message });

    try {
      // Try to get cached data from the last 180 days
      const cachedData = await this.getCachedCropCalendar(state, 180);
      
      if (cachedData) {
        // Publish event indicating degraded service
        await this.publishDegradedServiceEvent(state, 'crop_calendar', error.message);
        this.logger.info('Using cached crop calendar data as fallback', { state });
      } else {
        this.logger.error('No cached crop calendar data available for fallback', { state });
      }
    } catch (fallbackError) {
      this.logger.error('Fallback mechanism failed', fallbackError as Error, { state });
    }
  }

  /**
   * Get cached soil data within specified days
   */
  private async getCachedSoilData(coordinates: Coordinates, daysBack: number): Promise<SoilData | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const locationKey = `${coordinates.latitude},${coordinates.longitude}`;
      const cutoffTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      const items = await this.dynamoHelper.queryItems(
        tableName,
        'location = :location AND dataType = :dataType AND #timestamp >= :cutoff',
        {
          ':location': locationKey,
          ':dataType': 'soil',
          ':cutoff': cutoffTime.toISOString(),
        },
        'LocationTypeIndex',
        1,
        false // Most recent first
      );

      if (items.length > 0 && items[0].data) {
        const externalData: ExternalData = JSON.parse(items[0].data);
        return externalData.data as SoilData;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get cached soil data', error as Error);
      return null;
    }
  }

  /**
   * Get cached crop calendar data within specified days
   */
  private async getCachedCropCalendar(state: string, daysBack: number): Promise<CropCalendar | null> {
    try {
      const tableName = this.config.externalDataTableName;
      const cutoffTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      const items = await this.dynamoHelper.queryItems(
        tableName,
        'location = :state AND dataType = :dataType AND #timestamp >= :cutoff',
        {
          ':state': state,
          ':dataType': 'crop_calendar',
          ':cutoff': cutoffTime.toISOString(),
        },
        'LocationTypeIndex',
        1,
        false // Most recent first
      );

      if (items.length > 0 && items[0].data) {
        const externalData: ExternalData = JSON.parse(items[0].data);
        return externalData.data as CropCalendar;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get cached crop calendar data', error as Error);
      return null;
    }
  }

  /**
   * Publish degraded service event
   */
  private async publishDegradedServiceEvent(location: string, dataType: string, reason: string): Promise<void> {
    try {
      const eventDetail = {
        location,
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
   * Get list of active regions that need soil data
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
      this.logger.error('Failed to get active regions', error as Error);
      // Return default regions for major agricultural areas in India
      return [
        '28.6,77.2', // Delhi NCR
        '19.1,72.9', // Mumbai
        '13.1,80.3', // Chennai
        '22.6,88.4', // Kolkata
        '12.3,76.6', // Mysore
        '23.0,72.6', // Ahmedabad
      ];
    }
  }

  /**
   * Get list of active states that need crop calendar data
   */
  private async getActiveStates(): Promise<string[]> {
    try {
      // Query farm twins to get unique states
      const tableName = this.config.farmTwinsTableName;
      const items = await this.dynamoHelper.scanItems(
        tableName,
        undefined,
        undefined,
        1000 // Limit to prevent large scans
      );

      const states = new Set<string>();
      
      for (const item of items) {
        if (item.state) {
          states.add(item.state);
        }
      }

      return Array.from(states);
    } catch (error) {
      this.logger.error('Failed to get active states', error as Error);
      // Return default major agricultural states in India
      return [
        'Uttar Pradesh',
        'Punjab',
        'Haryana',
        'Madhya Pradesh',
        'Bihar',
        'West Bengal',
        'Gujarat',
        'Maharashtra',
        'Rajasthan',
        'Karnataka',
        'Andhra Pradesh',
        'Tamil Nadu',
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
export const handler: Handler<SoilCropCalendarEvent, void> = async (event, context) => {
  const logger = createLambdaLogger('soil-crop-calendar', context.awsRequestId);
  
  try {
    logger.info('Soil and crop calendar integration Lambda started', { event });
    
    const service = new SoilCropCalendarService(logger);
    await service.integrateSoilCropCalendarData(event);
    
    logger.info('Soil and crop calendar integration Lambda completed successfully');
  } catch (error) {
    logger.error('Soil and crop calendar integration Lambda failed', error as Error);
    throw error;
  }
};