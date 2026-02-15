/**
 * Farm Twin Management Lambda Functions
 * Implements core digital twin operations: create, update, and retrieve farm twins
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { 
  FarmTwin, 
  FarmConfiguration, 
  FarmState, 
  StressIndicators, 
  EnvironmentalConditions,
  DataQualityMetrics,
  FarmTwinMetadata,
  HistoricalRecord
} from '../types/farm-twin';
import { 
  Location, 
  CropStage, 
  ValidationResult 
} from '../types/core';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { Validator } from '../shared/utils/validation';
import { LambdaResponse, handleLambdaError } from '../shared/utils/lambda-response';
import { manualTrackFarmRegistration } from '../shared/services/performance-integration';

const dynamoHelper = new DynamoDBHelper();
const FARM_TWINS_TABLE = process.env.FARM_TWINS_TABLE || 'CropTwin-FarmTwins';

// Input interfaces for Lambda functions
export interface CreateFarmTwinRequest {
  farmerId: string;
  location: Location;
  farmConfiguration: FarmConfiguration;
}

export interface UpdateTwinStateRequest {
  twinId: string;
  dataUpdate: {
    source: 'weather' | 'satellite' | 'farmer' | 'soil' | 'simulation';
    timestamp: string;
    data: any;
    quality: number;
    processingNotes?: string[];
  };
}

export interface GetFarmStateRequest {
  twinId: string;
  includeHistory?: boolean;
  historyDays?: number;
}

/**
 * Create a new farm twin
 */
export const createFarmTwin = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const startTime = new Date();
  let twinId: string | undefined;
  
  try {
    console.log('Creating farm twin:', JSON.stringify(event.body));

    // Parse and validate input
    const request: CreateFarmTwinRequest = JSON.parse(event.body || '{}');
    const validationResult = validateCreateFarmTwinRequest(request);
    
    if (!validationResult.isValid) {
      return LambdaResponse.validationError(validationResult.errors);
    }

    // Generate unique twin ID
    twinId = `twin_${uuidv4()}`;
    const now = new Date();

    // Initialize farm state with default values
    const initialState = createInitialFarmState(request.farmConfiguration);

    // Create farm twin metadata
    const metadata: FarmTwinMetadata = {
      version: '1.0',
      dataSourcesUsed: ['farmer_input'],
      simulationModel: 'basic_crop_model_v1',
      calibrationStatus: 'pending',
      tags: [request.farmConfiguration.cropType, request.location.district]
    };

    // Create the farm twin object
    const farmTwin: FarmTwin = {
      twinId,
      farmerId: request.farmerId,
      location: request.location,
      farmConfiguration: request.farmConfiguration,
      currentState: initialState,
      historicalData: [],
      lastUpdated: now,
      createdAt: now,
      isActive: true,
      metadata
    };

    // Store in DynamoDB
    await dynamoHelper.putItem(FARM_TWINS_TABLE, {
      ...farmTwin,
      version: 'current',
      district: request.location.district,
      state: request.location.state,
      cropType: request.farmConfiguration.cropType,
      plantingDate: request.farmConfiguration.plantingDate.toISOString(),
      createdAt: now.toISOString()
    });

    console.log(`Farm twin created successfully: ${twinId}`);

    // Track performance (Requirement 7.3)
    const endTime = new Date();
    await manualTrackFarmRegistration(twinId, startTime, endTime, {
      farmerId: request.farmerId,
      cropType: request.farmConfiguration.cropType,
      district: request.location.district,
      state: request.location.state
    }).catch(err => {
      console.warn('Failed to track farm registration performance:', err);
      // Don't fail the request if performance tracking fails
    });

    return LambdaResponse.success({
      twinId,
      farmTwin,
      message: 'Farm twin created successfully'
    }, 201);

  } catch (error) {
    console.error('Error creating farm twin:', error);
    
    // Track failed registration if we have a twinId
    if (twinId) {
      const endTime = new Date();
      await manualTrackFarmRegistration(twinId, startTime, endTime, {
        success: false,
        error: (error as Error).message
      }).catch(err => {
        console.warn('Failed to track failed farm registration:', err);
      });
    }
    
    return handleLambdaError(error);
  }
};

/**
 * Update farm twin state with new data
 */
export const updateTwinState = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Updating twin state:', JSON.stringify(event.body));

    // Parse and validate input
    const request: UpdateTwinStateRequest = JSON.parse(event.body || '{}');
    const validationResult = validateUpdateTwinStateRequest(request);
    
    if (!validationResult.isValid) {
      return LambdaResponse.validationError(validationResult.errors);
    }

    // Get existing farm twin
    const existingTwin = await dynamoHelper.getItem(FARM_TWINS_TABLE, {
      twinId: request.twinId,
      version: 'current'
    });

    if (!existingTwin) {
      return LambdaResponse.notFound('Farm twin');
    }

    // Create historical record of current state
    const historicalRecord: HistoricalRecord = {
      timestamp: new Date(request.dataUpdate.timestamp),
      farmState: existingTwin.currentState,
      dataSource: request.dataUpdate.source,
      changeReason: `Data update from ${request.dataUpdate.source}`
    };

    // Update farm state based on data source
    const updatedState = await updateFarmStateFromData(
      existingTwin.currentState,
      request.dataUpdate,
      existingTwin.farmConfiguration
    );

    // Update data quality metrics
    updatedState.dataQuality = updateDataQualityMetrics(
      existingTwin.currentState.dataQuality,
      request.dataUpdate
    );

    const now = new Date();

    // Update the farm twin
    const updateExpression = `
      SET currentState = :currentState,
          lastUpdated = :lastUpdated,
          historicalData = list_append(if_not_exists(historicalData, :emptyList), :newRecord)
    `;

    const expressionAttributeValues = {
      ':currentState': updatedState,
      ':lastUpdated': now.toISOString(),
      ':emptyList': [],
      ':newRecord': [historicalRecord]
    };

    const updatedTwin = await dynamoHelper.updateItem(
      FARM_TWINS_TABLE,
      { twinId: request.twinId, version: 'current' },
      updateExpression,
      expressionAttributeValues
    );

    console.log(`Farm twin state updated successfully: ${request.twinId}`);

    return LambdaResponse.success({
      twinId: request.twinId,
      updatedState,
      dataQuality: updatedState.dataQuality,
      message: 'Farm twin state updated successfully'
    });

  } catch (error) {
    console.error('Error updating twin state:', error);
    return handleLambdaError(error);
  }
};

/**
 * Get current farm state and optionally historical data
 */
export const getFarmState = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  try {
    const twinId = event.pathParameters?.twinId;
    const includeHistory = event.queryStringParameters?.includeHistory === 'true';
    const historyDays = parseInt(event.queryStringParameters?.historyDays || '7');

    if (!twinId) {
      return LambdaResponse.validationError(['twinId is required']);
    }

    // Validate twinId format
    if (!twinId.startsWith('twin_')) {
      return LambdaResponse.validationError(['Invalid twinId format']);
    }

    // Get farm twin from DynamoDB
    const farmTwin = await dynamoHelper.getItem(FARM_TWINS_TABLE, {
      twinId,
      version: 'current'
    });

    if (!farmTwin) {
      return LambdaResponse.notFound('Farm twin');
    }

    // Prepare response data
    const responseData: any = {
      twinId,
      farmerId: farmTwin.farmerId,
      location: farmTwin.location,
      farmConfiguration: farmTwin.farmConfiguration,
      currentState: farmTwin.currentState,
      lastUpdated: farmTwin.lastUpdated,
      isActive: farmTwin.isActive,
      metadata: farmTwin.metadata
    };

    // Include historical data if requested
    if (includeHistory && farmTwin.historicalData) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - historyDays);

      responseData.historicalData = farmTwin.historicalData
        .filter((record: HistoricalRecord) => 
          new Date(record.timestamp) >= cutoffDate
        )
        .sort((a: HistoricalRecord, b: HistoricalRecord) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    }

    console.log(`Farm state retrieved successfully: ${twinId}`);

    return LambdaResponse.success(responseData);

  } catch (error) {
    console.error('Error getting farm state:', error);
    return handleLambdaError(error);
  }
};

/**
 * Validate create farm twin request
 */
function validateCreateFarmTwinRequest(request: CreateFarmTwinRequest): ValidationResult {
  const validationResults: ValidationResult[] = [];

  // Validate farmer ID
  if (request.farmerId) {
    validationResults.push(Validator.validateFarmerId(request.farmerId));
  } else {
    validationResults.push({ isValid: false, errors: ['farmerId is required'], warnings: [] });
  }

  // Validate location
  if (request.location) {
    validationResults.push(Validator.validateCoordinates(request.location));
    validationResults.push(Validator.validateRequiredString(request.location.district, 'district'));
    validationResults.push(Validator.validateRequiredString(request.location.state, 'state'));
  } else {
    validationResults.push({ isValid: false, errors: ['location is required'], warnings: [] });
  }

  // Validate farm configuration
  if (request.farmConfiguration) {
    validationResults.push(Validator.validateCropType(request.farmConfiguration.cropType));
    validationResults.push(Validator.validateRequiredString(request.farmConfiguration.varietyName, 'varietyName'));
    validationResults.push(Validator.validatePlantingDate(new Date(request.farmConfiguration.plantingDate)));
    validationResults.push(Validator.validateFarmSize(request.farmConfiguration.farmSize));
    validationResults.push(Validator.validateIrrigationType(request.farmConfiguration.irrigationType));
    validationResults.push(Validator.validateSoilType(request.farmConfiguration.soilType));
  } else {
    validationResults.push({ isValid: false, errors: ['farmConfiguration is required'], warnings: [] });
  }

  return Validator.combineValidationResults(validationResults);
}

/**
 * Validate update twin state request
 */
function validateUpdateTwinStateRequest(request: UpdateTwinStateRequest): ValidationResult {
  const validationResults: ValidationResult[] = [];

  // Validate twin ID
  if (request.twinId) {
    if (!request.twinId.startsWith('twin_')) {
      validationResults.push({ isValid: false, errors: ['Invalid twinId format'], warnings: [] });
    }
  } else {
    validationResults.push({ isValid: false, errors: ['twinId is required'], warnings: [] });
  }

  // Validate data update
  if (request.dataUpdate) {
    const validSources = ['weather', 'satellite', 'farmer', 'soil', 'simulation'];
    if (!validSources.includes(request.dataUpdate.source)) {
      validationResults.push({ 
        isValid: false, 
        errors: [`Invalid data source. Must be one of: ${validSources.join(', ')}`], 
        warnings: [] 
      });
    }

    // Validate timestamp
    const timestamp = new Date(request.dataUpdate.timestamp);
    if (isNaN(timestamp.getTime())) {
      validationResults.push({ isValid: false, errors: ['Invalid timestamp format'], warnings: [] });
    }

    // Validate quality score
    if (typeof request.dataUpdate.quality !== 'number' || 
        request.dataUpdate.quality < 0 || 
        request.dataUpdate.quality > 1) {
      validationResults.push({ 
        isValid: false, 
        errors: ['Quality must be a number between 0 and 1'], 
        warnings: [] 
      });
    }
  } else {
    validationResults.push({ isValid: false, errors: ['dataUpdate is required'], warnings: [] });
  }

  return Validator.combineValidationResults(validationResults);
}

/**
 * Create initial farm state for a new twin
 */
function createInitialFarmState(farmConfig: FarmConfiguration): FarmState {
  const now = new Date();
  const plantingDate = new Date(farmConfig.plantingDate);
  const daysAfterPlanting = Math.floor((now.getTime() - plantingDate.getTime()) / (1000 * 60 * 60 * 24));

  // Determine initial crop stage based on days after planting
  let cropStage: CropStage = CropStage.GERMINATION;
  if (daysAfterPlanting > 90) cropStage = CropStage.MATURITY;
  else if (daysAfterPlanting > 60) cropStage = CropStage.GRAIN_FILLING;
  else if (daysAfterPlanting > 40) cropStage = CropStage.FLOWERING;
  else if (daysAfterPlanting > 15) cropStage = CropStage.VEGETATIVE;

  const stressIndicators: StressIndicators = {
    waterStress: 0.3, // Default moderate water stress
    heatStress: 0.2,
    nutrientStress: 0.25,
    pestRisk: 0.1,
    diseaseRisk: 0.15,
    lastUpdated: now
  };

  const environmentalConditions: EnvironmentalConditions = {
    temperature: { min: 20, max: 35, average: 27.5 },
    humidity: 65,
    rainfall: 0, // Will be updated by weather data
    windSpeed: 5,
    lastUpdated: now
  };

  const dataQuality: DataQualityMetrics = {
    weatherDataFreshness: 24, // Hours
    satelliteDataFreshness: 7, // Days
    soilDataAvailability: false,
    farmerInputRecency: 0, // Just created
    overallQualityScore: 0.6 // Moderate quality with farmer input only
  };

  return {
    cropStage,
    daysAfterPlanting: Math.max(0, daysAfterPlanting),
    soilMoisture: 50, // Default 50% soil moisture
    stressIndicators,
    environmentalConditions,
    predictedYield: estimateInitialYield(farmConfig.cropType, farmConfig.farmSize),
    confidenceLevel: 0.5, // Low confidence initially
    lastUpdated: now,
    dataQuality
  };
}

/**
 * Update farm state based on incoming data
 */
async function updateFarmStateFromData(
  currentState: FarmState,
  dataUpdate: any,
  farmConfig: FarmConfiguration
): Promise<FarmState> {
  const updatedState = { ...currentState };
  const now = new Date();

  switch (dataUpdate.source) {
    case 'weather':
      if (dataUpdate.data.temperature) {
        updatedState.environmentalConditions.temperature = dataUpdate.data.temperature;
      }
      if (dataUpdate.data.humidity !== undefined) {
        updatedState.environmentalConditions.humidity = dataUpdate.data.humidity;
      }
      if (dataUpdate.data.rainfall !== undefined) {
        updatedState.environmentalConditions.rainfall = dataUpdate.data.rainfall;
        // Update soil moisture based on rainfall
        updatedState.soilMoisture = Math.min(100, updatedState.soilMoisture + dataUpdate.data.rainfall * 0.5);
      }
      // Update heat stress based on temperature
      if (dataUpdate.data.temperature?.max > 40) {
        updatedState.stressIndicators.heatStress = Math.min(1, updatedState.stressIndicators.heatStress + 0.2);
      }
      break;

    case 'satellite':
      if (dataUpdate.data.ndvi !== undefined) {
        // Update stress indicators based on NDVI
        const healthScore = Math.max(0, Math.min(1, dataUpdate.data.ndvi));
        updatedState.stressIndicators.waterStress = Math.max(0, 1 - healthScore * 1.2);
        updatedState.stressIndicators.nutrientStress = Math.max(0, 1 - healthScore * 1.1);
      }
      break;

    case 'farmer':
      if (dataUpdate.data.observedStress) {
        Object.assign(updatedState.stressIndicators, dataUpdate.data.observedStress);
      }
      if (dataUpdate.data.soilMoisture !== undefined) {
        updatedState.soilMoisture = dataUpdate.data.soilMoisture;
      }
      break;

    case 'soil':
      if (dataUpdate.data.moisture !== undefined) {
        updatedState.soilMoisture = dataUpdate.data.moisture;
      }
      if (dataUpdate.data.nutrients) {
        // Update nutrient stress based on soil nutrient levels
        const nutrientScore = (dataUpdate.data.nutrients.nitrogen + 
                             dataUpdate.data.nutrients.phosphorus + 
                             dataUpdate.data.nutrients.potassium) / 3;
        updatedState.stressIndicators.nutrientStress = Math.max(0, 1 - nutrientScore);
      }
      break;

    case 'simulation':
      // Update predicted yield and confidence based on simulation results
      if (dataUpdate.data.predictedYield !== undefined) {
        updatedState.predictedYield = dataUpdate.data.predictedYield;
      }
      if (dataUpdate.data.confidence !== undefined) {
        updatedState.confidenceLevel = dataUpdate.data.confidence;
      }
      break;
  }

  // Update crop stage based on days after planting
  const plantingDate = new Date(farmConfig.plantingDate);
  const daysAfterPlanting = Math.floor((now.getTime() - plantingDate.getTime()) / (1000 * 60 * 60 * 24));
  updatedState.daysAfterPlanting = Math.max(0, daysAfterPlanting);

  // Update crop stage progression
  updatedState.cropStage = determineCropStage(daysAfterPlanting, farmConfig.cropType);

  // Update stress indicator timestamps
  updatedState.stressIndicators.lastUpdated = now;
  updatedState.environmentalConditions.lastUpdated = now;
  updatedState.lastUpdated = now;

  return updatedState;
}

/**
 * Update data quality metrics based on new data
 */
function updateDataQualityMetrics(
  currentMetrics: DataQualityMetrics,
  dataUpdate: any
): DataQualityMetrics {
  const updated = { ...currentMetrics };
  const now = new Date();

  switch (dataUpdate.source) {
    case 'weather':
      updated.weatherDataFreshness = 0; // Fresh weather data
      break;
    case 'satellite':
      updated.satelliteDataFreshness = 0; // Fresh satellite data
      break;
    case 'soil':
      updated.soilDataAvailability = true;
      break;
    case 'farmer':
      updated.farmerInputRecency = 0; // Fresh farmer input
      break;
  }

  // Recalculate overall quality score
  let qualityScore = 0;
  let factors = 0;

  // Weather data quality (25% weight)
  if (updated.weatherDataFreshness <= 6) qualityScore += 0.25;
  else if (updated.weatherDataFreshness <= 24) qualityScore += 0.15;
  else if (updated.weatherDataFreshness <= 72) qualityScore += 0.05;
  factors += 0.25;

  // Satellite data quality (25% weight)
  if (updated.satelliteDataFreshness <= 3) qualityScore += 0.25;
  else if (updated.satelliteDataFreshness <= 7) qualityScore += 0.15;
  else if (updated.satelliteDataFreshness <= 14) qualityScore += 0.05;
  factors += 0.25;

  // Soil data quality (25% weight)
  if (updated.soilDataAvailability) qualityScore += 0.25;
  factors += 0.25;

  // Farmer input quality (25% weight)
  if (updated.farmerInputRecency <= 1) qualityScore += 0.25;
  else if (updated.farmerInputRecency <= 7) qualityScore += 0.15;
  else if (updated.farmerInputRecency <= 30) qualityScore += 0.05;
  factors += 0.25;

  updated.overallQualityScore = Math.min(1, qualityScore);

  return updated;
}

/**
 * Determine crop stage based on days after planting and crop type
 */
function determineCropStage(daysAfterPlanting: number, cropType: string): CropStage {
  // Simplified crop stage determination - would be more sophisticated in production
  if (daysAfterPlanting < 0) return CropStage.GERMINATION;
  
  switch (cropType) {
    case 'rice':
      if (daysAfterPlanting <= 20) return CropStage.GERMINATION;
      if (daysAfterPlanting <= 60) return CropStage.VEGETATIVE;
      if (daysAfterPlanting <= 90) return CropStage.FLOWERING;
      if (daysAfterPlanting <= 120) return CropStage.GRAIN_FILLING;
      if (daysAfterPlanting <= 140) return CropStage.MATURITY;
      return CropStage.HARVEST_READY;
    
    case 'wheat':
      if (daysAfterPlanting <= 15) return CropStage.GERMINATION;
      if (daysAfterPlanting <= 45) return CropStage.VEGETATIVE;
      if (daysAfterPlanting <= 75) return CropStage.FLOWERING;
      if (daysAfterPlanting <= 105) return CropStage.GRAIN_FILLING;
      if (daysAfterPlanting <= 120) return CropStage.MATURITY;
      return CropStage.HARVEST_READY;
    
    default:
      // Generic crop stages
      if (daysAfterPlanting <= 15) return CropStage.GERMINATION;
      if (daysAfterPlanting <= 45) return CropStage.VEGETATIVE;
      if (daysAfterPlanting <= 75) return CropStage.FLOWERING;
      if (daysAfterPlanting <= 105) return CropStage.GRAIN_FILLING;
      if (daysAfterPlanting <= 120) return CropStage.MATURITY;
      return CropStage.HARVEST_READY;
  }
}

/**
 * Estimate initial yield based on crop type and farm size
 */
function estimateInitialYield(cropType: string, farmSize: number): number {
  // Simplified yield estimation - would use more sophisticated models in production
  const yieldPerHectare: { [key: string]: number } = {
    rice: 4000,      // kg/ha
    wheat: 3500,     // kg/ha
    maize: 5000,     // kg/ha
    cotton: 1500,    // kg/ha
    sugarcane: 70000, // kg/ha
    soybean: 2500,   // kg/ha
    groundnut: 2000, // kg/ha
    pulses: 1500,    // kg/ha
    vegetables: 25000, // kg/ha
    fruits: 15000    // kg/ha
  };

  const baseYield = yieldPerHectare[cropType] || 3000; // Default yield
  return baseYield * farmSize;
}