document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('btn-save').addEventListener('click', saveSettings);
  
  document.getElementById('btn-test-keka').addEventListener('click', () => testConnection('keka'));
  document.getElementById('btn-test-anthropic').addEventListener('click', () => testConnection('anthropic'));
  document.getElementById('btn-test-openai').addEventListener('click', () => testConnection('openai'));
  document.getElementById('btn-test-gemini').addEventListener('click', () => testConnection('gemini'));
});

function testConnection(service) {
  const statusEl = document.getElementById(`${service}-test-status`);
  statusEl.style.color = 'var(--text-secondary)';
  statusEl.innerText = 'Testing...';
  
  console.log('Testing connection for', service);
  saveSettingsSilently(() => {
    console.log('Settings saved silently, sending message...');
    sendMessageWithTimeout({ type: 'TEST_CONNECTION', service }, 8000, (response) => {
      console.log('Received response:', response);
      if (response && response.success) {
        statusEl.style.color = 'var(--success)';
        statusEl.innerText = 'Connection Successful!';
      } else {
        statusEl.style.color = 'var(--error)';
        statusEl.innerText = response?.error || 'Connection Failed (No details)';
      }
    });
  });
}

function saveSettingsSilently(callback) {
  try {
    const keka = {
      companyName: document.getElementById('keka-company').value,
      clientId: document.getElementById('keka-client-id').value,
      clientSecret: document.getElementById('keka-client-secret').value,
      apiKey: document.getElementById('keka-key').value,
      environment: 'keka.com'
    };
    
    const anthropicModel = document.getElementById('anthropic-select-model').value;
    const anthropicCustom = document.getElementById('anthropic-model').value;
    const finalAnthropicModel = anthropicModel === 'custom' ? anthropicCustom : anthropicModel;

    const ai = {
      anthropic: { 
        enabled: true, 
        apiKey: document.getElementById('anthropic-key').value,
        baseUrl: document.getElementById('anthropic-url').value,
        customModel: finalAnthropicModel,
        models: [finalAnthropicModel] 
      },
      openai: { 
        enabled: true, 
        apiKey: document.getElementById('openai-key').value, 
        models: [document.getElementById('openai-select-model').value] 
      },
      gemini: { 
        enabled: true, 
        apiKey: document.getElementById('gemini-key').value, 
        models: [document.getElementById('gemini-select-model').value] 
      }
    };
    
    chrome.storage.local.set({ keka_api_config: keka, ai_services_config: ai }, callback);
  } catch (error) {
    console.error('Error in saveSettingsSilently:', error);
    alert('UI Error: ' + error.message);
  }
}

function loadSettings() {
  chrome.storage.local.get(['keka_api_config', 'ai_services_config'], (result) => {
    const keka = result.keka_api_config || {};
    const ai = result.ai_services_config || {};
    
    if (keka.companyName) document.getElementById('keka-company').value = keka.companyName;
    if (keka.clientId) document.getElementById('keka-client-id').value = keka.clientId;
    if (keka.clientSecret) document.getElementById('keka-client-secret').value = keka.clientSecret;
    if (keka.apiKey) document.getElementById('keka-key').value = keka.apiKey;
    
    if (ai.anthropic?.apiKey) document.getElementById('anthropic-key').value = ai.anthropic.apiKey;
    if (ai.anthropic?.baseUrl) document.getElementById('anthropic-url').value = ai.anthropic.baseUrl;
    
    if (ai.anthropic?.models && ai.anthropic.models.length > 0) {
      const model = ai.anthropic.models[0];
      const select = document.getElementById('anthropic-select-model');
      if (Array.from(select.options).some(o => o.value === model)) {
        select.value = model;
      } else {
        select.value = 'custom';
        document.getElementById('anthropic-model').value = model;
      }
    } else if (ai.anthropic?.customModel) {
      document.getElementById('anthropic-model').value = ai.anthropic.customModel;
    }
    
    if (ai.openai?.apiKey) document.getElementById('openai-key').value = ai.openai.apiKey;
    if (ai.openai?.models && ai.openai.models.length > 0) document.getElementById('openai-select-model').value = ai.openai.models[0];
    
    if (ai.gemini?.apiKey) document.getElementById('gemini-key').value = ai.gemini.apiKey;
    if (ai.gemini?.models && ai.gemini.models.length > 0) document.getElementById('gemini-select-model').value = ai.gemini.models[0];
  });
}

function saveSettings() {
  saveSettingsSilently(() => {
    const msg = document.getElementById('status-msg');
    msg.style.color = 'var(--success)';
    msg.innerText = 'Settings saved successfully!';
    setTimeout(() => { msg.innerText = ''; }, 3000);
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
        callback(response);
      }
    });
  } catch (err) {
    if (isDone) return;
    isDone = true;
    clearTimeout(timer);
    callback({ success: false, error: 'SYNC_ERROR: ' + err.message });
  }
}
