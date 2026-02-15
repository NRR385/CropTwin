# CropTwin Web Dashboard

A simple web interface to visualize and monitor your CropTwin platform data.

## Features

- 📊 System overview with key metrics
- 🌾 Farm twin monitoring
- 📱 Advisory tracking
- 🌡️ Weather data visualization
- 🛰️ Satellite imagery metrics
- 🚨 Real-time alerts

## How to Run

### Option 1: Open Directly (Demo Mode)
1. Open `index.html` in your web browser
2. Click "Load Demo Data" to see sample data
3. Explore the dashboard with demo farms and advisories

### Option 2: Connect to AWS Backend
1. Deploy your CropTwin backend to AWS using `npm run deploy`
2. Get your API Gateway endpoint URL from the deployment output
3. Open `index.html` in your browser
4. Enter your API endpoint in the configuration section
5. Click "Save Configuration"

### Option 3: Run with Local Server
```bash
# Using Python
cd web
python -m http.server 8000

# Using Node.js (install http-server first: npm install -g http-server)
cd web
http-server -p 8000

# Then open: http://localhost:8000
```

## API Endpoints Expected

The dashboard expects these endpoints from your AWS backend:

- `GET /farms` - List all farm twins
- `GET /advisories` - List all advisories
- `GET /stats` - System statistics
- `GET /weather/latest` - Latest weather data
- `GET /satellite/latest` - Latest satellite data

## Customization

Edit `app.js` to:
- Add more visualizations
- Customize data display
- Add charts and graphs
- Implement real-time updates

Edit `index.html` to:
- Change styling and layout
- Add new sections
- Modify branding

## Next Steps

To enhance the dashboard:
1. Add charts using Chart.js or D3.js
2. Implement real-time updates with WebSockets
3. Add map visualization for farm locations
4. Create detailed farm view pages
5. Add user authentication
6. Implement data export features

## Browser Compatibility

Works with all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera
