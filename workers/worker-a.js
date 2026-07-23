import { BaseWorker } from './base-worker.js';
import { dbManager, services } from '../services/instances.js';

export class WorkerA extends BaseWorker {
  static async processCandidate(taskId, candidate) {
    await super.processCandidate(
      taskId,
      candidate,
      {
        workerName: 'WorkerA',
        inProgressStatus: 'downloading',
        successStatus: 'downloaded',
        nextAction: 'parse',
        errorPrefix: 'Download failed'
      },
      async (c) => {
        const resumeData = await services.kekaAPI.getCandidateResume(c.candidateId);
        await dbManager.storeRawResume(c.candidateId, resumeData);
      }
    );
  }
}
