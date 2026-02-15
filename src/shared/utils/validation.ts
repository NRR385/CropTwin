/**
 * Validation utilities for CropTwin platform
 * Provides input validation functions for various data types
 */

import { ValidationResult, Location, CropType, IndianState } from '../../types';
import { Coordinates } from '../../types/core';

/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validator class that provides static validation methods
 */
export class Validator {
  /**
   * Validate farmer ID
   */
  static validateFarmerId(farmerId: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!farmerId || typeof farmerId !== 'string') {
      errors.push('Farmer ID is required and must be a string');
    } else if (farmerId.length < 3) {
      errors.push('Farmer ID must be at least 3 characters long');
    } else if (farmerId.length > 50) {
      errors.push('Farmer ID must be less than 50 characters');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate required string field
   */
  static validateRequiredString(value: string, fieldName: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!value || typeof value !== 'string') {
      errors.push(`${fieldName} is required and must be a string`);
    } else if (value.trim().length === 0) {
      errors.push(`${fieldName} cannot be empty`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate planting date
   */
  static validatePlantingDate(date: Date): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      errors.push('Planting date must be a valid date');
    } else {
      const now = new Date();
      const futureLimit = new Date();
      futureLimit.setFullYear(futureLimit.getFullYear() + 1);
      const pastLimit = new Date();
      pastLimit.setFullYear(pastLimit.getFullYear() - 2);

      if (date > futureLimit) {
        errors.push('Planting date cannot be more than 1 year in the future');
      } else if (date < pastLimit) {
        errors.push('Planting date cannot be more than 2 years in the past');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate crop type
   */
  static validateCropType(cropType: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!cropType) {
      errors.push('Crop type is required');
    } else if (!Object.values(CropType).includes(cropType)) {
      errors.push(`Invalid crop type: ${cropType}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate irrigation type
   */
  static validateIrrigationType(irrigationType: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!irrigationType) {
      errors.push('Irrigation type is required');
    } else {
      const validTypes = ['rainfed', 'irrigated', 'drip', 'sprinkler', 'flood'];
      if (!validTypes.includes(irrigationType)) {
        errors.push(`Invalid irrigation type: ${irrigationType}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate soil type
   */
  static validateSoilType(soilType: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!soilType) {
      errors.push('Soil type is required');
    } else {
      const validTypes = ['clay', 'loam', 'sand', 'silt', 'peat', 'chalk'];
      if (!validTypes.includes(soilType)) {
        errors.push(`Invalid soil type: ${soilType}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Combine multiple validation results
   */
  static combineValidationResults(results: ValidationResult[]): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    for (const result of results) {
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }

    return {
      isValid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings
    };
  }

  /**
   * Throw error if validation fails
   */
  static throwIfInvalid(result: ValidationResult): void {
    if (!result.isValid) {
      throw new ValidationError(result.errors.join('; '));
    }
  }

  /**
   * Validate coordinates
   */
  static validateCoordinates(coordinates: Coordinates): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof coordinates.latitude !== 'number' || coordinates.latitude < -90 || coordinates.latitude > 90) {
      errors.push('Invalid latitude: must be between -90 and 90');
    }

    if (typeof coordinates.longitude !== 'number' || coordinates.longitude < -180 || coordinates.longitude > 180) {
      errors.push('Invalid longitude: must be between -180 and 180');
    }

    // Add warnings for coordinates outside India bounds
    if (coordinates.latitude < 6 || coordinates.latitude > 37) {
      warnings.push('Latitude is outside typical India bounds (6-37°N)');
    }

    if (coordinates.longitude < 68 || coordinates.longitude > 97) {
      warnings.push('Longitude is outside typical India bounds (68-97°E)');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate farm size
   */
  static validateFarmSize(size: number): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof size !== 'number' || size <= 0) {
      errors.push('Farm size must be a positive number');
    } else if (size > 100) {
      warnings.push('Farm size is unusually large for smallholder farming');
    } else if (size < 0.1) {
      warnings.push('Farm size is very small');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate stress indicators
   */
  static validateStressIndicators(indicators: any): ValidationResult {
    const errors: string[] = [];
    const stressTypes = ['waterStress', 'heatStress', 'nutrientStress', 'pestRisk', 'diseaseRisk'];

    stressTypes.forEach(type => {
      const value = indicators[type];
      if (typeof value !== 'number' || value < 0 || value > 1) {
        errors.push(`${type} must be a number between 0 and 1`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings: []
    };
  }
}

/**
 * Validate input data with custom validation rules
 */
export function validateInput(data: any, rules: ValidationRule[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  rules.forEach(rule => {
    const result = rule.validate(data);
    if (!result.isValid) {
      errors.push(...result.errors);
    }
    if (result.warnings) {
      warnings.push(...result.warnings);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validation rule interface
 */
export interface ValidationRule {
  name: string;
  validate: (data: any) => ValidationResult;
}

/**
 * Common validation rules
 */
export const ValidationRules = {
  required: (field: string): ValidationRule => ({
    name: `required_${field}`,
    validate: (data: any) => ({
      isValid: data && data[field] !== undefined && data[field] !== null && data[field] !== '',
      errors: data && data[field] !== undefined && data[field] !== null && data[field] !== '' 
        ? [] 
        : [`${field} is required`],
      warnings: []
    })
  }),

  location: (): ValidationRule => ({
    name: 'location',
    validate: (data: any) => {
      const errors: string[] = [];
      const location = data as Location;

      if (!location) {
        errors.push('Location is required');
        return { isValid: false, errors, warnings: [] };
      }

      if (typeof location.latitude !== 'number' || location.latitude < -90 || location.latitude > 90) {
        errors.push('Invalid latitude');
      }

      if (typeof location.longitude !== 'number' || location.longitude < -180 || location.longitude > 180) {
        errors.push('Invalid longitude');
      }

      if (!location.district || typeof location.district !== 'string') {
        errors.push('District is required');
      }

      if (!location.state || typeof location.state !== 'string') {
        errors.push('State is required');
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings: []
      };
    }
  }),

  cropType: (): ValidationRule => ({
    name: 'cropType',
    validate: (data: any) => {
      const validCropTypes = Object.values(CropType);
      const isValid = validCropTypes.includes(data);
      
      return {
        isValid,
        errors: isValid ? [] : [`Invalid crop type: ${data}`],
        warnings: []
      };
    }
  }),

  indianState: (): ValidationRule => ({
    name: 'indianState',
    validate: (data: any) => {
      const validStates = Object.values(IndianState);
      const isValid = validStates.includes(data);
      
      return {
        isValid,
        errors: isValid ? [] : [`Invalid Indian state: ${data}`],
        warnings: []
      };
    }
  }),

  dateRange: (startField: string, endField: string): ValidationRule => ({
    name: `dateRange_${startField}_${endField}`,
    validate: (data: any) => {
      const errors: string[] = [];
      const startDate = data[startField];
      const endDate = data[endField];

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start.getTime())) {
          errors.push(`Invalid start date: ${startField}`);
        }

        if (isNaN(end.getTime())) {
          errors.push(`Invalid end date: ${endField}`);
        }

        if (start.getTime() >= end.getTime()) {
          errors.push(`Start date must be before end date`);
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings: []
      };
    }
  }),

  positiveNumber: (field: string): ValidationRule => ({
    name: `positiveNumber_${field}`,
    validate: (data: any) => {
      const value = data[field];
      const isValid = typeof value === 'number' && value > 0;
      
      return {
        isValid,
        errors: isValid ? [] : [`${field} must be a positive number`],
        warnings: []
      };
    }
  }),

  range: (field: string, min: number, max: number): ValidationRule => ({
    name: `range_${field}_${min}_${max}`,
    validate: (data: any) => {
      const value = data[field];
      const isValid = typeof value === 'number' && value >= min && value <= max;
      
      return {
        isValid,
        errors: isValid ? [] : [`${field} must be between ${min} and ${max}`],
        warnings: []
      };
    }
  }),

  arrayNotEmpty: (field: string): ValidationRule => ({
    name: `arrayNotEmpty_${field}`,
    validate: (data: any) => {
      const value = data[field];
      const isValid = Array.isArray(value) && value.length > 0;
      
      return {
        isValid,
        errors: isValid ? [] : [`${field} must be a non-empty array`],
        warnings: []
      };
    }
  })
};

/**
 * Validate farm twin data
 */
export function validateFarmTwin(farmTwin: any): ValidationResult {
  const rules = [
    ValidationRules.required('twinId'),
    ValidationRules.required('farmerId'),
    ValidationRules.required('location'),
    ValidationRules.required('farmConfiguration'),
    ValidationRules.required('currentState'),
    ValidationRules.location()
  ];

  return validateInput(farmTwin, rules);
}

/**
 * Validate regional aggregation request
 */
export function validateRegionalAggregationRequest(request: any): ValidationResult {
  const rules = [
    ValidationRules.required('region'),
    ValidationRules.required('aggregationLevel')
  ];

  if (request.timeRange) {
    rules.push(ValidationRules.dateRange('startDate', 'endDate'));
  }

  return validateInput(request, rules);
}

/**
 * Validate coordinates
 */
export function validateCoordinates(lat: number, lon: number): ValidationResult {
  const errors: string[] = [];

  if (typeof lat !== 'number' || lat < -90 || lat > 90) {
    errors.push('Invalid latitude: must be between -90 and 90');
  }

  if (typeof lon !== 'number' || lon < -180 || lon > 180) {
    errors.push('Invalid longitude: must be between -180 and 180');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: []
  };
}

/**
 * Validate farm size
 */
export function validateFarmSize(size: number): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof size !== 'number' || size <= 0) {
    errors.push('Farm size must be a positive number');
  } else if (size > 100) {
    warnings.push('Farm size is unusually large for smallholder farming');
  } else if (size < 0.1) {
    warnings.push('Farm size is very small');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate stress indicators
 */
export function validateStressIndicators(indicators: any): ValidationResult {
  const errors: string[] = [];
  const stressTypes = ['waterStress', 'heatStress', 'nutrientStress', 'pestRisk', 'diseaseRisk'];

  stressTypes.forEach(type => {
    const value = indicators[type];
    if (typeof value !== 'number' || value < 0 || value > 1) {
      errors.push(`${type} must be a number between 0 and 1`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings: []
  };
}