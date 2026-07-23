import { StorageManager } from './services/storage-manager.js';
import { dbManager, services } from './services/instances.js';
import { KekaAPIClient } from './services/keka-api.js';
import { AIService } from './services/ai-service.js';
import { StateOrchestrator } from './services/state-orchestrator.js';
import { AlarmScheduler } from './services/alarm-scheduler.js';

// Worker imports
import { WorkerA } from './workers/worker-a.js';
import { WorkerB } from './workers/worker-b.js';
import { WorkerC } from './workers/worker-c.js';
import { WorkerD } from './workers/worker-d.js';
import { WorkerE } from './workers/worker-e.js';
import { WorkerF } from './workers/worker-f.js';
import { WorkerG } from './workers/worker-g.js';

// Helper imports
import { getTaskMetadata, getActiveTasks } from './utils/helpers.js';

// Global service instances local to background script
let storageManager;
let kekaAPI;
let aiService;
let stateOrchestrator;
let alarmScheduler;

let isInitialized = false;
let initPromise = null;

function broadcastState(state) {
  try {
    chrome.storage.local.set({ debug_state: { state, time: new Date().toISOString() } });
    console.log(`[STATE] ${state}`);
  } catch (e) {
    // Ignore
  }
}

/**
 * Service Worker Initialization
 */
async function initialize() {
  if (isInitialized) return;
  broadcastState('BOOTING');
  console.log('🚀 Keka ATS Service Worker Starting (ES Module Mode)');
  
  try {
    // Initialize storage manager
    broadcastState('STARTING_STORAGE');
    storageManager = new StorageManager();
    await storageManager.initialize();
    
    // Initialize IndexedDB manager from instances.js
    broadcastState('STARTING_DB');
    await dbManager.init();
    
    // Initialize API clients
    broadcastState('STARTING_KEKA_API');
    const kekaConfig = await storageManager.getKekaAPIConfig();
    kekaAPI = new KekaAPIClient(kekaConfig);
    services.kekaAPI = kekaAPI; // Inject into shared instances
    
    broadcastState('STARTING_AI_SERVICE');
    aiService = new AIService(storageManager);
    services.aiService = aiService; // Inject into shared instances
    
    // Initialize state orchestrator
    broadcastState('STARTING_ORCHESTRATOR');
    stateOrchestrator = new StateOrchestrator();
    await stateOrchestrator.initialize();
    services.stateOrchestrator = stateOrchestrator; // Inject into shared instances
    
    // Initialize alarm scheduler
    broadcastState('STARTING_ALARMS');
    alarmScheduler = new AlarmScheduler();
    await alarmScheduler.initialize();
    
    // Start WorkerG (handles alarm events)
    WorkerG.start();
    
    isInitialized = true;
    broadcastState('READY');
    console.log('✅ Service Worker Ready with ES modules, event-driven architecture, and proper global scope');
    
  } catch (error) {
    broadcastState(`ERROR: ${error.message}`);
    console.error('❌ Service Worker Initialization Failed:', error);
    throw error;
  }
}

function ensureInitialized() {
  if (!initPromise) {
    const initRace = Promise.race([
      initialize(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_INITIALIZATION')), 5000))
    ]);
    initPromise = initRace.catch(err => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

// Setup message handlers at top level synchronously!
chrome.runtime.onMessage.addListener(handleMessage);

// Setup lifecycle handlers at top level synchronously!
chrome.runtime.onStartup.addListener(handleStartup);
chrome.runtime.onInstalled.addListener(handleInstall);

/**
 * Handle startup (MV3 recovery)
 */
async function handleStartup() {
  await ensureInitialized();
  console.log('🔄 Service Worker Startup - Recovering processing...');
  
  try {
    // Resume stalled candidates
    if (stateOrchestrator) {
      await stateOrchestrator.processStalledCandidates();
    }
    
  } catch (error) {
    console.error('Startup recovery failed:', error);
  }
}

/**
 * Handle install/update
 */
async function handleInstall(details) {
  await ensureInitialized();
  if (details.reason === 'install') {
    console.log('Extension installed - setting up defaults');
    await setupDefaults();
  } else if (details.reason === 'update') {
    console.log('Extension updated - migrating data');
    await migrateData(details.previousVersion);
  }
}

/**
 * Handle incoming messages
 */
function handleMessage(message, sender, sendResponse) {
  (async () => {
    try {
      await ensureInitialized();
      switch (message.type) {
        case 'PING': {
          sendResponse({ success: true, pong: true });
          break;
        }

        case 'CREATE_TASK': {
          const taskId = await stateOrchestrator.createTask(message.config);
          sendResponse({ success: true, taskId: taskId });
          break;
        }
          
        case 'CANCEL_TASK': {
          await stateOrchestrator.cancelTask(message.taskId, message.reason);
          sendResponse({ success: true });
          break;
        }
          
        case 'GET_TASK_STATUS': {
          const status = await stateOrchestrator.getTaskStatus(message.taskId);
          sendResponse({ success: true, status: status });
          break;
        }
          
        case 'GET_ACTIVE_TASKS': {
          const activeTasks = await getActiveTasks();
          sendResponse({ success: true, tasks: activeTasks });
          break;
        }

        case 'GET_ALL_TASKS': {
          try {
            const data = await new Promise(resolve => chrome.storage.local.get(null, resolve));
            const allTasks = Object.keys(data)
              .filter(key => key.startsWith('task_metadata_'))
              .map(key => data[key]);
            sendResponse({ success: true, tasks: allTasks });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        }

        case 'CLEAR_PAST_TASKS': {
          try {
            const data = await new Promise(resolve => chrome.storage.local.get(null, resolve));
            const keysToRemove = Object.keys(data).filter(key => {
              if (key.startsWith('task_metadata_')) {
                const task = data[key];
                return task && task.status !== 'running';
              }
              return false;
            });
            if (keysToRemove.length > 0) {
              await new Promise(resolve => chrome.storage.local.remove(keysToRemove, resolve));
            }
            sendResponse({ success: true, cleared: keysToRemove.length });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        }

        case 'GET_CANDIDATES_BY_TASK': {
          try {
            const cands = await dbManager.getCandidatesByTask(message.taskId);
            sendResponse({ success: true, candidates: cands });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        }

        case 'FETCH_JOBS': {
          try {
            if (!kekaAPI) {
              const kConfig = await storageManager.getKekaAPIConfig();
              kekaAPI = new KekaAPIClient(kConfig);
            }
            const jobs = await kekaAPI.getJobs();
            sendResponse({ success: true, jobs });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        }
          
        case 'FETCH_CANDIDATES': {
          try {
            if (!kekaAPI) {
              const kConfig = await storageManager.getKekaAPIConfig();
              kekaAPI = new KekaAPIClient(kConfig);
            }
            const candidates = await kekaAPI.getJobCandidates(message.jobId, message.stage || 'Applied');
            sendResponse({ success: true, candidates });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        }
          
        case 'TEST_CONNECTION': {
          try {
            if (message.service === 'keka') {
              const kConfig = await storageManager.getKekaAPIConfig();
              if (!kConfig.clientId || !kConfig.clientSecret || !kConfig.apiKey || !kConfig.companyName) {
                throw new Error("Missing Keka credentials");
              }
              const testKeka = new KekaAPIClient(kConfig);
              await testKeka.healthCheck(); // Tests both auth and API health
              sendResponse({ success: true });
            } else {
              const aiConfig = await storageManager.getAIServicesConfig();
              const sConfig = aiConfig[message.service];
              if (!sConfig || !sConfig.apiKey) throw new Error("API Key missing");
              const dummyPrompt = { system: "You are a test bot.", user: "Reply 'ok'" };
              
              if (message.service === 'anthropic') {
                await aiService.callAnthropic(sConfig, sConfig.customModel || 'claude-3-5-sonnet-20241022', dummyPrompt);
              } else if (message.service === 'openai') {
                await aiService.callOpenAI(sConfig, 'gpt-4-turbo', dummyPrompt);
              } else if (message.service === 'gemini') {
                await aiService.callGoogleGemini(sConfig, 'gemini-1.5-pro', dummyPrompt);
              }
              sendResponse({ success: true });
            }
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        }
          
        default: {
          sendResponse({ success: false, error: 'Unknown message type' });
          break;
        }
      }
    } catch (error) {
      console.error('Message handling error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep message channel open synchronously
}

/**
 * Setup default configurations
 */
async function setupDefaults() {
  const defaults = {
    keka_api_config: {
      companyName: '',
      apiKey: '',
      environment: 'keka.com'
    },
    ai_services_config: {
      anthropic: { 
        enabled: true, 
        apiKey: '', 
        models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'] 
      },
      openai: { 
        enabled: false, 
        apiKey: '', 
        models: ['gpt-4-turbo', 'gpt-4'] 
      },
      gemini: {
        enabled: true,
        apiKey: '',
        models: ['gemini-1.5-pro']
      }
    },
    active_task_queue: []
  };
  
  await chrome.storage.local.set(defaults);
}

/**
 * Migrate data between versions
 */
async function migrateData(previousVersion) {
  console.log(`Migrating from version ${previousVersion}`);
  // Add version-specific migration logic here if needed in the future
}

// Service worker initialized on demand via ensureInitialized();
