/* ========================================================================
   Hiring Agent — Web UI Client
   Handles file upload, SSE progress streaming, and results rendering.
   ======================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // ---- DOM refs ----
  const uploadZone     = document.getElementById('upload-zone');
  const fileInput      = document.getElementById('file-input');
  const fileInfoName   = document.getElementById('file-info-name');
  const fileInfoSize   = document.getElementById('file-info-size');
  const removeFileBtn  = document.getElementById('remove-file-btn');
  const roleSelect     = document.getElementById('role-select');
  const evaluateBtn    = document.getElementById('evaluate-btn');
  const evaluateBtnText= document.getElementById('evaluate-btn-text');
  const progressSection= document.getElementById('progress-section');
  const progressBarFill= document.getElementById('progress-bar-fill');
  const resultsSection = document.getElementById('results-section');
  const errorBanner    = document.getElementById('error-banner');
  const errorMessage   = document.getElementById('error-message');
  const retryBtn       = document.getElementById('retry-btn');

  let selectedFile = null;

  // ---- Load roles ----
  async function loadRoles() {
    try {
      const resp = await fetch('/api/roles');
      const data = await resp.json();
      roleSelect.innerHTML = '';
      data.roles.forEach(role => {
        const opt = document.createElement('option');
        opt.value = role;
        opt.textContent = role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        roleSelect.appendChild(opt);
      });
    } catch (err) {
      roleSelect.innerHTML = '<option value="">Failed to load roles</option>';
    }
  }
  loadRoles();

  // ---- Drag & Drop ----
  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileSelect(files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFileSelect(fileInput.files[0]);
  });

  removeFileBtn.addEventListener('click', e => {
    e.stopPropagation();
    clearFile();
  });

  function handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showError('Invalid file type', 'Please upload a PDF file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      showError('File too large', 'Maximum file size is 50 MB.');
      return;
    }
    selectedFile = file;
    fileInfoName.textContent = file.name;
    fileInfoSize.textContent = formatSize(file.size);
    uploadZone.classList.add('has-file');
    hideError();
    updateEvaluateBtn();
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    uploadZone.classList.remove('has-file');
    updateEvaluateBtn();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function updateEvaluateBtn() {
    evaluateBtn.disabled = !selectedFile || !roleSelect.value;
  }
  roleSelect.addEventListener('change', updateEvaluateBtn);

  // ---- Evaluate ----
  evaluateBtn.addEventListener('click', startEvaluation);
  retryBtn.addEventListener('click', startEvaluation);

  async function startEvaluation() {
    if (!selectedFile || !roleSelect.value) return;

    // Reset UI
    hideError();
    hideResults();
    showProgress();
    evaluateBtn.disabled = true;
    evaluateBtnText.innerHTML = '<span class="spinner"></span> Evaluating…';

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('role', roleSelect.value);

    try {
      const resp = await fetch('/api/evaluate', {
        method: 'POST',
        body: formData,
      });

      // Check for SSE streaming
      const contentType = resp.headers.get('Content-Type') || '';

      if (contentType.includes('text/event-stream')) {
        await handleSSE(resp);
      } else {
        // Non-streaming JSON response
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.error || 'Evaluation failed');
        }
        hideProgress();
        renderResults(data);
      }
    } catch (err) {
      hideProgress();
      showError('Evaluation Failed', err.message || 'Something went wrong. Please try again.');
    } finally {
      evaluateBtn.disabled = false;
      evaluateBtnText.innerHTML = 'Evaluate Resume';
      updateEvaluateBtn();
    }
  }

  // ---- SSE Handler ----
  async function handleSSE(resp) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        } else if (line === '') {
          // End of event
          if (eventType && eventData) {
            try {
              const parsed = JSON.parse(eventData);
              handleSSEEvent(eventType, parsed);
            } catch (e) {
              // skip malformed events
            }
          }
          eventType = '';
          eventData = '';
        }
      }
    }
  }

  function handleSSEEvent(type, data) {
    switch (type) {
      case 'progress':
        updateProgress(data.step, data.message, data.percent);
        break;
      case 'result':
        hideProgress();
        renderResults(data);
        break;
      case 'error':
        hideProgress();
        showError('Evaluation Failed', data.error || 'Unknown error');
        break;
    }
  }

  // ---- Progress UI ----
  const PROGRESS_STEPS = [
    { id: 'extract',  label: 'Extracting data from PDF…' },
    { id: 'github',   label: 'Fetching GitHub profile…' },
    { id: 'evaluate', label: 'Running AI evaluation…' },
    { id: 'complete', label: 'Generating results…' },
  ];

  function showProgress() {
    progressSection.classList.add('visible');
    progressBarFill.style.width = '0%';

    const stepsContainer = document.getElementById('progress-steps');
    stepsContainer.innerHTML = PROGRESS_STEPS.map(s =>
      `<div class="progress-step" id="step-${s.id}">
        <span class="progress-step__icon">○</span>
        <span>${s.label}</span>
      </div>`
    ).join('');
  }

  function updateProgress(step, message, percent) {
    progressBarFill.style.width = (percent || 0) + '%';

    // Update step states
    const stepIndex = PROGRESS_STEPS.findIndex(s => s.id === step);
    PROGRESS_STEPS.forEach((s, i) => {
      const el = document.getElementById(`step-${s.id}`);
      if (!el) return;
      el.classList.remove('active', 'done');
      if (i < stepIndex) {
        el.classList.add('done');
        el.querySelector('.progress-step__icon').textContent = '✓';
      } else if (i === stepIndex) {
        el.classList.add('active');
        el.querySelector('.progress-step__icon').textContent = '●';
      }
    });
  }

  function hideProgress() {
    progressSection.classList.remove('visible');
  }

  // ---- Results Rendering ----
  function renderResults(data) {
    resultsSection.classList.add('visible');

    const { evaluation, candidate_name, role_info } = data;
    const maxScore = role_info.categories.reduce((sum, c) => sum + c.max, 0);

    // Calculate total
    let totalScore = 0;
    if (evaluation.scores) {
      for (const [key, cat] of Object.entries(evaluation.scores)) {
        totalScore += Math.min(cat.score, cat.max);
      }
    }
    if (evaluation.bonus_points) totalScore += evaluation.bonus_points.total;
    if (evaluation.deductions) totalScore -= evaluation.deductions.total;
    totalScore = Math.max(role_info.min_final_score, Math.min(totalScore, role_info.max_final_score));

    // Score color
    const pct = maxScore > 0 ? totalScore / maxScore : 0;
    let scoreColor;
    if (pct >= 0.7) scoreColor = 'var(--score-high)';
    else if (pct >= 0.4) scoreColor = 'var(--score-mid)';
    else scoreColor = 'var(--score-low)';

    // Render overall score ring
    renderScoreRing(totalScore, maxScore, scoreColor, candidate_name);

    // Render category scores
    renderCategoryScores(evaluation.scores, role_info.categories, maxScore);

    // Render bonus & deductions
    renderBonusDeductions(evaluation.bonus_points, evaluation.deductions);

    // Render strengths & improvements
    renderStrengthsImprovements(evaluation.key_strengths, evaluation.areas_for_improvement);
  }

  function renderScoreRing(total, max, color, candidateName) {
    const ring = document.getElementById('score-ring-fill');
    const numberEl = document.getElementById('score-number');
    const maxEl = document.getElementById('score-max');
    const candidateEl = document.getElementById('candidate-name');

    // Circumference: 2πr = 2 * π * 80 ≈ 502
    const circumference = 502;
    const pct = max > 0 ? Math.max(0, total) / max : 0;
    const offset = circumference - (pct * circumference);

    ring.style.stroke = color;
    ring.style.setProperty('--ring-color', color);

    // Animate after a short delay
    requestAnimationFrame(() => {
      setTimeout(() => {
        ring.style.strokeDashoffset = offset;
      }, 100);
    });

    // Animate number counting
    animateCounter(numberEl, 0, Math.round(total), 1200);
    maxEl.textContent = '/ ' + max;
    candidateEl.textContent = candidateName || 'Candidate';
  }

  function animateCounter(el, from, to, duration) {
    const start = performance.now();
    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  function renderCategoryScores(scores, categories) {
    const container = document.getElementById('category-scores');
    container.innerHTML = '';

    categories.forEach(cat => {
      const score = scores?.[cat.key];
      if (!score) return;

      const capped = Math.min(score.score, cat.max);
      const pct = cat.max > 0 ? (capped / cat.max) * 100 : 0;
      let barColor;
      if (pct >= 70) barColor = 'var(--score-high)';
      else if (pct >= 40) barColor = 'var(--score-mid)';
      else barColor = 'var(--score-low)';

      const div = document.createElement('div');
      div.className = 'category-score';
      div.innerHTML = `
        <div class="category-score__header">
          <span class="category-score__name">${cat.icon || '•'} ${cat.label}</span>
          <span class="category-score__value" style="color:${barColor}">${capped}/${cat.max}</span>
        </div>
        <div class="category-score__bar-track">
          <div class="category-score__bar-fill" style="background:${barColor}"></div>
        </div>
        <div class="category-score__evidence">${score.evidence || ''}</div>
      `;
      container.appendChild(div);

      // Animate bar fill
      requestAnimationFrame(() => {
        setTimeout(() => {
          div.querySelector('.category-score__bar-fill').style.width = pct + '%';
        }, 200);
      });
    });
  }

  function renderBonusDeductions(bonus, deductions) {
    const container = document.getElementById('bonus-deductions');

    const bonusTotal = bonus?.total ?? 0;
    const bonusBreakdown = bonus?.breakdown || 'None';
    const deductTotal = deductions?.total ?? 0;
    const deductReasons = deductions?.reasons || 'None';

    container.innerHTML = `
      <div class="bd-card">
        <div class="bd-card__label"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-top: -2px; margin-right: 4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>Bonus Points</div>
        <div class="bd-card__value bd-card__value--bonus">+${bonusTotal}</div>
        <div class="bd-card__detail">${bonusBreakdown}</div>
      </div>
      <div class="bd-card">
        <div class="bd-card__label"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-top: -2px; margin-right: 4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>Deductions</div>
        <div class="bd-card__value bd-card__value--deduction">${deductTotal > 0 ? '-' + deductTotal : '0'}</div>
        <div class="bd-card__detail">${deductReasons}</div>
      </div>
    `;
  }

  function renderStrengthsImprovements(strengths, improvements) {
    const container = document.getElementById('strengths-improvements');

    const strengthItems = (strengths || []).map(s => `<li>${s}</li>`).join('') || '<li>None identified</li>';
    const improvementItems = (improvements || []).map(s => `<li>${s}</li>`).join('') || '<li>None identified</li>';

    container.innerHTML = `
      <div class="si-card">
        <div class="si-card__title si-card__title--strengths"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-top: -2px; margin-right: 4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>Key Strengths</div>
        <ul class="si-list si-list--strengths">${strengthItems}</ul>
      </div>
      <div class="si-card">
        <div class="si-card__title si-card__title--improvements"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-top: -2px; margin-right: 4px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>Areas for Improvement</div>
        <ul class="si-list si-list--improvements">${improvementItems}</ul>
      </div>
    `;
  }

  // ---- Error Handling ----
  function showError(title, message) {
    document.getElementById('error-title').textContent = title;
    errorMessage.textContent = message;
    errorBanner.classList.add('visible');
  }

  function hideError() {
    errorBanner.classList.remove('visible');
  }

  function hideResults() {
    resultsSection.classList.remove('visible');
  }
});
