/**
 * Multi-Plot Manager for Digital Twin Engine
 * Handles multiple farm plots for a single farmer and provides aggregated insights
 */

import { 
  FarmConfiguration, 
  FarmTwin,
  FarmState,
  StressIndicators
} from '../types/farm-twin';
import { CropType, CropStage, Location } from '../types/core';
import { WeatherData, SoilData, SatelliteData } from '../types/external-data';
import { Logger, createLambdaLogger } from '../shared/utils/logger';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { TABLE_NAMES } from '../shared/config/constants';

export interface MultiPlotFarm {
  farmerId: string;
  farmerName: string;
  location: Location;
  plots: FarmTwin[];
  aggregatedState: AggregatedFarmState;
  metadata: MultiPlotMetadata;
  createdAt: Date;
  lastUpdated: Date;
}

export interface AggregatedFarmState {
  totalArea: number;
  totalPredictedYield: number;
  overallConfidence: number;
  averageStressIndicators: StressIndicators;
  criticalAlerts: string[];
  cropStageDistribution: Record<CropStage, number>;
  lastUpdated: Date;
}

export interface MultiPlotMetadata {
  plotCount: number;
  totalArea: number;
  dominantCropType: CropType;
  averageYield: number;
}

export class MultiPlotManager {
  private logger: Logger;
  private dbHelper: DynamoDBHelper;

  constructor() {
    this.logger = createLambdaLogger('MultiPlotManager');
    this.dbHelper = new DynamoDBHelper();
  }

  /**
   * Create a multi-plot farm with separate twins for each plot
   */
  async createMultiPlotFarm(
    farmerId: string,
    farmerName: string,
    location: Location,
    plotConfigurations: FarmConfiguration[]
  ): Promise<MultiPlotFarm> {
    try {
      const plots: FarmTwin[] = [];

      // Create individual farm twins for each plot
      for (let i = 0; i < plotConfigurations.length; i++) {
        const plotConfig = plotConfigurations[i];
        const twinId = `${farmerId}-plot-${i + 1}`;

        const farmTwin: FarmTwin = {
          twinId,
          farmerId,
          location,
          farmConfiguration: plotConfig,
          currentState: this.createInitialFarmState(plotConfig),
          historicalData: [],
          lastUpdated: new Date(),
          createdAt: new Date(),
          isActive: true,
          metadata: {
            version: '1.0',
            dataSourcesUsed: ['farmer_input'],
            simulationModel: 'crop_growth_v1',
            calibrationStatus: 'pending',
            tags: [plotConfig.cropType.toLowerCase(), `plot-${i + 1}`]
          }
        };

        plots.push(farmTwin);

        // Store individual plot in database
        await this.dbHelper.putItem(TABLE_NAMES.FARM_TWINS, {
          ...farmTwin,
          version: 'current',
          plotIndex: i + 1
        });
      }

      // Calculate aggregated state
      const aggregatedState = this.calculateAggregatedState(plots);

      // Calculate metadata
      const metadata = this.calculateMultiPlotMetadata(plots);

      const multiPlotFarm: MultiPlotFarm = {
        farmerId,
        farmerName,
        location,
        plots,
        aggregatedState,
        metadata,
        createdAt: new Date(),
        lastUpdated: new Date()
      };

      // Store multi-plot farm record
      await this.dbHelper.putItem(TABLE_NAMES.FARM_TWINS, {
        ...multiPlotFarm,
        type: 'multi-plot-farm',
        plotCount: plots.length
      });

      return multiPlotFarm;
    } catch (error) {
      this.logger.error('Error creating multi-plot farm', error);
      throw error;
    }
  }

  /**
   * Apply fallback configuration for missing farmer input
   */
  async applyFallbackConfiguration(
    partialConfig: Partial<FarmConfiguration>,
    location: Location
  ): Promise<FarmConfiguration> {
    try {
      // Get regional defaults based on location
      const regionalDefaults = await this.getRegionalDefaults(location);

      const completeConfig: FarmConfiguration = {
        cropType: partialConfig.cropType || regionalDefaults.cropType || CropType.RICE,
        varietyName: partialConfig.varietyName || regionalDefaults.varietyName || 'Local Variety',
        plantingDate: partialConfig.plantingDate || regionalDefaults.plantingDate || new Date(),
        farmSize: partialConfig.farmSize || regionalDefaults.farmSize || 1.0,
        irrigationType: partialConfig.irrigationType || regionalDefaults.irrigationType || 'rainfed' as any,
        soilType: partialConfig.soilType || regionalDefaults.soilType || 'loam' as any,
        expectedHarvestDate: partialConfig.expectedHarvestDate || this.calculateExpectedHarvestDate(
          partialConfig.plantingDate || regionalDefaults.plantingDate || new Date(),
          partialConfig.cropType || regionalDefaults.cropType || CropType.RICE
        )
      };

      return completeConfig;
    } catch (error) {
      this.logger.error('Error applying fallback configuration', error);
      throw error;
    }
  }

  /**
   * Get fallback external data when primary sources are unavailable
   */
  async getFallbackExternalData(
    location: Location,
    dataType: 'weather' | 'soil' | 'satellite'
  ): Promise<WeatherData | SoilData | SatelliteData | null> {
    try {
      // Try to get cached data first
      const cachedData = await this.getCachedData(location, dataType);
      if (cachedData) {
        // Mark as fallback data with reduced quality
        cachedData.quality = {
          ...cachedData.quality,
          accuracy: Math.min(cachedData.quality.accuracy, 0.7),
          timeliness: Math.min(cachedData.quality.timeliness, 0.6)
        };
        return cachedData;
      }

      // Generate synthetic fallback data based on regional patterns
      return this.generateSyntheticFallbackData(location, dataType);
    } catch (error) {
      this.logger.error('Error getting fallback external data', error);
      return null;
    }
  }

  /**
   * Calculate aggregated state across multiple plots
   */
  private calculateAggregatedState(plots: FarmTwin[]): AggregatedFarmState {
    let totalArea = 0;
    let totalPredictedYield = 0;
    let totalConfidence = 0;
    const stressSum = {
      waterStress: 0,
      heatStress: 0,
      nutrientStress: 0,
      pestRisk: 0,
      diseaseRisk: 0
    };
    const cropStageDistribution: Record<CropStage, number> = {} as Record<CropStage, number>;
    const criticalAlerts: string[] = [];

    for (const plot of plots) {
      const area = plot.farmConfiguration.farmSize;
      totalArea += area;
      totalPredictedYield += plot.currentState.predictedYield * area;
      totalConfidence += plot.currentState.confidenceLevel;

      // Weight stress indicators by area
      stressSum.waterStress += plot.currentState.stressIndicators.waterStress * area;
      stressSum.heatStress += plot.currentState.stressIndicators.heatStress * area;
      stressSum.nutrientStress += plot.currentState.stressIndicators.nutrientStress * area;
      stressSum.pestRisk += plot.currentState.stressIndicators.pestRisk * area;
      stressSum.diseaseRisk += plot.currentState.stressIndicators.diseaseRisk * area;

      // Count crop stages
      const stage = plot.currentState.cropStage;
      cropStageDistribution[stage] = (cropStageDistribution[stage] || 0) + 1;

      // Check for critical alerts
      if (plot.currentState.stressIndicators.waterStress > 0.8) {
        criticalAlerts.push(`Plot ${plot.twinId}: Critical water stress`);
      }
      if (plot.currentState.stressIndicators.heatStress > 0.8) {
        criticalAlerts.push(`Plot ${plot.twinId}: Critical heat stress`);
      }
    }

    const averageStressIndicators: StressIndicators = {
      waterStress: stressSum.waterStress / totalArea,
      heatStress: stressSum.heatStress / totalArea,
      nutrientStress: stressSum.nutrientStress / totalArea,
      pestRisk: stressSum.pestRisk / totalArea,
      diseaseRisk: stressSum.diseaseRisk / totalArea,
      lastUpdated: new Date()
    };

    return {
      totalArea,
      totalPredictedYield,
      overallConfidence: totalConfidence / plots.length,
      averageStressIndicators,
      criticalAlerts,
      cropStageDistribution,
      lastUpdated: new Date()
    };
  }

  /**
   * Calculate metadata for multi-plot farm
   */
  private calculateMultiPlotMetadata(plots: FarmTwin[]): MultiPlotMetadata {
    const totalArea = plots.reduce((sum, plot) => sum + plot.farmConfiguration.farmSize, 0);
    const totalYield = plots.reduce((sum, plot) => 
      sum + (plot.currentState.predictedYield * plot.farmConfiguration.farmSize), 0);

    // Find dominant crop type
    const cropTypeCounts: Record<string, number> = {};
    for (const plot of plots) {
      const cropType = plot.farmConfiguration.cropType;
      cropTypeCounts[cropType] = (cropTypeCounts[cropType] || 0) + 1;
    }

    const dominantCropType = Object.entries(cropTypeCounts)
      .reduce((a, b) => cropTypeCounts[a[0]] > cropTypeCounts[b[0]] ? a : b)[0] as CropType;

    return {
      plotCount: plots.length,
      totalArea,
      dominantCropType,
      averageYield: totalYield / totalArea
    };
  }

  /**
   * Create initial farm state for a new plot
   */
  private createInitialFarmState(farmConfig: FarmConfiguration): FarmState {
    const now = new Date();
    const plantingDate = new Date(farmConfig.plantingDate);
    const daysAfterPlanting = Math.floor((now.getTime() - plantingDate.getTime()) / (1000 * 60 * 60 * 24));

    return {
      cropStage: CropStage.GERMINATION,
      daysAfterPlanting: Math.max(0, daysAfterPlanting),
      soilMoisture: 50,
      stressIndicators: {
        waterStress: 0.1,
        heatStress: 0.1,
        nutrientStress: 0.1,
        pestRisk: 0.1,
        diseaseRisk: 0.1,
        lastUpdated: now
      },
      environmentalConditions: {
        temperature: { min: 20, max: 30, average: 25 },
        humidity: 60,
        rainfall: 10,
        windSpeed: 8,
        lastUpdated: now
      },
      predictedYield: this.estimateInitialYield(farmConfig.cropType, farmConfig.farmSize),
      confidenceLevel: 0.5,
      lastUpdated: now,
      dataQuality: {
        weatherDataFreshness: 24,
        satelliteDataFreshness: 7,
        soilDataAvailability: false,
        farmerInputRecency: 0,
        overallQualityScore: 0.4
      }
    };
  }

  /**
   * Get regional defaults based on location
   */
  private async getRegionalDefaults(location: Location): Promise<Partial<FarmConfiguration>> {
    try {
      // Try to get from database first
      const cachedDefaults = await this.dbHelper.getItem(TABLE_NAMES.EXTERNAL_DATA, {
        type: 'regional_defaults',
        district: location.district,
        state: location.state
      });

      if (cachedDefaults) {
        return cachedDefaults.defaults;
      }

      // Return hardcoded defaults based on common patterns in India
      return {
        cropType: this.getRegionalCropType(location),
        varietyName: 'Local Variety',
        plantingDate: this.getRegionalPlantingDate(location),
        farmSize: 1.5, // Average smallholder farm size in India
        irrigationType: 'rainfed' as any,
        soilType: 'loam' as any
      };
    } catch (error) {
      this.logger.error('Error getting regional defaults', error);
      return {};
    }
  }

  /**
   * Get cached data for fallback
   */
  private async getCachedData(
    location: Location,
    dataType: 'weather' | 'soil' | 'satellite'
  ): Promise<any> {
    try {
      return await this.dbHelper.getItem(TABLE_NAMES.EXTERNAL_DATA, {
        type: `cached_${dataType}`,
        district: location.district,
        state: location.state
      });
    } catch (error) {
      this.logger.warn('No cached data available', error);
      return null;
    }
  }

  /**
   * Generate synthetic fallback data
   */
  private generateSyntheticFallbackData(
    location: Location,
    dataType: 'weather' | 'soil' | 'satellite'
  ): WeatherData | SoilData | SatelliteData | null {
    const baseQuality = {
      completeness: 0.6,
      accuracy: 0.5,
      timeliness: 0.3,
      lastValidated: new Date(),
      issues: ['synthetic_fallback_data']
    };

    switch (dataType) {
      case 'weather':
        return {
          location: { latitude: location.latitude, longitude: location.longitude },
          timestamp: new Date(),
          source: 'synthetic_fallback',
          current: {
            temperature: 25,
            humidity: 65,
            windSpeed: 10,
            windDirection: 180,
            precipitation: 0,
            pressure: 1013,
            visibility: 10,
            uvIndex: 5,
            cloudCover: 50,
            dewPoint: 20
          },
          forecast: [],
          historical: [],
          quality: baseQuality
        } as WeatherData;

      case 'soil':
        return {
          location: { latitude: location.latitude, longitude: location.longitude },
          source: 'synthetic_fallback',
          lastUpdated: new Date(),
          soilProperties: {
            soilType: 'loam',
            texture: { sand: 40, silt: 40, clay: 20 },
            ph: 6.5,
            organicCarbon: 1.0,
            nitrogen: 200,
            phosphorus: 25,
            potassium: 150,
            micronutrients: {},
            physicalProperties: {
              bulkDensity: 1.4,
              waterHoldingCapacity: 20,
              infiltrationRate: 10,
              permeability: 'moderate'
            }
          },
          soilHealth: {
            overallScore: 60,
            categories: { chemical: 60, physical: 60, biological: 60 },
            deficiencies: [],
            strengths: [],
            trends: []
          },
          recommendations: [],
          quality: baseQuality
        } as SoilData;

      case 'satellite':
        return {
          location: { latitude: location.latitude, longitude: location.longitude },
          captureDate: new Date(),
          source: 'synthetic_fallback',
          satellite: 'synthetic',
          vegetationIndex: {
            ndvi: 0.5,
            evi: 0.3,
            lai: 2.0,
            fpar: 0.6,
            confidence: 0.4
          },
          cloudCover: 30,
          resolution: 30,
          processingLevel: 'L1',
          quality: baseQuality
        } as SatelliteData;

      default:
        return null;
    }
  }

  /**
   * Get regional crop type based on location
   */
  private getRegionalCropType(location: Location): CropType {
    // Simplified regional mapping - would be more sophisticated in production
    const state = location.state.toLowerCase();
    
    if (state.includes('punjab') || state.includes('haryana')) {
      return CropType.WHEAT;
    } else if (state.includes('west bengal') || state.includes('odisha')) {
      return CropType.RICE;
    } else if (state.includes('maharashtra') || state.includes('gujarat')) {
      return CropType.COTTON;
    } else {
      return CropType.RICE; // Default
    }
  }

  /**
   * Get regional planting date based on location and crop calendar
   */
  private getRegionalPlantingDate(location: Location): Date {
    // Simplified - would use actual crop calendar data in production
    const now = new Date();
    const currentMonth = now.getMonth();
    
    // Kharif season (June-July) or Rabi season (November-December)
    if (currentMonth >= 5 && currentMonth <= 7) {
      // Kharif planting season
      return new Date(now.getFullYear(), 5, 15); // June 15
    } else if (currentMonth >= 10 && currentMonth <= 11) {
      // Rabi planting season
      return new Date(now.getFullYear(), 10, 15); // November 15
    } else {
      // Default to next appropriate season
      return new Date(now.getFullYear(), 5, 15);
    }
  }

  /**
   * Calculate expected harvest date based on planting date and crop type
   */
  private calculateExpectedHarvestDate(plantingDate: Date, cropType: CropType): Date {
    const harvestDate = new Date(plantingDate);
    
    // Add crop-specific growing period (simplified)
    switch (cropType) {
      case CropType.RICE:
        harvestDate.setDate(harvestDate.getDate() + 120); // 4 months
        break;
      case CropType.WHEAT:
        harvestDate.setDate(harvestDate.getDate() + 150); // 5 months
        break;
      case CropType.MAIZE:
        harvestDate.setDate(harvestDate.getDate() + 90); // 3 months
        break;
      default:
        harvestDate.setDate(harvestDate.getDate() + 120); // Default 4 months
    }
    
    return harvestDate;
  }

  /**
   * Estimate initial yield based on crop type and farm size
   */
  private estimateInitialYield(cropType: CropType, farmSize: number): number {
    const yieldPerHectare: Record<string, number> = {
      [CropType.RICE]: 4000,
      [CropType.WHEAT]: 3500,
      [CropType.MAIZE]: 5000,
      [CropType.COTTON]: 1500,
      [CropType.SUGARCANE]: 70000,
      [CropType.SOYBEAN]: 2500,
      [CropType.GROUNDNUT]: 2000,
      [CropType.PULSES]: 1500,
      [CropType.VEGETABLES]: 25000,
      [CropType.FRUITS]: 15000
    };

    const baseYield = yieldPerHectare[cropType] || 3000;
    return baseYield * farmSize;
  }
}