import { IndexedDBManager } from './indexeddb-manager.js';

export const dbManager = new IndexedDBManager();

// We will initialize these in background.js but hold their references here
export const services = {
  kekaAPI: null,
  aiService: null,
  stateOrchestrator: null
};
