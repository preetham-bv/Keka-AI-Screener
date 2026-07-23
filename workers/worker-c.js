import { BaseWorker } from './base-worker.js';
import { dbManager } from '../services/instances.js';
import { getTaskMetadata } from '../utils/helpers.js';

export class WorkerC extends BaseWorker {
  static async processCandidate(taskId, candidate) {
    await super.processCandidate(
      taskId,
      candidate,
      {
        workerName: 'WorkerC',
        inProgressStatus: 'assembling_prompt',
        successStatus: 'prompt_ready',
        nextAction: 'evaluate',
        errorPrefix: 'Assembly failed'
      },
      async (c) => {
        const taskMetadata = await getTaskMetadata(taskId);
        
        let candidateSpecificPrompt = taskMetadata.masterPromptTemplate;
        const resumeText = c.parsedResumeText || 'No text extracted.';
        
        if (candidateSpecificPrompt.includes('{CANDIDATE_DETAILS}')) {
          candidateSpecificPrompt = candidateSpecificPrompt.replace('{CANDIDATE_DETAILS}', resumeText);
        } else {
          candidateSpecificPrompt += `\n\n--- CANDIDATE RESUME ---\n${resumeText}`;
        }
        
        await dbManager.updateCandidateRecord(taskId, c.candidateId, {
          candidateSpecificPrompt: candidateSpecificPrompt
        });
      }
    );
  }
}
