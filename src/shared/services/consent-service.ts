/**
 * Consent Management Service for CropTwin Platform
 * Manages farmer consent for data sharing and usage
 * Implements Requirement 8.2: Explicit consent before sharing individual farm data
 */

import { DynamoDBHelper } from '../utils/dynamodb-helper';

export enum ConsentType {
  DATA_COLLECTION = 'data_collection',
  REGIONAL_ANALYTICS = 'regional_analytics',
  RESEARCH_SHARING = 'research_sharing',
  GOVERNMENT_SHARING = 'government_sharing',
  NGO_SHARING = 'ngo_sharing',
  THIRD_PARTY_SHARING = 'third_party_sharing',
}

export enum ConsentStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  REVOKED = 'revoked',
  PENDING = 'pending',
}

export interface ConsentRecord {
  farmerId: string;
  consentType: ConsentType;
  status: ConsentStatus;
  grantedAt?: Date;
  revokedAt?: Date;
  expiresAt?: Date;
  purpose: string;
  dataCategories: string[];
  version: string; // Terms version
  metadata?: Record<string, any>;
}

export interface ConsentRequest {
  farmerId: string;
  consentType: ConsentType;
  purpose: string;
  dataCategories: string[];
  expiresInDays?: number;
}

export interface ConsentValidation {
  isValid: boolean;
  consentRecord?: ConsentRecord;
  reason?: string;
}

export class ConsentService {
  private dbHelper: DynamoDBHelper;
  private tableName: string;
  private currentTermsVersion: string;

  constructor() {
    this.dbHelper = new DynamoDBHelper();
    this.tableName = process.env.CONSENT_TABLE_NAME || 'CropTwin-Consent';
    this.currentTermsVersion = '1.0.0';
  }

  /**
   * Request consent from a farmer
   */
  async requestConsent(request: ConsentRequest): Promise<ConsentRecord> {
    const consentId = `${request.farmerId}#${request.consentType}`;

    const consentRecord: ConsentRecord = {
      farmerId: request.farmerId,
      consentType: request.consentType,
      status: ConsentStatus.PENDING,
      purpose: request.purpose,
      dataCategories: request.dataCategories,
      version: this.currentTermsVersion,
      expiresAt: request.expiresInDays
        ? new Date(Date.now() + request.expiresInDays * 24 * 60 * 60 * 1000)
        : undefined,
    };

    await this.dbHelper.putItem(this.tableName, {
      consentId,
      ...consentRecord,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return consentRecord;
  }

  /**
   * Grant consent
   */
  async grantConsent(
    farmerId: string,
    consentType: ConsentType,
    expiresInDays?: number
  ): Promise<ConsentRecord> {
    const consentId = `${farmerId}#${consentType}`;
    const now = new Date();

    const updateExpression =
      'SET #status = :status, grantedAt = :grantedAt, updatedAt = :updatedAt' +
      (expiresInDays ? ', expiresAt = :expiresAt' : '');

    const expressionAttributeValues: any = {
      ':status': ConsentStatus.GRANTED,
      ':grantedAt': now.toISOString(),
      ':updatedAt': now.toISOString(),
    };

    if (expiresInDays) {
      expressionAttributeValues[':expiresAt'] = new Date(
        now.getTime() + expiresInDays * 24 * 60 * 60 * 1000
      ).toISOString();
    }

    const updated = await this.dbHelper.updateItem(
      this.tableName,
      { consentId },
      updateExpression,
      expressionAttributeValues,
      { '#status': 'status' }
    );

    return this.mapToConsentRecord(updated);
  }

  /**
   * Revoke consent
   */
  async revokeConsent(farmerId: string, consentType: ConsentType): Promise<ConsentRecord> {
    const consentId = `${farmerId}#${consentType}`;
    const now = new Date();

    const updated = await this.dbHelper.updateItem(
      this.tableName,
      { consentId },
      'SET #status = :status, revokedAt = :revokedAt, updatedAt = :updatedAt',
      {
        ':status': ConsentStatus.REVOKED,
        ':revokedAt': now.toISOString(),
        ':updatedAt': now.toISOString(),
      },
      { '#status': 'status' }
    );

    return this.mapToConsentRecord(updated);
  }

  /**
   * Check if farmer has granted consent for a specific type
   */
  async hasConsent(farmerId: string, consentType: ConsentType): Promise<boolean> {
    const validation = await this.validateConsent(farmerId, consentType);
    return validation.isValid;
  }

  /**
   * Validate consent with expiration check
   */
  async validateConsent(farmerId: string, consentType: ConsentType): Promise<ConsentValidation> {
    const consentId = `${farmerId}#${consentType}`;

    try {
      const record = await this.dbHelper.getItem(this.tableName, { consentId });

      if (!record) {
        return {
          isValid: false,
          reason: 'No consent record found',
        };
      }

      const consentRecord = this.mapToConsentRecord(record);

      // Check if consent is granted
      if (consentRecord.status !== ConsentStatus.GRANTED) {
        return {
          isValid: false,
          consentRecord,
          reason: `Consent status is ${consentRecord.status}`,
        };
      }

      // Check if consent has expired
      if (consentRecord.expiresAt && new Date(consentRecord.expiresAt) < new Date()) {
        return {
          isValid: false,
          consentRecord,
          reason: 'Consent has expired',
        };
      }

      return {
        isValid: true,
        consentRecord,
      };
    } catch (error) {
      return {
        isValid: false,
        reason: `Error validating consent: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get all consents for a farmer
   */
  async getFarmerConsents(farmerId: string): Promise<ConsentRecord[]> {
    const items = await this.dbHelper.queryItems(
      this.tableName,
      'farmerId = :farmerId',
      { ':farmerId': farmerId },
      'FarmerIdIndex' // Assumes GSI exists
    );

    return items.map(item => this.mapToConsentRecord(item));
  }

  /**
   * Get consent record
   */
  async getConsentRecord(farmerId: string, consentType: ConsentType): Promise<ConsentRecord | null> {
    const consentId = `${farmerId}#${consentType}`;
    const record = await this.dbHelper.getItem(this.tableName, { consentId });

    return record ? this.mapToConsentRecord(record) : null;
  }

  /**
   * Check if data can be shared based on consent
   */
  async canShareData(
    farmerId: string,
    purpose: 'regional_analytics' | 'research' | 'government' | 'ngo' | 'third_party'
  ): Promise<boolean> {
    const consentTypeMap: Record<string, ConsentType> = {
      regional_analytics: ConsentType.REGIONAL_ANALYTICS,
      research: ConsentType.RESEARCH_SHARING,
      government: ConsentType.GOVERNMENT_SHARING,
      ngo: ConsentType.NGO_SHARING,
      third_party: ConsentType.THIRD_PARTY_SHARING,
    };

    const consentType = consentTypeMap[purpose];
    if (!consentType) {
      return false;
    }

    return this.hasConsent(farmerId, consentType);
  }

  /**
   * Bulk consent validation for multiple farmers
   */
  async validateBulkConsent(
    farmerIds: string[],
    consentType: ConsentType
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    await Promise.all(
      farmerIds.map(async farmerId => {
        const hasConsent = await this.hasConsent(farmerId, consentType);
        results.set(farmerId, hasConsent);
      })
    );

    return results;
  }

  /**
   * Map database item to ConsentRecord
   */
  private mapToConsentRecord(item: any): ConsentRecord {
    return {
      farmerId: item.farmerId,
      consentType: item.consentType,
      status: item.status,
      grantedAt: item.grantedAt ? new Date(item.grantedAt) : undefined,
      revokedAt: item.revokedAt ? new Date(item.revokedAt) : undefined,
      expiresAt: item.expiresAt ? new Date(item.expiresAt) : undefined,
      purpose: item.purpose,
      dataCategories: item.dataCategories || [],
      version: item.version,
      metadata: item.metadata,
    };
  }
}
