/**
 * Core data types for the CropTwin Digital Twin Platform
 * These interfaces define the fundamental data structures used throughout the system
 */

// Geographic and location types
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Location extends Coordinates {
  district: string;
  state: string;
  country?: string;
}

export interface GeographicRegion {
  name: string;
  boundaries: Coordinates[];
  administrativeLevel: 'district' | 'state' | 'country';
}

// Enumeration types
export enum CropType {
  RICE = 'rice',
  WHEAT = 'wheat',
  MAIZE = 'maize',
  COTTON = 'cotton',
  SUGARCANE = 'sugarcane',
  SOYBEAN = 'soybean',
  GROUNDNUT = 'groundnut',
  PULSES = 'pulses',
  VEGETABLES = 'vegetables',
  FRUITS = 'fruits'
}

export enum CropStage {
  GERMINATION = 'germination',
  VEGETATIVE = 'vegetative',
  FLOWERING = 'flowering',
  FRUITING = 'fruiting',
  GRAIN_FILLING = 'grain_filling',
  MATURITY = 'maturity',
  HARVEST_READY = 'harvest_ready'
}

export enum IrrigationType {
  RAINFED = 'rainfed',
  DRIP = 'drip',
  SPRINKLER = 'sprinkler',
  FLOOD = 'flood',
  FURROW = 'furrow'
}

export enum SoilType {
  CLAY = 'clay',
  LOAM = 'loam',
  SANDY = 'sandy',
  SILT = 'silt',
  CLAY_LOAM = 'clay_loam',
  SANDY_LOAM = 'sandy_loam',
  SILT_LOAM = 'silt_loam'
}

export enum AdvisoryType {
  ALERT = 'alert',
  RECOMMENDATION = 'recommendation',
  INFORMATION = 'information'
}

export enum Priority {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export enum AdvisoryCategory {
  IRRIGATION = 'irrigation',
  FERTILIZATION = 'fertilization',
  PEST_CONTROL = 'pest_control',
  DISEASE_MANAGEMENT = 'disease_management',
  HARVESTING = 'harvesting',
  SOIL_MANAGEMENT = 'soil_management',
  WEATHER_ALERT = 'weather_alert',
  GENERAL = 'general'
}

export enum Language {
  ENGLISH = 'en',
  HINDI = 'hi',
  TAMIL = 'ta',
  TELUGU = 'te',
  KANNADA = 'kn',
  MARATHI = 'mr',
  GUJARATI = 'gu',
  BENGALI = 'bn',
  PUNJABI = 'pa',
  MALAYALAM = 'ml'
}

export enum CommunicationChannel {
  SMS = 'sms',
  IVR = 'ivr',
  MOBILE_APP = 'mobile_app',
  VOICE_UPDATE = 'voice_update'
}

export enum UserRole {
  FARMER = 'farmer',
  EXTENSION_OFFICER = 'extension_officer',
  GOVERNMENT_OFFICIAL = 'government_official',
  NGO_WORKER = 'ngo_worker',
  RESEARCHER = 'researcher'
}

export enum IndianState {
  ANDHRA_PRADESH = 'andhra_pradesh',
  ARUNACHAL_PRADESH = 'arunachal_pradesh',
  ASSAM = 'assam',
  BIHAR = 'bihar',
  CHHATTISGARH = 'chhattisgarh',
  DELHI = 'delhi', // Union Territory
  GOA = 'goa',
  GUJARAT = 'gujarat',
  HARYANA = 'haryana',
  HIMACHAL_PRADESH = 'himachal_pradesh',
  JHARKHAND = 'jharkhand',
  KARNATAKA = 'karnataka',
  KERALA = 'kerala',
  MADHYA_PRADESH = 'madhya_pradesh',
  MAHARASHTRA = 'maharashtra',
  MANIPUR = 'manipur',
  MEGHALAYA = 'meghalaya',
  MIZORAM = 'mizoram',
  NAGALAND = 'nagaland',
  ODISHA = 'odisha',
  PUNJAB = 'punjab',
  RAJASTHAN = 'rajasthan',
  SIKKIM = 'sikkim',
  TAMIL_NADU = 'tamil_nadu',
  TELANGANA = 'telangana',
  TRIPURA = 'tripura',
  UTTAR_PRADESH = 'uttar_pradesh',
  UTTARAKHAND = 'uttarakhand',
  WEST_BENGAL = 'west_bengal'
}

// Temperature range type
export interface TemperatureRange {
  min: number;
  max: number;
  average: number;
}

// Validation result type
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Delivery and status types
export interface DeliveryStatus {
  messageId: string;
  status: 'sent' | 'delivered' | 'failed' | 'pending';
  timestamp: Date;
  errorMessage?: string;
}

export interface CallStatus {
  callId: string;
  status: 'initiated' | 'connected' | 'completed' | 'failed';
  duration?: number;
  timestamp: Date;
  errorMessage?: string;
}