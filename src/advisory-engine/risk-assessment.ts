/**
 * Risk Assessment and Threshold Monitoring
 * Core advisory engine component for detecting and prioritizing farm risks
 */

import { FarmTwin, StressIndicators } from '../types/farm-twin';
import { AdvisoryType, Priority, AdvisoryCategory, Language } from '../types/core';
import { Advisory } from '../types/advisory';
import { Logger, createLambdaLogger } from '../shared/utils/logger';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { TABLE_NAMES } from '../shared/config/constants';

export interface RiskThresholds {
  waterStress: { mild: 0.3; moderate: 0.6; severe: 0.8 };
  heatStress: { mild: 0.3; moderate: 0.6; severe: 0.8 };
  nutrientStress: { mild: 0.3; moderate: 0.6; severe: 0.8 };
  pestRisk: { mild: 0.4; moderate: 0.7; severe: 0.9 };
  diseaseRisk: { mild: 0.4; moderate: 0.7; severe: 0.9 };
}

export interface RiskAlert {
  twinId: string;
  riskType: string;
  severity: 'mild' | 'moderate' | 'severe';
  priority: Priority;
  message: string;
  recommendations: string[];
  urgency: number; // 0-1 scale
  yieldImpact: number; // Estimated % yield loss
}

export class RiskAssessmentEngine {
  private logger: Logger;
  private dbHelper: DynamoDBHelper;
  private thresholds: RiskThresholds;

  constructor() {
    this.logger = createLambdaLogger('RiskAssessmentEngine');
    this.dbHelper = new DynamoDBHelper();
    this.thresholds = {
      waterStress: { mild: 0.3, moderate: 0.6, severe: 0.8 },
      heatStress: { mild: 0.3, moderate: 0.6, severe: 0.8 },
      nutrientStress: { mild: 0.3, moderate: 0.6, severe: 0.8 },
      pestRisk: { mild: 0.4, moderate: 0.7, severe: 0.9 },
      diseaseRisk: { mild: 0.4, moderate: 0.7, severe: 0.9 }
    };
  }

  /**
   * Assess all risks for a farm twin
   * Requirements: 4.1, 4.3, 4.4
   */
  public assessFarmRisks(farmTwin: FarmTwin): RiskAlert[] {
    const alerts: RiskAlert[] = [];
    const stress = farmTwin.currentState.stressIndicators;

    // Water stress assessment
    if (stress.waterStress > this.thresholds.waterStress.mild) {
      alerts.push(this.createWaterStressAlert(farmTwin, stress.waterStress));
    }

    // Heat stress assessment
    if (stress.heatStress > this.thresholds.heatStress.mild) {
      alerts.push(this.createHeatStressAlert(farmTwin, stress.heatStress));
    }

    // Nutrient stress assessment
    if (stress.nutrientStress > this.thresholds.nutrientStress.mild) {
      alerts.push(this.createNutrientStressAlert(farmTwin, stress.nutrientStress));
    }

    // Pest risk assessment
    if (stress.pestRisk > this.thresholds.pestRisk.mild) {
      alerts.push(this.createPestRiskAlert(farmTwin, stress.pestRisk));
    }

    // Disease risk assessment
    if (stress.diseaseRisk > this.thresholds.diseaseRisk.mild) {
      alerts.push(this.createDiseaseRiskAlert(farmTwin, stress.diseaseRisk));
    }

    return this.prioritizeAlerts(alerts);
  }

  /**
   * Generate advisory from risk assessment
   * Requirements: 4.2, 4.6
   */
  public async generateAdvisory(farmTwin: FarmTwin): Promise<Advisory> {
    const risks = this.assessFarmRisks(farmTwin);
    const highPriorityRisks = risks.filter(r => r.priority === Priority.HIGH);
    
    const advisory: Advisory = {
      advisoryId: `advisory-${farmTwin.twinId}-${Date.now()}`,
      farmTwinId: farmTwin.twinId,
      type: highPriorityRisks.length > 0 ? AdvisoryType.ALERT : AdvisoryType.RECOMMENDATION,
      category: this.determinePrimaryCategory(risks),
      priority: highPriorityRisks.length > 0 ? Priority.HIGH : Priority.MEDIUM,
      title: this.generateTitle(risks),
      description: this.generateMessage(risks),
      actionItems: [],
      reasoning: this.consolidateRecommendations(risks).join('; '),
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      language: Language.ENGLISH,
      confidence: this.calculateConfidence(farmTwin, risks),
      metadata: {
        generatedBy: 'risk-assessment-engine',
        ruleVersion: '1.0',
        dataInputs: ['farm-twin-state', 'weather-data', 'satellite-data'],
        reviewStatus: 'auto_generated' as const,
        relatedAdvisories: [],
        riskCount: risks.length,
        highPriorityCount: highPriorityRisks.length,
        estimatedYieldImpact: risks.reduce((sum, r) => sum + r.yieldImpact, 0)
      },
      createdAt: new Date()
    };

    // Store advisory
    await this.dbHelper.putItem(TABLE_NAMES.ADVISORIES, advisory);
    
    return advisory;
  }

  private createWaterStressAlert(farmTwin: FarmTwin, stressLevel: number): RiskAlert {
    const severity = this.getSeverity(stressLevel, this.thresholds.waterStress);
    return {
      twinId: farmTwin.twinId,
      riskType: 'water_stress',
      severity,
      priority: severity === 'severe' ? Priority.HIGH : Priority.MEDIUM,
      message: `Water stress detected (${Math.round(stressLevel * 100)}%)`,
      recommendations: [
        'Increase irrigation frequency',
        'Check soil moisture levels',
        'Consider mulching to retain moisture'
      ],
      urgency: stressLevel,
      yieldImpact: stressLevel * 15 // Up to 15% yield loss
    };
  }

  private createHeatStressAlert(farmTwin: FarmTwin, stressLevel: number): RiskAlert {
    const severity = this.getSeverity(stressLevel, this.thresholds.heatStress);
    return {
      twinId: farmTwin.twinId,
      riskType: 'heat_stress',
      severity,
      priority: severity === 'severe' ? Priority.HIGH : Priority.MEDIUM,
      message: `Heat stress detected (${Math.round(stressLevel * 100)}%)`,
      recommendations: [
        'Provide shade if possible',
        'Increase irrigation during hot periods',
        'Apply cooling sprays in evening'
      ],
      urgency: stressLevel,
      yieldImpact: stressLevel * 12 // Up to 12% yield loss
    };
  }

  private createNutrientStressAlert(farmTwin: FarmTwin, stressLevel: number): RiskAlert {
    const severity = this.getSeverity(stressLevel, this.thresholds.nutrientStress);
    return {
      twinId: farmTwin.twinId,
      riskType: 'nutrient_stress',
      severity,
      priority: severity === 'severe' ? Priority.HIGH : Priority.MEDIUM,
      message: `Nutrient deficiency detected (${Math.round(stressLevel * 100)}%)`,
      recommendations: [
        'Apply balanced NPK fertilizer',
        'Consider soil testing',
        'Add organic matter to soil'
      ],
      urgency: stressLevel * 0.8, // Less urgent than water/heat
      yieldImpact: stressLevel * 20 // Up to 20% yield loss
    };
  }

  private createPestRiskAlert(farmTwin: FarmTwin, riskLevel: number): RiskAlert {
    const severity = this.getSeverity(riskLevel, this.thresholds.pestRisk);
    return {
      twinId: farmTwin.twinId,
      riskType: 'pest_risk',
      severity,
      priority: severity === 'severe' ? Priority.HIGH : Priority.MEDIUM,
      message: `High pest activity risk (${Math.round(riskLevel * 100)}%)`,
      recommendations: [
        'Monitor crops daily for pest signs',
        'Consider preventive pest control',
        'Use integrated pest management'
      ],
      urgency: riskLevel,
      yieldImpact: riskLevel * 25 // Up to 25% yield loss
    };
  }

  private createDiseaseRiskAlert(farmTwin: FarmTwin, riskLevel: number): RiskAlert {
    const severity = this.getSeverity(riskLevel, this.thresholds.diseaseRisk);
    return {
      twinId: farmTwin.twinId,
      riskType: 'disease_risk',
      severity,
      priority: severity === 'severe' ? Priority.HIGH : Priority.MEDIUM,
      message: `High disease risk (${Math.round(riskLevel * 100)}%)`,
      recommendations: [
        'Apply preventive fungicide',
        'Ensure proper plant spacing',
        'Remove infected plant material'
      ],
      urgency: riskLevel,
      yieldImpact: riskLevel * 30 // Up to 30% yield loss
    };
  }

  private getSeverity(level: number, thresholds: { mild: number; moderate: number; severe: number }): 'mild' | 'moderate' | 'severe' {
    if (level >= thresholds.severe) return 'severe';
    if (level >= thresholds.moderate) return 'moderate';
    return 'mild';
  }

  private prioritizeAlerts(alerts: RiskAlert[]): RiskAlert[] {
    return alerts.sort((a, b) => {
      // Sort by priority first, then by urgency
      if (a.priority !== b.priority) {
        const priorityOrder = { [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return b.urgency - a.urgency;
    });
  }

  private determinePrimaryCategory(risks: RiskAlert[]): AdvisoryCategory {
    if (risks.some(r => r.riskType === 'water_stress')) return AdvisoryCategory.IRRIGATION;
    if (risks.some(r => r.riskType === 'nutrient_stress')) return AdvisoryCategory.FERTILIZATION;
    if (risks.some(r => r.riskType === 'pest_risk')) return AdvisoryCategory.PEST_CONTROL;
    if (risks.some(r => r.riskType === 'disease_risk')) return AdvisoryCategory.DISEASE_MANAGEMENT;
    return AdvisoryCategory.SOIL_MANAGEMENT;
  }

  private generateTitle(risks: RiskAlert[]): string {
    if (risks.length === 0) return 'Farm Status Normal';
    if (risks.length === 1) return `${risks[0].riskType.replace('_', ' ')} Alert`;
    return `Multiple Risk Alert (${risks.length} issues)`;
  }

  private generateMessage(risks: RiskAlert[]): string {
    if (risks.length === 0) return 'Your farm is in good condition.';
    
    const highPriority = risks.filter(r => r.priority === Priority.HIGH);
    if (highPriority.length > 0) {
      return `Urgent attention needed: ${highPriority.map(r => r.message).join(', ')}`;
    }
    
    return `Monitoring required: ${risks.map(r => r.message).join(', ')}`;
  }

  private consolidateRecommendations(risks: RiskAlert[]): string[] {
    const allRecommendations = risks.flatMap(r => r.recommendations);
    return [...new Set(allRecommendations)]; // Remove duplicates
  }

  private calculateConfidence(farmTwin: FarmTwin, risks: RiskAlert[]): number {
    const baseConfidence = farmTwin.currentState.confidenceLevel;
    const dataQuality = farmTwin.currentState.dataQuality.overallQualityScore;
    return (baseConfidence + dataQuality) / 2;
  }
}