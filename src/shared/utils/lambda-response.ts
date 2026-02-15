/**
 * Lambda response utilities for consistent API responses
 */

import { APIGatewayProxyResult } from 'aws-lambda';

export interface ApiResponse {
  statusCode: number;
  body: string;
  headers?: { [key: string]: string };
}

export class LambdaResponse {
  private static defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };

  /**
   * Create a successful response
   */
  static success(data: any, statusCode: number = 200): APIGatewayProxyResult {
    return {
      statusCode,
      headers: this.defaultHeaders,
      body: JSON.stringify({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  /**
   * Create an error response
   */
  static error(message: string, statusCode: number = 500, details?: any): APIGatewayProxyResult {
    return {
      statusCode,
      headers: this.defaultHeaders,
      body: JSON.stringify({
        success: false,
        error: {
          message,
          details,
        },
        timestamp: new Date().toISOString(),
      }),
    };
  }

  /**
   * Create a validation error response
   */
  static validationError(errors: string[]): APIGatewayProxyResult {
    return this.error('Validation failed', 400, { validationErrors: errors });
  }

  /**
   * Create a not found response
   */
  static notFound(resource: string): APIGatewayProxyResult {
    return this.error(`${resource} not found`, 404);
  }

  /**
   * Create an unauthorized response
   */
  static unauthorized(message: string = 'Unauthorized'): APIGatewayProxyResult {
    return this.error(message, 401);
  }

  /**
   * Create a forbidden response
   */
  static forbidden(message: string = 'Forbidden'): APIGatewayProxyResult {
    return this.error(message, 403);
  }

  /**
   * Create a conflict response
   */
  static conflict(message: string): APIGatewayProxyResult {
    return this.error(message, 409);
  }

  /**
   * Create a rate limit exceeded response
   */
  static rateLimitExceeded(): APIGatewayProxyResult {
    return this.error('Rate limit exceeded', 429);
  }
}

/**
 * Error handler wrapper for Lambda functions
 */
export function handleLambdaError(error: any): APIGatewayProxyResult {
  console.error('Lambda function error:', error);

  if (error.name === 'ValidationError') {
    return LambdaResponse.validationError([error.message]);
  }

  if (error.name === 'NotFoundError') {
    return LambdaResponse.notFound(error.resource || 'Resource');
  }

  if (error.name === 'UnauthorizedError') {
    return LambdaResponse.unauthorized(error.message);
  }

  if (error.name === 'ConflictError') {
    return LambdaResponse.conflict(error.message);
  }

  // Default to internal server error
  return LambdaResponse.error(
    'Internal server error',
    500,
    process.env.NODE_ENV === 'development' ? error.stack : undefined
  );
}