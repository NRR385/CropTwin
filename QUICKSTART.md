# CropTwin Quick Start Guide

Get CropTwin up and running in 5 minutes!

## 🚀 Option 1: View Demo (No Setup Required)

**Fastest way to see CropTwin in action:**

1. **Download or clone the repository**
   ```bash
   git clone https://github.com/NRR385/CropTwin.git
   cd CropTwin
   ```

2. **Open the dashboard**
   ```bash
   cd web
   start index.html
   ```
   (On Mac/Linux: `open index.html`)

3. **Load demo data**
   - Click the green "Load Demo Data" button
   - Watch the dashboard populate with simulated farm data
   - Data updates automatically every 5 seconds

4. **Control the demo**
   - Click **"Stop Demo"** (red button) to pause updates
   - Click **"Resume Demo"** (yellow button) to continue
   - Perfect for presentations and screenshots!

**That's it!** You're now viewing a fully functional demo with:
- 5-12 simulated farms across Telangana & Andhra Pradesh
- Real-time weather and satellite data
- Dynamic advisories based on crop conditions
- Live stress indicators

---

## 💻 Option 2: Deploy to AWS (Production)

**Prerequisites:**
- AWS Account
- Node.js 18+ installed
- AWS CLI configured

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Build Project
```bash
npm run build
```

### Step 3: Configure AWS
```bash
# Configure AWS credentials
aws configure

# Bootstrap CDK (first time only)
npx cdk bootstrap
```

### Step 4: Deploy
```bash
npm run deploy
```

This will create:
- ✅ 15+ Lambda functions
- ✅ 10+ DynamoDB tables
- ✅ EventBridge rules
- ✅ SNS topics
- ✅ S3 buckets
- ✅ API Gateway endpoints

### Step 5: Get API Endpoint
After deployment, you'll see:
```
Outputs:
CropTwinStack.ApiEndpoint = https://abc123.execute-api.region.amazonaws.com/prod
```

### Step 6: Connect Dashboard
1. Open `web/index.html`
2. Paste your API endpoint
3. Click "Save Configuration"
4. Dashboard now shows real data!

---

## 📱 Option 3: Test SMS Functionality

**After AWS deployment:**

1. **Register a test farm via SMS**
   ```
   Send SMS to your SNS number:
   REG RICE 2.5 HYDERABAD
   ```

2. **System will:**
   - Create digital twin
   - Start monitoring
   - Send confirmation SMS
   - Begin advisory generation

3. **Receive advisories**
   - Irrigation alerts
   - Fertilizer recommendations
   - Pest warnings
   - Harvest timing

---

## 🎯 What to Try

### In Demo Mode:
- ✅ Watch farms change health status (Healthy → Moderate → Critical)
- ✅ See advisories appear when stress levels increase
- ✅ Observe weather and satellite data updates
- ✅ Click on farms to see details
- ✅ Monitor SMS count increasing

### In Production Mode:
- ✅ Register real farms
- ✅ Receive actual SMS advisories
- ✅ View real weather from IMD
- ✅ See satellite imagery from ISRO/NASA
- ✅ Track advisory effectiveness

---

## 🔧 Troubleshooting

### Dashboard not loading?
- Check if `web/index.html` is in the correct folder
- Try a different browser (Chrome recommended)
- Clear browser cache

### Demo data not showing?
- Open browser console (F12)
- Look for JavaScript errors
- Refresh the page and click "Load Demo Data" again

### AWS deployment failing?
- Verify AWS credentials: `aws sts get-caller-identity`
- Check AWS region is supported
- Ensure you have necessary permissions
- Try: `npm run build` first

### Build errors?
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again
- Check Node.js version: `node --version` (should be 18+)

---

## 📚 Next Steps

1. **Explore the code**
   - Check `src/` for backend logic
   - Look at `infrastructure/` for AWS setup
   - Review `web/` for dashboard code

2. **Read documentation**
   - [README.md](README.md) - Full project overview
   - [ARCHITECTURE.md](ARCHITECTURE.md) - System design
   - [CONTRIBUTING.md](CONTRIBUTING.md) - How to contribute

3. **Customize**
   - Add more crop types
   - Modify stress thresholds
   - Change advisory templates
   - Add new features

4. **Deploy for real**
   - Get IMD API key
   - Get ISRO/NASA API keys
   - Configure SMS gateway
   - Set up monitoring

---

## 💡 Tips

- **Demo mode** is perfect for presentations and testing
- **Production mode** requires AWS costs (~$50/month for 1000 farmers)
- Start with demo, deploy to AWS when ready
- Use CloudWatch logs to debug issues
- Monitor costs in AWS Cost Explorer

---

## 🆘 Need Help?

- **Email**: rohithreddyn2005@gmail.com
- **LinkedIn**: [Rohith Reddy Nemtoor](https://www.linkedin.com/in/rohithreddynemtoor)
- **Issues**: [GitHub Issues](https://github.com/NRR385/CropTwin/issues)

---

**Happy farming! 🌾**
