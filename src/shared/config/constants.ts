/**
 * Application constants and configuration
 */

// Table names
export const TABLE_NAMES = {
  FARM_TWINS: 'farm-twins',
  HISTORICAL_RECORDS: 'historical-records',
  EXTERNAL_DATA: 'external-data',
  ADVISORIES: 'advisories',
  PARAMETER_CHANGE_HISTORY: 'parameter-change-history',
  OFFLINE_CACHE: 'offline-cache',
  SYNC_QUEUE: 'sync-queue',
  DELIVERY_STATS: 'delivery-stats',
  SMS_REPLIES: 'sms-replies',
  VOICE_UPDATES: 'voice-updates',
  SMS_MESSAGES: 'sms-messages',
  FALLBACK_REQUESTS: 'fallback-requests'
} as const;

// Default values
export const DEFAULT_VALUES = {
  LOG_LEVEL: 'INFO',
  AWS_REGION: 'us-east-1',
  CONFIDENCE_THRESHOLD: 0.3,
  MAX_HISTORICAL_DAYS: 365
} as const;

// Crop growth constants
export const CROP_CONSTANTS = {
  MAX_STRESS_VALUE: 1.0,
  MIN_STRESS_VALUE: 0.0,
  DEFAULT_CONFIDENCE: 0.7,
  CRITICAL_STRESS_THRESHOLD: 0.8
} as const;