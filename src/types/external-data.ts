/**
 * External Data models
 * Defines structures for data ingested from external sources
 */

import { Coordinates, IndianState, ValidationResult } from './core';

// Weather data from meteorological services
export interface WeatherData {
  location: Coordinates;
  timestamp: Date;
  source: string; // IMD, OpenWeather, etc.
  current: CurrentWeather;
  forecast: WeatherForecast[];
  historical: WeatherRecord[];
  quality: DataQuality;
}

export interface CurrentWeather {
  temperature: number; // Celsius
  humidity: number; // percentage
  windSpeed: number; // km/h
  windDirection: number; // degrees
  precipitation: number; // mm
  pressure: number; // hPa
  visibility: number; // km
  uvIndex: number;
  cloudCover: number; // percentage
  dewPoint: number; // Celsius
}

export interface WeatherForecast {
  date: Date;
  temperature: {
    min: number;
    max: number;
    average: number;
  };
  humidity: {
    min: number;
    max: number;
    average: number;
  };
  precipitation: {
    probability: number; // percentage
    amount: number; // mm
  };
  windSpeed: number;
  conditions: string[];
  confidence: number; // 0-1 scale
}

export interface WeatherRecord {
  date: Date;
  temperature: {
    min: number;
    max: number;
  };
  precipitation: number;
  humidity: number;
  windSpeed: number;
}

export interface DataQuality {
  completeness: number; // 0-1 scale
  accuracy: number; // 0-1 scale
  timeliness: number; // 0-1 scale
  lastValidated: Date;
  issues: string[];
}

// Satellite imagery and vegetation indices
export interface SatelliteData {
  location: Coordinates;
  captureDate: Date;
  source: string; // ISRO, NASA, ESA, etc.
  satellite: string; // Landsat, Sentinel, etc.
  vegetationIndex: VegetationIndex;
  cloudCover: number; // percentage
  resolution: number; // meters per pixel
  quality: DataQuality;
  processingLevel: string;
}

export interface VegetationIndex {
  ndvi: number; // Normalized Difference Vegetation Index (-1 to 1)
  evi: number; // Enhanced Vegetation Index (-1 to 1)
  lai: number; // Leaf Area Index (0 to 8+)
  fpar: number; // Fraction of Photosynthetically Active Radiation (0-1)
  gpp?: number; // Gross Primary Productivity (optional)
  confidence: number; // 0-1 scale
}

// Soil data from government databases
export interface SoilData {
  location: Coordinates;
  source: string; // NBSS&LUP, state soil surveys, etc.
  lastUpdated: Date;
  soilProperties: SoilProperties;
  soilHealth: SoilHealth;
  recommendations: SoilRecommendation[];
  quality: DataQuality;
}

export interface SoilProperties {
  soilType: string;
  texture: {
    sand: number; // percentage
    silt: number; // percentage
    clay: number; // percentage
  };
  ph: number;
  organicCarbon: number; // percentage
  nitrogen: number; // kg/ha
  phosphorus: number; // kg/ha
  potassium: number; // kg/ha
  sulfur?: number; // kg/ha
  micronutrients: {
    zinc?: number; // ppm
    iron?: number; // ppm
    manganese?: number; // ppm
    copper?: number; // ppm
    boron?: number; // ppm
  };
  physicalProperties: {
    bulkDensity: number; // g/cm³
    waterHoldingCapacity: number; // percentage
    infiltrationRate: number; // mm/hr
    permeability: string; // slow/moderate/rapid
  };
}

export interface SoilHealth {
  overallScore: number; // 0-100 scale
  categories: {
    chemical: number; // 0-100 scale
    physical: number; // 0-100 scale
    biological: number; // 0-100 scale
  };
  deficiencies: string[];
  strengths: string[];
  trends: {
    parameter: string;
    trend: 'improving' | 'stable' | 'declining';
    timeframe: string;
  }[];
}

export interface SoilRecommendation {
  category: 'fertilizer' | 'amendment' | 'management';
  recommendation: string;
  quantity?: string;
  timing?: string;
  expectedBenefit: string;
  cost?: number;
}

// Crop calendar information
export interface CropCalendar {
  state: IndianState;
  district?: string;
  source: string; // agricultural department, research institute
  lastUpdated: Date;
  crops: CropCalendarEntry[];
  quality: DataQuality;
}

export interface CropCalendarEntry {
  cropType: string;
  variety?: string;
  season: 'kharif' | 'rabi' | 'zaid' | 'perennial';
  sowingPeriod: {
    start: MonthDay;
    end: MonthDay;
    optimal: MonthDay;
  };
  harvestPeriod: {
    start: MonthDay;
    end: MonthDay;
    optimal: MonthDay;
  };
  duration: number; // days
  yieldPotential: {
    min: number; // kg/ha
    max: number; // kg/ha
    average: number; // kg/ha
  };
  waterRequirement: number; // mm
  criticalStages: CriticalStage[];
  commonPests: string[];
  commonDiseases: string[];
  marketingPeriod?: {
    start: MonthDay;
    end: MonthDay;
  };
}

export interface MonthDay {
  month: number; // 1-12
  day: number; // 1-31
}

export interface CriticalStage {
  stage: string;
  daysAfterSowing: number;
  duration: number; // days
  waterCritical: boolean;
  nutrientRequirements: string[];
  commonIssues: string[];
}

// Market and price data
export interface MarketData {
  location: string;
  source: string; // AGMARKNET, state marketing boards
  date: Date;
  prices: CommodityPrice[];
  trends: PriceTrend[];
  quality: DataQuality;
}

export interface CommodityPrice {
  commodity: string;
  variety?: string;
  grade?: string;
  price: {
    min: number;
    max: number;
    modal: number; // most common price
    average: number;
  };
  unit: string; // per quintal, per kg, etc.
  arrivals: number; // quantity arrived in market
  currency: string;
}

export interface PriceTrend {
  commodity: string;
  timeframe: '7d' | '30d' | '90d' | '1y';
  change: number; // percentage
  direction: 'up' | 'down' | 'stable';
  volatility: number; // 0-1 scale
  seasonalPattern?: SeasonalPattern;
}

export interface SeasonalPattern {
  peakMonths: number[];
  lowMonths: number[];
  averageVariation: number; // percentage
}

// Pest and disease surveillance data
export interface PestSurveillanceData {
  location: Coordinates;
  reportDate: Date;
  source: string; // agricultural extension, research institutes
  reports: PestReport[];
  diseaseReports: DiseaseReport[];
  quality: DataQuality;
}

export interface PestReport {
  pestName: string;
  scientificName?: string;
  cropAffected: string;
  severity: 'low' | 'medium' | 'high' | 'outbreak';
  incidence: number; // percentage of area affected
  lifeCycle: string;
  favorableConditions: string[];
  controlMeasures: string[];
  economicThreshold?: number;
}

export interface DiseaseReport {
  diseaseName: string;
  pathogen?: string;
  cropAffected: string;
  severity: 'low' | 'medium' | 'high' | 'epidemic';
  incidence: number; // percentage of area affected
  symptoms: string[];
  favorableConditions: string[];
  controlMeasures: string[];
  resistantVarieties?: string[];
}

// External data integration interfaces
export interface ExternalData {
  dataType: 'weather' | 'satellite' | 'soil' | 'crop_calendar' | 'market' | 'pest_surveillance';
  source: string;
  timestamp: Date;
  location?: Coordinates;
  data: any; // Flexible structure based on dataType
  metadata: ExternalDataMetadata;
}

export interface ExternalDataMetadata {
  version: string;
  processingDate: Date;
  processingNotes: string[];
  validationResult: ValidationResult;
  retentionPolicy: string;
  accessRestrictions?: string[];
}

// Data ingestion service interfaces
export interface DataIngestionConfig {
  sources: DataSourceConfig[];
  schedules: IngestionSchedule[];
  validation: ValidationConfig;
  storage: StorageConfig;
}

export interface DataSourceConfig {
  sourceId: string;
  name: string;
  type: 'api' | 'file' | 'database' | 'stream';
  endpoint?: string;
  credentials?: CredentialConfig;
  parameters: { [key: string]: any };
  rateLimit?: RateLimit;
  timeout: number; // seconds
  retryPolicy: RetryPolicy;
}

export interface CredentialConfig {
  type: 'api_key' | 'oauth' | 'basic_auth' | 'certificate';
  secretArn?: string; // AWS Secrets Manager ARN
  parameters: { [key: string]: string };
}

export interface RateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  baseDelay: number; // seconds
  maxDelay: number; // seconds
}

export interface IngestionSchedule {
  sourceId: string;
  frequency: string; // cron expression
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  priority: number;
}

export interface ValidationConfig {
  rules: ValidationRule[];
  onFailure: 'reject' | 'flag' | 'quarantine';
  notificationThreshold: number; // failure percentage
}

export interface ValidationRule {
  field: string;
  type: 'required' | 'range' | 'format' | 'custom';
  parameters: any;
  severity: 'error' | 'warning';
}

export interface StorageConfig {
  primaryStorage: string; // S3 bucket or DynamoDB table
  archiveStorage?: string;
  retentionPeriod: number; // days
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
}