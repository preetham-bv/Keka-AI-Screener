
document.addEventListener('DOMContentLoaded', async () => {
  const jdListEl = document.getElementById('jd-list');
  const promptListEl = document.getElementById('prompt-list');
  const modal = document.getElementById('kb-modal');
  const modalTitle = document.getElementById('modal-title');
  const inputTitle = document.getElementById('modal-input-title');
  const inputContent = document.getElementById('modal-input-content');
  const modalStatus = document.getElementById('modal-status');
  
  let currentType = null; // 'jd' or 'prompt'
  let currentEditId = null; // null if adding new

  const defaultPrompts = [
    {
      id: 'default-prompt-1',
      title: 'Standard Resume Evaluator',
      content: 'Review the resume against the JD. Output Decision: [Strong/Good/Manual Check/Reject] and Confidence: [High/Medium/Low] at the top.'
    }
  ];

  async function loadData() {
    const data = await chrome.storage.local.get(['kb_jds', 'kb_prompts']);
    const jds = data.kb_jds || [];
    let prompts = data.kb_prompts;
    
    // Seed default prompt if empty
    if (!prompts) {
      prompts = defaultPrompts;
      await chrome.storage.local.set({ kb_prompts: prompts });
    }

    renderList(jdListEl, jds, 'jd');
    renderList(promptListEl, prompts, 'prompt');
  }

  function renderList(container, items, type) {
    if (!items || items.length === 0) {
      container.innerHTML = `<p style="font-size: 13px; color: var(--text-secondary); font-style: italic;">No items found.</p>`;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="kb-item">
        <div class="kb-item-title">${escapeHtml(item.title)}</div>
        <div class="kb-item-desc">${escapeHtml(item.content)}</div>
        <div class="kb-item-actions">
          <button class="btn btn-secondary btn-edit" data-type="${type}" data-id="${item.id}">Edit</button>
          <button class="btn btn-secondary btn-delete" data-type="${type}" data-id="${item.id}" style="color: var(--error); border-color: var(--error);">Delete</button>
        </div>
      </div>
    `).join('');

    // Attach event listeners for edit/delete
    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => openModal(e.target.dataset.type, e.target.dataset.id));
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => deleteItem(e.target.dataset.type, e.target.dataset.id));
    });
  }

  async function openModal(type, editId = null) {
    currentType = type;
    currentEditId = editId;
    modalStatus.innerText = '';
    
    if (editId) {
      modalTitle.innerText = `Edit ${type === 'jd' ? 'JD' : 'Prompt'}`;
      const data = await chrome.storage.local.get(type === 'jd' ? 'kb_jds' : 'kb_prompts');
      const items = data[type === 'jd' ? 'kb_jds' : 'kb_prompts'] || [];
      const item = items.find(i => i.id === editId);
      if (item) {
        inputTitle.value = item.title;
        inputContent.value = item.content;
      }
    } else {
      modalTitle.innerText = `Add New ${type === 'jd' ? 'JD' : 'Prompt'}`;
      inputTitle.value = '';
      inputContent.value = '';
    }
    
    modal.classList.add('active');
  }

  function closeModal() {
    modal.classList.remove('active');
    currentType = null;
    currentEditId = null;
  }

  async function saveItem() {
    const title = inputTitle.value.trim();
    const content = inputContent.value.trim();
    
    if (!title || !content) {
      modalStatus.style.color = 'var(--error)';
      modalStatus.innerText = 'Title and content are required.';
      return;
    }

    modalStatus.innerText = 'Saving...';
    modalStatus.style.color = 'var(--text-secondary)';

    const key = currentType === 'jd' ? 'kb_jds' : 'kb_prompts';
    const data = await chrome.storage.local.get(key);
    let items = data[key] || [];

    if (currentEditId) {
      const idx = items.findIndex(i => i.id === currentEditId);
      if (idx !== -1) {
        items[idx].title = title;
        items[idx].content = content;
      }
    } else {
      items.push({
        id: 'kb_' + Date.now().toString(36),
        title,
        content
      });
    }

    await chrome.storage.local.set({ [key]: items });
    closeModal();
    await loadData();
  }

  async function deleteItem(type, id) {
    if (!confirm('Are you sure you want to delete this item?')) return;
    const key = type === 'jd' ? 'kb_jds' : 'kb_prompts';
    const data = await chrome.storage.local.get(key);
    let items = data[key] || [];
    items = items.filter(i => i.id !== id);
    await chrome.storage.local.set({ [key]: items });
    await loadData();
  }

  // Escape HTML helper to prevent XSS
  function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
  }

  // Event Listeners
  document.getElementById('btn-add-jd').addEventListener('click', () => openModal('jd'));
  document.getElementById('btn-add-prompt').addEventListener('click', () => openModal('prompt'));
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-modal-save').addEventListener('click', saveItem);

  // Load initial data
  loadData();
});
