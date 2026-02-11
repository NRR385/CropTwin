# 🌾 CropTwin  
### Sensor-less Digital Twin Platform for Smallholder Farmers

![TypeScript](https://img.shields.io/badge/TypeScript-Backend-blue)
![AWS](https://img.shields.io/badge/AWS-Serverless-orange)
![Architecture](https://img.shields.io/badge/Architecture-Event--Driven-green)
![Tests](https://img.shields.io/badge/Tests-100%2B%20Passing-brightgreen)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

CropTwin is a **cloud-based digital twin platform** that generates farm-level crop advisories using publicly available data — **without requiring expensive IoT sensors**.

Designed for **smallholder farmers in low-connectivity regions**, it supports **SMS, IVR, and mobile apps**.

---

## 🌱 The Problem
Smallholder farmers often lack:

- Access to precision agriculture tools  
- Reliable internet connectivity  
- Affordable sensor hardware  
- Localized crop advisories  

**Existing solutions are:**
- Expensive  
- Sensor-dependent  
- Designed for large commercial farms  

---

## 💡 The Solution
CropTwin creates a **virtual farm model** using:

- Weather data
- Satellite imagery
- Soil databases
- Crop calendars

It then:

1. Simulates crop conditions  
2. Detects risks  
3. Sends personalized advisories  

**No sensors required.**

---

## 🚀 Key Features

### 👨‍🌾 For Farmers
- No hardware investment required
- Personalized crop advisories
- Multi-language support
- SMS and IVR delivery
- Offline-friendly mobile app

### 🏛 For Governments & NGOs
- Regional crop health dashboards
- Early warning systems
- Yield predictions
- High-risk area detection
- Privacy-preserving analytics

### ⚙️ Technical Highlights
- Serverless architecture
- Event-driven microservices
- Auto-scaling for **100K+ farms**
- Property-based testing
- Designed for **99.5% uptime**

---

## 🏗 Architecture Overview

```
Data Ingestion Layer
(Weather, Satellite, Soil, Crop Calendar)
            │
            ▼
Digital Twin Engine
(Farm State, Crop Simulation)
            │
            ▼
Advisory Engine
(Risk Assessment, Recommendations)
            │
            ▼
Interaction Layer
(SMS, IVR, Mobile, Offline Sync)
            │
            ▼
Analytics Layer
(Regional Insights, Dashboards)
```

---

## 🛠 Tech Stack

### Core Technologies
- TypeScript
- Node.js
- AWS Lambda (Serverless)
- Jest + fast-check (Property-based testing)
- AWS CDK (Infrastructure as Code)

### AWS Services
- **Compute:** Lambda
- **Database:** DynamoDB
- **Storage:** S3
- **API:** AppSync (GraphQL)
- **Messaging:** SNS (SMS)
- **IVR:** Amazon Connect
- **Events:** EventBridge
- **Monitoring:** CloudWatch
- **Security:** KMS

---

## 🌍 External Data Sources
- Weather: IMD API
- Satellite: NASA MODIS, ISRO ResourceSat
- Soil: Government soil databases
- Crop calendars: Agricultural department data

---

## 📂 Project Structure
```
CropTwin/
│
├── src/
│   ├── data-ingestion/
│   ├── digital-twin-engine/
│   ├── advisory-engine/
│   ├── interaction-layer/
│   ├── analytics-layer/
│   └── shared/
│       ├── services/
│       └── utils/
│
├── test/
│   ├── unit/
│   └── property/
│
├── infrastructure/
├── docs/
└── README.md
```

---

## 🔐 Security & Privacy
- AES-256 encryption (at rest and in transit)
- Consent-based data sharing
- k-anonymity for regional analytics
- Farmer data rights (access, export, delete)
- Immutable audit logs

---

## 📈 Scalability
- Serverless auto-scaling
- Event-driven architecture
- Stateless compute (Lambda)
- Horizontally scalable DynamoDB
- Designed for **millions of farms**

---

## 🧪 Testing Strategy
- 100+ unit tests
- Property-based testing
- Integration tests
- Performance SLA tests

---

## ⚙️ Setup & Deployment

### Install dependencies
```bash
npm install
```

### Run tests
```bash
npm test
```

### Deploy to AWS
```bash
cdk deploy --all
```

---

## 📊 Impact Potential
- Target: **100,000+ smallholder farmers**
- Cost: **< $0.10 per farmer/month**
- Works on basic phones (SMS/IVR)
- Privacy-compliant
- Scales to millions of farms

---

## ✨ Innovation Highlights
- Sensor-less digital twin approach
- Offline-first architecture
- Privacy-preserving analytics
- Multi-channel communication
- Serverless cost optimization

---

## 📜 License
MIT License

---

## 👤 Author
**Your Name**  
GitHub: https://github.com/yourusername  
LinkedIn: https://linkedin.com/in/yourprofile  
