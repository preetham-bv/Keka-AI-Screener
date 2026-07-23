import { WorkerG } from '../workers/worker-g.js';

export class AlarmScheduler {
  async initialize() {
    chrome.alarms.create('pipeline_heartbeat', {
      periodInMinutes: 1 // Check every minute to ensure workers are running
    });
    WorkerG.start();
    console.log('⏰ Alarm Scheduler Initialized');
  }
}
