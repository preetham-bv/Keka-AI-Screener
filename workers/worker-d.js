import { BaseWorker } from './base-worker.js';
import { dbManager, services } from '../services/instances.js';
import { getTaskMetadata } from '../utils/helpers.js';

export class WorkerD extends BaseWorker {
  static async processCandidate(taskId, candidate) {
    await super.processCandidate(
      taskId,
      candidate,
      {
        workerName: 'WorkerD',
        inProgressStatus: 'evaluating',
        successStatus: 'evaluated',
        nextAction: 'extract_decision',
        errorPrefix: 'Eval failed'
      },
      async (c) => {
        const taskMetadata = await getTaskMetadata(taskId);
        
        if (!c.candidateSpecificPrompt) {
          throw new Error('Candidate specific prompt was not assembled by WorkerC');
        }

        const aiResponse = await services.aiService.generateReview(
          c,
          taskMetadata.snapshot.jdContent, // Assuming snapshot holds the JD content, or taskMetadata.jdContent
          c.candidateSpecificPrompt,
          taskMetadata.snapshot.aiService,
          taskMetadata.snapshot.aiModel
        );
        
        if (!aiResponse.success) {
          throw new Error('AI Generation failed: ' + (aiResponse.error || 'Unknown error'));
        }
        
        await dbManager.updateCandidateRecord(taskId, c.candidateId, {
          aiEvaluationOutput: aiResponse.content
        });
      }
    );
  }
}
