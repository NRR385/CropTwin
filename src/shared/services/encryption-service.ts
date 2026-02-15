/**
 * Encryption Service for CropTwin Platform
 * Provides data encryption and decryption for storage and transmission
 * Implements Requirement 8.1: Data encryption for all storage and transmission
 */

import * as crypto from 'crypto';

export interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
}

export interface EncryptedData {
  encryptedContent: string;
  iv: string;
  authTag?: string;
  algorithm: string;
}

export class EncryptionService {
  private algorithm: string;
  private keyLength: number;
  private ivLength: number;
  private encryptionKey: Buffer;

  constructor(config?: Partial<EncryptionConfig>) {
    this.algorithm = config?.algorithm || 'aes-256-gcm';
    this.keyLength = config?.keyLength || 32; // 256 bits
    this.ivLength = config?.ivLength || 16; // 128 bits

    // In production, this should come from AWS KMS or Secrets Manager
    const keyString = process.env.ENCRYPTION_KEY || this.generateDefaultKey();
    this.encryptionKey = Buffer.from(keyString, 'hex');

    if (this.encryptionKey.length !== this.keyLength) {
      throw new Error(`Encryption key must be ${this.keyLength} bytes`);
    }
  }

  /**
   * Generate a default encryption key for development
   * In production, use AWS KMS or Secrets Manager
   */
  private generateDefaultKey(): string {
    return crypto.randomBytes(this.keyLength).toString('hex');
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  encrypt(data: string): EncryptedData {
    try {
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv) as crypto.CipherGCM;

      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      return {
        encryptedContent: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        algorithm: this.algorithm,
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${(error as Error).message}`);
    }
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  decrypt(encryptedData: EncryptedData): string {
    try {
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv) as crypto.DecipherGCM;

      if (encryptedData.authTag) {
        const authTag = Buffer.from(encryptedData.authTag, 'hex');
        decipher.setAuthTag(authTag);
      }

      let decrypted = decipher.update(encryptedData.encryptedContent, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${(error as Error).message}`);
    }
  }

  /**
   * Encrypt an object by converting to JSON first
   */
  encryptObject<T>(obj: T): EncryptedData {
    const jsonString = JSON.stringify(obj);
    return this.encrypt(jsonString);
  }

  /**
   * Decrypt an object by parsing JSON after decryption
   */
  decryptObject<T>(encryptedData: EncryptedData): T {
    const jsonString = this.decrypt(encryptedData);
    return JSON.parse(jsonString) as T;
  }

  /**
   * Hash sensitive data for comparison without storing plaintext
   */
  hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate a secure random token
   */
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Encrypt data for transmission (includes timestamp and signature)
   */
  encryptForTransmission(data: string): string {
    const timestamp = Date.now();
    const payload = JSON.stringify({ data, timestamp });
    const encrypted = this.encrypt(payload);
    return Buffer.from(JSON.stringify(encrypted)).toString('base64');
  }

  /**
   * Decrypt data received from transmission
   */
  decryptFromTransmission(encryptedPayload: string, maxAgeMs: number = 300000): string {
    try {
      const encryptedData = JSON.parse(
        Buffer.from(encryptedPayload, 'base64').toString('utf8')
      ) as EncryptedData;

      const decrypted = this.decrypt(encryptedData);
      const payload = JSON.parse(decrypted);

      // Verify timestamp to prevent replay attacks
      const age = Date.now() - payload.timestamp;
      if (age > maxAgeMs) {
        throw new Error('Encrypted payload has expired');
      }

      return payload.data;
    } catch (error) {
      throw new Error(`Transmission decryption failed: ${(error as Error).message}`);
    }
  }
}
