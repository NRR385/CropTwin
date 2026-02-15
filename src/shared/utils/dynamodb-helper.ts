/**
 * DynamoDB helper utilities for CropTwin platform
 * Provides common database operations with error handling and type safety
 */

import { DynamoDB } from 'aws-sdk';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';

export class DynamoDBHelper {
  private docClient: DocumentClient;

  constructor() {
    this.docClient = new DynamoDB.DocumentClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Put an item into a DynamoDB table
   */
  async putItem(tableName: string, item: any): Promise<void> {
    const params: DocumentClient.PutItemInput = {
      TableName: tableName,
      Item: {
        ...item,
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    try {
      await this.docClient.put(params).promise();
    } catch (error) {
      console.error(`Error putting item to ${tableName}:`, error);
      throw new Error(`Failed to put item to ${tableName}: ${(error as Error).message}`);
    }
  }

  /**
   * Get an item from a DynamoDB table
   */
  async getItem(tableName: string, key: any): Promise<any | null> {
    const params: DocumentClient.GetItemInput = {
      TableName: tableName,
      Key: key,
    };

    try {
      const result = await this.docClient.get(params).promise();
      return result.Item || null;
    } catch (error) {
      console.error(`Error getting item from ${tableName}:`, error);
      throw new Error(`Failed to get item from ${tableName}: ${(error as Error).message}`);
    }
  }

  /**
   * Update an item in a DynamoDB table
   */
  async updateItem(
    tableName: string,
    key: any,
    updateExpression: string,
    expressionAttributeValues: any,
    expressionAttributeNames?: any
  ): Promise<any> {
    const params: DocumentClient.UpdateItemInput = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ':updatedAt': new Date().toISOString(),
      },
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: 'ALL_NEW',
    };

    try {
      const result = await this.docClient.update(params).promise();
      return result.Attributes;
    } catch (error) {
      console.error(`Error updating item in ${tableName}:`, error);
      throw new Error(`Failed to update item in ${tableName}: ${(error as Error).message}`);
    }
  }

  /**
   * Simple update method that takes an object of attributes to update
   */
  async simpleUpdate(tableName: string, key: any, updates: any): Promise<any> {
    const updateExpressions: string[] = [];
    const expressionAttributeValues: any = {};
    const expressionAttributeNames: any = {};
    
    let index = 0;
    for (const [field, value] of Object.entries(updates)) {
      const attrName = `#attr${index}`;
      const attrValue = `:val${index}`;
      updateExpressions.push(`${attrName} = ${attrValue}`);
      expressionAttributeNames[attrName] = field;
      expressionAttributeValues[attrValue] = value;
      index++;
    }
    
    const updateExpression = `SET ${updateExpressions.join(', ')}, #updatedAt = :updatedAt`;
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();
    
    return this.updateItem(
      tableName,
      key,
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    );
  }

  /**
   * Delete an item from a DynamoDB table
   */
  async deleteItem(tableName: string, key: any): Promise<void> {
    const params: DocumentClient.DeleteItemInput = {
      TableName: tableName,
      Key: key,
    };

    try {
      await this.docClient.delete(params).promise();
    } catch (error) {
      console.error(`Error deleting item from ${tableName}:`, error);
      throw new Error(`Failed to delete item from ${tableName}: ${(error as Error).message}`);
    }
  }

  /**
   * Query items from a DynamoDB table
   */
  async queryItems(
    tableName: string,
    keyConditionExpression: string,
    expressionAttributeValues: any,
    indexName?: string,
    limit?: number,
    scanIndexForward?: boolean
  ): Promise<any[]> {
    const params: DocumentClient.QueryInput = {
      TableName: tableName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      IndexName: indexName,
      Limit: limit,
      ScanIndexForward: scanIndexForward,
    };

    try {
      const result = await this.docClient.query(params).promise();
      return result.Items || [];
    } catch (error) {
      console.error(`Error querying items from ${tableName}:`, error);
      throw new Error(`Failed to query items from ${tableName}: ${(error as Error).message}`);
    }
  }

  /**
   * Simple query method (alias for queryItems)
   */
  async query(
    tableName: string,
    keyConditionExpression: string,
    expressionAttributeValues?: any
  ): Promise<any[]> {
    return this.queryItems(tableName, keyConditionExpression, expressionAttributeValues || {});
  }

  /**
   * Scan items from a DynamoDB table (use sparingly)
   */
  async scanItems(
    tableName: string,
    filterExpression?: string,
    expressionAttributeValues?: any,
    limit?: number
  ): Promise<any[]> {
    const params: DocumentClient.ScanInput = {
      TableName: tableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit,
    };

    try {
      const result = await this.docClient.scan(params).promise();
      return result.Items || [];
    } catch (error) {
      console.error(`Error scanning items from ${tableName}:`, error);
      throw new Error(`Failed to scan items from ${tableName}: ${(error as Error).message}`);
    }
  }

  /**
   * Batch write items to DynamoDB
   */
  async batchWriteItems(tableName: string, items: any[]): Promise<void> {
    const batchSize = 25; // DynamoDB batch write limit
    const batches = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const params: DocumentClient.BatchWriteItemInput = {
        RequestItems: {
          [tableName]: batch.map(item => ({
            PutRequest: {
              Item: {
                ...item,
                createdAt: item.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
          })),
        },
      };

      try {
        await this.docClient.batchWrite(params).promise();
      } catch (error) {
        console.error(`Error batch writing items to ${tableName}:`, error);
        throw new Error(`Failed to batch write items to ${tableName}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Generate TTL timestamp for DynamoDB items
   */
  generateTTL(daysFromNow: number): number {
    const now = new Date();
    const ttlDate = new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
    return Math.floor(ttlDate.getTime() / 1000);
  }

  /**
   * Create a composite key for external data
   */
  createExternalDataKey(dataType: string, location: string, date: string): string {
    return `${dataType}#${location}#${date}`;
  }

  /**
   * Parse a composite key for external data
   */
  parseExternalDataKey(key: string): { dataType: string; location: string; date: string } {
    const parts = key.split('#');
    if (parts.length !== 3) {
      throw new Error(`Invalid external data key format: ${key}`);
    }
    return {
      dataType: parts[0],
      location: parts[1],
      date: parts[2],
    };
  }
}