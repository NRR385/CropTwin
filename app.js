// CropTwin Dashboard JavaScript

let apiEndpoint = localStorage.getItem('apiEndpoint') || '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (apiEndpoint) {
        document.getElementById('apiEndpoint').value = apiEndpoint;
        loadDashboard();
    }
});

function saveConfig() {
    apiEndpoint = document.getElementById('apiEndpoint').value.trim();
    if (!apiEndpoint) {
        alert('Please enter a valid API endpoint');
        return;
    }
    localStorage.setItem('apiEndpoint', apiEndpoint);
    document.getElementById('config-alert').style.display = 'none';
    loadDashboard();
}

async function loadDashboard() {
    document.getElementById('dashboard').style.display = 'block';
    
    try {
        await Promise.all([
            loadFarms(),
            loadAdvisories(),
            loadSystemStats(),
            loadWeatherData(),
            loadSatelliteData()
        ]);
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showError('Failed to load dashboard data. Check your API endpoint.');
    }
}

async function loadFarms() {
    try {
        // In production, this would call: GET ${apiEndpoint}/farms
        const farms = await fetchData('/farms');
        displayFarms(farms);
    } catch (error) {
        console.error('Error loading farms:', error);
    }
}

async function loadAdvisories() {
    try {
        // In production: GET ${apiEndpoint}/advisories
        const advisories = await fetchData('/advisories');
        displayAdvisories(advisories);
    } catch (error) {
        console.error('Error loading advisories:', error);
    }
}

async function loadSystemStats() {
    try {
        const stats = await fetchData('/stats');
        updateSystemStats(stats);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadWeatherData() {
    try {
        const weather = await fetchData('/weather/latest');
        updateWeatherData(weather);
    } catch (error) {
        console.error('Error loading weather:', error);
    }
}

async function loadSatelliteData() {
    try {
        const satellite = await fetchData('/satellite/latest');
        updateSatelliteData(satellite);
    } catch (error) {
        console.error('Error loading satellite data:', error);
    }
}

async function fetchData(endpoint) {
    if (!apiEndpoint) {
        throw new Error('API endpoint not configured');
    }
    
    const response = await fetch(`${apiEndpoint}${endpoint}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
}

function displayFarms(farms) {
    const farmsList = document.getElementById('farmsList');
    
    if (!farms || farms.length === 0) {
        farmsList.innerHTML = '<li class="loading">No farms found</li>';
        return;
    }
    
    farmsList.innerHTML = farms.map(farm => `
        <li class="farm-item" onclick="viewFarmDetails('${farm.twinId}')">
            <div class="farm-name">${farm.farmConfiguration?.cropType || 'Unknown Crop'} - ${farm.location?.district || 'Unknown'}</div>
            <div class="farm-details">
                Stage: ${farm.currentState?.cropStage || 'N/A'} | 
                Health: ${getHealthStatus(farm.currentState?.stressIndicators)}
            </div>
        </li>
    `).join('');
    
    document.getElementById('totalFarms').textContent = farms.length;
}

function displayAdvisories(advisories) {
    const advisoriesList = document.getElementById('advisoriesList');
    
    if (!advisories || advisories.length === 0) {
        advisoriesList.innerHTML = '<li class="loading">No advisories</li>';
        return;
    }
    
    advisoriesList.innerHTML = advisories.slice(0, 5).map(advisory => `
        <li class="farm-item">
            <div class="farm-name">${advisory.title}</div>
            <div class="farm-details">
                <span class="status ${advisory.priority}">${advisory.priority}</span>
                ${advisory.category} - ${new Date(advisory.createdAt).toLocaleDateString()}
            </div>
        </li>
    `).join('');
    
    document.getElementById('activeAdvisories').textContent = advisories.length;
    
    // Display high priority as alerts
    const alerts = advisories.filter(a => a.priority === 'high');
    const alertsList = document.getElementById('alertsList');
    if (alerts.length > 0) {
        alertsList.innerHTML = alerts.slice(0, 3).map(alert => `
            <li class="farm-item">
                <div class="farm-name">⚠️ ${alert.title}</div>
                <div class="farm-details">${alert.description?.substring(0, 100)}...</div>
            </li>
        `).join('');
    } else {
        alertsList.innerHTML = '<li class="loading">No active alerts</li>';
    }
}

function updateSystemStats(stats) {
    if (stats) {
        document.getElementById('smsSent').textContent = stats.smsSentToday || 0;
        document.getElementById('systemStatus').textContent = stats.status || 'Operational';
    }
}

function updateWeatherData(weather) {
    if (weather) {
        document.getElementById('temperature').textContent = `${weather.temperature || '--'}°C`;
        document.getElementById('humidity').textContent = `${weather.humidity || '--'}%`;
        document.getElementById('rainfall').textContent = `${weather.rainfall || '--'} mm`;
        document.getElementById('weatherUpdate').textContent = weather.lastUpdated 
            ? new Date(weather.lastUpdated).toLocaleString() 
            : '--';
    }
}

function updateSatelliteData(satellite) {
    console.log('Updating satellite data:', satellite);
    if (satellite) {
        const ndviValue = satellite.ndvi ? satellite.ndvi.toFixed(2) : '--';
        const eviValue = satellite.evi ? satellite.evi.toFixed(2) : '--';
        const laiValue = satellite.lai ? satellite.lai.toFixed(2) : '--';
        
        document.getElementById('ndvi').textContent = ndviValue;
        document.getElementById('evi').textContent = eviValue;
        document.getElementById('lai').textContent = laiValue;
        document.getElementById('satelliteUpdate').textContent = satellite.lastUpdated 
            ? new Date(satellite.lastUpdated).toLocaleString() 
            : '--';
        
        console.log('Satellite values set:', { ndvi: ndviValue, evi: eviValue, lai: laiValue });
    } else {
        console.log('No satellite data provided');
    }
}

function getHealthStatus(stressIndicators) {
    if (!stressIndicators) return 'Unknown';
    
    const avgStress = (
        stressIndicators.waterStress + 
        stressIndicators.heatStress + 
        stressIndicators.nutrientStress
    ) / 3;
    
    if (avgStress < 0.3) return '<span class="status healthy">Healthy</span>';
    if (avgStress < 0.6) return '<span class="status warning">Moderate</span>';
    return '<span class="status critical">Critical</span>';
}

function viewFarmDetails(twinId) {
    alert(`Farm details for ${twinId}\n\nThis would open a detailed view with:\n- Crop growth timeline\n- Stress indicators\n- Historical data\n- Recommendations`);
}

function showError(message) {
    const alert = document.getElementById('config-alert');
    alert.className = 'alert error';
    alert.innerHTML = `<strong>Error:</strong> ${message}`;
    alert.style.display = 'block';
}

// Dynamic demo data state
let demoState = {
    farms: [],
    advisories: [],
    weather: {},
    satellite: {},
    stats: {},
    updateInterval: null
};

// Helper: Random number in range
function random(min, max) {
    return Math.random() * (max - min) + min;
}

// Helper: Random integer in range
function randomInt(min, max) {
    return Math.floor(random(min, max));
}

// Helper: Random choice from array
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Generate dynamic farm data
function generateDynamicFarms() {
    const cropTypes = ['Rice', 'Wheat', 'Cotton', 'Maize', 'Sugarcane', 'Soybean', 'Chilli', 'Turmeric', 'Groundnut'];
    
    // Telangana districts
    const telanganaDistricts = [
        'Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 
        'Nalgonda', 'Mahbubnagar', 'Rangareddy', 'Medak', 'Adilabad'
    ];
    
    // Andhra Pradesh districts
    const andhraDistricts = [
        'Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool',
        'Tirupati', 'Kakinada', 'Rajahmundry', 'Anantapur', 'Kadapa',
        'Eluru', 'Ongole', 'Vizianagaram', 'Srikakulam', 'Chittoor'
    ];
    
    const stages = ['germination', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvest_ready'];
    
    const numFarms = randomInt(5, 12);
    const farms = [];
    
    for (let i = 0; i < numFarms; i++) {
        // Randomly choose between Telangana and Andhra Pradesh
        const isTelangana = Math.random() > 0.5;
        const district = isTelangana 
            ? randomChoice(telanganaDistricts)
            : randomChoice(andhraDistricts);
        const state = isTelangana ? 'Telangana' : 'Andhra Pradesh';
        
        farms.push({
            twinId: `farm-${String(i + 1).padStart(3, '0')}`,
            farmConfiguration: { 
                cropType: randomChoice(cropTypes),
                farmSize: random(0.5, 5).toFixed(2)
            },
            location: { 
                district: district, 
                state: state
            },
            currentState: {
                cropStage: randomChoice(stages),
                daysAfterPlanting: randomInt(10, 120),
                stressIndicators: {
                    waterStress: random(0, 0.9),
                    heatStress: random(0, 0.8),
                    nutrientStress: random(0, 0.7),
                    pestRisk: random(0, 0.6),
                    diseaseRisk: random(0, 0.5)
                },
                predictedYield: randomInt(1500, 4500)
            }
        });
    }
    
    return farms;
}

// Generate dynamic advisories based on farms
function generateDynamicAdvisories(farms) {
    const advisories = [];
    const advisoryTemplates = [
        { title: 'Irrigation Required', category: 'irrigation', condition: (f) => f.currentState.stressIndicators.waterStress > 0.5 },
        { title: 'Heat Stress Warning', category: 'weather_alert', condition: (f) => f.currentState.stressIndicators.heatStress > 0.6 },
        { title: 'Fertilizer Application', category: 'fertilization', condition: (f) => f.currentState.stressIndicators.nutrientStress > 0.4 },
        { title: 'Pest Control Needed', category: 'pest_control', condition: (f) => f.currentState.stressIndicators.pestRisk > 0.5 },
        { title: 'Disease Prevention', category: 'disease_management', condition: (f) => f.currentState.stressIndicators.diseaseRisk > 0.4 },
        { title: 'Harvest Preparation', category: 'harvesting', condition: (f) => f.currentState.cropStage === 'maturity' || f.currentState.cropStage === 'harvest_ready' }
    ];
    
    farms.forEach(farm => {
        advisoryTemplates.forEach(template => {
            if (template.condition(farm) && Math.random() > 0.5) {
                const priority = Math.random() > 0.7 ? 'high' : (Math.random() > 0.5 ? 'medium' : 'low');
                advisories.push({
                    advisoryId: `adv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    farmTwinId: farm.twinId,
                    title: `${template.title} - ${farm.farmConfiguration.cropType}`,
                    description: `${template.title} recommended for ${farm.farmConfiguration.cropType} farm in ${farm.location.district}.`,
                    priority: priority,
                    category: template.category,
                    createdAt: new Date(Date.now() - randomInt(0, 7 * 24 * 60 * 60 * 1000))
                });
            }
        });
    });
    
    // Add some general advisories
    if (Math.random() > 0.6) {
        advisories.push({
            title: 'Weather Alert: Heavy Rainfall Expected',
            description: 'Monsoon activity expected in next 48-72 hours. Prepare drainage systems.',
            priority: 'high',
            category: 'weather_alert',
            createdAt: new Date()
        });
    }
    
    return advisories;
}

// Generate dynamic weather data
function generateDynamicWeather() {
    const baseTemp = 25;
    const tempVariation = Math.sin(Date.now() / 100000) * 8;
    
    return {
        temperature: (baseTemp + tempVariation + random(-3, 3)).toFixed(1),
        humidity: randomInt(40, 90),
        rainfall: random(0, 100).toFixed(1),
        windSpeed: random(5, 25).toFixed(1),
        lastUpdated: new Date()
    };
}

// Generate dynamic satellite data
function generateDynamicSatellite() {
    return {
        ndvi: parseFloat(random(0.3, 0.9).toFixed(3)),
        evi: parseFloat(random(0.2, 0.8).toFixed(3)),
        lai: parseFloat(random(1.5, 5.0).toFixed(2)),
        lastUpdated: new Date()
    };
}

// Generate dynamic stats
function generateDynamicStats() {
    return {
        smsSentToday: randomInt(50, 300),
        status: Math.random() > 0.95 ? 'Degraded' : 'Operational',
        apiCalls: randomInt(1000, 5000),
        activeUsers: randomInt(20, 150)
    };
}

// Update demo data periodically
function updateDemoData() {
    // Slightly modify existing data for smooth transitions
    if (demoState.farms.length > 0) {
        demoState.farms.forEach(farm => {
            // Gradually change stress indicators
            const stress = farm.currentState.stressIndicators;
            stress.waterStress = Math.max(0, Math.min(1, stress.waterStress + random(-0.05, 0.05)));
            stress.heatStress = Math.max(0, Math.min(1, stress.heatStress + random(-0.03, 0.03)));
            stress.nutrientStress = Math.max(0, Math.min(1, stress.nutrientStress + random(-0.02, 0.02)));
            stress.pestRisk = Math.max(0, Math.min(1, stress.pestRisk + random(-0.04, 0.04)));
            stress.diseaseRisk = Math.max(0, Math.min(1, stress.diseaseRisk + random(-0.03, 0.03)));
            
            // Increment days
            farm.currentState.daysAfterPlanting++;
        });
    }
    
    // Update weather with variations
    demoState.weather = generateDynamicWeather();
    
    // Update satellite data occasionally
    if (Math.random() > 0.7) {
        demoState.satellite = generateDynamicSatellite();
    }
    
    // Update stats
    demoState.stats.smsSentToday = (demoState.stats.smsSentToday || 0) + randomInt(0, 5);
    
    // Regenerate advisories based on current farm state
    if (Math.random() > 0.8) {
        demoState.advisories = generateDynamicAdvisories(demoState.farms);
    }
    
    // Update display
    displayFarms(demoState.farms);
    displayAdvisories(demoState.advisories);
    updateSystemStats(demoState.stats);
    updateWeatherData(demoState.weather);
    updateSatelliteData(demoState.satellite);
}

// Demo data loader
function loadDemoData() {
    document.getElementById('dashboard').style.display = 'block';
    document.getElementById('config-alert').innerHTML = '<strong>Demo Mode:</strong> Showing dynamic simulated data. Data updates every 5 seconds.';
    document.getElementById('config-alert').className = 'alert info';
    document.getElementById('config-alert').style.display = 'block';
    
    // Generate initial data
    demoState.farms = generateDynamicFarms();
    demoState.advisories = generateDynamicAdvisories(demoState.farms);
    demoState.weather = generateDynamicWeather();
    demoState.satellite = generateDynamicSatellite();
    demoState.stats = generateDynamicStats();
    
    // Display initial data
    displayFarms(demoState.farms);
    displayAdvisories(demoState.advisories);
    updateSystemStats(demoState.stats);
    updateWeatherData(demoState.weather);
    updateSatelliteData(demoState.satellite);
    
    // Clear any existing interval
    if (demoState.updateInterval) {
        clearInterval(demoState.updateInterval);
    }
    
    // Start periodic updates (every 5 seconds)
    demoState.updateInterval = setInterval(updateDemoData, 5000);
    
    // Show stop button, hide resume button
    document.getElementById('stopDemoBtn').style.display = 'inline-block';
    document.getElementById('resumeDemoBtn').style.display = 'none';
    
    console.log('🌾 Dynamic demo mode activated! Data will update every 5 seconds.');
}

// Stop demo updates
function stopDemo() {
    if (demoState.updateInterval) {
        clearInterval(demoState.updateInterval);
        demoState.updateInterval = null;
    }
    
    document.getElementById('config-alert').innerHTML = '<strong>Demo Paused:</strong> Data updates stopped. Click "Resume Demo" to continue.';
    document.getElementById('config-alert').className = 'alert info';
    
    // Show resume button, hide stop button
    document.getElementById('stopDemoBtn').style.display = 'none';
    document.getElementById('resumeDemoBtn').style.display = 'inline-block';
    
    console.log('⏸️ Demo paused');
}

// Resume demo updates
function resumeDemo() {
    if (!demoState.updateInterval) {
        demoState.updateInterval = setInterval(updateDemoData, 5000);
    }
    
    document.getElementById('config-alert').innerHTML = '<strong>Demo Mode:</strong> Showing dynamic simulated data. Data updates every 5 seconds.';
    document.getElementById('config-alert').className = 'alert info';
    
    // Show stop button, hide resume button
    document.getElementById('stopDemoBtn').style.display = 'inline-block';
    document.getElementById('resumeDemoBtn').style.display = 'none';
    
    console.log('▶️ Demo resumed');
}
