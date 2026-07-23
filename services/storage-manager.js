export class StorageManager {
  constructor() {
    this.storageKeys = {
      TASK_METADATA_PREFIX: 'task_metadata_',
      ACTIVE_TASK_QUEUE: 'active_task_queue',
      KEKA_API_CONFIG: 'keka_api_config',
      AI_SERVICES_CONFIG: 'ai_services_config',
      JD_PREFIX: 'jd_',
      PROMPT_PREFIX: 'prompt_'
    };
  }

  async initialize() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (result) => {
        this.data = result || {};
        resolve();
      });
    });
  }

  async getKekaAPIConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(this.storageKeys.KEKA_API_CONFIG, (res) => {
        resolve(res[this.storageKeys.KEKA_API_CONFIG] || {});
      });
    });
  }

  async getAIServicesConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(this.storageKeys.AI_SERVICES_CONFIG, (res) => {
        resolve(res[this.storageKeys.AI_SERVICES_CONFIG] || {});
      });
    });
  }
}
