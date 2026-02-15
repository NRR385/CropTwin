/**
 * Data Ingestion Stack
 * Deploys Lambda functions for external data collection with scheduled triggers
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { CropTwinStack } from './crop-twin-stack';

export interface DataIngestionStackProps extends cdk.StackProps {
  cropTwinStack: CropTwinStack;
}

export class DataIngestionStack extends cdk.Stack {
  public readonly weatherCollectionFunction: lambda.Function;
  public readonly satelliteProcessingFunction: lambda.Function;
  public readonly soilCropCalendarFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: DataIngestionStackProps) {
    super(scope, id, props);

    const { cropTwinStack } = props;

    // Create weather data collection Lambda function
    this.createWeatherCollectionFunction(cropTwinStack);

    // Create satellite data processing Lambda function
    this.createSatelliteProcessingFunction(cropTwinStack);

    // Create soil and crop calendar integration Lambda function
    this.createSoilCropCalendarFunction(cropTwinStack);

    // Create EventBridge scheduled rules
    this.createScheduledRules();

    // Create outputs
    this.createOutputs();
  }

  private createWeatherCollectionFunction(cropTwinStack: CropTwinStack): void {
    // Create Lambda function for weather data collection
    this.weatherCollectionFunction = new lambda.Function(this, 'WeatherCollectionFunction', {
      functionName: 'CropTwin-WeatherCollection',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'weather-collection.handler',
      code: lambda.Code.fromAsset('dist/data-ingestion'), // Will be built from TypeScript
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      layers: [cropTwinStack.sharedLayer],
      environment: {
        // DynamoDB Tables
        FARM_TWINS_TABLE_NAME: cropTwinStack.farmTwinsTable.tableName,
        EXTERNAL_DATA_TABLE_NAME: cropTwinStack.externalDataTable.tableName,
        
        // S3 Buckets
        DATA_LAKE_BUCKET_NAME: cropTwinStack.dataLakeBucket.bucketName,
        
        // EventBridge
        EVENT_BUS_NAME: cropTwinStack.eventBus.eventBusName,
        
        // External API Configuration
        IMD_API_URL: 'https://api.openweathermap.org/data/2.5', // Using OpenWeather as IMD proxy
        
        // Application Settings
        LOG_LEVEL: 'INFO',
        ENABLE_METRICS: 'true',
        ENABLE_TRACING: 'true',
        
        // Performance
        DEFAULT_TIMEOUT: '30000',
        MAX_RETRIES: '3',
        
        // Data Retention
        EXTERNAL_DATA_RETENTION_DAYS: '30',
        
        // Stage
        STAGE: 'development',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant permissions to DynamoDB tables
    cropTwinStack.farmTwinsTable.grantReadData(this.weatherCollectionFunction);
    cropTwinStack.externalDataTable.grantReadWriteData(this.weatherCollectionFunction);

    // Grant permissions to S3 buckets
    cropTwinStack.dataLakeBucket.grantReadWrite(this.weatherCollectionFunction);

    // Grant permissions to EventBridge
    cropTwinStack.eventBus.grantPutEventsTo(this.weatherCollectionFunction);

    // Grant permissions to Systems Manager for API keys
    this.weatherCollectionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:GetParametersByPath',
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/croptwin/*`,
        ],
      })
    );

    // Grant permissions for AWS X-Ray tracing
    this.weatherCollectionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
        ],
        resources: ['*'],
      })
    );

    // Add CloudWatch metrics permissions
    this.weatherCollectionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
      })
    );
  }

  private createSatelliteProcessingFunction(cropTwinStack: CropTwinStack): void {
    // Create Lambda function for satellite data processing
    this.satelliteProcessingFunction = new lambda.Function(this, 'SatelliteProcessingFunction', {
      functionName: 'CropTwin-SatelliteProcessing',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'satellite-processing.handler',
      code: lambda.Code.fromAsset('dist/data-ingestion'), // Will be built from TypeScript
      timeout: cdk.Duration.minutes(10), // Longer timeout for satellite processing
      memorySize: 1024, // More memory for image processing
      layers: [cropTwinStack.sharedLayer],
      environment: {
        // DynamoDB Tables
        FARM_TWINS_TABLE_NAME: cropTwinStack.farmTwinsTable.tableName,
        EXTERNAL_DATA_TABLE_NAME: cropTwinStack.externalDataTable.tableName,
        
        // S3 Buckets
        DATA_LAKE_BUCKET_NAME: cropTwinStack.dataLakeBucket.bucketName,
        SATELLITE_DATA_BUCKET_NAME: cropTwinStack.dataLakeBucket.bucketName, // Using same bucket with prefix
        
        // EventBridge
        EVENT_BUS_NAME: cropTwinStack.eventBus.eventBusName,
        
        // External API Configuration
        SATELLITE_API_URL: 'https://api.nasa.gov', // NASA API base URL
        
        // Application Settings
        LOG_LEVEL: 'INFO',
        ENABLE_METRICS: 'true',
        ENABLE_TRACING: 'true',
        
        // Performance
        DEFAULT_TIMEOUT: '45000', // Longer timeout for satellite APIs
        MAX_RETRIES: '3',
        
        // Data Retention
        EXTERNAL_DATA_RETENTION_DAYS: '30',
        
        // Stage
        STAGE: 'development',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant permissions to DynamoDB tables
    cropTwinStack.farmTwinsTable.grantReadData(this.satelliteProcessingFunction);
    cropTwinStack.externalDataTable.grantReadWriteData(this.satelliteProcessingFunction);

    // Grant permissions to S3 buckets
    cropTwinStack.dataLakeBucket.grantReadWrite(this.satelliteProcessingFunction);

    // Grant permissions to EventBridge
    cropTwinStack.eventBus.grantPutEventsTo(this.satelliteProcessingFunction);

    // Grant permissions to Systems Manager for API keys
    this.satelliteProcessingFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:GetParametersByPath',
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/croptwin/*`,
        ],
      })
    );

    // Grant permissions for AWS X-Ray tracing
    this.satelliteProcessingFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
        ],
        resources: ['*'],
      })
    );

    // Add CloudWatch metrics permissions
    this.satelliteProcessingFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
      })
    );
  }

  private createSoilCropCalendarFunction(cropTwinStack: CropTwinStack): void {
    // Create Lambda function for soil and crop calendar data integration
    this.soilCropCalendarFunction = new lambda.Function(this, 'SoilCropCalendarFunction', {
      functionName: 'CropTwin-SoilCropCalendar',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'soil-crop-calendar.handler',
      code: lambda.Code.fromAsset('dist/data-ingestion'), // Will be built from TypeScript
      timeout: cdk.Duration.minutes(8), // Longer timeout for multiple API calls
      memorySize: 768, // More memory for data processing
      layers: [cropTwinStack.sharedLayer],
      environment: {
        // DynamoDB Tables
        FARM_TWINS_TABLE_NAME: cropTwinStack.farmTwinsTable.tableName,
        EXTERNAL_DATA_TABLE_NAME: cropTwinStack.externalDataTable.tableName,
        
        // S3 Buckets
        DATA_LAKE_BUCKET_NAME: cropTwinStack.dataLakeBucket.bucketName,
        
        // EventBridge
        EVENT_BUS_NAME: cropTwinStack.eventBus.eventBusName,
        
        // External API Configuration
        SOIL_API_URL: 'https://api.nbsslup.in/soil',
        CROP_CALENDAR_API_URL: 'https://api.agricoop.nic.in/cropcalendar',
        
        // Application Settings
        LOG_LEVEL: 'INFO',
        ENABLE_METRICS: 'true',
        ENABLE_TRACING: 'true',
        
        // Performance
        DEFAULT_TIMEOUT: '40000', // Longer timeout for government APIs
        MAX_RETRIES: '3',
        
        // Data Retention
        EXTERNAL_DATA_RETENTION_DAYS: '365', // Longer retention for soil/crop data
        
        // Stage
        STAGE: 'development',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant permissions to DynamoDB tables
    cropTwinStack.farmTwinsTable.grantReadData(this.soilCropCalendarFunction);
    cropTwinStack.externalDataTable.grantReadWriteData(this.soilCropCalendarFunction);

    // Grant permissions to S3 buckets
    cropTwinStack.dataLakeBucket.grantReadWrite(this.soilCropCalendarFunction);

    // Grant permissions to EventBridge
    cropTwinStack.eventBus.grantPutEventsTo(this.soilCropCalendarFunction);

    // Grant permissions to Systems Manager for API keys
    this.soilCropCalendarFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:GetParametersByPath',
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/croptwin/*`,
        ],
      })
    );

    // Grant permissions for AWS X-Ray tracing
    this.soilCropCalendarFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
        ],
        resources: ['*'],
      })
    );

    // Add CloudWatch metrics permissions
    this.soilCropCalendarFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
      })
    );
  }

  private createScheduledRules(): void {
    // Create EventBridge rule for 6-hour weather data collection
    const weatherCollectionRule = new events.Rule(this, 'WeatherCollectionSchedule', {
      ruleName: 'CropTwin-WeatherCollection-Schedule',
      description: 'Triggers weather data collection every 6 hours',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '*/6', // Every 6 hours
        day: '*',
        month: '*',
        year: '*',
      }),
      eventBus: events.EventBus.fromEventBusName(
        this,
        'DefaultEventBus',
        'default'
      ),
    });

    // Add Lambda function as target
    weatherCollectionRule.addTarget(
      new targets.LambdaFunction(this.weatherCollectionFunction, {
        event: events.RuleTargetInput.fromObject({
          source: 'aws.events',
          'detail-type': 'Scheduled Event',
          detail: {
            scheduledBy: 'EventBridge',
            collectionType: 'weather',
            forceRefresh: false,
          },
        }),
      })
    );

    // Create manual trigger rule for immediate weather collection
    const manualWeatherTrigger = new events.Rule(this, 'ManualWeatherTrigger', {
      ruleName: 'CropTwin-WeatherCollection-Manual',
      description: 'Manual trigger for weather data collection',
      eventPattern: {
        source: ['croptwin.manual'],
        detailType: ['Manual Weather Collection'],
      },
    });

    manualWeatherTrigger.addTarget(
      new targets.LambdaFunction(this.weatherCollectionFunction)
    );

    // Create EventBridge rule for weekly satellite data processing
    const satelliteProcessingRule = new events.Rule(this, 'SatelliteProcessingSchedule', {
      ruleName: 'CropTwin-SatelliteProcessing-Schedule',
      description: 'Triggers satellite data processing weekly',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2', // 2 AM UTC
        day: '*',
        month: '*',
        year: '*',
        weekDay: 'SUN', // Every Sunday
      }),
      eventBus: events.EventBus.fromEventBusName(
        this,
        'DefaultEventBus2',
        'default'
      ),
    });

    // Add Lambda function as target for satellite processing
    satelliteProcessingRule.addTarget(
      new targets.LambdaFunction(this.satelliteProcessingFunction, {
        event: events.RuleTargetInput.fromObject({
          source: 'aws.events',
          'detail-type': 'Scheduled Event',
          detail: {
            scheduledBy: 'EventBridge',
            collectionType: 'satellite',
            satellite: 'modis', // Default to MODIS
            forceRefresh: false,
          },
        }),
      })
    );

    // Create manual trigger rule for immediate satellite processing
    const manualSatelliteTrigger = new events.Rule(this, 'ManualSatelliteTrigger', {
      ruleName: 'CropTwin-SatelliteProcessing-Manual',
      description: 'Manual trigger for satellite data processing',
      eventPattern: {
        source: ['croptwin.manual'],
        detailType: ['Manual Satellite Processing'],
      },
    });

    manualSatelliteTrigger.addTarget(
      new targets.LambdaFunction(this.satelliteProcessingFunction)
    );

    // Create EventBridge rule for daily soil data integration
    const soilDataRule = new events.Rule(this, 'SoilDataSchedule', {
      ruleName: 'CropTwin-SoilData-Schedule',
      description: 'Triggers soil data integration daily',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '3', // 3 AM UTC
        day: '*',
        month: '*',
        year: '*',
      }),
      eventBus: events.EventBus.fromEventBusName(
        this,
        'DefaultEventBus3',
        'default'
      ),
    });

    // Add Lambda function as target for soil data integration
    soilDataRule.addTarget(
      new targets.LambdaFunction(this.soilCropCalendarFunction, {
        event: events.RuleTargetInput.fromObject({
          source: 'aws.events',
          'detail-type': 'Scheduled Event',
          detail: {
            scheduledBy: 'EventBridge',
            dataType: 'soil',
            forceRefresh: false,
          },
        }),
      })
    );

    // Create EventBridge rule for weekly crop calendar integration
    const cropCalendarRule = new events.Rule(this, 'CropCalendarSchedule', {
      ruleName: 'CropTwin-CropCalendar-Schedule',
      description: 'Triggers crop calendar integration weekly',
      schedule: events.Schedule.cron({
        minute: '30',
        hour: '4', // 4:30 AM UTC
        day: '*',
        month: '*',
        year: '*',
        weekDay: 'MON', // Every Monday
      }),
      eventBus: events.EventBus.fromEventBusName(
        this,
        'DefaultEventBus4',
        'default'
      ),
    });

    // Add Lambda function as target for crop calendar integration
    cropCalendarRule.addTarget(
      new targets.LambdaFunction(this.soilCropCalendarFunction, {
        event: events.RuleTargetInput.fromObject({
          source: 'aws.events',
          'detail-type': 'Scheduled Event',
          detail: {
            scheduledBy: 'EventBridge',
            dataType: 'crop_calendar',
            forceRefresh: false,
          },
        }),
      })
    );

    // Create manual trigger rule for immediate soil and crop calendar integration
    const manualSoilCropCalendarTrigger = new events.Rule(this, 'ManualSoilCropCalendarTrigger', {
      ruleName: 'CropTwin-SoilCropCalendar-Manual',
      description: 'Manual trigger for soil and crop calendar integration',
      eventPattern: {
        source: ['croptwin.manual'],
        detailType: ['Manual Soil Crop Calendar Integration'],
      },
    });

    manualSoilCropCalendarTrigger.addTarget(
      new targets.LambdaFunction(this.soilCropCalendarFunction)
    );

    // Create CloudWatch log group for EventBridge rules
    new logs.LogGroup(this, 'WeatherCollectionRuleLogGroup', {
      logGroupName: '/aws/events/croptwin/weather-collection',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create CloudWatch log group for satellite processing rules
    new logs.LogGroup(this, 'SatelliteProcessingRuleLogGroup', {
      logGroupName: '/aws/events/croptwin/satellite-processing',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create CloudWatch log group for soil and crop calendar rules
    new logs.LogGroup(this, 'SoilCropCalendarRuleLogGroup', {
      logGroupName: '/aws/events/croptwin/soil-crop-calendar',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'WeatherCollectionFunctionName', {
      value: this.weatherCollectionFunction.functionName,
      description: 'Name of the weather collection Lambda function',
      exportName: 'CropTwin-WeatherCollectionFunctionName',
    });

    new cdk.CfnOutput(this, 'WeatherCollectionFunctionArn', {
      value: this.weatherCollectionFunction.functionArn,
      description: 'ARN of the weather collection Lambda function',
      exportName: 'CropTwin-WeatherCollectionFunctionArn',
    });

    new cdk.CfnOutput(this, 'SatelliteProcessingFunctionName', {
      value: this.satelliteProcessingFunction.functionName,
      description: 'Name of the satellite processing Lambda function',
      exportName: 'CropTwin-SatelliteProcessingFunctionName',
    });

    new cdk.CfnOutput(this, 'SatelliteProcessingFunctionArn', {
      value: this.satelliteProcessingFunction.functionArn,
      description: 'ARN of the satellite processing Lambda function',
      exportName: 'CropTwin-SatelliteProcessingFunctionArn',
    });

    new cdk.CfnOutput(this, 'SoilCropCalendarFunctionName', {
      value: this.soilCropCalendarFunction.functionName,
      description: 'Name of the soil and crop calendar integration Lambda function',
      exportName: 'CropTwin-SoilCropCalendarFunctionName',
    });

    new cdk.CfnOutput(this, 'SoilCropCalendarFunctionArn', {
      value: this.soilCropCalendarFunction.functionArn,
      description: 'ARN of the soil and crop calendar integration Lambda function',
      exportName: 'CropTwin-SoilCropCalendarFunctionArn',
    });
  }
}