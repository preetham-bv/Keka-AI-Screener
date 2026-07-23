export class IndexedDBManager extends EventTarget {
  constructor() {
    super(); // Initialize EventTarget
    this.dbName = 'KekaATSWorkerDB';
    this.dbVersion = 1;
    this.db = null;
  }

  /**
   * Initialize IndexedDB with event-driven architecture
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onblocked = (event) => reject(new Error('IndexedDB blocked: Please close other extension tabs and reload.'));
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        
        // Handle database version changes (upgrades)
        this.db.onversionchange = () => {
          this.db.close();
          console.warn("Database requires an upgrade. Please reload the extension.");
        };
        
        this.cleanupOldResumes().catch(err => console.warn('Failed to cleanup old resumes:', err));
        
        console.log('✅ IndexedDB initialized with event emitter');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Candidates store - optimized schema
        if (!db.objectStoreNames.contains('candidates')) {
          const candidateStore = db.createObjectStore('candidates', {
            keyPath: 'id' // e.g. `${taskId}_${candidateId}`
          });
          
          candidateStore.createIndex('taskId', 'taskId', { unique: false });
          candidateStore.createIndex('candidateId', 'candidateId', { unique: false });
          candidateStore.createIndex('status', 'status', { unique: false });
          candidateStore.createIndex('nextAction', 'nextAction', { unique: false });
          candidateStore.createIndex('currentWorker', 'currentWorker', { unique: false });
        }
        
        // Raw resumes store - Direct key
        if (!db.objectStoreNames.contains('raw_resumes')) {
          db.createObjectStore('raw_resumes', {
            keyPath: 'candidateId' // Direct primary key, no auto-increment
          });
        }
        
        // Processing queue store
        if (!db.objectStoreNames.contains('processing_queue')) {
          const queueStore = db.createObjectStore('processing_queue', {
            keyPath: 'id',
            autoIncrement: true
          });
          
          queueStore.createIndex('scheduledFor', 'scheduledFor', { unique: false });
          queueStore.createIndex('priority', 'priority', { unique: false });
        }
      };
    });
  }

  /**
   * Update candidate record with event emission
   */
  async updateCandidateRecord(taskId, candidateId, updates) {
    const transaction = this.db.transaction(['candidates'], 'readwrite');
    const store = transaction.objectStore('candidates');
    const id = `${taskId}_${candidateId}`;
    const request = store.get(id);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const record = request.result;
        if (record) {
          Object.assign(record, updates);
          const updateRequest = store.put(record);
          
          updateRequest.onsuccess = () => {
            this.dispatchEvent(new CustomEvent('candidate_updated', {
              detail: { taskId, candidateId, record }
            }));
            resolve(record);
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          reject(new Error(`Candidate not found: ${id}`));
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Add candidate record with event emission
   */
  async addCandidateRecord(taskId, candidateData) {
    const transaction = this.db.transaction(['candidates'], 'readwrite');
    const store = transaction.objectStore('candidates');
    
    const record = {
      id: `${taskId}_${candidateData.candidateId}`,
      taskId: taskId,
      candidateId: candidateData.candidateId,
      ...candidateData,
      status: 'pending'
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(record);
      
      request.onsuccess = () => {
        this.dispatchEvent(new CustomEvent('candidate_added', {
          detail: { taskId, candidateId: candidateData.candidateId, record }
        }));
        resolve(record);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Store raw resume
   */
  async storeRawResume(candidateId, resumeData) {
    const transaction = this.db.transaction(['raw_resumes'], 'readwrite');
    const store = transaction.objectStore('raw_resumes');
    const record = {
      candidateId,
      data: resumeData.data || resumeData.buffer, // ArrayBuffer or base64
      contentType: resumeData.contentType || 'application/pdf',
      timestamp: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => {
        this.dispatchEvent(new CustomEvent('resume_downloaded', { detail: { candidateId } }));
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getRawResume(candidateId) {
    const transaction = this.db.transaction(['raw_resumes'], 'readonly');
    const store = transaction.objectStore('raw_resumes');
    const request = store.get(candidateId);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); // return full object now
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete raw resume
   */
  async deleteRawResume(candidateId) {
    const transaction = this.db.transaction(['raw_resumes'], 'readwrite');
    const store = transaction.objectStore('raw_resumes');
    const request = store.delete(candidateId);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        this.dispatchEvent(new CustomEvent('resume_deleted', { detail: { candidateId } }));
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if any other tasks are currently waiting to parse this same candidate's resume
   */
  async isRawResumeNeeded(candidateId, currentTaskId) {
    const transaction = this.db.transaction(['candidates'], 'readonly');
    const store = transaction.objectStore('candidates');
    const index = store.index('candidateId');
    const request = index.openCursor(IDBKeyRange.only(candidateId));
    
    return new Promise((resolve, reject) => {
      let isNeeded = false;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(isNeeded);
          return;
        }
        
        const candidate = cursor.value;
        // If there's another task (not the current one) that hasn't finished parsing this candidate yet
        if (candidate.taskId !== currentTaskId && 
            ['pending', 'downloading', 'downloaded', 'parsing'].includes(candidate.status)) {
          isNeeded = true;
        }
        
        if (isNeeded) {
          resolve(true);
        } else {
          cursor.continue();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get candidate by ID (primary key: taskId + candidateId)
   */
  async getCandidateById(taskId, candidateId) {
    const transaction = this.db.transaction(['candidates'], 'readonly');
    const store = transaction.objectStore('candidates');
    const request = store.get(`${taskId}_${candidateId}`);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all candidate records across tasks for a given candidateId
   */
  async getCandidatesByCandidateId(candidateId) {
    const transaction = this.db.transaction(['candidates'], 'readonly');
    const store = transaction.objectStore('candidates');
    const index = store.index('candidateId');
    const request = index.getAll(candidateId);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get pending candidates with status filtering
   */
  async getPendingCandidates(taskId, options = {}) {
    const transaction = this.db.transaction(['candidates'], 'readonly');
    const store = transaction.objectStore('candidates');
    const index = store.index('taskId');
    const request = index.openCursor(IDBKeyRange.only(taskId));
    
    const { limit = 10, status = 'pending' } = options;
    const candidates = [];
    
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || candidates.length >= limit) {
          resolve(candidates);
          return;
        }
        
        const candidate = cursor.value;
        if (candidate.status === status || !status) {
          candidates.push(candidate);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get stalled candidates (for alarm recovery)
   */
  async getStalledCandidates(taskId) {
    const stallThreshold = Date.now() - (5 * 60 * 1000); // 5 minutes
    const transaction = this.db.transaction(['candidates'], 'readonly');
    const store = transaction.objectStore('candidates');
    const index = store.index('taskId');
    const request = index.openCursor(IDBKeyRange.only(taskId));
    
    const stalledCandidates = [];
    
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(stalledCandidates);
          return;
        }
        
        const candidate = cursor.value;
        
        if (candidate.currentWorker && candidate.workerLockTime) {
          if (new Date(candidate.workerLockTime).getTime() < stallThreshold) {
            stalledCandidates.push({ ...candidate, stallReason: 'worker_timeout' });
          }
        } else if (!candidate.currentWorker && !['completed', 'failed', 'posted'].includes(candidate.status)) {
          const lastUpdate = candidate.workerLockTime || candidate.queuedAt || candidate.createdAt;
          if (lastUpdate && new Date(lastUpdate).getTime() < stallThreshold) {
            stalledCandidates.push({ ...candidate, stallReason: 'status_stagnation' });
          }
        }
        
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getCandidatesByTask(taskId) {
    const transaction = this.db.transaction(['candidates'], 'readonly');
    const store = transaction.objectStore('candidates');
    const index = store.index('taskId');
    const request = index.openCursor(IDBKeyRange.only(taskId));
    
    const candidates = [];
    
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(candidates);
          return;
        }
        candidates.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getCompletedCandidateCount(taskId) {
    const candidates = await this.getCandidatesByTask(taskId);
    return candidates.filter(c => c.status === 'posted').length;
  }

  async getFailedCandidateCount(taskId) {
    const candidates = await this.getCandidatesByTask(taskId);
    return candidates.filter(c => c.status === 'failed').length;
  }

  async getAllTasks() {
    const transaction = this.db.transaction(['tasks'], 'readonly');
    const store = transaction.objectStore('tasks');
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async cleanupOldResumes() {
    const transaction = this.db.transaction(['raw_resumes'], 'readwrite');
    const store = transaction.objectStore('raw_resumes');
    const request = store.getAll();

    request.onsuccess = () => {
      const resumes = request.result;
      const now = new Date();
      resumes.forEach((resume) => {
        if (resume.timestamp) {
          const resumeDate = new Date(resume.timestamp);
          const diffHours = (now - resumeDate) / (1000 * 60 * 60);
          if (diffHours > 24) {
            store.delete(resume.candidateId);
          }
        }
      });
    };
  }
}
