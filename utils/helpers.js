export async function getTaskMetadata(taskId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(`task_metadata_${taskId}`, (result) => {
      resolve(result[`task_metadata_${taskId}`]);
    });
  });
}

export async function getActiveTasks() {
  return new Promise((resolve) => {
    chrome.storage.local.get('active_task_queue', async (result) => {
      const queue = result.active_task_queue || [];
      if (queue.length === 0) {
        return resolve([]);
      }
      
      const activeIds = [];
      for (const taskId of queue) {
        const metadata = await getTaskMetadata(taskId);
        if (metadata && metadata.status !== 'cancelled' && metadata.status !== 'completed' && metadata.status !== 'completed_with_errors') {
          activeIds.push(taskId);
        }
      }
      
      // Cleanup if any were stale
      if (activeIds.length !== queue.length) {
        chrome.storage.local.set({ 'active_task_queue': activeIds });
      }
      
      resolve(activeIds);
    });
  });
}

export async function saveTaskMetadata(taskId, metadata) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [`task_metadata_${taskId}`]: metadata }, () => {
      resolve();
    });
  });
}
