import { BaseWorker } from './base-worker.js';
import { dbManager } from '../services/instances.js';

export class WorkerE extends BaseWorker {
  static async processCandidate(taskId, candidate) {
    await super.processCandidate(
      taskId,
      candidate,
      {
        workerName: 'WorkerE',
        inProgressStatus: 'extracting_decision',
        successStatus: 'decision_extracted',
        nextAction: 'post_to_keka',
        errorPrefix: 'Extraction failed'
      },
      async (c) => {
        const output = c.aiEvaluationOutput;
        const decision = this.extractDecision(output);
        const confidence = this.extractConfidence(output);
        const tags = this.extractTags(output);
        
        await dbManager.updateCandidateRecord(taskId, c.candidateId, {
          decision: decision,
          confidence: confidence,
          tags: tags
        });
      }
    );
  }
  
  static extractDecision(content) {
    if (!content) return 'Manual Check';
    const patterns = [
      /decision:\s*(strong|good|manual check|reject)/i,
      /recommendation:\s*(strong|good|manual check|reject)/i
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }
    return 'Manual Check';
  }
  
  static extractConfidence(content) {
    if (!content) return 'Medium';
    const patterns = [
      /confidence:\s*(high|medium|low)/i,
      /sureness:\s*(high|medium|low)/i
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }
    return 'Medium';
  }
  
  static extractTags(content) {
    if (!content) return [];
    
    // Match the exact format {{Tags: XYZ, ABC}}
    const match = content.match(/\{\{Tags:\s*(.*?)\}\}/i);
    
    if (match && match[1]) {
      return match[1]
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
        .slice(0, 5); // Limit to 5 tags maximum
    }
    
    return [];
  }
}
