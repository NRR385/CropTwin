/**
 * Farm Twin data models
 * Defines the structure for digital farm representations and their state
 */

import {
  Coordinates,
  Location,
  CropType,
  CropStage,
  IrrigationType,
  SoilType,
  TemperatureRange
} from './core';

// Historical record for tracking farm twin changes over time
export interface HistoricalRecord {
  timestamp: Date;
  farmState: FarmState;
  dataSource: string;
  changeReason: string;
}

// Farm configuration provided during twin creation
export interface FarmConfiguration {
  cropType: CropType;
  varietyName: string;
  plantingDate: Date;
  farmSize: number; // in hectares
  irrigationType: IrrigationType;
  soilType: SoilType;
  expectedHarvestDate?: Date;
  previousCropHistory?: PreviousCrop[];
}

export interface PreviousCrop {
  cropType: CropType;
  varietyName: string;
  plantingDate: Date;
  harvestDate: Date;
  yield: number; // kg per hectare
  issues?: string[];
}

// Stress indicators for crop health monitoring
export interface StressIndicators {
  waterStress: number; // 0-1 scale
  heatStress: number; // 0-1 scale
  nutrientStress: number; // 0-1 scale
  pestRisk: number; // 0-1 scale
  diseaseRisk: number; // 0-1 scale
  lastUpdated: Date;
}

// Environmental conditions affecting the farm
export interface EnvironmentalConditions {
  temperature: TemperatureRange;
  humidity: number; // percentage
  rainfall: number; // mm in last 7 days
  windSpeed: number; // km/h
  soilTemperature?: number;
  evapotranspiration?: number; // mm/day
  solarRadiation?: number; // MJ/m²/day
  lastUpdated: Date;
}

// Current state of the farm twin
export interface FarmState {
  cropStage: CropStage;
  daysAfterPlanting: number;
  soilMoisture: number; // percentage
  stressIndicators: StressIndicators;
  environmentalConditions: EnvironmentalConditions;
  predictedYield: number; // kg per hectare
  confidenceLevel: number; // 0-1 scale
  lastUpdated: Date;
  dataQuality: DataQualityMetrics;
}

export interface DataQualityMetrics {
  weatherDataFreshness: number; // hours since last update
  satelliteDataFreshness: number; // days since last update
  soilDataAvailability: boolean;
  farmerInputRecency: number; // days since last farmer input
  overallQualityScore: number; // 0-1 scale
}

// Main Farm Twin interface
export interface FarmTwin {
  twinId: string;
  farmerId: string;
  location: Location;
  farmConfiguration: FarmConfiguration;
  currentState: FarmState;
  historicalData: HistoricalRecord[];
  lastUpdated: Date;
  createdAt: Date;
  isActive: boolean;
  metadata: FarmTwinMetadata;
  preferences?: FarmerPreferences;
}

export interface FarmTwinMetadata {
  version: string;
  dataSourcesUsed: string[];
  simulationModel: string;
  calibrationStatus: 'pending' | 'calibrated' | 'needs_recalibration';
  lastCalibrationDate?: Date;
  tags: string[];
}

// Growth prediction model
export interface GrowthPrediction {
  twinId: string;
  predictionDate: Date;
  timeHorizon: number; // days into the future
  predictedStages: PredictedStage[];
  yieldForecast: YieldForecast;
  riskFactors: RiskFactor[];
  confidence: number; // 0-1 scale
}

export interface PredictedStage {
  stage: CropStage;
  expectedStartDate: Date;
  expectedEndDate: Date;
  confidence: number;
}

export interface YieldForecast {
  expectedYield: number; // kg per hectare
  minYield: number; // worst case scenario
  maxYield: number; // best case scenario
  confidence: number;
  factors: YieldFactor[];
}

export interface YieldFactor {
  factor: string;
  impact: number; // -1 to 1 scale (negative = reduces yield)
  confidence: number;
}

export interface RiskFactor {
  type: 'weather' | 'pest' | 'disease' | 'nutrient' | 'water';
  severity: number; // 0-1 scale
  probability: number; // 0-1 scale
  timeframe: string; // e.g., "next 7 days"
  description: string;
}

// Data update interface for twin state modifications
export interface DataUpdate {
  source: 'weather' | 'satellite' | 'farmer' | 'soil' | 'simulation';
  timestamp: Date;
  data: any; // Flexible data structure based on source
  quality: number; // 0-1 scale
  processingNotes?: string[];
}

// Farm context for advisory generation
export interface FarmContext {
  twinId: string;
  farmerId: string;
  location: Location;
  cropType: CropType;
  cropStage: CropStage;
  farmSize: number;
  irrigationType: IrrigationType;
  farmerPreferences: FarmerPreferences;
  localConditions: LocalConditions;
}

export interface FarmerPreferences {
  preferredLanguage: string;
  language?: string; // Alias for preferredLanguage
  communicationChannels: string[];
  advisoryFrequency: 'daily' | 'weekly' | 'as_needed';
  riskTolerance: 'low' | 'medium' | 'high';
  organicFarming: boolean;
  budgetConstraints?: BudgetConstraints;
}

export interface BudgetConstraints {
  maxMonthlySpend: number; // in local currency
  priorityCategories: string[]; // ordered by importance
  subsidyEligibility: string[];
}

export interface LocalConditions {
  marketPrices: MarketPrice[];
  inputAvailability: InputAvailability[];
  weatherAlerts: WeatherAlert[];
  regionalPestOutbreaks: string[];
}

export interface MarketPrice {
  commodity: string;
  price: number;
  unit: string;
  market: string;
  date: Date;
}

export interface InputAvailability {
  inputType: string;
  availability: 'high' | 'medium' | 'low' | 'unavailable';
  price?: number;
  supplier?: string;
}

export interface WeatherAlert {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  startDate: Date;
  endDate: Date;
  description: string;
}