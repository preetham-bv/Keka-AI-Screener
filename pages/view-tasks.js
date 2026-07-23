class ViewTasksPage {
  constructor() {
    this.pollingInterval = null;
    this.isPolling = false;
  }

  async init() {
    await this.loadTasks();
    this.startPolling();
  }

  async loadTasks() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_ALL_TASKS' }, async (response) => {
        const activeContainer = document.getElementById('active-tasks-container');
        const pastContainer = document.getElementById('past-tasks-container');
        
        if (response && response.success && response.tasks) {
          const activeTasks = response.tasks.filter(t => t.status === 'running');
          const pastTasks = response.tasks.filter(t => t.status !== 'running');
          
          // Backup expanded states for all tasks to prevent UI flickering
          const expandedStates = {};
          document.querySelectorAll('.task-card').forEach(card => {
            const taskId = card.id.replace('task-', '');
            const details = card.querySelector('.task-details');
            if (details && details.classList.contains('expanded')) {
              expandedStates[taskId] = true;
            }
          });
          
          const validActiveIds = activeTasks.map(t => `task-${t.taskId}`);
          const validPastIds = pastTasks.map(t => `task-${t.taskId}`);
          
          if (activeTasks.length > 0) {
            // Remove active cards that are no longer active
            Array.from(activeContainer.children).forEach(child => {
              if (child.classList.contains('task-card') && !validActiveIds.includes(child.id)) child.remove();
            });
            // Remove the 'No active tasks' message or 'Loading tasks...' message if present
            const emptyMsg = activeContainer.querySelector('.empty-tasks-msg, #loading-tasks-msg, div[style*="Loading tasks"]');
            if (emptyMsg) emptyMsg.remove();
            
            for (const task of activeTasks) {
              task._isExpanded = expandedStates[task.taskId] || false;
              await this.renderTask(task, activeContainer);
            }
          } else {
            activeContainer.innerHTML = '<div class="empty-tasks-msg" style="text-align: center; color: var(--text-secondary); margin-top: 20px;">No active tasks.</div>';
          }
          
          if (pastTasks.length > 0) {
            // Remove past cards that are no longer in pastTasks
            Array.from(pastContainer.children).forEach(child => {
              if (child.classList && child.classList.contains('task-card') && !validPastIds.includes(child.id)) {
                child.remove();
              }
            });
            // Remove the 'No past tasks' message if present
            const pastEmptyMsg = pastContainer.querySelector('.empty-tasks-msg');
            if (pastEmptyMsg) pastEmptyMsg.remove();

            pastTasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
            const groupedTasks = { today: [], previous: [] };
            const today = new Date().toDateString();

            pastTasks.forEach(task => {
              const date = new Date(task.createdAt);
              if (date.toDateString() === today) {
                groupedTasks.today.push(task);
              } else {
                groupedTasks.previous.push(task);
              }
            });

            const renderGroup = async (title, tasks, groupId) => {
              if (tasks.length === 0) return;
              let header = pastContainer.querySelector(`h4[data-group="${groupId}"]`);
              if (!header) {
                header = document.createElement('h4');
                header.style.cssText = "margin-top: 16px; margin-bottom: 8px; font-size: 14px; color: var(--text-secondary);";
                header.setAttribute('data-group', groupId);
                pastContainer.appendChild(header);
              }
              header.textContent = `${title} (${tasks.length})`;
              
              for (const task of tasks) {
                task._isExpanded = expandedStates[task.taskId] || false;
                await this.renderTask(task, pastContainer, header);
              }
            };

            await renderGroup('Today', groupedTasks.today, 'today');
            await renderGroup('Previous', groupedTasks.previous, 'previous');

          } else {
            pastContainer.innerHTML = '<div class="empty-tasks-msg" style="text-align: center; color: var(--text-secondary); margin-top: 20px; font-style: italic; font-size: 13px;">No past tasks</div>';
          }
        } else {
          if (!activeContainer.querySelector('.error-msg')) {
             activeContainer.innerHTML = '<div class="error-msg" style="color: var(--error); text-align: center;">Error loading tasks</div>';
             pastContainer.innerHTML = '';
          }
        }
        resolve();
      });
    });
  }

  async renderTask(task, container) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_TASK_STATUS', taskId: task.taskId }, (statusRes) => {
        chrome.runtime.sendMessage({ type: 'GET_CANDIDATES_BY_TASK', taskId: task.taskId }, (candRes) => {
          if (statusRes && statusRes.success && candRes && candRes.success) {
            const status = statusRes.status;
            const candidates = candRes.candidates || [];
            
            const isExpanded = task._isExpanded || false;
            
            const card = document.createElement('div');
            card.className = 'card glass task-card';
            card.id = `task-${task.taskId}`;
            
            // Worker states mapping
            const stages = ['pending', 'downloaded', 'parsed', 'assembling_prompt', 'prompt_ready', 'evaluating', 'evaluated', 'extracting_decision', 'decision_extracted', 'posting', 'posted'];
            
            // Generate candidates HTML (Worker Status Grid)
            const candidatesHtml = `
              <div style="overflow-x: auto; max-width: 100%;">
                <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                  <thead>
                    <tr style="border-bottom: 1px solid var(--border); color: var(--text-secondary);">
                      <th style="padding: 8px;">Candidate</th>
                      <th style="padding: 8px;">Status</th>
                      <th style="padding: 8px;">Worker</th>
                      <th style="padding: 8px;">Last Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${candidates.map(c => `
                      <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 8px; font-weight: 500;">${c.name || c.candidateId}</td>
                        <td style="padding: 8px;">
                          ${c.status === 'posted' ? '<span style="color:#10b981; font-weight: 600;">✓ Done</span>' : ''}
                          ${c.status === 'failed' ? '<span style="color:#ef4444; font-weight: 600;">✗ Failed</span>' : ''}
                          ${!['posted', 'failed'].includes(c.status) ? `<span style="color:var(--primary);">${c.status.replace('_', ' ')}</span>` : ''}
                        </td>
                        <td style="padding: 8px; color: var(--text-secondary);">${c.currentWorker || '-'}</td>
                        <td style="padding: 8px; color: #ef4444;">${c.lastError || '-'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;

            const newHtml = `
              <div class="task-header" data-task-id="${task.taskId}" style="cursor: pointer;">
                <div>
                  <h3 class="card-title" style="margin-bottom: 4px;">Job: ${task.config ? task.config.jobId : (task.snapshot ? task.snapshot.kekaJobId : 'Unknown')}</h3>
                  <div class="header-subtext" style="font-size: 12px; color: var(--text-secondary);">
                    Started: ${new Date(task.createdAt).toLocaleString()} • ${status.progress.completedCandidates}/${status.progress.totalCandidates} Candidates
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap: 12px;">
                  <span class="status-badge status-${status.status}">${status.status.toUpperCase()}</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron" style="transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0)'}; transition: 0.2s;">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
              
              <div class="task-details ${isExpanded ? 'expanded' : ''}" id="details-${task.taskId}">
                  <div class="progress-wrapper" style="margin-top: 0; margin-bottom: 16px;">
                    <div class="progress-fill" style="width: ${status.progress.percentage}%"></div>
                  </div>
                
                <h4 style="font-size: 13px; margin-bottom: 8px;">Worker Status Grid</h4>
                <div class="candidate-list" style="padding: 0;">
                  ${candidatesHtml || '<div style="padding:12px; font-size:12px; color:var(--text-secondary);">No candidates found.</div>'}
                </div>
                
                <h4 style="font-size: 13px; margin-top: 16px; margin-bottom: 8px;">Master Prompt Template</h4>
                <div style="font-size: 11px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; color: var(--text-secondary); border: 1px solid var(--border);">
${task.masterPromptTemplate || 'Not available'}
                </div>

                <h4 style="font-size: 13px; margin-top: 16px; margin-bottom: 8px;">Evaluation Configuration</h4>
                <div style="font-size: 12px; color: var(--text-secondary);">
                  AI Service: ${task.snapshot ? task.snapshot.aiService : 'Unknown'} (${task.snapshot ? task.snapshot.aiModel : 'Unknown'})
                </div>
                
                ${task.status === 'running' ? `
                  <button class="btn btn-cancel-task" data-task-id="${task.taskId}" style="margin-top: 16px; width: 100%; font-size: 12px; padding: 6px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2);">Cancel Task</button>
                ` : ''}
              </div>
            `;
            
            let existingCard = document.getElementById(`task-${task.taskId}`);
            
            if (!existingCard) {
              const card = document.createElement('div');
              card.className = 'card glass task-card';
              card.id = `task-${task.taskId}`;
              card.innerHTML = newHtml;
              
              // If we passed a header to insert after
              // (which renderGroup uses, but activeTasks doesn't pass a 3rd arg)
              const insertAfter = arguments[2];
              if (insertAfter) {
                // insert after the header or the last card in this group
                insertAfter.after(card);
              } else {
                container.appendChild(card);
              }
            } else {
              // Smart update instead of innerHTML replace
              const temp = document.createElement('div');
              temp.innerHTML = newHtml;
              
              // Update badge
              const oldBadge = existingCard.querySelector('.status-badge');
              const newBadge = temp.querySelector('.status-badge');
              if (oldBadge && newBadge && oldBadge.className !== newBadge.className) {
                oldBadge.className = newBadge.className;
                oldBadge.textContent = newBadge.textContent;
              }

              // Update subtext
              const oldSubtext = existingCard.querySelector('.header-subtext');
              const newSubtext = temp.querySelector('.header-subtext');
              if (oldSubtext && newSubtext && oldSubtext.textContent !== newSubtext.textContent) {
                 oldSubtext.textContent = newSubtext.textContent;
              }

              // Update progress
              const oldProgressWrapper = existingCard.querySelector('.progress-wrapper');
              const newProgressWrapper = temp.querySelector('.progress-wrapper');
              if (oldProgressWrapper && newProgressWrapper) {
                 const oldFill = oldProgressWrapper.querySelector('.progress-fill');
                 const newFill = newProgressWrapper.querySelector('.progress-fill');
                 if (oldFill && newFill && oldFill.style.width !== newFill.style.width) {
                   oldFill.style.width = newFill.style.width;
                 }
              } else if (!oldProgressWrapper && newProgressWrapper) {
                existingCard.querySelector('.task-details').insertAdjacentHTML('afterbegin', newProgressWrapper.outerHTML);
              } else if (oldProgressWrapper && !newProgressWrapper) {
                oldProgressWrapper.remove();
              }
              
              // Update candidate list securely
              const oldGrid = existingCard.querySelector('.candidate-list');
              const newGrid = temp.querySelector('.candidate-list');
              // Create a hash from candidate data to compare before touching innerHTML
              const candidateHash = JSON.stringify(candidates.map(c => [c.status, c.currentWorker, c.lastError]));
              if (oldGrid && newGrid && oldGrid.getAttribute('data-hash') !== candidateHash) {
                oldGrid.innerHTML = newGrid.innerHTML;
                oldGrid.setAttribute('data-hash', candidateHash);
              }
              
              // Update cancel button
              const oldCancel = existingCard.querySelector('.btn-cancel-task');
              const newCancel = temp.querySelector('.btn-cancel-task');
              if (oldCancel && !newCancel) oldCancel.remove();
              else if (!oldCancel && newCancel) existingCard.querySelector('.task-details').appendChild(newCancel);
            }
          }
          resolve();
        });
      });
    });
  }

  startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;
    
    const poll = async () => {
      if (!this.isPolling) return;
      if (!document.hidden) {
        await this.loadTasks();
      }
      this.pollingInterval = setTimeout(poll, 3000); // 3 seconds interval, chained
    };
    
    poll();
  }

  stopPolling() {
    this.isPolling = false;
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

let page;
document.addEventListener('DOMContentLoaded', () => {
  page = new ViewTasksPage();
  page.init();
  
  const pastTasksHeader = document.getElementById('past-tasks-header');
  if (pastTasksHeader) {
    pastTasksHeader.addEventListener('click', function(e) {
      if (e.target.closest('#btn-clear-past')) return;
      document.getElementById('past-tasks-container').classList.toggle('hidden'); 
      this.querySelector('.chevron').classList.toggle('rotated');
    });
  }

  const btnClearPast = document.getElementById('btn-clear-past');
  if (btnClearPast) {
    btnClearPast.addEventListener('click', (e) => {
      e.stopPropagation();
      if(confirm('Are you sure you want to clear all past tasks? This cannot be undone.')) {
        chrome.runtime.sendMessage({ type: 'CLEAR_PAST_TASKS' }, (response) => {
          if (response && response.success) {
            if (page) page.loadTasks();
          }
        });
      }
    });
  }

  // Event delegation for toggle and cancel buttons
  document.body.addEventListener('click', (e) => {
    const header = e.target.closest('.task-header[data-task-id]');
    if (header) {
      const taskId = header.getAttribute('data-task-id');
      const details = document.getElementById(`details-${taskId}`);
      const chevron = header.querySelector('.chevron');
      if (details && chevron) {
        if (details.classList.contains('expanded')) {
          details.classList.remove('expanded');
          chevron.style.transform = 'rotate(0)';
        } else {
          details.classList.add('expanded');
          chevron.style.transform = 'rotate(180deg)';
        }
      }
    }

    const cancelBtn = e.target.closest('.btn-cancel-task');
    if (cancelBtn) {
      const taskId = cancelBtn.getAttribute('data-task-id');
      if(confirm('Are you sure you want to cancel this task?')) {
        chrome.runtime.sendMessage({ type: 'CANCEL_TASK', taskId, reason: 'User triggered' }, () => {
          if (page) page.loadTasks();
        });
      }
    }
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && page) {
    page.stopPolling();
  } else if (!document.hidden && page) {
    page.startPolling();
  }
});
