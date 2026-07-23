document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-new-task').addEventListener('click', () => {
    window.location.href = 'create-task.html';
  });

  document.getElementById('btn-view-tasks').addEventListener('click', () => {
    window.location.href = 'view-tasks.html';
  });

  const btnKb = document.getElementById('btn-kb');
  if (btnKb) {
    btnKb.addEventListener('click', () => {
      window.location.href = 'knowledge-base.html';
    });
  }

  loadActiveTasks();
});

function loadActiveTasks() {
  sendMessageWithTimeout({ type: 'GET_ACTIVE_TASKS' }, 8000, (response) => {
    const preview = document.getElementById('active-tasks-preview');
    if (response && response.success) {
      if (response.tasks.length === 0) {
        preview.innerHTML = '<span style="color: var(--success)">●</span> All systems idle. Ready for new tasks.';
      } else {
        preview.innerHTML = `<span style="color: var(--warning)">●</span> ${response.tasks.length} task(s) currently processing.`;
      }
    } else {
      preview.innerText = response?.error ? `Failed to load status: ${response.error}` : 'Failed to load status.';
    }
  });
}

function sendMessageWithTimeout(message, timeoutMs, callback) {
  let isDone = false;
  
  const timer = setTimeout(() => {
    if (!isDone) {
      isDone = true;
      callback({ success: false, error: 'TIMEOUT: Background script did not respond within ' + timeoutMs + 'ms' });
    }
  }, timeoutMs);

  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      
      if (chrome.runtime.lastError) {
        callback({ success: false, error: chrome.runtime.lastError.message });
      } else {
        callback(response || { success: false, error: 'Empty response received' });
      }
    });
  } catch (err) {
    if (isDone) return;
    isDone = true;
    clearTimeout(timer);
    callback({ success: false, error: 'SYNC_ERROR: ' + err.message });
  }
}
