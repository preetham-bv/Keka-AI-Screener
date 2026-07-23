import { dbManager, services } from '../services/instances.js';

export class BaseWorker {
  /**
   * Process a candidate using the standard workflow:
   * 1. Lock the candidate
   * 2. Execute worker-specific logic
   * 3. Unlock and transition to next state
   * 4. Handle errors with retries
   */
  static async processCandidate(taskId, candidate, options, executeLogic) {
    const {
      workerName,
      inProgressStatus,
      successStatus,
      nextAction,
      errorPrefix
    } = options;

    try {
      console.log(`${workerName}: Processing candidate ${candidate.candidateId}`);
      
      // 1. Lock Candidate
      await dbManager.updateCandidateRecord(taskId, candidate.candidateId, {
        status: inProgressStatus,
        [`${inProgressStatus}Started`]: new Date().toISOString(),
        currentWorker: workerName,
        workerLockTime: new Date().toISOString(),
        lastError: null
      });
      
      // 2. Execute Worker Logic
      await executeLogic(candidate);
      
      // 3. Unlock and Transition
      await dbManager.updateCandidateRecord(taskId, candidate.candidateId, {
        status: successStatus,
        [`${inProgressStatus}Completed`]: new Date().toISOString(),
        currentWorker: null,
        workerLockTime: null,
        nextAction: nextAction
      });
      
      console.log(`${workerName}: Completed candidate ${candidate.candidateId}`);
      
    } catch (error) {
      console.error(`${workerName} Error:`, error);
      await this.handleError(taskId, candidate.candidateId, error, errorPrefix);
    }
  }
  
  static async handleError(taskId, candidateId, error, errorPrefix) {
    const candidate = await dbManager.getCandidateById(taskId, candidateId);
    const newRetryCount = (candidate.retryCount || 0) + 1;
    
    if (newRetryCount >= 3) {
      await dbManager.updateCandidateRecord(taskId, candidateId, {
        status: 'failed',
        lastError: `${errorPrefix}: ${error.message}`,
        retryCount: newRetryCount,
        currentWorker: null,
        workerLockTime: null
      });
    } else {
      // 10 second backoff for retries to prevent instant failure looping
      const backoffMs = 10000;
      await dbManager.updateCandidateRecord(taskId, candidateId, {
        retryCount: newRetryCount,
        lastError: `${errorPrefix} (retry ${newRetryCount}/3): ${error.message}`,
        currentWorker: null,
        workerLockTime: null,
        status: 'pending', // Usually 'pending' restarts the pipeline, but we should make it configurable if needed. For now, matching old logic.
        nextRetryAfter: Date.now() + backoffMs
      });
    }
  }
}
