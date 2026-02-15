# CropTwin Architecture

## System Overview

CropTwin is a serverless, event-driven platform built on AWS that creates digital twins of farms for smallholder farmers in India.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     FARMER INTERACTION                       │
│  📱 SMS  │  📞 IVR  │  📲 Mobile App  │  🎤 Voice Updates   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    INTERACTION LAYER                         │
│  • SMS Delivery (Amazon SNS)                                │
│  • IVR System (Amazon Connect)                              │
│  • Mobile API (AWS AppSync/GraphQL)                         │
│  • Voice Processing (Amazon Transcribe)                     │
│  • Offline Sync Manager                                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    ADVISORY ENGINE                           │
│  • Risk Assessment                                          │
│  • Threshold Monitoring                                     │
│  • Advisory Generation                                      │
│  • Multi-language Translation                               │
│  • Priority Calculation                                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  DIGITAL TWIN ENGINE                         │
│  • Farm Twin Management                                     │
│  • Crop Growth Simulation                                   │
│  • Stress Indicator Calculation                             │
│  • Yield Prediction                                         │
│  • Multi-plot Support                                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   DATA INGESTION                             │
│  • Weather Collection (IMD API - every 6 hours)             │
│  • Satellite Processing (ISRO/NASA - weekly)                │
│  • Soil Data Integration (Government DBs)                   │
│  • Crop Calendar Sync                                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA STORAGE                              │
│  • DynamoDB Tables (NoSQL)                                  │
│  • S3 Buckets (Satellite Images)                            │
│  • CloudWatch Logs                                          │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Data Ingestion Layer
- **Weather Collection**: Fetches data from IMD API every 6 hours
- **Satellite Processing**: Processes ISRO/NASA imagery weekly
- **Soil Integration**: Syncs with government soil databases
- **Crop Calendar**: Maintains planting and harvest schedules

### 2. Digital Twin Engine
- **Farm Twin Management**: CRUD operations for farm twins
- **Crop Growth Simulation**: Growing Degree Days (GDD) algorithm
- **Stress Calculation**: Water, heat, nutrient, pest, disease indicators
- **Yield Prediction**: ML-based yield forecasting

### 3. Advisory Engine
- **Risk Assessment**: Monitors stress thresholds
- **Advisory Generation**: Creates actionable recommendations
- **Multi-language Support**: Translates to 10+ Indian languages
- **Priority Calculation**: Urgency and impact-based prioritization

### 4. Interaction Layer
- **SMS Delivery**: Amazon SNS for text messages
- **IVR System**: Voice-based advisory delivery
- **Mobile API**: GraphQL API for smartphone apps
- **Offline Sync**: Queue-based synchronization

### 5. Analytics Layer
- **Regional Aggregation**: District and state-level analytics
- **Early Warning System**: Pest outbreak and weather alerts
- **Dashboard Reporting**: Stakeholder dashboards
- **Trend Analysis**: Historical crop health trends

## Technology Stack

### Backend
- **Language**: TypeScript 5.2, Node.js 18.x
- **Compute**: AWS Lambda (serverless functions)
- **Database**: Amazon DynamoDB (NoSQL)
- **Storage**: Amazon S3 (satellite images)
- **Messaging**: Amazon SNS (SMS), Amazon Connect (IVR)
- **Scheduling**: Amazon EventBridge (cron jobs)
- **API**: AWS API Gateway, AWS AppSync (GraphQL)
- **Monitoring**: Amazon CloudWatch, AWS X-Ray

### Infrastructure
- **IaC**: AWS CDK (TypeScript)
- **Deployment**: AWS CloudFormation
- **CI/CD**: GitHub Actions (planned)

### Frontend
- **Dashboard**: HTML5, CSS3, JavaScript
- **Mobile**: React Native (planned)

## Data Flow

### Farm Registration Flow
```
1. Farmer sends SMS: "REG RICE 2.5 HYDERABAD"
2. SNS receives message
3. Lambda processes registration
4. Creates FarmTwin in DynamoDB
5. Sends confirmation SMS
6. Triggers initial data collection
```

### Advisory Generation Flow
```
1. EventBridge triggers weather collection (every 6 hours)
2. Weather data stored in DynamoDB
3. Crop simulation Lambda triggered
4. Calculates stress indicators
5. If stress > threshold: Risk assessment Lambda triggered
6. Advisory generator creates recommendation
7. SMS delivery Lambda sends to farmer
8. Delivery status tracked in DynamoDB
```

### Data Update Flow
```
1. EventBridge scheduled trigger
2. Data ingestion Lambda runs
3. Fetches external data (weather/satellite)
4. Stores in DynamoDB
5. Triggers crop simulation for affected farms
6. Updates farm twin state
7. Checks for advisory triggers
```

## Scalability

- **Horizontal Scaling**: Lambda auto-scales based on demand
- **Database**: DynamoDB on-demand pricing scales automatically
- **Cost Optimization**: Pay only for what you use
- **Performance**: Sub-second response times for API calls

## Security

- **Encryption**: All data encrypted at rest (KMS) and in transit (TLS)
- **Authentication**: IAM roles and policies
- **Privacy**: Farmer consent management
- **Compliance**: GDPR-compliant data handling

## Monitoring

- **Logs**: CloudWatch Logs for all Lambda functions
- **Metrics**: Custom CloudWatch metrics for business KPIs
- **Alarms**: Automated alerts for errors and performance issues
- **Tracing**: X-Ray for distributed tracing

## Cost Structure

For 1000 farmers:
- Lambda: $10-20/month
- DynamoDB: $5-15/month
- SNS (SMS): $20-100/month
- S3: $1-5/month
- Other services: $5-10/month
- **Total**: ~$50-150/month

## Future Enhancements

- Machine learning for yield prediction
- Real-time weather alerts
- Marketplace integration
- Drone imagery support
- Blockchain for supply chain
- Mobile app with offline-first architecture

---

For more details, see the [README](README.md) or contact [Rohith Reddy Nemtoor](mailto:rohithreddyn2005@gmail.com).
