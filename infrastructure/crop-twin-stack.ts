import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class CropTwinStack extends cdk.Stack {
  // DynamoDB Tables
  public readonly farmTwinsTable: dynamodb.Table;
  public readonly advisoriesTable: dynamodb.Table;
  public readonly externalDataTable: dynamodb.Table;
  public readonly userPreferencesTable: dynamodb.Table;

  // S3 Buckets
  public readonly dataLakeBucket: s3.Bucket;
  public readonly satelliteDataBucket: s3.Bucket;

  // EventBridge
  public readonly eventBus: events.EventBus;

  // Lambda Layer for shared utilities
  public readonly sharedLayer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create DynamoDB tables
    this.createDynamoDBTables();

    // Create S3 buckets
    this.createS3Buckets();

    // Create EventBridge custom event bus
    this.createEventBridge();

    // Create shared Lambda layer
    this.createSharedLayer();

    // Output important ARNs and names
    this.createOutputs();
  }

  private createDynamoDBTables(): void {
    // Farm Twins Table - stores digital twin data
    this.farmTwinsTable = new dynamodb.Table(this, 'FarmTwinsTable', {
      tableName: 'CropTwin-FarmTwins',
      partitionKey: {
        name: 'twinId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'version',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Global Secondary Indexes for Farm Twins
    this.farmTwinsTable.addGlobalSecondaryIndex({
      indexName: 'FarmerIdIndex',
      partitionKey: {
        name: 'farmerId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    this.farmTwinsTable.addGlobalSecondaryIndex({
      indexName: 'LocationIndex',
      partitionKey: {
        name: 'district',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'state',
        type: dynamodb.AttributeType.STRING,
      },
    });

    this.farmTwinsTable.addGlobalSecondaryIndex({
      indexName: 'CropTypeIndex',
      partitionKey: {
        name: 'cropType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'plantingDate',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Advisories Table - stores generated advisories
    this.advisoriesTable = new dynamodb.Table(this, 'AdvisoriesTable', {
      tableName: 'CropTwin-Advisories',
      partitionKey: {
        name: 'advisoryId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl', // Auto-expire old advisories
    });

    // Global Secondary Indexes for Advisories
    this.advisoriesTable.addGlobalSecondaryIndex({
      indexName: 'FarmTwinIdIndex',
      partitionKey: {
        name: 'farmTwinId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    this.advisoriesTable.addGlobalSecondaryIndex({
      indexName: 'PriorityIndex',
      partitionKey: {
        name: 'priority',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    this.advisoriesTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: {
        name: 'category',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'validUntil',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // External Data Table - stores cached external data
    this.externalDataTable = new dynamodb.Table(this, 'ExternalDataTable', {
      tableName: 'CropTwin-ExternalData',
      partitionKey: {
        name: 'dataKey', // composite key: dataType#location#date
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // External data can be re-fetched
      timeToLiveAttribute: 'ttl', // Auto-expire old external data
    });

    // Global Secondary Indexes for External Data
    this.externalDataTable.addGlobalSecondaryIndex({
      indexName: 'DataTypeIndex',
      partitionKey: {
        name: 'dataType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    this.externalDataTable.addGlobalSecondaryIndex({
      indexName: 'LocationIndex',
      partitionKey: {
        name: 'location',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // User Preferences Table - stores farmer communication preferences
    this.userPreferencesTable = new dynamodb.Table(this, 'UserPreferencesTable', {
      tableName: 'CropTwin-UserPreferences',
      partitionKey: {
        name: 'farmerId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }

  private createS3Buckets(): void {
    // Data Lake bucket for storing raw and processed data
    this.dataLakeBucket = new s3.Bucket(this, 'DataLakeBucket', {
      bucketName: `croptwin-data-lake-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ArchiveOldData',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Satellite data bucket for storing satellite imagery and processed indices
    this.satelliteDataBucket = new s3.Bucket(this, 'SatelliteDataBucket', {
      bucketName: `croptwin-satellite-data-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false, // Satellite data doesn't need versioning
      lifecycleRules: [
        {
          id: 'DeleteOldSatelliteData',
          enabled: true,
          expiration: cdk.Duration.days(180), // Keep satellite data for 6 months
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createEventBridge(): void {
    // Custom event bus for CropTwin events
    this.eventBus = new events.EventBus(this, 'CropTwinEventBus', {
      eventBusName: 'CropTwin-Events',
    });

    // Create CloudWatch log group for event bus
    new logs.LogGroup(this, 'EventBusLogGroup', {
      logGroupName: '/aws/events/croptwin',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createSharedLayer(): void {
    // Lambda layer containing shared utilities and dependencies
    this.sharedLayer = new lambda.LayerVersion(this, 'SharedUtilitiesLayer', {
      layerVersionName: 'CropTwin-SharedUtilities',
      code: lambda.Code.fromAsset('src/shared'), // Will be created later
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X, lambda.Runtime.NODEJS_20_X],
      description: 'Shared utilities and common dependencies for CropTwin Lambda functions',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createOutputs(): void {
    // DynamoDB Table outputs
    new cdk.CfnOutput(this, 'FarmTwinsTableName', {
      value: this.farmTwinsTable.tableName,
      description: 'Name of the Farm Twins DynamoDB table',
      exportName: 'CropTwin-FarmTwinsTableName',
    });

    new cdk.CfnOutput(this, 'AdvisoriesTableName', {
      value: this.advisoriesTable.tableName,
      description: 'Name of the Advisories DynamoDB table',
      exportName: 'CropTwin-AdvisoriesTableName',
    });

    new cdk.CfnOutput(this, 'ExternalDataTableName', {
      value: this.externalDataTable.tableName,
      description: 'Name of the External Data DynamoDB table',
      exportName: 'CropTwin-ExternalDataTableName',
    });

    new cdk.CfnOutput(this, 'UserPreferencesTableName', {
      value: this.userPreferencesTable.tableName,
      description: 'Name of the User Preferences DynamoDB table',
      exportName: 'CropTwin-UserPreferencesTableName',
    });

    // S3 Bucket outputs
    new cdk.CfnOutput(this, 'DataLakeBucketName', {
      value: this.dataLakeBucket.bucketName,
      description: 'Name of the Data Lake S3 bucket',
      exportName: 'CropTwin-DataLakeBucketName',
    });

    new cdk.CfnOutput(this, 'SatelliteDataBucketName', {
      value: this.satelliteDataBucket.bucketName,
      description: 'Name of the Satellite Data S3 bucket',
      exportName: 'CropTwin-SatelliteDataBucketName',
    });

    // EventBridge output
    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'Name of the CropTwin EventBridge event bus',
      exportName: 'CropTwin-EventBusName',
    });

    // Lambda Layer output
    new cdk.CfnOutput(this, 'SharedLayerArn', {
      value: this.sharedLayer.layerVersionArn,
      description: 'ARN of the shared utilities Lambda layer',
      exportName: 'CropTwin-SharedLayerArn',
    });
  }
}