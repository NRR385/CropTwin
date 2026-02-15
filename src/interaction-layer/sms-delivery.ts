/**
 * SMS Advisory Delivery System
 * Handles SMS message formatting, delivery, and tracking using Amazon SNS
 * Requirements: 5.1, 5.6
 */

import { SNS } from 'aws-sdk';
import { 
  FormattedAdvisory, 
  DeliveryInstructions, 
  CommunicationPreferences 
} from '../types/advisory';
import { 
  AdvisoryType, 
  Priority, 
  CommunicationChannel, 
  Language 
} from '../types/core';
import { Logger, createLambdaLogger } from '../shared/utils/logger';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { TABLE_NAMES } from '../shared/config/constants';
import { manualTrackAdvisoryDelivery } from '../shared/services/performance-integration';

export interface SMSDeliveryConfig {
  maxMessageLength: number;
  retryAttempts: number;
  retryDelayMinutes: number;
  enableDeliveryReports: boolean;
  fallbackToVoice: boolean;
}

export interface SMSMessage {
  messageId: string;
  advisoryId: string;
  farmerId: string;
  phoneNumber: string;
  content: string;
  priority: Priority;
  language: Language;
  scheduledTime?: Date;
  expiryTime?: Date;
  deliveryStatus: SMSDeliveryStatus;
  attempts: number;
  createdAt: Date;
  deliveredAt?: Date;
  failureReason?: string;
}

export enum SMSDeliveryStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  EXPIRED = 'expired'
}

export interface DeliveryReport {
  messageId: string;
  status: SMSDeliveryStatus;
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
  cost?: number;
}

export class SMSDeliveryService {
  private sns: SNS;
  private logger: Logger;
  private dbHelper: DynamoDBHelper;
  private config: SMSDeliveryConfig;

  constructor(config?: Partial<SMSDeliveryConfig>) {
    this.sns = new SNS({ region: process.env.AWS_REGION || 'ap-south-1' });
    this.logger = createLambdaLogger('SMSDeliveryService');
    this.dbHelper = new DynamoDBHelper();
    this.config = {
      maxMessageLength: 160,
      retryAttempts: 3,
      retryDelayMinutes: 30,
      enableDeliveryReports: true,
      fallbackToVoice: true,
      ...config
    };
  }

  /**
   * Send SMS advisory to farmer
   * Requirements: 5.1, 5.6
   */
  public async sendAdvisory(
    advisory: FormattedAdvisory,
    farmerId: string,
    phoneNumber: string,
    preferences?: CommunicationPreferences,
    detectionTime?: Date
  ): Promise<SMSMessage> {
    const advisoryDetectionTime = detectionTime || new Date();
    this.logger.info(`Sending SMS advisory ${advisory.advisoryId} to farmer ${farmerId}`);

    // Format message content
    const content = this.formatSMSContent(advisory, preferences);
    
    // Create SMS message record
    const smsMessage: SMSMessage = {
      messageId: `sms-${advisory.advisoryId}-${Date.now()}`,
      advisoryId: advisory.advisoryId,
      farmerId,
      phoneNumber: this.sanitizePhoneNumber(phoneNumber),
      content,
      priority: advisory.deliveryInstructions.priority,
      language: advisory.language,
      scheduledTime: advisory.deliveryInstructions.scheduledDelivery,
      expiryTime: advisory.deliveryInstructions.expiryTime,
      deliveryStatus: SMSDeliveryStatus.PENDING,
      attempts: 0,
      createdAt: new Date()
    };

    // Store message record
    await this.dbHelper.putItem(TABLE_NAMES.SMS_MESSAGES, smsMessage);

    // Send immediately or schedule
    if (smsMessage.scheduledTime && smsMessage.scheduledTime > new Date()) {
      await this.scheduleMessage(smsMessage);
    } else {
      await this.sendMessage(smsMessage, advisoryDetectionTime);
    }

    return smsMessage;
  }

  /**
   * Send immediate SMS message
   */
  private async sendMessage(smsMessage: SMSMessage, detectionTime?: Date): Promise<void> {
    try {
      smsMessage.attempts++;
      
      const params: SNS.PublishInput = {
        PhoneNumber: smsMessage.phoneNumber,
        Message: smsMessage.content,
        MessageAttributes: {
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue: 'CropTwin'
          },
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: smsMessage.priority === Priority.HIGH ? 'Transactional' : 'Promotional'
          }
        }
      };

      const result = await this.sns.publish(params).promise();
      const deliveryTime = new Date();
      
      // Update message status
      smsMessage.deliveryStatus = SMSDeliveryStatus.SENT;
      smsMessage.deliveredAt = deliveryTime;
      await this.dbHelper.simpleUpdate(
        TABLE_NAMES.SMS_MESSAGES,
        { messageId: smsMessage.messageId },
        {
          deliveryStatus: SMSDeliveryStatus.SENT,
          attempts: smsMessage.attempts,
          deliveredAt: deliveryTime
        }
      );

      this.logger.info(`SMS sent successfully: ${result.MessageId}`);

      // Track performance (Requirement 7.4)
      if (detectionTime) {
        const priorityStr = smsMessage.priority === Priority.HIGH ? 'high' : 
                           smsMessage.priority === Priority.MEDIUM ? 'medium' : 'low';
        await manualTrackAdvisoryDelivery(
          smsMessage.advisoryId,
          detectionTime,
          deliveryTime,
          priorityStr,
          {
            channel: 'sms',
            farmerId: smsMessage.farmerId,
            attempts: smsMessage.attempts,
            success: true
          }
        ).catch(err => {
          this.logger.warn('Failed to track advisory delivery performance:', err);
          // Don't fail the delivery if performance tracking fails
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send SMS: ${errorMessage}`);
      
      // Update failure status
      smsMessage.deliveryStatus = SMSDeliveryStatus.FAILED;
      smsMessage.failureReason = errorMessage;
      
      await this.dbHelper.simpleUpdate(
        TABLE_NAMES.SMS_MESSAGES,
        { messageId: smsMessage.messageId },
        {
          deliveryStatus: SMSDeliveryStatus.FAILED,
          attempts: smsMessage.attempts,
          failureReason: errorMessage
        }
      );

      // Track failed delivery (Requirement 7.4)
      if (detectionTime) {
        const priorityStr = smsMessage.priority === Priority.HIGH ? 'high' : 
                           smsMessage.priority === Priority.MEDIUM ? 'medium' : 'low';
        await manualTrackAdvisoryDelivery(
          smsMessage.advisoryId,
          detectionTime,
          new Date(),
          priorityStr,
          {
            channel: 'sms',
            farmerId: smsMessage.farmerId,
            attempts: smsMessage.attempts,
            success: false,
            error: errorMessage
          }
        ).catch(err => {
          this.logger.warn('Failed to track failed advisory delivery:', err);
        });
      }

      // Retry if attempts remaining
      if (smsMessage.attempts < this.config.retryAttempts) {
        await this.scheduleRetry(smsMessage);
      } else if (this.config.fallbackToVoice) {
        await this.triggerVoiceFallback(smsMessage);
      }
    }
  }

  /**
   * Schedule message for later delivery
   */
  private async scheduleMessage(smsMessage: SMSMessage): Promise<void> {
    // In a real implementation, this would use EventBridge or SQS with delay
    this.logger.info(`Scheduling SMS ${smsMessage.messageId} for ${smsMessage.scheduledTime}`);
    
    // For now, we'll just log the scheduling
    // In production, you would create an EventBridge rule or SQS message with delay
  }

  /**
   * Schedule retry attempt
   */
  private async scheduleRetry(smsMessage: SMSMessage): Promise<void> {
    const retryTime = new Date(Date.now() + this.config.retryDelayMinutes * 60 * 1000);
    
    this.logger.info(`Scheduling retry for SMS ${smsMessage.messageId} at ${retryTime}`);
    
    // In production, this would schedule the retry using EventBridge or SQS
    // For now, we'll update the message status to indicate retry is scheduled
    await this.dbHelper.simpleUpdate(
      TABLE_NAMES.SMS_MESSAGES,
      { messageId: smsMessage.messageId },
      {
        scheduledTime: retryTime
      }
    );
  }

  /**
   * Trigger voice fallback when SMS fails
   */
  private async triggerVoiceFallback(smsMessage: SMSMessage): Promise<void> {
    this.logger.info(`Triggering voice fallback for failed SMS ${smsMessage.messageId}`);
    
    // In production, this would trigger the IVR system
    // For now, we'll just log the fallback trigger
    await this.dbHelper.putItem(TABLE_NAMES.FALLBACK_REQUESTS, {
      requestId: `fallback-${smsMessage.messageId}`,
      originalMessageId: smsMessage.messageId,
      advisoryId: smsMessage.advisoryId,
      farmerId: smsMessage.farmerId,
      phoneNumber: smsMessage.phoneNumber,
      fallbackChannel: CommunicationChannel.IVR,
      reason: 'SMS delivery failed',
      createdAt: new Date()
    });
  }

  /**
   * Format SMS content based on advisory and preferences
   */
  private formatSMSContent(
    advisory: FormattedAdvisory, 
    preferences?: CommunicationPreferences
  ): string {
    let content = advisory.content.body;
    
    // Apply content preferences
    if (preferences?.contentPreferences.detailLevel === 'basic') {
      content = this.simplifyContent(content);
    }
    
    // Truncate if too long
    if (content.length > this.config.maxMessageLength) {
      content = content.substring(0, this.config.maxMessageLength - 3) + '...';
    }
    
    // Add priority indicator for urgent messages
    if (advisory.deliveryInstructions.priority === Priority.HIGH) {
      content = `🚨 URGENT: ${content}`;
    }
    
    return content;
  }

  /**
   * Simplify content for basic detail level
   */
  private simplifyContent(content: string): string {
    // Remove technical terms and simplify language
    return content
      .replace(/stress indicators?/gi, 'problems')
      .replace(/threshold/gi, 'limit')
      .replace(/simulation/gi, 'prediction')
      .replace(/parameters?/gi, 'settings');
  }

  /**
   * Sanitize and validate phone number
   */
  private sanitizePhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Add country code for India if not present
    if (cleaned.length === 10) {
      cleaned = '+91' + cleaned;
    } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
      cleaned = '+' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Process delivery report from SNS
   */
  public async processDeliveryReport(report: DeliveryReport): Promise<void> {
    this.logger.info(`Processing delivery report for message ${report.messageId}`);
    
    try {
      await this.dbHelper.simpleUpdate(
        TABLE_NAMES.SMS_MESSAGES,
        { messageId: report.messageId },
        {
          deliveryStatus: report.status,
          deliveredAt: report.status === SMSDeliveryStatus.DELIVERED ? report.timestamp : undefined,
          failureReason: report.errorMessage
        }
      );
      
      // Update delivery statistics
      await this.updateDeliveryStats(report);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process delivery report: ${errorMessage}`);
    }
  }

  /**
   * Update delivery statistics for monitoring
   */
  private async updateDeliveryStats(report: DeliveryReport): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const statsKey = `sms-stats-${today}`;
    
    try {
      // Increment counters based on delivery status
      const updateExpression = report.status === SMSDeliveryStatus.DELIVERED 
        ? 'ADD delivered :inc SET lastUpdated = :now'
        : 'ADD failed :inc SET lastUpdated = :now';
      
      await this.dbHelper.updateItem(
        TABLE_NAMES.DELIVERY_STATS,
        { statsKey },
        updateExpression,
        {
          ':inc': 1,
          ':now': new Date()
        }
      );
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to update delivery stats: ${errorMessage}`);
    }
  }

  /**
   * Get delivery statistics for monitoring
   */
  public async getDeliveryStats(date?: string): Promise<any> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const statsKey = `sms-stats-${targetDate}`;
    
    try {
      const stats = await this.dbHelper.getItem(TABLE_NAMES.DELIVERY_STATS, { statsKey });
      return stats || { delivered: 0, failed: 0, date: targetDate };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to get delivery stats: ${errorMessage}`);
      return { delivered: 0, failed: 0, date: targetDate };
    }
  }

  /**
   * Send bulk SMS messages
   */
  public async sendBulkAdvisories(
    advisories: FormattedAdvisory[],
    farmerContacts: Map<string, { farmerId: string; phoneNumber: string; preferences?: CommunicationPreferences }>
  ): Promise<SMSMessage[]> {
    this.logger.info(`Sending bulk SMS to ${farmerContacts.size} farmers`);
    
    const messages: SMSMessage[] = [];
    
    for (const advisory of advisories) {
      const contact = farmerContacts.get(advisory.advisoryId);
      if (contact) {
        try {
          const message = await this.sendAdvisory(
            advisory,
            contact.farmerId,
            contact.phoneNumber,
            contact.preferences
          );
          messages.push(message);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Failed to send SMS to farmer ${contact.farmerId}: ${errorMessage}`);
        }
      }
    }
    
    return messages;
  }

  /**
   * Handle SMS replies from farmers
   */
  public async processSMSReply(
    phoneNumber: string,
    message: string,
    timestamp: Date
  ): Promise<void> {
    this.logger.info(`Processing SMS reply from ${phoneNumber}: ${message}`);
    
    // Store the reply
    await this.dbHelper.putItem(TABLE_NAMES.SMS_REPLIES, {
      replyId: `reply-${phoneNumber}-${timestamp.getTime()}`,
      phoneNumber: this.sanitizePhoneNumber(phoneNumber),
      message: message.trim(),
      timestamp,
      processed: false,
      createdAt: new Date()
    });
    
    // Process simple acknowledgments
    const lowerMessage = message.toLowerCase().trim();
    if (['ok', 'yes', 'done', 'received'].includes(lowerMessage)) {
      // Mark as acknowledged
      this.logger.info(`Acknowledgment received from ${phoneNumber}`);
    } else if (['help', 'info', 'more'].includes(lowerMessage)) {
      // Send help information
      await this.sendHelpMessage(phoneNumber);
    }
  }

  /**
   * Send help message
   */
  private async sendHelpMessage(phoneNumber: string): Promise<void> {
    const helpMessage = "CropTwin Help: Reply 'OK' to confirm receipt, 'STOP' to unsubscribe. For support, call 1800-XXX-XXXX";
    
    const params: SNS.PublishInput = {
      PhoneNumber: phoneNumber,
      Message: helpMessage,
      MessageAttributes: {
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'CropTwin'
        }
      }
    };

    try {
      await this.sns.publish(params).promise();
      this.logger.info(`Help message sent to ${phoneNumber}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send help message: ${errorMessage}`);
    }
  }
}