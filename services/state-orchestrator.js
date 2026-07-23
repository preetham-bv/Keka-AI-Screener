import { getTaskMetadata } from '../utils/helpers.js';
import { dbManager } from './instances.js';
import { WorkerA } from '../workers/worker-a.js';
import { WorkerB } from '../workers/worker-b.js';
import { WorkerC } from '../workers/worker-c.js';
import { WorkerD } from '../workers/worker-d.js';
import { WorkerE } from '../workers/worker-e.js';
import { WorkerF } from '../workers/worker-f.js';

export class StateOrchestrator {
  constructor() {
    this.inFlightLocks = new Map();
    this.maxConcurrency = 5;
    this.isInitialized = false;
    this.isProcessingQueue = false;
  }

  async initialize() {
    if (this.isInitialized) return;
    console.log('🔄 Initializing State Orchestrator...');
    
    // Setup IndexedDB event listeners
    dbManager.addEventListener('candidate_added', (event) => {
      const { taskId, record } = event.detail;
      this.enqueueCandidate(taskId, record);
    });
    
    dbManager.addEventListener('candidate_updated', (event) => {
      const { taskId, record } = event.detail;
      this.enqueueCandidate(taskId, record);
    });
    
    dbManager.addEventListener('resume_downloaded', async (event) => {
      const { candidateId } = event.detail;
      const candidates = await dbManager.getCandidatesByCandidateId(candidateId);
      for (const candidate of candidates) {
        this.enqueueCandidate(candidate.taskId, candidate);
      }
    });
    
    dbManager.addEventListener('resume_deleted', (event) => {
      // Cleanup complete
    });
    
    // Resume orphaned tasks on boot
    const activeTasks = await this.getActiveTasks();
    for (const taskId of activeTasks) {
      const candidates = await dbManager.getCandidatesByTask(taskId);
      for (const c of candidates) {
        if (!['completed', 'failed', 'posted'].includes(c.status)) {
          this.enqueueCandidate(taskId, c);
        }
      }
    }

    this.isInitialized = true;
    console.log('✅ State Orchestrator initialized');
  }

  enqueueCandidate(taskId, candidate) {
    this.pumpQueue();
  }

  async getActiveTasks() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const tasks = [];
        for (const [key, value] of Object.entries(items)) {
          if (key.startsWith('task_metadata_') && value.status === 'running') {
            tasks.push(value.taskId);
          }
        }
        resolve(tasks);
      });
    });
  }

  async pumpQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      // 1. Determine how many slots we have
      while (this.inFlightLocks.size < this.maxConcurrency) {
        let foundCandidate = false;
        
        // 2. Find the next pending candidate across all active tasks
        const activeTasks = await this.getActiveTasks();
        for (const taskId of activeTasks) {
          if (this.inFlightLocks.size >= this.maxConcurrency) break;
          
          const candidates = await dbManager.getCandidatesByTask(taskId);
          for (const candidate of candidates) {
             if (this.inFlightLocks.size >= this.maxConcurrency) break;
             
             // Skip if locked or actively being processed
             if (this.inFlightLocks.has(candidate.candidateId)) continue;
             if (candidate.currentWorker) continue;
             
             // Skip if completed or fully failed/posted
             if (['completed', 'failed', 'posted'].includes(candidate.status) && !candidate.nextAction) continue;
             if (candidate.status !== 'pending' && !candidate.nextAction) continue;
             
             // Enforce retry backoff delay
             if (candidate.nextRetryAfter && Date.now() < candidate.nextRetryAfter) continue;
             
             // We found a candidate to process!
             foundCandidate = true;
             this.inFlightLocks.set(candidate.candidateId, Date.now());
             
             // Fire and forget execution to allow parallel processing
             this.executeCandidate(taskId, candidate).catch(err => {
               console.error('Error executing candidate:', err);
             }).finally(() => {
               this.inFlightLocks.delete(candidate.candidateId);
               this.pumpQueue(); // Trigger next pump when done
             });
          }
        }
        
        // If we looped through all active tasks and found nothing to do, break the loop
        if (!foundCandidate) break;
      }
    } catch (e) {
      console.error('pumpQueue error:', e);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  async executeCandidate(taskId, candidate) {
    try {
      if (candidate.status === 'failed' && !candidate.nextAction) {
        await this.updateTaskProgress(taskId);
      } else if (candidate.nextAction) {
        await this.processNextAction(taskId, candidate);
      } else if (candidate.status === 'pending') {
        await this.routeCandidateToWorker(taskId, candidate);
      } else if (candidate.status === 'posted') {
        await this.updateTaskProgress(taskId);
      }
    } catch (error) {
      console.error(`Error executing candidate ${candidate.candidateId}:`, error);
    }
  }

  async createTask(config) {
    const taskId = `task_${Date.now()}`;
    
    // Generate Master Prompt Template securely
    const masterPromptTemplate = this.buildMasterPrompt(config.jdContent, config.promptContent);
    
    // Initialize detailed worker status map
    const workerStatus = {};
    config.candidates.forEach(c => {
      workerStatus[c.candidateId] = {
        worker: null,
        lastUpdate: new Date().toISOString(),
        history: []
      };
    });

    // Store comprehensive metadata
    await new Promise((resolve) => {
      chrome.storage.local.set({
        [`task_metadata_${taskId}`]: {
          taskId,
          createdAt: new Date().toISOString(),
          status: 'running',
          cancellationRequested: false,
          snapshot: {
            kekaJobId: config.jobId,
            jdContent: config.jdContent,
            promptContent: config.promptContent,
            candidateSelection: config.candidates.map(c => c.candidateId),
            aiService: config.aiService,
            aiModel: config.aiModel
          },
          masterPromptTemplate,
          workerStatus,
          progress: {
            totalCandidates: config.candidates.length,
            completedCandidates: 0,
            failedCandidates: 0,
            percentage: 0
          }
        }
      }, resolve);
    });

    // Tasks are dynamically derived as active when their status is 'running'

    // Insert candidates into IndexedDB to trigger processing
    for (const candidate of config.candidates) {
      await dbManager.addCandidateRecord(taskId, candidate);
    }
    
    return taskId;
  }

  buildMasterPrompt(jdContent, userPromptContent) {
    return `${userPromptContent}

<job_description>
${jdContent}
</job_description>

<candidate_resume>
{CANDIDATE_DETAILS}
</candidate_resume>`;
  }

  async processNextAction(taskId, candidate) {
    const taskMetadata = await getTaskMetadata(taskId);
    if (!taskMetadata || taskMetadata.cancellationRequested) return;

    switch (candidate.nextAction) {
      case 'parse':
        await WorkerB.processCandidate(taskId, candidate);
        break;
      case 'assemble_prompt':
        await WorkerC.processCandidate(taskId, candidate);
        break;
      case 'evaluate':
        await WorkerD.processCandidate(taskId, candidate);
        break;
      case 'extract_decision':
        await WorkerE.processCandidate(taskId, candidate);
        break;
      case 'post_to_keka':
        await WorkerF.processCandidate(taskId, candidate);
        break;
    }
  }

  async routeCandidateToWorker(taskId, candidate) {
    const taskMetadata = await getTaskMetadata(taskId);
    if (!taskMetadata || taskMetadata.cancellationRequested) return;
    
    switch (candidate.status) {
      case 'pending': 
      case 'downloading':
        await WorkerA.processCandidate(taskId, candidate); break;
      case 'downloaded': 
      case 'parsing':
        await WorkerB.processCandidate(taskId, candidate); break;
      case 'parsed': 
      case 'assembling_prompt':
        await WorkerC.processCandidate(taskId, candidate); break;
      case 'prompt_ready': 
      case 'evaluating':
        await WorkerD.processCandidate(taskId, candidate); break;
      case 'evaluated': 
      case 'extracting_decision':
        await WorkerE.processCandidate(taskId, candidate); break;
      case 'decision_extracted': 
      case 'posting':
        await WorkerF.processCandidate(taskId, candidate); break;
      case 'posted': await this.updateTaskProgress(taskId); break;
    }
  }

  async updateTaskProgress(taskId) {
    const taskMetadata = await getTaskMetadata(taskId);
    if (!taskMetadata) return;

    const completedCount = await dbManager.getCompletedCandidateCount(taskId);
    const failedCount = await dbManager.getFailedCandidateCount(taskId);
    
    taskMetadata.progress.completedCandidates = completedCount;
    taskMetadata.progress.failedCandidates = failedCount;
    taskMetadata.progress.percentage = Math.round((completedCount / taskMetadata.progress.totalCandidates) * 100);
    
    if (completedCount + failedCount >= taskMetadata.progress.totalCandidates) {
      taskMetadata.status = 'completed';
      // Task completed, derived naturally by status
    }
    
    await new Promise(resolve => chrome.storage.local.set({ [`task_metadata_${taskId}`]: taskMetadata }, resolve));
    
    chrome.runtime.sendMessage({
      type: 'TASK_PROGRESS',
      taskId: taskId,
      progress: taskMetadata.progress
    }).catch(() => {});
  }

  async processStalledCandidates() {
    console.log('💓 Pipeline heartbeat: Checking for stalled candidates...');
    const activeTasks = await this.getActiveTasks();
    for (const taskId of activeTasks) {
      const stalledCandidates = await dbManager.getStalledCandidates(taskId);
      for (const candidate of stalledCandidates) {
        // Force-clear the lock so processQueue doesn't ignore it
        await dbManager.updateCandidateRecord(taskId, candidate.candidateId, {
          currentWorker: null,
          workerLockTime: null,
          lastError: `Recovered from stall (${candidate.currentWorker || 'unknown'})`
        });
        // Fetch updated record to enqueue
        const updated = await dbManager.getCandidateById(taskId, candidate.candidateId);
        this.enqueueCandidate(taskId, updated);
      }
    }
  }

  async cancelTask(taskId, reason) {
    const metadata = await getTaskMetadata(taskId);
    if (metadata) {
      metadata.cancellationRequested = true;
      metadata.status = 'cancelled';
      metadata.cancelReason = reason;
      await new Promise(resolve => chrome.storage.local.set({ [`task_metadata_${taskId}`]: metadata }, resolve));
      
      // Task cancelled, derived naturally by status
    }
  }

  async getTaskStatus(taskId) {
    return await getTaskMetadata(taskId);
  }
}
