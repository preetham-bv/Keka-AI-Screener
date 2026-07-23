import { StorageManager } from '../services/storage-manager.js';

document.addEventListener('DOMContentLoaded', async () => {
  let currentStep = 1;
  const totalSteps = 4;
  
  // UI Elements
  const steps = [
    document.getElementById('step-1'),
    document.getElementById('step-2'),
    document.getElementById('step-3'),
    document.getElementById('step-4')
  ];
  const dots = [
    document.getElementById('dot-1'),
    document.getElementById('dot-2'),
    document.getElementById('dot-3'),
    document.getElementById('dot-4')
  ];
  
  const btnNext = document.getElementById('btn-next');
  const btnPrev = document.getElementById('btn-prev');
  const btnStart = document.getElementById('btn-start');
  const statusMsg = document.getElementById('status-msg');
  
  // Form Elements
  const selectJob = document.getElementById('select-job');
  const candidateList = document.getElementById('candidate-list');
  const selectJd = document.getElementById('select-jd');
  const selectPrompt = document.getElementById('select-prompt');
  const selectAi = document.getElementById('select-ai');
  
  // Summary Elements
  const summaryJob = document.getElementById('summary-job');
  const summaryCandidates = document.getElementById('summary-candidates');
  const summaryJd = document.getElementById('summary-jd');
  const summaryPrompt = document.getElementById('summary-prompt');
  const summaryAi = document.getElementById('summary-ai');

  // Filter Elements removed

  // Cost Elements
  const costInput = document.getElementById('cost-input');
  const costOutput = document.getElementById('cost-output');
  const costTotal = document.getElementById('cost-total');

  let currentCandidates = [];
  let currentJobId = null;
  let kbData = { jds: [], prompts: [] };

  // Init
  loadKB();
  fetchJobs();

  // Wizard Navigation
  btnNext.addEventListener('click', () => {
    if (validateStep(currentStep)) {
      if (currentStep < totalSteps) {
        if (currentStep === totalSteps - 1) {
          updateSummary();
        }
        currentStep++;
        updateWizardUI();
      }
    }
  });

  btnPrev.addEventListener('click', () => {
    if (currentStep > 1) {
      currentStep--;
      updateWizardUI();
    }
  });

  function updateWizardUI() {
    steps.forEach((el, index) => {
      el.classList.toggle('active', index === currentStep - 1);
    });
    
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === currentStep - 1);
      dot.classList.toggle('completed', index < currentStep - 1);
    });

    btnPrev.style.visibility = currentStep === 1 ? 'hidden' : 'visible';
    
    if (currentStep === totalSteps) {
      btnNext.style.display = 'none';
      btnStart.style.display = 'block';
    } else {
      btnNext.style.display = 'block';
      btnStart.style.display = 'none';
    }
    statusMsg.innerText = '';
  }

  function validateStep(step) {
    statusMsg.style.color = 'var(--error)';
    if (step === 1) {
      if (!selectJob.value) {
        statusMsg.innerText = 'Please select a job to continue.';
        return false;
      }
    } else if (step === 2) {
      const selected = document.querySelectorAll('.candidate-cb:checked');
      if (selected.length === 0) {
        statusMsg.innerText = 'Please select at least one candidate.';
        return false;
      }
    } else if (step === 3) {
      if (!selectJd.value || !selectPrompt.value) {
        statusMsg.innerText = 'Please select both JD and Prompt from the Knowledge Base.';
        return false;
      }
    }
    statusMsg.innerText = '';
    return true;
  }

  function updateSummary() {
    const jobText = selectJob.options[selectJob.selectedIndex]?.text || 'None';
    summaryJob.innerText = jobText;
    
    const selectedCbs = document.querySelectorAll('.candidate-cb:checked');
    summaryCandidates.innerText = `${selectedCbs.length} candidate(s) selected`;
    
    const jdText = selectJd.options[selectJd.selectedIndex]?.text || 'None';
    summaryJd.innerText = jdText;
    
    const promptText = selectPrompt.options[selectPrompt.selectedIndex]?.text || 'None';
    summaryPrompt.innerText = promptText;
    
    const aiText = selectAi.options[selectAi.selectedIndex]?.text || 'None';
    summaryAi.innerText = aiText;

    // Update estimated cost
    const service = selectAi.value;
    let inCost = 0.003;
    let outCost = 0.015;
    if (service === 'openai') {
      inCost = 0.01; outCost = 0.03;
    } else if (service === 'gemini') {
      inCost = 0.0035; outCost = 0.0105;
    }
    
    costInput.innerText = `~$${inCost}/1K tokens`;
    costOutput.innerText = `~$${outCost}/1K tokens`;
    
    const minCost = (inCost * 2 + outCost * 0.5) * selectedCbs.length;
    const maxCost = (inCost * 4 + outCost * 1.5) * selectedCbs.length;
    costTotal.innerText = `~$${minCost.toFixed(2)} - $${maxCost.toFixed(2)} total`;
  }

  // Load KB items
  async function loadKB() {
    const data = await chrome.storage.local.get(['kb_jds', 'kb_prompts']);
    kbData.jds = data.kb_jds || [];
    kbData.prompts = data.kb_prompts || [];
    
    selectJd.innerHTML = '<option value="">Select JD from Knowledge Base</option>' + 
      kbData.jds.map(jd => `<option value="${jd.id}">${jd.title}</option>`).join('');
      
    selectPrompt.innerHTML = '<option value="">Select Prompt from Knowledge Base</option>' + 
      kbData.prompts.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
  }

  // Fetch Jobs
  function fetchJobs() {
    chrome.runtime.sendMessage({ type: 'FETCH_JOBS' }, (response) => {
      if (response && response.success) {
        if (response.jobs.length === 0) {
          selectJob.innerHTML = '<option value="">No open jobs found</option>';
        } else {
          selectJob.innerHTML = '<option value="">-- Select a Job --</option>' + 
            response.jobs.map(job => `<option value="${job.id}">${job.title}</option>`).join('');
        }
      } else {
        selectJob.innerHTML = '<option value="">Error loading jobs. Check settings.</option>';
        console.error(response?.error);
      }
    });
  }

  function fetchCandidates(jobId) {
    candidateList.innerHTML = '<div class="loading-spinner">Fetching candidates...</div>';
    
    // Pass null or empty for stage to fetch all candidates
    chrome.runtime.sendMessage({ type: 'FETCH_CANDIDATES', jobId, stage: null }, (response) => {
      if (response && response.success) {
        currentCandidates = response.candidates || [];

        if (currentCandidates.length === 0) {
          candidateList.innerHTML = `<div class="loading-spinner">No candidates found for this job.</div>`;
        } else {
          candidateList.innerHTML = currentCandidates.map(c => `
            <label class="candidate-item">
              <input type="checkbox" value="${c.id}" class="candidate-cb" checked>
              <div class="candidate-info" style="display: flex; flex-direction: column; gap: 2px;">
                <span class="candidate-name" style="font-weight: 500; color: var(--text-primary); text-transform: capitalize;">${(c.firstName || '') + ' ' + (c.lastName || '')}</span>
                <span class="candidate-email" style="font-size: 11px; color: var(--text-secondary); text-transform: lowercase; font-weight: normal;">${c.email || c.id}</span>
              </div>
            </label>
          `).join('');
        }
      } else {
        candidateList.innerHTML = '<div class="loading-spinner" style="color:var(--error)">Failed to load candidates.</div>';
        console.error(response?.error);
      }
    });
  }

  // Fetch Candidates when job changes
  selectJob.addEventListener('change', (e) => {
    currentJobId = e.target.value;
    if (!currentJobId) {
      candidateList.innerHTML = '<div class="loading-spinner">Select a job to load candidates...</div>';
      currentCandidates = [];
      return;
    }
    fetchCandidates(currentJobId);
  });

  // Select/Deselect All
  const selectAllCb = document.getElementById('select-all-candidates');
  if (selectAllCb) {
    selectAllCb.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      const checkboxes = document.querySelectorAll('.candidate-cb');
      checkboxes.forEach(cb => cb.checked = isChecked);
    });
  }

  // Update "Select All" if individual checkboxes are manually changed
  candidateList.addEventListener('change', (e) => {
    if (e.target.classList.contains('candidate-cb')) {
      const allCbs = document.querySelectorAll('.candidate-cb');
      const allChecked = Array.from(allCbs).every(cb => cb.checked);
      const someChecked = Array.from(allCbs).some(cb => cb.checked);
      selectAllCb.checked = allChecked;
      selectAllCb.indeterminate = someChecked && !allChecked;
    }
  });

  // Start task
  btnStart.addEventListener('click', async () => {
    const jobId = selectJob.value;
    const jdId = selectJd.value;
    const promptId = selectPrompt.value;
    const aiService = selectAi.value;
    
    // Fetch the correct model from settings
    const { ai_services_config } = await chrome.storage.local.get('ai_services_config');
    let aiModel = 'unknown';
    if (ai_services_config && ai_services_config[aiService] && ai_services_config[aiService].models) {
      aiModel = ai_services_config[aiService].models[0];
    } else {
      // Fallbacks if not set
      aiModel = aiService === 'anthropic' ? 'claude-3-5-sonnet-20241022' : (aiService === 'gemini' ? 'gemini-1.5-pro' : 'gpt-4');
    }
    
    const checkboxes = document.querySelectorAll('.candidate-cb:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    
    const selectedJd = kbData.jds.find(j => j.id === jdId);
    const selectedPrompt = kbData.prompts.find(p => p.id === promptId);
    
    const candidates = currentCandidates
      .filter(c => selectedIds.includes(c.id))
      .map(c => ({ 
        candidateId: c.id, 
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim() 
      }));
    
    const config = {
      jobId,
      jdContent: selectedJd.content,
      promptContent: selectedPrompt.content,
      aiService,
      aiModel,
      candidates
    };
    
    btnStart.disabled = true;
    btnPrev.disabled = true;
    statusMsg.style.color = 'var(--text-secondary)';
    statusMsg.innerText = 'Creating task...';
    
    chrome.runtime.sendMessage({ type: 'CREATE_TASK', config }, (response) => {
      if (response && response.success) {
        statusMsg.style.color = 'var(--primary)';
        statusMsg.innerText = 'Task created successfully! Redirecting...';
        setTimeout(() => {
          window.location.href = 'view-tasks.html';
        }, 1500);
      } else {
        btnStart.disabled = false;
        btnPrev.disabled = false;
        statusMsg.style.color = 'var(--error)';
        statusMsg.innerText = response?.error || 'Failed to create task';
      }
    });
  });

});
