import { BaseWorker } from './base-worker.js';
import { dbManager, services } from '../services/instances.js';
import { getTaskMetadata } from '../utils/helpers.js';

export class WorkerF extends BaseWorker {
  static async processCandidate(taskId, candidate) {
    await super.processCandidate(
      taskId,
      candidate,
      {
        workerName: 'WorkerF',
        inProgressStatus: 'posting',
        successStatus: 'posted',
        nextAction: null, // End of the line
        errorPrefix: 'Posting failed'
      },
      async (c) => {
        const taskMetadata = await getTaskMetadata(taskId);
        const jobId = taskMetadata?.snapshot?.kekaJobId || taskMetadata?.kekaJobId;
        
        if (!jobId) {
          throw new Error('Could not find Keka Job ID in task metadata.');
        }

        const noteContent = this.formatEvaluationNote(c, taskMetadata);
        let tags = c.tags;
        
        // Fallback for candidates that were processed by Worker E before the tags update
        if (!tags && c.aiEvaluationOutput) {
          const match = c.aiEvaluationOutput.match(/\{\{Tags:\s*(.*?)\}\}/i);
          if (match && match[1]) {
            tags = match[1].split(',').map(tag => tag.trim()).filter(t => t.length > 0).slice(0, 5);
          }
        }
        
        if (!Array.isArray(tags)) tags = [];
        
        await services.kekaAPI.postCandidateNote(jobId, c.candidateId, noteContent, tags);
        
        await dbManager.updateCandidateRecord(taskId, c.candidateId, {
          postedToKeka: true,
          kekaNotePosted: true,
          kekaTagsPosted: true
        });
      }
    );
  }
  
  static formatEvaluationNote(candidate, taskMetadata) {
    let aiOutput = candidate.aiEvaluationOutput || 'No output generated.';
    
    const candidateName = candidate.name || 'N/A';
    const model = taskMetadata.snapshot?.aiModel || taskMetadata.aiModel || 'N/A';
    const dateStr = new Date().toLocaleString();

    const rawMarkdown = `**AI CANDIDATE EVALUATION**

${aiOutput}

---
*System Info: Candidate: ${candidateName} | Evaluated: ${dateStr} | AI Model: ${model} | Keka AI Screener (by Preetham Phirangi)*`;

    return rawMarkdown
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');
  }
}
