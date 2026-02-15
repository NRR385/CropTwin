/**
 * Environment configuration for CropTwin Lambda functions
 * Centralizes environment variable management and validation
 */

export interface EnvironmentConfig {
  // AWS Configuration
  region: string;
  stage: string;
  
  // DynamoDB Tables
  farmTwinsTableName: string;
  advisoriesTableName: string;
  externalDataTableName: string;
  userPreferencesTableName: string;
  
  // S3 Buckets
  dataLakeBucketName: string;
  satelliteDataBucketName: string;
  
  // EventBridge
  eventBusName: string;
  
  // External API Configuration
  imdApiKey?: string;
  imdApiUrl: string;
  satelliteApiKey?: string;
  satelliteApiUrl: string;
  
  // Communication Services
  snsTopicArn?: string;
  connectInstanceId?: string;
  
  // Application Settings
  logLevel: string;
  enableMetrics: boolean;
  enableTracing: boolean;
  
  // Security
  encryptionKeyId?: string;
  
  // Performance
  defaultTimeout: number;
  maxRetries: number;
  
  // Data Retention
  advisoryRetentionDays: number;
  externalDataRetentionDays: number;
}

class EnvironmentManager {
  private config: EnvironmentConfig;

  constructor() {
    this.config = this.loadConfiguration();
    this.validateConfiguration();
  }

  private loadConfiguration(): EnvironmentConfig {
    return {
      // AWS Configuration
      region: process.env.AWS_REGION || 'us-east-1',
      stage: process.env.STAGE || 'development',
      
      // DynamoDB Tables
      farmTwinsTableName: this.requireEnv('FARM_TWINS_TABLE_NAME'),
      advisoriesTableName: process.env.ADVISORIES_TABLE_NAME || 'CropTwin-Advisories',
      externalDataTableName: this.requireEnv('EXTERNAL_DATA_TABLE_NAME'),
      userPreferencesTableName: process.env.USER_PREFERENCES_TABLE_NAME || 'CropTwin-UserPreferences',
      
      // S3 Buckets
      dataLakeBucketName: this.requireEnv('DATA_LAKE_BUCKET_NAME'),
      satelliteDataBucketName: process.env.SATELLITE_DATA_BUCKET_NAME || this.requireEnv('DATA_LAKE_BUCKET_NAME'),
      
      // EventBridge
      eventBusName: this.requireEnv('EVENT_BUS_NAME'),
      
      // External API Configuration
      imdApiKey: process.env.IMD_API_KEY,
      imdApiUrl: process.env.IMD_API_URL || 'https://api.imd.gov.in',
      satelliteApiKey: process.env.SATELLITE_API_KEY,
      satelliteApiUrl: process.env.SATELLITE_API_URL || 'https://api.nasa.gov',
      
      // Communication Services
      snsTopicArn: process.env.SNS_TOPIC_ARN,
      connectInstanceId: process.env.CONNECT_INSTANCE_ID,
      
      // Application Settings
      logLevel: process.env.LOG_LEVEL || 'INFO',
      enableMetrics: process.env.ENABLE_METRICS === 'true',
      enableTracing: process.env.ENABLE_TRACING === 'true',
      
      // Security
      encryptionKeyId: process.env.ENCRYPTION_KEY_ID,
      
      // Performance
      defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '30000', 10),
      maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
      
      // Data Retention
      advisoryRetentionDays: parseInt(process.env.ADVISORY_RETENTION_DAYS || '90', 10),
      externalDataRetentionDays: parseInt(process.env.EXTERNAL_DATA_RETENTION_DAYS || '30', 10),
    };
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Required environment variable ${name} is not set`);
    }
    return value;
  }

  private validateConfiguration(): void {
    const errors: string[] = [];

    // Validate numeric values
    if (this.config.defaultTimeout < 1000 || this.config.defaultTimeout > 900000) {
      errors.push('DEFAULT_TIMEOUT must be between 1000 and 900000 milliseconds');
    }

    if (this.config.maxRetries < 0 || this.config.maxRetries > 10) {
      errors.push('MAX_RETRIES must be between 0 and 10');
    }

    if (this.config.advisoryRetentionDays < 1 || this.config.advisoryRetentionDays > 365) {
      errors.push('ADVISORY_RETENTION_DAYS must be between 1 and 365');
    }

    if (this.config.externalDataRetentionDays < 1 || this.config.externalDataRetentionDays > 90) {
      errors.push('EXTERNAL_DATA_RETENTION_DAYS must be between 1 and 90');
    }

    // Validate log level
    const validLogLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    if (!validLogLevels.includes(this.config.logLevel.toUpperCase())) {
      errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
    }

    // Validate stage
    const validStages = ['development', 'staging', 'production'];
    if (!validStages.includes(this.config.stage)) {
      errors.push(`STAGE must be one of: ${validStages.join(', ')}`);
    }

    if (errors.length > 0) {
      throw new Error(`Environment configuration errors:\n${errors.join('\n')}`);
    }
  }

  getConfig(): EnvironmentConfig {
    return { ...this.config };
  }

  get(key: keyof EnvironmentConfig): any {
    return this.config[key];
  }

  isDevelopment(): boolean {
    return this.config.stage === 'development';
  }

  isProduction(): boolean {
    return this.config.stage === 'production';
  }

  isStaging(): boolean {
    return this.config.stage === 'staging';
  }
}

// Singleton instance
let environmentManager: EnvironmentManager;

export function getEnvironment(): EnvironmentConfig {
  if (!environmentManager) {
    environmentManager = new EnvironmentManager();
  }
  return environmentManager.getConfig();
}

export function getEnvironmentValue<K extends keyof EnvironmentConfig>(key: K): EnvironmentConfig[K] {
  if (!environmentManager) {
    environmentManager = new EnvironmentManager();
  }
  return environmentManager.get(key);
}

export function isDevelopment(): boolean {
  if (!environmentManager) {
    environmentManager = new EnvironmentManager();
  }
  return environmentManager.isDevelopment();
}

export function isProduction(): boolean {
  if (!environmentManager) {
    environmentManager = new EnvironmentManager();
  }
  return environmentManager.isProduction();
}

export function isStaging(): boolean {
  if (!environmentManager) {
    environmentManager = new EnvironmentManager();
  }
  return environmentManager.isStaging();
}