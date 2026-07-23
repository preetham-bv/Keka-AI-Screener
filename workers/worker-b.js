import { BaseWorker } from './base-worker.js';
import { ResumeParser } from '../utils/resume-parser.js';
import { dbManager, services } from '../services/instances.js';

export class WorkerB extends BaseWorker {
  static async processCandidate(taskId, candidate) {
    await super.processCandidate(
      taskId,
      candidate,
      {
        workerName: 'WorkerB',
        inProgressStatus: 'parsing',
        successStatus: 'parsed',
        nextAction: 'assemble_prompt',
        errorPrefix: 'Parse failed'
      },
      async (c) => {
        let rawResume = await dbManager.getRawResume(c.candidateId);
        
        // Ensure validation for IndexedDB Operations, recover if missing
        if (!rawResume || !rawResume.data) {
           console.warn(`Raw resume missing for ${c.candidateId}, attempting to auto-recover...`);
           const resumeData = await services.kekaAPI.getCandidateResume(c.candidateId);
           await dbManager.storeRawResume(c.candidateId, resumeData);
           rawResume = await dbManager.getRawResume(c.candidateId);
           
           if (!rawResume || !rawResume.data) {
             throw new Error('Raw resume data is missing or incorrectly structured in DB despite recovery attempt');
           }
        }

        const parsedText = await ResumeParser.parse(rawResume.data, rawResume.contentType);
        
        if (!parsedText || parsedText.length < 10) {
          throw new Error('Insufficient content parsed');
        }
        
        await dbManager.updateCandidateRecord(taskId, c.candidateId, {
          parsedResumeText: parsedText,
          parseCompleted: new Date().toISOString()
        });
        
        // Safely delete the raw PDF to save DB space, but ONLY if no other concurrent tasks need it
        const isNeeded = await dbManager.isRawResumeNeeded(c.candidateId, taskId);
        if (!isNeeded) {
          await dbManager.deleteRawResume(c.candidateId);
        }
      }
    );
  }
}
