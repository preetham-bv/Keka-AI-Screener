export async function getTaskMetadata(taskId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(`task_metadata_${taskId}`, (result) => {
      resolve(result[`task_metadata_${taskId}`]);
    });
  });
}

export async function getActiveTasks() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      const activeIds = [];
      for (const [key, value] of Object.entries(items)) {
        if (key.startsWith('task_metadata_') && value && value.status === 'running') {
          activeIds.push(value.taskId);
        }
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
