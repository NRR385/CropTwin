#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CropTwinStack } from './crop-twin-stack';

const app = new cdk.App();

// Get environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Create the main CropTwin stack
new CropTwinStack(app, 'CropTwinStack', {
  env,
  description: 'CropTwin Digital Twin Platform - Serverless agriculture platform for smallholder farmers',
  tags: {
    Project: 'CropTwin',
    Environment: process.env.ENVIRONMENT || 'development',
    Owner: 'CropTwin Team',
  },
});

app.synth();