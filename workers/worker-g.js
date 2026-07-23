import { services } from '../services/instances.js';

export class WorkerG {
  static async start() {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'pipeline_heartbeat') {
        await this.processStalledCandidates();
      }
    });
  }
  
  static async processStalledCandidates() {
    // This connects back to stateOrchestrator to trigger the processing logic
    if (services.stateOrchestrator) {
      await services.stateOrchestrator.processStalledCandidates();
    }
  }
}
