/**
 * Advisory Generation and Formatting Service
 * Generates comprehensive advisories with multi-language support and confidence levels
 * Requirements: 4.2, 4.4, 4.5, 4.6
 */

import { 
  Advisory, 
  ActionItem, 
  FormattedAdvisory, 
  VoiceAdvisory,
  MobileAppResponse,
  CommunicationPreferences,
  AdvisoryMetadata,
  CostEstimate
} from '../types/advisory';
import { FarmTwin } from '../types/farm-twin';
import { 
  AdvisoryType, 
  Priority, 
  AdvisoryCategory, 
  Language, 
  CommunicationChannel 
} from '../types/core';
import { RiskAssessmentEngine, RiskAlert } from './risk-assessment';
import { Logger, createLambdaLogger } from '../shared/utils/logger';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { TABLE_NAMES } from '../shared/config/constants';

export interface WeeklyAdvisoryConfig {
  includePrevention: boolean;
  includeMarketPrices: boolean;
  includeWeatherForecast: boolean;
  maxActionItems: number;
  confidenceThreshold: number;
}

export interface MultiStressScenario {
  stressTypes: string[];
  combinedSeverity: number;
  integratedRecommendations: string[];
  priorityOrder: string[];
}

export class AdvisoryGenerator {
  private logger: Logger;
  private dbHelper: DynamoDBHelper;
  private riskEngine: RiskAssessmentEngine;
  private languageTemplates: Map<Language, LanguageTemplate>;

  constructor() {
    this.logger = createLambdaLogger('AdvisoryGenerator');
    this.dbHelper = new DynamoDBHelper();
    this.riskEngine = new RiskAssessmentEngine();
    this.languageTemplates = this.initializeLanguageTemplates();
  }

  /**
   * Generate weekly advisory report with comprehensive recommendations
   * Requirements: 4.2, 4.6
   */
  public async generateWeeklyAdvisory(
    farmTwin: FarmTwin, 
    config: WeeklyAdvisoryConfig = this.getDefaultConfig()
  ): Promise<Advisory> {
    this.logger.info(`Generating weekly advisory for farm ${farmTwin.twinId}`);

    // Assess current risks
    const risks = this.riskEngine.assessFarmRisks(farmTwin);
    
    // Generate action items based on risks and farm state
    const actionItems = await this.generateActionItems(farmTwin, risks, config);
    
    // Calculate confidence level
    const confidence = this.calculateAdvisoryConfidence(farmTwin, risks);
    
    // Determine advisory language
    const language = (farmTwin.preferences?.language || Language.ENGLISH) as Language;
    
    const advisory: Advisory = {
      advisoryId: `weekly-${farmTwin.twinId}-${Date.now()}`,
      farmTwinId: farmTwin.twinId,
      type: risks.some(r => r.priority === Priority.HIGH) ? AdvisoryType.ALERT : AdvisoryType.RECOMMENDATION,
      priority: this.determineOverallPriority(risks),
      category: this.determinePrimaryCategory(risks),
      title: this.generateTitle(risks, language),
      description: this.generateDescription(farmTwin, risks, language),
      actionItems,
      reasoning: this.generateReasoning(farmTwin, risks, language),
      confidence,
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      language,
      createdAt: new Date(),
      metadata: this.generateMetadata(farmTwin, risks, config)
    };

    // Store advisory
    await this.dbHelper.putItem(TABLE_NAMES.ADVISORIES, advisory);
    
    this.logger.info(`Generated advisory ${advisory.advisoryId} with ${actionItems.length} actions`);
    return advisory;
  }

  /**
   * Handle multi-stress scenarios with integrated recommendations
   * Requirements: 4.4
   */
  public generateIntegratedRecommendations(risks: RiskAlert[]): MultiStressScenario {
    const stressTypes = [...new Set(risks.map(r => r.riskType))];
    const combinedSeverity = risks.reduce((sum, r) => sum + r.urgency, 0) / risks.length;
    
    // Generate integrated recommendations that address multiple stresses
    const integratedRecommendations = this.createIntegratedRecommendations(risks);
    
    // Prioritize actions based on urgency and effectiveness
    const priorityOrder = this.prioritizeIntegratedActions(risks);
    
    return {
      stressTypes,
      combinedSeverity,
      integratedRecommendations,
      priorityOrder
    };
  }

  /**
   * Format advisory for specific communication channel
   * Requirements: 4.5
   */
  public async formatForChannel(
    advisory: Advisory, 
    channel: CommunicationChannel,
    preferences?: CommunicationPreferences
  ): Promise<FormattedAdvisory> {
    const language = preferences?.language || advisory.language;
    const template = this.languageTemplates.get(language);
    
    if (!template) {
      throw new Error(`Language template not found for ${language}`);
    }

    switch (channel) {
      case CommunicationChannel.SMS:
        return this.formatForSMS(advisory, template);
      case CommunicationChannel.IVR:
        return this.formatForIVR(advisory, template);
      case CommunicationChannel.MOBILE_APP:
        return this.formatForMobileApp(advisory, template);
      default:
        throw new Error(`Unsupported communication channel: ${channel}`);
    }
  }

  /**
   * Generate voice advisory for IVR system
   * Requirements: 4.5
   */
  public async generateVoiceAdvisory(advisory: Advisory, language: Language): Promise<VoiceAdvisory> {
    const template = this.languageTemplates.get(language);
    if (!template) {
      throw new Error(`Language template not found for ${language}`);
    }

    return {
      advisoryId: advisory.advisoryId,
      language,
      script: {
        greeting: template.voiceGreeting,
        mainContent: this.generateVoiceContent(advisory, template),
        actionItems: advisory.actionItems.map(item => 
          template.formatVoiceAction(item.action, item.timing)
        ),
        closing: template.voiceClosing,
        confirmationPrompts: template.voiceConfirmations
      },
      interactionFlow: {
        steps: this.generateInteractionSteps(advisory, template),
        fallbackMessages: template.voiceFallbacks,
        maxRetries: 3
      }
    };
  }

  private async generateActionItems(
    farmTwin: FarmTwin, 
    risks: RiskAlert[], 
    config: WeeklyAdvisoryConfig
  ): Promise<ActionItem[]> {
    const actionItems: ActionItem[] = [];
    
    // Generate immediate actions for high-priority risks
    const urgentRisks = risks.filter(r => r.priority === Priority.HIGH);
    for (const risk of urgentRisks) {
      actionItems.push(...this.createUrgentActions(risk, farmTwin));
    }
    
    // Generate preventive actions if enabled
    if (config.includePrevention) {
      actionItems.push(...this.createPreventiveActions(farmTwin, risks));
    }
    
    // Generate routine maintenance actions
    actionItems.push(...this.createRoutineActions(farmTwin));
    
    // Limit to max action items and prioritize
    return this.prioritizeAndLimitActions(actionItems, config.maxActionItems);
  }

  private createUrgentActions(risk: RiskAlert, farmTwin: FarmTwin): ActionItem[] {
    const actions: ActionItem[] = [];
    
    switch (risk.riskType) {
      case 'water_stress':
        actions.push({
          action: 'Increase irrigation frequency to twice daily',
          timing: 'within 24 hours',
          resources: ['Water source', 'Irrigation equipment'],
          expectedOutcome: 'Reduce water stress by 50% within 3 days',
          cost: { amount: 200, currency: 'INR', unit: 'per hectare' },
          difficulty: 'easy',
          alternatives: ['Mulching', 'Drip irrigation setup']
        });
        break;
        
      case 'pest_risk':
        actions.push({
          action: 'Apply organic neem-based pesticide',
          timing: 'within 48 hours',
          resources: ['Neem oil', 'Sprayer', 'Water'],
          expectedOutcome: 'Prevent pest infestation and protect yield',
          cost: { amount: 150, currency: 'INR', unit: 'per hectare', subsidyAvailable: true },
          difficulty: 'medium',
          alternatives: ['Biological pest control', 'Companion planting']
        });
        break;
        
      case 'disease_risk':
        actions.push({
          action: 'Apply preventive fungicide spray',
          timing: 'within 24 hours',
          resources: ['Copper-based fungicide', 'Sprayer'],
          expectedOutcome: 'Prevent disease outbreak',
          cost: { amount: 300, currency: 'INR', unit: 'per hectare' },
          difficulty: 'medium'
        });
        break;
    }
    
    return actions;
  }

  private createPreventiveActions(farmTwin: FarmTwin, risks: RiskAlert[]): ActionItem[] {
    const actions: ActionItem[] = [];
    
    // Soil health maintenance
    actions.push({
      action: 'Apply organic compost to improve soil health',
      timing: 'this week',
      resources: ['Organic compost (500kg)', 'Labor'],
      expectedOutcome: 'Improve soil fertility and water retention',
      cost: { amount: 1000, currency: 'INR', unit: 'per hectare' },
      difficulty: 'easy'
    });
    
    return actions;
  }

  private createRoutineActions(farmTwin: FarmTwin): ActionItem[] {
    const actions: ActionItem[] = [];
    const cropStage = farmTwin.currentState.cropStage;
    
    switch (cropStage) {
      case 'flowering':
        actions.push({
          action: 'Monitor for flower drop and pollination issues',
          timing: 'daily for next week',
          resources: ['Visual inspection'],
          expectedOutcome: 'Ensure proper fruit/grain formation',
          difficulty: 'easy'
        });
        break;
        
      case 'fruiting':
        actions.push({
          action: 'Support heavy branches to prevent breakage',
          timing: 'within 3 days',
          resources: ['Stakes', 'Ties'],
          expectedOutcome: 'Prevent yield loss from branch damage',
          cost: { amount: 100, currency: 'INR', unit: 'per hectare' },
          difficulty: 'easy'
        });
        break;
    }
    
    return actions;
  }

  private prioritizeAndLimitActions(actions: ActionItem[], maxActions: number): ActionItem[] {
    // Sort by difficulty (easy first) and expected impact
    const prioritized = actions.sort((a, b) => {
      const difficultyOrder = { easy: 3, medium: 2, hard: 1 };
      return difficultyOrder[b.difficulty] - difficultyOrder[a.difficulty];
    });
    
    return prioritized.slice(0, maxActions);
  }

  private calculateAdvisoryConfidence(farmTwin: FarmTwin, risks: RiskAlert[]): number {
    const baseConfidence = farmTwin.currentState.confidenceLevel;
    const dataQuality = farmTwin.currentState.dataQuality.overallQualityScore;
    const riskAssessmentConfidence = risks.length > 0 ? 0.8 : 0.9; // Lower confidence with more risks
    
    return (baseConfidence + dataQuality + riskAssessmentConfidence) / 3;
  }

  private determineOverallPriority(risks: RiskAlert[]): Priority {
    if (risks.some(r => r.priority === Priority.HIGH)) return Priority.HIGH;
    if (risks.some(r => r.priority === Priority.MEDIUM)) return Priority.MEDIUM;
    return Priority.LOW;
  }

  private determinePrimaryCategory(risks: RiskAlert[]): AdvisoryCategory {
    if (risks.length === 0) return AdvisoryCategory.GENERAL;
    
    // Count risk types and return most common
    const categoryCount = new Map<AdvisoryCategory, number>();
    risks.forEach(risk => {
      const category = this.mapRiskToCategory(risk.riskType);
      categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
    });
    
    let maxCategory = AdvisoryCategory.GENERAL;
    let maxCount = 0;
    categoryCount.forEach((count, category) => {
      if (count > maxCount) {
        maxCount = count;
        maxCategory = category;
      }
    });
    
    return maxCategory;
  }

  private mapRiskToCategory(riskType: string): AdvisoryCategory {
    switch (riskType) {
      case 'water_stress': return AdvisoryCategory.IRRIGATION;
      case 'nutrient_stress': return AdvisoryCategory.FERTILIZATION;
      case 'pest_risk': return AdvisoryCategory.PEST_CONTROL;
      case 'disease_risk': return AdvisoryCategory.DISEASE_MANAGEMENT;
      case 'heat_stress': return AdvisoryCategory.SOIL_MANAGEMENT;
      default: return AdvisoryCategory.GENERAL;
    }
  }

  private generateTitle(risks: RiskAlert[], language: Language): string {
    const template = this.languageTemplates.get(language);
    if (!template) return 'Weekly Farm Advisory';
    
    if (risks.length === 0) return template.normalStatusTitle;
    if (risks.some(r => r.priority === Priority.HIGH)) return template.urgentAlertTitle;
    return template.weeklyAdvisoryTitle;
  }

  private generateDescription(farmTwin: FarmTwin, risks: RiskAlert[], language: Language): string {
    const template = this.languageTemplates.get(language);
    if (!template) return 'Farm status and recommendations';
    
    const cropStage = farmTwin.currentState.cropStage;
    const riskCount = risks.length;
    
    return template.formatDescription(cropStage, riskCount);
  }

  private generateReasoning(farmTwin: FarmTwin, risks: RiskAlert[], language: Language): string {
    const template = this.languageTemplates.get(language);
    if (!template) return 'Based on current farm conditions and weather data';
    
    const dataInputs = [
      'weather data',
      'satellite imagery',
      'crop growth model',
      'historical patterns'
    ];
    
    return template.formatReasoning(dataInputs, farmTwin.currentState.confidenceLevel);
  }

  private generateMetadata(farmTwin: FarmTwin, risks: RiskAlert[], config: WeeklyAdvisoryConfig): AdvisoryMetadata {
    return {
      generatedBy: 'AdvisoryGenerator',
      ruleVersion: '1.0.0',
      dataInputs: ['weather', 'satellite', 'soil', 'crop_model'],
      reviewStatus: 'auto_generated',
      relatedAdvisories: []
    };
  }

  private createIntegratedRecommendations(risks: RiskAlert[]): string[] {
    const recommendations: string[] = [];
    
    // Check for common multi-stress scenarios
    const hasWaterStress = risks.some(r => r.riskType === 'water_stress');
    const hasHeatStress = risks.some(r => r.riskType === 'heat_stress');
    const hasNutrientStress = risks.some(r => r.riskType === 'nutrient_stress');
    
    if (hasWaterStress && hasHeatStress) {
      recommendations.push('Install shade nets and increase irrigation frequency during hot hours');
    }
    
    if (hasWaterStress && hasNutrientStress) {
      recommendations.push('Apply water-soluble fertilizers through drip irrigation system');
    }
    
    return recommendations;
  }

  private prioritizeIntegratedActions(risks: RiskAlert[]): string[] {
    return risks
      .sort((a, b) => b.yieldImpact - a.yieldImpact)
      .map(r => r.riskType);
  }

  private formatForSMS(advisory: Advisory, template: LanguageTemplate): FormattedAdvisory {
    const smsContent = template.formatSMS(advisory);
    
    return {
      advisoryId: advisory.advisoryId,
      channel: CommunicationChannel.SMS,
      language: advisory.language,
      content: {
        body: smsContent
      },
      deliveryInstructions: {
        priority: advisory.priority,
        retryPolicy: {
          maxAttempts: 3,
          retryInterval: 30,
          backoffMultiplier: 2
        },
        fallbackChannels: [CommunicationChannel.IVR]
      }
    };
  }

  private formatForIVR(advisory: Advisory, template: LanguageTemplate): FormattedAdvisory {
    const ivrContent = template.formatIVR(advisory);
    
    return {
      advisoryId: advisory.advisoryId,
      channel: CommunicationChannel.IVR,
      language: advisory.language,
      content: {
        body: ivrContent
      },
      deliveryInstructions: {
        priority: advisory.priority,
        retryPolicy: {
          maxAttempts: 2,
          retryInterval: 60,
          backoffMultiplier: 1.5
        },
        fallbackChannels: [CommunicationChannel.SMS]
      }
    };
  }

  private formatForMobileApp(advisory: Advisory, template: LanguageTemplate): FormattedAdvisory {
    const appContent = template.formatMobileApp(advisory);
    
    return {
      advisoryId: advisory.advisoryId,
      channel: CommunicationChannel.MOBILE_APP,
      language: advisory.language,
      content: {
        body: appContent,
        interactiveElements: [
          {
            type: 'button',
            label: 'Mark as Read',
            action: 'mark_read'
          },
          {
            type: 'button',
            label: 'Get More Details',
            action: 'view_details'
          }
        ]
      },
      deliveryInstructions: {
        priority: advisory.priority,
        retryPolicy: {
          maxAttempts: 1,
          retryInterval: 0,
          backoffMultiplier: 1
        },
        fallbackChannels: []
      }
    };
  }

  private generateVoiceContent(advisory: Advisory, template: LanguageTemplate): string {
    return template.formatVoiceContent(advisory);
  }

  private generateInteractionSteps(advisory: Advisory, template: LanguageTemplate): any[] {
    return [
      {
        stepId: 'intro',
        prompt: template.voiceGreeting,
        expectedInputs: ['yes', 'no', '1', '2'],
        nextSteps: { 'yes': 'content', '1': 'content', 'no': 'end', '2': 'end' },
        timeout: 10
      },
      {
        stepId: 'content',
        prompt: this.generateVoiceContent(advisory, template),
        expectedInputs: ['repeat', 'next', '1', '2'],
        nextSteps: { 'repeat': 'content', 'next': 'actions', '1': 'content', '2': 'actions' },
        timeout: 15
      }
    ];
  }

  private getDefaultConfig(): WeeklyAdvisoryConfig {
    return {
      includePrevention: true,
      includeMarketPrices: false,
      includeWeatherForecast: true,
      maxActionItems: 5,
      confidenceThreshold: 0.7
    };
  }

  private initializeLanguageTemplates(): Map<Language, LanguageTemplate> {
    const templates = new Map<Language, LanguageTemplate>();
    
    // English template
    templates.set(Language.ENGLISH, {
      normalStatusTitle: 'Weekly Farm Update',
      urgentAlertTitle: 'Urgent Farm Alert',
      weeklyAdvisoryTitle: 'Weekly Farm Advisory',
      voiceGreeting: 'Hello farmer, this is your weekly farm advisory.',
      voiceClosing: 'Thank you for listening. Have a productive week!',
      voiceConfirmations: ['Press 1 to repeat', 'Press 2 to end call'],
      voiceFallbacks: ['I did not understand. Please try again.'],
      formatDescription: (cropStage: string, riskCount: number) => 
        `Your crop is in ${cropStage} stage. ${riskCount > 0 ? `${riskCount} issues need attention.` : 'All conditions are normal.'}`,
      formatReasoning: (inputs: string[], confidence: number) => 
        `Based on ${inputs.join(', ')} with ${Math.round(confidence * 100)}% confidence.`,
      formatSMS: (advisory: Advisory) => 
        `${advisory.title}: ${advisory.description}. ${advisory.actionItems.length} actions recommended.`,
      formatIVR: (advisory: Advisory) => 
        `${advisory.title}. ${advisory.description}. Please listen carefully for recommended actions.`,
      formatMobileApp: (advisory: Advisory) => 
        `${advisory.description}\n\nRecommended Actions:\n${advisory.actionItems.map((item, i) => `${i+1}. ${item.action}`).join('\n')}`,
      formatVoiceAction: (action: string, timing: string) => 
        `Action: ${action}. Timing: ${timing}.`,
      formatVoiceContent: (advisory: Advisory) => 
        `${advisory.description}. Here are your recommended actions: ${advisory.actionItems.map(item => item.action).join('. ')}.`
    });
    
    // Hindi template (basic implementation)
    templates.set(Language.HINDI, {
      normalStatusTitle: 'साप्ताहिक खेत अपडेट',
      urgentAlertTitle: 'तत्काल खेत चेतावनी',
      weeklyAdvisoryTitle: 'साप्ताहिक खेत सलाह',
      voiceGreeting: 'नमस्कार किसान भाई, यह आपकी साप्ताहिक खेत सलाह है।',
      voiceClosing: 'सुनने के लिए धन्यवाद। आपका सप्ताह उत्पादक हो!',
      voiceConfirmations: ['दोहराने के लिए 1 दबाएं', 'कॉल समाप्त करने के लिए 2 दबाएं'],
      voiceFallbacks: ['मैं समझ नहीं पाया। कृपया फिर से कोशिश करें।'],
      formatDescription: (cropStage: string, riskCount: number) => 
        `आपकी फसल ${cropStage} अवस्था में है। ${riskCount > 0 ? `${riskCount} समस्याओं पर ध्यान देना आवश्यक है।` : 'सभी स्थितियां सामान्य हैं।'}`,
      formatReasoning: (inputs: string[], confidence: number) => 
        `${inputs.join(', ')} के आधार पर ${Math.round(confidence * 100)}% विश्वसनीयता के साथ।`,
      formatSMS: (advisory: Advisory) => 
        `${advisory.title}: ${advisory.description}। ${advisory.actionItems.length} कार्य सुझाए गए हैं।`,
      formatIVR: (advisory: Advisory) => 
        `${advisory.title}। ${advisory.description}। सुझाए गए कार्यों को ध्यान से सुनें।`,
      formatMobileApp: (advisory: Advisory) => 
        `${advisory.description}\n\nसुझाए गए कार्य:\n${advisory.actionItems.map((item, i) => `${i+1}. ${item.action}`).join('\n')}`,
      formatVoiceAction: (action: string, timing: string) => 
        `कार्य: ${action}। समय: ${timing}।`,
      formatVoiceContent: (advisory: Advisory) => 
        `${advisory.description}। यहाँ आपके सुझाए गए कार्य हैं: ${advisory.actionItems.map(item => item.action).join('। ')}।`
    });
    
    return templates;
  }
}

interface LanguageTemplate {
  normalStatusTitle: string;
  urgentAlertTitle: string;
  weeklyAdvisoryTitle: string;
  voiceGreeting: string;
  voiceClosing: string;
  voiceConfirmations: string[];
  voiceFallbacks: string[];
  formatDescription: (cropStage: string, riskCount: number) => string;
  formatReasoning: (inputs: string[], confidence: number) => string;
  formatSMS: (advisory: Advisory) => string;
  formatIVR: (advisory: Advisory) => string;
  formatMobileApp: (advisory: Advisory) => string;
  formatVoiceAction: (action: string, timing: string) => string;
  formatVoiceContent: (advisory: Advisory) => string;
}