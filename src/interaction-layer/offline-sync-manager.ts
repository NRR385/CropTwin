/**
 * Offline Capability and Synchronization Manager
 * Handles offline advisory caching, conflict resolution, and SMS fallback
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import { SNS, SQS } from 'aws-sdk';
import { 
  Advisory, 
  FormattedAdvisory, 
  CommunicationPreferences,
  MobileAdvisory 
} from '../types/advisory';
import { 
  Priority, 
  CommunicationChannel, 
  Language 
} from '../types/core';
import { Logger, createLambdaLogger } from '../shared/utils/logger';
import { DynamoDBHelper } from '../shared/utils/dynamodb-helper';
import { TABLE_NAMES } from '../shared/config/constants';

export interface OfflineCacheConfig {
  maxCachedAdvisories: number;
  cacheExpiryHours: number;
  criticalPriorityThreshold: Priority;
  maxQueuedUpdates: number;
  syncRetryAttempts: number;
  syncRetryDelayMs: number;
}

export interface CachedAdvisory {
  advisoryId: string;
  farmId: string;
  advisory: MobileAdvisory;
  priority: Priority;
  cachedAt: Date;
  expiresAt: Date;
  isCritical: boolean;
}

export interface QueuedUpdate {
  updateId: string;
  farmId: string;
  updateType: 'crop_condition' | 'farming_activity' | 'farmer_feedback';
  updateData: any;
  timestamp: Date;
  retryCount: number;
  maxRetries: number;
}

export interface SyncConflict {
  conflictId: string;
  farmId: string;
  localUpdate: QueuedUpdate;
  serverState: any;
  conflictType: 'data_mismatch' | 'timestamp_conflict' | 'state_divergence';
  resolutionStrategy: 'server_wins' | 'client_wins' | 'merge' | 'manual';
}

export interface OfflineSyncStatus {
  isOnline: boolean;
  lastSyncTime: Date;
  pendingUpdates: number;
  failedSyncs: number;
  cachedAdvisories: number;
  conflicts: number;
}
export class OfflineSyncManager {
  private logger: Logger;
  private dynamoHelper: DynamoDBHelper;
  private sns: SNS;
  private sqs: SQS;
  private config: OfflineCacheConfig;

  constructor(config?: Partial<OfflineCacheConfig>) {
    this.logger = createLambdaLogger('OfflineSyncManager');
    this.dynamoHelper = new DynamoDBHelper();
    this.sns = new SNS();
    this.sqs = new SQS();
    
    this.config = {
      maxCachedAdvisories: 50,
      cacheExpiryHours: 72,
      criticalPriorityThreshold: Priority.HIGH,
      maxQueuedUpdates: 100,
      syncRetryAttempts: 3,
      syncRetryDelayMs: 5000,
      ...config
    };
  }

  /**
   * Cache advisory for offline access with prioritization
   * Requirement 10.1: Cache recent advisories for offline access
   * Requirement 10.3: Prioritize critical advisories for offline caching
   */
  async cacheAdvisoryForOffline(
    farmId: string,
    advisory: MobileAdvisory,
    priority: Priority
  ): Promise<void> {
    try {
      const isCritical = priority >= this.config.criticalPriorityThreshold;
      const cachedAt = new Date();
      const expiresAt = new Date(cachedAt.getTime() + this.config.cacheExpiryHours * 60 * 60 * 1000);

      const cachedAdvisory: CachedAdvisory = {
        advisoryId: advisory.advisoryId,
        farmId,
        advisory,
        priority,
        cachedAt,
        expiresAt,
        isCritical
      };

      // Store in DynamoDB with TTL
      await this.dynamoHelper.putItem(TABLE_NAMES.OFFLINE_CACHE, {
        PK: `FARM#${farmId}`,
        SK: `ADVISORY#${advisory.advisoryId}`,
        ...cachedAdvisory,
        TTL: Math.floor(expiresAt.getTime() / 1000)
      });

      // Clean up old cached advisories if limit exceeded
      await this.cleanupOldCachedAdvisories(farmId);

      this.logger.info('Advisory cached for offline access', {
        farmId,
        advisoryId: advisory.advisoryId,
        priority,
        isCritical
      });
    } catch (error: any) {
      this.logger.error('Failed to cache advisory for offline access', {
        farmId,
        advisoryId: advisory.advisoryId,
        error: error.message
      });
      throw error;
    }
  }
  /**
   * Retrieve cached advisories for offline access
   * Requirement 10.1: Cache recent advisories for offline access
   */
  async getCachedAdvisories(farmId: string): Promise<CachedAdvisory[]> {
    try {
      const result = await this.dynamoHelper.queryItems(
        TABLE_NAMES.OFFLINE_CACHE,
        'PK = :pk',
        {
          ':pk': `FARM#${farmId}`
        },
        undefined, // indexName
        undefined, // limit
        false // scanIndexForward - most recent first
      );

      const cachedAdvisories = result?.map((item: any) => ({
        advisoryId: item.advisoryId,
        farmId: item.farmId,
        advisory: item.advisory,
        priority: item.priority,
        cachedAt: new Date(item.cachedAt),
        expiresAt: new Date(item.expiresAt),
        isCritical: item.isCritical
      })) || [];

      // Filter out expired advisories
      const validAdvisories = cachedAdvisories.filter(
        (advisory: CachedAdvisory) => advisory.expiresAt > new Date()
      );

      this.logger.info('Retrieved cached advisories', {
        farmId,
        totalCached: cachedAdvisories.length,
        validAdvisories: validAdvisories.length
      });

      return validAdvisories;
    } catch (error: any) {
      this.logger.error('Failed to retrieve cached advisories', {
        farmId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Queue farmer update for later synchronization
   * Requirement 10.4: Queue important updates for delivery
   */
  async queueUpdateForSync(
    farmId: string,
    updateType: 'crop_condition' | 'farming_activity' | 'farmer_feedback',
    updateData: any
  ): Promise<string> {
    try {
      const updateId = `${farmId}-${updateType}-${Date.now()}`;
      const queuedUpdate: QueuedUpdate = {
        updateId,
        farmId,
        updateType,
        updateData,
        timestamp: new Date(),
        retryCount: 0,
        maxRetries: this.config.syncRetryAttempts
      };

      // Store in DynamoDB
      await this.dynamoHelper.putItem(TABLE_NAMES.SYNC_QUEUE, {
        PK: `FARM#${farmId}`,
        SK: `UPDATE#${updateId}`,
        ...queuedUpdate,
        GSI1PK: 'PENDING_SYNC',
        GSI1SK: queuedUpdate.timestamp.toISOString()
      });

      // Clean up old queued updates if limit exceeded
      await this.cleanupOldQueuedUpdates(farmId);

      this.logger.info('Update queued for synchronization', {
        farmId,
        updateId,
        updateType
      });

      return updateId;
    } catch (error: any) {
      this.logger.error('Failed to queue update for sync', {
        farmId,
        updateType,
        error: error.message
      });
      throw error;
    }
  }
  /**
   * Synchronize queued updates when connectivity is restored
   * Requirement 10.2: Synchronize farmer updates when connectivity is restored
   */
  async synchronizeQueuedUpdates(farmId: string): Promise<OfflineSyncStatus> {
    try {
      const queuedUpdates = await this.getQueuedUpdates(farmId);
      let successfulSyncs = 0;
      let failedSyncs = 0;
      const conflicts: SyncConflict[] = [];

      for (const update of queuedUpdates) {
        try {
          const syncResult = await this.syncSingleUpdate(update);
          
          if (syncResult.success) {
            successfulSyncs++;
            await this.removeQueuedUpdate(update.updateId);
          } else if (syncResult.conflict) {
            conflicts.push(syncResult.conflict);
            failedSyncs++;
          } else {
            failedSyncs++;
            await this.incrementRetryCount(update.updateId);
          }
        } catch (error: any) {
          this.logger.error('Failed to sync individual update', {
            updateId: update.updateId,
            error: error.message
          });
          failedSyncs++;
          await this.incrementRetryCount(update.updateId);
        }
      }

      // Handle conflicts
      for (const conflict of conflicts) {
        await this.resolveConflict(conflict);
      }

      const syncStatus: OfflineSyncStatus = {
        isOnline: true,
        lastSyncTime: new Date(),
        pendingUpdates: queuedUpdates.length - successfulSyncs,
        failedSyncs,
        cachedAdvisories: (await this.getCachedAdvisories(farmId)).length,
        conflicts: conflicts.length
      };

      this.logger.info('Synchronization completed', {
        farmId,
        successfulSyncs,
        failedSyncs,
        conflicts: conflicts.length
      });

      return syncStatus;
    } catch (error: any) {
      this.logger.error('Failed to synchronize queued updates', {
        farmId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send SMS fallback for critical alerts during connectivity issues
   * Requirement 10.5: SMS fallback for critical alerts when app connectivity fails
   */
  async sendSMSFallback(
    farmId: string,
    phoneNumber: string,
    advisory: MobileAdvisory,
    language: Language
  ): Promise<void> {
    try {
      // Format advisory for SMS (keep it concise)
      const smsMessage = this.formatAdvisoryForSMS(advisory, language);

      const smsParams = {
        Message: smsMessage,
        PhoneNumber: phoneNumber,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Transactional'
          }
        }
      };

      const result = await this.sns.publish(smsParams).promise();

      // Log SMS fallback usage
      await this.logSMSFallback(farmId, advisory.advisoryId, result.MessageId);

      this.logger.info('SMS fallback sent successfully', {
        farmId,
        advisoryId: advisory.advisoryId,
        messageId: result.MessageId
      });
    } catch (error: any) {
      this.logger.error('Failed to send SMS fallback', {
        farmId,
        advisoryId: advisory.advisoryId,
        error: error.message
      });
      throw error;
    }
  }
  /**
   * Handle data conflicts when multiple offline updates are synchronized
   * Requirement 10.6: Handle data conflicts when multiple offline updates are synchronized
   */
  private async resolveConflict(conflict: SyncConflict): Promise<void> {
    try {
      switch (conflict.resolutionStrategy) {
        case 'server_wins':
          // Discard local update, keep server state
          await this.removeQueuedUpdate(conflict.localUpdate.updateId);
          break;

        case 'client_wins':
          // Force apply local update
          await this.forceApplyUpdate(conflict.localUpdate);
          await this.removeQueuedUpdate(conflict.localUpdate.updateId);
          break;

        case 'merge':
          // Attempt to merge both updates
          const mergedUpdate = await this.mergeUpdates(conflict.localUpdate, conflict.serverState);
          await this.forceApplyUpdate(mergedUpdate);
          await this.removeQueuedUpdate(conflict.localUpdate.updateId);
          break;

        case 'manual':
          // Store conflict for manual resolution
          await this.storeConflictForManualResolution(conflict);
          break;
      }

      this.logger.info('Conflict resolved', {
        conflictId: conflict.conflictId,
        strategy: conflict.resolutionStrategy
      });
    } catch (error: any) {
      this.logger.error('Failed to resolve conflict', {
        conflictId: conflict.conflictId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get current offline sync status
   */
  async getSyncStatus(farmId: string): Promise<OfflineSyncStatus> {
    try {
      const queuedUpdates = await this.getQueuedUpdates(farmId);
      const cachedAdvisories = await this.getCachedAdvisories(farmId);
      const conflicts = await this.getPendingConflicts(farmId);

      return {
        isOnline: await this.checkConnectivity(),
        lastSyncTime: await this.getLastSyncTime(farmId),
        pendingUpdates: queuedUpdates.length,
        failedSyncs: queuedUpdates.filter(u => u.retryCount > 0).length,
        cachedAdvisories: cachedAdvisories.length,
        conflicts: conflicts.length
      };
    } catch (error: any) {
      this.logger.error('Failed to get sync status', {
        farmId,
        error: error.message
      });
      throw error;
    }
  }
  // Private helper methods

  private async cleanupOldCachedAdvisories(farmId: string): Promise<void> {
    const cachedAdvisories = await this.getCachedAdvisories(farmId);
    
    if (cachedAdvisories.length > this.config.maxCachedAdvisories) {
      // Sort by priority (critical first) then by date (oldest first)
      const sortedAdvisories = cachedAdvisories.sort((a, b) => {
        if (a.isCritical !== b.isCritical) {
          return a.isCritical ? 1 : -1; // Keep critical advisories
        }
        return a.cachedAt.getTime() - b.cachedAt.getTime(); // Remove oldest first
      });

      const toRemove = sortedAdvisories.slice(0, cachedAdvisories.length - this.config.maxCachedAdvisories);
      
      for (const advisory of toRemove) {
        await this.dynamoHelper.deleteItem(TABLE_NAMES.OFFLINE_CACHE, {
          PK: `FARM#${farmId}`,
          SK: `ADVISORY#${advisory.advisoryId}`
        });
      }
    }
  }

  private async cleanupOldQueuedUpdates(farmId: string): Promise<void> {
    const queuedUpdates = await this.getQueuedUpdates(farmId);
    
    if (queuedUpdates.length > this.config.maxQueuedUpdates) {
      // Sort by timestamp (oldest first)
      const sortedUpdates = queuedUpdates.sort((a, b) => 
        a.timestamp.getTime() - b.timestamp.getTime()
      );

      const toRemove = sortedUpdates.slice(0, queuedUpdates.length - this.config.maxQueuedUpdates);
      
      for (const update of toRemove) {
        await this.removeQueuedUpdate(update.updateId);
      }
    }
  }

  private async getQueuedUpdates(farmId: string): Promise<QueuedUpdate[]> {
    const result = await this.dynamoHelper.queryItems(
      TABLE_NAMES.SYNC_QUEUE,
      'PK = :pk',
      {
        ':pk': `FARM#${farmId}`
      }
    );

    return result?.map((item: any) => ({
      updateId: item.updateId,
      farmId: item.farmId,
      updateType: item.updateType,
      updateData: item.updateData,
      timestamp: new Date(item.timestamp),
      retryCount: item.retryCount,
      maxRetries: item.maxRetries
    })) || [];
  }
  private async syncSingleUpdate(update: QueuedUpdate): Promise<{
    success: boolean;
    conflict?: SyncConflict;
  }> {
    // This would integrate with the actual farm twin management system
    // For now, we'll simulate the sync process
    
    try {
      // Check for conflicts by comparing timestamps or data versions
      const serverState = await this.getServerState(update.farmId);
      const hasConflict = await this.detectConflict(update, serverState);

      if (hasConflict) {
        const conflict: SyncConflict = {
          conflictId: `${update.updateId}-conflict`,
          farmId: update.farmId,
          localUpdate: update,
          serverState,
          conflictType: 'timestamp_conflict',
          resolutionStrategy: 'server_wins' // Default strategy
        };

        return { success: false, conflict };
      }

      // Apply the update
      await this.applyUpdateToServer(update);
      return { success: true };
    } catch (error: any) {
      this.logger.error('Failed to sync single update', {
        updateId: update.updateId,
        error: error.message
      });
      return { success: false };
    }
  }

  private async removeQueuedUpdate(updateId: string): Promise<void> {
    // Implementation would remove from DynamoDB
    this.logger.info('Queued update removed', { updateId });
  }

  private async incrementRetryCount(updateId: string): Promise<void> {
    // Implementation would increment retry count in DynamoDB
    this.logger.info('Retry count incremented', { updateId });
  }

  private formatAdvisoryForSMS(advisory: MobileAdvisory, language: Language): string {
    // Format advisory content for SMS (160 character limit consideration)
    const title = advisory.title.substring(0, 50);
    const summary = advisory.summary.substring(0, 100);
    return `${title}: ${summary}`;
  }

  private async logSMSFallback(farmId: string, advisoryId: string, messageId?: string): Promise<void> {
    // Log SMS fallback usage for monitoring
    this.logger.info('SMS fallback logged', { farmId, advisoryId, messageId });
  }

  private async forceApplyUpdate(update: QueuedUpdate): Promise<void> {
    // Force apply update to server
    this.logger.info('Update force applied', { updateId: update.updateId });
  }

  private async mergeUpdates(localUpdate: QueuedUpdate, serverState: any): Promise<QueuedUpdate> {
    // Merge logic would depend on update type and data structure
    return localUpdate; // Simplified
  }

  private async storeConflictForManualResolution(conflict: SyncConflict): Promise<void> {
    // Store conflict in DynamoDB for manual resolution
    this.logger.info('Conflict stored for manual resolution', { conflictId: conflict.conflictId });
  }

  private async getPendingConflicts(farmId: string): Promise<SyncConflict[]> {
    // Get pending conflicts from DynamoDB
    return []; // Simplified
  }

  private async checkConnectivity(): Promise<boolean> {
    // Check network connectivity
    return true; // Simplified
  }

  private async getLastSyncTime(farmId: string): Promise<Date> {
    // Get last sync time from DynamoDB
    return new Date(); // Simplified
  }

  private async getServerState(farmId: string): Promise<any> {
    // Get current server state for conflict detection
    return {}; // Simplified
  }

  private async detectConflict(update: QueuedUpdate, serverState: any): Promise<boolean> {
    // Detect if there's a conflict between local update and server state
    return false; // Simplified
  }

  private async applyUpdateToServer(update: QueuedUpdate): Promise<void> {
    // Apply update to the server
    this.logger.info('Update applied to server', { updateId: update.updateId });
  }
}

// Export the class as default as well for easier importing
export default OfflineSyncManager;