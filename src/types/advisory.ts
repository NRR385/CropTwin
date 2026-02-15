/**
 * Advisory data models
 * Defines the structure for agricultural recommendations and alerts
 */

import {
  AdvisoryType,
  Priority,
  AdvisoryCategory,
  Language,
  CommunicationChannel
} from './core';

// Action item within an advisory
export interface ActionItem {
  action: string;
  timing: string; // e.g., "within 2 days", "next week"
  resources: string[]; // required inputs/materials
  expectedOutcome: string;
  cost?: CostEstimate;
  difficulty: 'easy' | 'medium' | 'hard';
  alternatives?: string[];
}

export interface CostEstimate {
  amount: number;
  currency: string;
  unit: string; // per hectare, per application, etc.
  subsidyAvailable?: boolean;
}

// Main Advisory interface
export interface Advisory {
  advisoryId: string;
  farmTwinId: string;
  type: AdvisoryType;
  priority: Priority;
  category: AdvisoryCategory;
  title: string;
  description: string;
  actionItems: ActionItem[];
  reasoning: string;
  confidence: number; // 0-1 scale
  validUntil: Date;
  language: Language;
  createdAt: Date;
  metadata: AdvisoryMetadata;
}

export interface AdvisoryMetadata {
  generatedBy: string; // system component or rule that generated this
  ruleVersion: string;
  dataInputs: string[]; // list of data sources used
  reviewStatus: 'auto_generated' | 'expert_reviewed' | 'farmer_feedback';
  effectivenessScore?: number; // if feedback available
  relatedAdvisories: string[]; // IDs of related advisories
  riskCount?: number; // number of risks identified
  highPriorityCount?: number; // number of high priority risks
  estimatedYieldImpact?: number; // estimated yield impact
}

// Risk assessment for advisory generation
export interface RiskAssessment {
  farmTwinId: string;
  assessmentDate: Date;
  overallRiskLevel: number; // 0-1 scale
  riskCategories: RiskCategory[];
  urgentActions: UrgentAction[];
  recommendations: Recommendation[];
  confidence: number;
}

export interface RiskCategory {
  category: AdvisoryCategory;
  riskLevel: number; // 0-1 scale
  factors: AdvisoryRiskFactor[];
  trend: 'increasing' | 'stable' | 'decreasing';
  timeToAction: number; // days until action needed
}

export interface AdvisoryRiskFactor {
  factor: string;
  severity: number; // 0-1 scale
  probability: number; // 0-1 scale
  impact: string;
  dataSource: string;
}

export interface UrgentAction {
  action: string;
  reason: string;
  timeframe: string;
  consequences: string; // what happens if not done
}

export interface Recommendation {
  title: string;
  description: string;
  category: AdvisoryCategory;
  priority: Priority;
  expectedBenefit: string;
  implementationSteps: string[];
}

// Formatted advisory for different communication channels
export interface FormattedAdvisory {
  advisoryId: string;
  channel: CommunicationChannel;
  language: Language;
  content: ChannelContent;
  deliveryInstructions: DeliveryInstructions;
}

export interface ChannelContent {
  subject?: string; // for SMS/email
  body: string;
  attachments?: Attachment[];
  interactiveElements?: InteractiveElement[];
}

export interface Attachment {
  type: 'image' | 'audio' | 'video' | 'document';
  url: string;
  description: string;
  size?: number;
}

export interface InteractiveElement {
  type: 'button' | 'menu' | 'input';
  label: string;
  action: string;
  options?: string[];
}

export interface DeliveryInstructions {
  priority: Priority;
  retryPolicy: AdvisoryRetryPolicy;
  fallbackChannels: CommunicationChannel[];
  scheduledDelivery?: Date;
  expiryTime?: Date;
}

export interface AdvisoryRetryPolicy {
  maxAttempts: number;
  retryInterval: number; // minutes
  backoffMultiplier: number;
}

// Voice advisory for IVR systems
export interface VoiceAdvisory {
  advisoryId: string;
  language: Language;
  script: VoiceScript;
  audioFiles?: AudioFile[];
  interactionFlow: InteractionFlow;
}

export interface VoiceScript {
  greeting: string;
  mainContent: string;
  actionItems: string[];
  closing: string;
  confirmationPrompts: string[];
}

export interface AudioFile {
  segment: string; // which part of the script
  url: string;
  duration: number; // seconds
  format: string;
}

export interface InteractionFlow {
  steps: InteractionStep[];
  fallbackMessages: string[];
  maxRetries: number;
}

export interface InteractionStep {
  stepId: string;
  prompt: string;
  expectedInputs: string[];
  nextSteps: { [input: string]: string }; // input -> next step ID
  timeout: number; // seconds
}

// Mobile app response structure
export interface MobileAppResponse {
  farmerId: string;
  farmTwins: MobileFarmTwin[];
  advisories: MobileAdvisory[];
  dashboardData: MobileDashboardData;
  notifications: MobileNotification[];
  lastSync: Date;
}

export interface MobileFarmTwin {
  twinId: string;
  name: string;
  cropType: string;
  cropStage: string;
  healthScore: number; // 0-100 scale
  daysToHarvest?: number;
  location: {
    latitude: number;
    longitude: number;
    name: string;
  };
  alerts: number; // count of active alerts
}

export interface MobileAdvisory {
  advisoryId: string;
  title: string;
  summary: string;
  priority: Priority;
  category: AdvisoryCategory;
  dueDate?: Date;
  isRead: boolean;
  actionCount: number;
  completedActions: number;
}

export interface MobileDashboardData {
  weatherSummary: WeatherSummary;
  farmOverview: FarmOverview;
  upcomingTasks: UpcomingTask[];
  marketPrices: MarketPriceSummary[];
  achievements: Achievement[];
}

export interface WeatherSummary {
  current: {
    temperature: number;
    condition: string;
    humidity: number;
  };
  forecast: DailyForecast[];
  alerts: string[];
}

export interface DailyForecast {
  date: Date;
  high: number;
  low: number;
  condition: string;
  precipitation: number;
}

export interface FarmOverview {
  totalFarms: number;
  healthyFarms: number;
  farmsNeedingAttention: number;
  averageYieldPrediction: number;
  totalArea: number;
}

export interface UpcomingTask {
  taskId: string;
  title: string;
  dueDate: Date;
  priority: Priority;
  farmName: string;
  estimatedTime: string;
}

export interface MarketPriceSummary {
  commodity: string;
  currentPrice: number;
  change: number; // percentage change
  trend: 'up' | 'down' | 'stable';
  unit: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  earnedDate: Date;
  category: string;
}

export interface MobileNotification {
  id: string;
  title: string;
  message: string;
  type: 'advisory' | 'alert' | 'reminder' | 'achievement';
  timestamp: Date;
  isRead: boolean;
  actionUrl?: string;
}

// Communication preferences
export interface CommunicationPreferences {
  farmerId: string;
  preferredChannels: CommunicationChannel[];
  language: Language;
  timePreferences: TimePreferences;
  contentPreferences: ContentPreferences;
  privacySettings: PrivacySettings;
}

export interface TimePreferences {
  preferredHours: number[]; // 0-23 hour format
  timezone: string;
  frequency: {
    alerts: 'immediate' | 'batched_hourly' | 'batched_daily';
    recommendations: 'daily' | 'weekly' | 'bi_weekly';
    reports: 'weekly' | 'monthly' | 'seasonal';
  };
  quietHours: {
    start: number; // hour
    end: number; // hour
  };
}

export interface ContentPreferences {
  detailLevel: 'basic' | 'detailed' | 'expert';
  includeScientificNames: boolean;
  includeMarketPrices: boolean;
  includeWeatherDetails: boolean;
  preferredUnits: {
    temperature: 'celsius' | 'fahrenheit';
    area: 'hectares' | 'acres';
    weight: 'kg' | 'pounds';
    currency: string;
  };
}

export interface PrivacySettings {
  shareDataForResearch: boolean;
  shareDataForRegionalAnalytics: boolean;
  allowMarketingCommunications: boolean;
  dataRetentionPeriod: number; // months
  consentDate: Date;
  consentVersion: string;
}