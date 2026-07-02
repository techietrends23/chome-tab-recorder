(function(){ if (window.__TRP_OVERLAY) { window.__trpSyncOverlayFromBackground && window.__trpSyncOverlayFromBackground(); return; }
class RecorderOverlay {
  constructor() {
    this.active = false;
    this.activeTool = null;
    this.color = '#ff0000';
    this.strokeWidth = 3;
    this.textSize = 18;
    this.clickHighlightEnabled = false;
    this.clickCircleEnabled = true;
    this.clickArrowEnabled = true;
    this.isPaused = false;
    this.hideToolbarInRecording = true;
    this.toolbarPinnedOpen = false;
    this.theme = 'dark';
    this.controlActionInFlight = false;
    this.controlButtons = [];

    this.container = null;
    this.effectLayer = null;
    this.canvas = null;
    this.ctx = null;
    this.highlightLayer = null;
    this.badge = null;
    this.toolbar = null;
    this.toolButtons = {};
    this.pauseBtn = null;
    this.stopBtn = null;
    this.themeBtn = null;
    this.pinBtn = null;

    this.isDrawing = false;
    this.isErasing = false;
    this.currentPath = null;
    this.currentShape = null;
    this.currentArea = null;
    this.paths = [];
    this.shapes = [];
    this.textElements = [];
    this.highlightedElements = [];
    this.areaElements = [];
    this.annotationHistory = [];
    this.annotationRevision = 0;
    this.annotationPersistTimer = null;

    this.boundHandlers = {};
  }

  // ---------- lifecycle ----------

  activate() {
    if (this.active) return;
    this.createElements();
    this.buildToolbar();
    this.bindEvents();
    this.active = true;
    this.loadSettings();
  }

  deactivate() {
    if (!this.active) return;
    this.unbindEvents();
    this.removeElements();
    this.active = false;
    this.activeTool = null;
    this.paths = [];
    this.shapes = [];
    this.textElements = [];
    this.highlightedElements = [];
    this.areaElements = [];
    this.annotationHistory = [];
    this.annotationRevision = 0;
  }

  startSession(isPaused, startedAt, options = {}) {
    this.activate();
    this.isPaused = !!isPaused;
    this.hideToolbarInRecording = options.hideToolbarInRecording !== false;
    this.startedAt = startedAt || Date.now();
    if (options.annotationState) {
      this.restoreAnnotationState(options.annotationState);
    }
    this.showToolbar();
    this.updateToolbarVisibilityMode();
    this.showRecordingBadge(this.isPaused);
    this.updatePauseButton();
    if (this.isPaused) this.stopTimer(); else this.startTimer();
  }

  endSession() {
    if (!this.active) return;
    this.stopTimer();
    this.clearAll({ persist: false });
    this.deactivate();
  }

  startTimer() {
    this.stopTimer();
    const tick = () => {
      if (!this.timerEl || !this.startedAt) return;
      const e = Math.floor((Date.now() - this.startedAt) / 1000);
      this.timerEl.textContent =
        `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
    };
    tick();
    this.timerInterval = setInterval(tick, 250);
  }

  stopTimer() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }

  loadSettings() {
    try {
      chrome.storage.sync.get(
        ['color', 'strokeWidth', 'defaultColor', 'defaultStrokeWidth', 'toolbarTheme', 'clickHighlightEnabled', 'clickCircleEnabled', 'clickArrowEnabled', 'tool', 'toolbarPinnedOpen'],
        (s) => {
          const color = s.color || s.defaultColor;
          const width = s.strokeWidth || s.defaultStrokeWidth;
          if (color) this.setColor(color);
          if (width) this.setStrokeWidth(width);
          if (this.colorInput && color) this.colorInput.value = color;
          if (this.strokeInput && width) {
            this.strokeInput.value = width;
            this.strokeValue.textContent = width;
          }
          this.applyTheme(s.toolbarTheme || 'dark');
          if (typeof s.clickHighlightEnabled === 'boolean') {
            this.toggleClickHighlight(s.clickHighlightEnabled);
            if (this.toolButtons.__highlight) {
              this.toolButtons.__highlight.classList.toggle('active', s.clickHighlightEnabled);
            }
          }
          if (typeof s.clickCircleEnabled === 'boolean') {
            this.clickCircleEnabled = s.clickCircleEnabled;
            if (this.toolButtons.__circle) {
              this.toolButtons.__circle.classList.toggle('active', s.clickCircleEnabled);
            }
          }
          if (typeof s.clickArrowEnabled === 'boolean') {
            this.clickArrowEnabled = s.clickArrowEnabled;
            if (this.toolButtons.__arrow) {
              this.toolButtons.__arrow.classList.toggle('active', s.clickArrowEnabled);
            }
          }
          if (typeof s.toolbarPinnedOpen === 'boolean') {
            this.toolbarPinnedOpen = s.toolbarPinnedOpen;
          }
          if (typeof s.tool === 'string' && this.toolButtons[s.tool]) {
            this.setTool(s.tool);
            this.updateToolButtonStates(s.tool);
          }
          this.updatePinButton();
          this.updateToolbarVisibilityMode();
        }
      );
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- DOM ----------

  createElements() {
    this.container = document.createElement('div');
    this.container.id = 'trp-overlay';

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'trp-canvas';
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx = this.canvas.getContext('2d');

    this.highlightLayer = document.createElement('div');
    this.highlightLayer.id = 'trp-highlight-layer';

    this.effectLayer = document.createElement('div');
    this.effectLayer.id = 'trp-effect-layer';

    this.badge = document.createElement('div');
    this.badge.id = 'trp-recording-badge';
    this.badge.style.display = 'none';

    this.container.appendChild(this.effectLayer);
    this.container.appendChild(this.canvas);
    this.container.appendChild(this.highlightLayer);
    document.documentElement.appendChild(this.container);
    document.documentElement.appendChild(this.badge);
  }

  removeElements() {
    const remove = (el) => { if (el && el.parentNode) el.parentNode.removeChild(el); };
    remove(this.container);
    remove(this.badge);
    remove(this.toolbar);
    this.textElements.forEach(({ el }) => remove(el));
    this.highlightedElements.forEach(({ el }) => remove(el));
    this.areaElements.forEach(({ el }) => remove(el));
    this.container = this.effectLayer = this.canvas = this.ctx = this.highlightLayer = this.badge = this.toolbar = null;
    this.toolButtons = {};
    this.pauseBtn = null;
    this.stopBtn = null;
    this.themeBtn = null;
    this.pinBtn = null;
    this.controlButtons = [];
    if (this.annotationPersistTimer) {
      clearTimeout(this.annotationPersistTimer);
      this.annotationPersistTimer = null;
    }
  }

  buildToolbar() {
    const bar = document.createElement('div');
    bar.id = 'trp-toolbar';

    const handle = document.createElement('div');
    handle.className = 'trp-tb-handle';
    handle.title = 'Drag to move';
    handle.innerHTML = '<span class="trp-drag-grip">⋮⋮</span><span class="trp-rec-dot"></span><span class="trp-tb-timer">00:00</span>';
    bar.appendChild(handle);
    this.timerEl = handle.querySelector('.trp-tb-timer');

    const tools = [
      { tool: 'pen', label: '✎', title: 'Pen' },
      { tool: 'highlighter', label: '🖍', title: 'Highlighter' },
      { tool: 'text', label: 'T', title: 'Text' },
      { tool: 'square', label: '□', title: 'Square' },
      { tool: 'filled-rect', label: '■', title: 'Filled rectangle' },
      { tool: 'arrow', label: '↗', title: 'Arrow callout' },
      { tool: 'blur', label: '▒', title: 'Blur area' },
      { tool: 'board', label: '▤', title: 'Whiteboard area' },
      { tool: 'eraser', label: '⌫', title: 'Eraser' },
    ];
    const toolGroup = document.createElement('div');
    toolGroup.className = 'trp-tb-group';
    tools.forEach(({ tool, label, title }) => {
      const btn = document.createElement('button');
      btn.className = 'trp-tb-btn';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', () => this.onToolClick(tool));
      toolGroup.appendChild(btn);
      this.toolButtons[tool] = btn;
    });
    bar.appendChild(toolGroup);

    // color + stroke
    const styleGroup = document.createElement('div');
    styleGroup.className = 'trp-tb-group';
    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.className = 'trp-tb-color';
    this.colorInput.value = this.color;
    this.colorInput.title = 'Color';
    this.colorInput.addEventListener('input', (e) => {
      this.setColor(e.target.value);
      try { chrome.storage.sync.set({ color: e.target.value }); } catch (err) {}
    });
    this.strokeInput = document.createElement('input');
    this.strokeInput.type = 'range';
    this.strokeInput.min = '1';
    this.strokeInput.max = '20';
    this.strokeInput.value = this.strokeWidth;
    this.strokeInput.className = 'trp-tb-stroke';
    this.strokeInput.title = 'Stroke width';
    this.strokeValue = document.createElement('span');
    this.strokeValue.className = 'trp-tb-strokeval';
    this.strokeValue.textContent = this.strokeWidth;
    this.strokeInput.addEventListener('input', (e) => {
      const v = parseInt(e.target.value);
      this.setStrokeWidth(v);
      this.strokeValue.textContent = v;
      try { chrome.storage.sync.set({ strokeWidth: v }); } catch (err) {}
    });
    styleGroup.appendChild(this.colorInput);
    styleGroup.appendChild(this.strokeInput);
    styleGroup.appendChild(this.strokeValue);
    bar.appendChild(styleGroup);

    // clear + click highlight
    const actionGroup = document.createElement('div');
    actionGroup.className = 'trp-tb-group';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'trp-tb-btn';
    clearBtn.textContent = '🗑';
    clearBtn.title = 'Clear all annotations';
    clearBtn.addEventListener('click', () => this.clearAll());
    actionGroup.appendChild(clearBtn);

    const hlBtn = document.createElement('button');
    hlBtn.className = 'trp-tb-btn';
    hlBtn.textContent = '⌖';
    hlBtn.title = 'Toggle click-to-highlight elements';
    hlBtn.addEventListener('click', () => {
      const enabled = !this.clickHighlightEnabled;
      this.toggleClickHighlight(enabled);
      hlBtn.classList.toggle('active', enabled);
      try { chrome.storage.sync.set({ clickHighlightEnabled: enabled }); } catch (err) {}
    });
    this.toolButtons['__highlight'] = hlBtn;
    actionGroup.appendChild(hlBtn);

    const circleBtn = document.createElement('button');
    circleBtn.className = 'trp-tb-btn active';
    circleBtn.textContent = '◉';
    circleBtn.title = 'Toggle click ripple effect';
    circleBtn.addEventListener('click', () => {
      this.clickCircleEnabled = !this.clickCircleEnabled;
      circleBtn.classList.toggle('active', this.clickCircleEnabled);
      try { chrome.storage.sync.set({ clickCircleEnabled: this.clickCircleEnabled }); } catch (err) {}
    });
    this.toolButtons['__circle'] = circleBtn;
    actionGroup.appendChild(circleBtn);

    const arrowBtn = document.createElement('button');
    arrowBtn.className = 'trp-tb-btn active';
    arrowBtn.textContent = '➜';
    arrowBtn.title = 'Toggle click arrow effect';
    arrowBtn.addEventListener('click', () => {
      this.clickArrowEnabled = !this.clickArrowEnabled;
      arrowBtn.classList.toggle('active', this.clickArrowEnabled);
      try { chrome.storage.sync.set({ clickArrowEnabled: this.clickArrowEnabled }); } catch (err) {}
    });
    this.toolButtons['__arrow'] = arrowBtn;
    actionGroup.appendChild(arrowBtn);

    bar.appendChild(actionGroup);

    const viewGroup = document.createElement('div');
    viewGroup.className = 'trp-tb-group';
    this.themeBtn = document.createElement('button');
    this.themeBtn.className = 'trp-tb-btn';
    this.themeBtn.title = 'Toggle toolbar theme';
    this.themeBtn.addEventListener('click', () => this.toggleTheme());
    viewGroup.appendChild(this.themeBtn);
    this.pinBtn = document.createElement('button');
    this.pinBtn.className = 'trp-tb-btn';
    this.pinBtn.addEventListener('click', () => this.toggleToolbarPin());
    viewGroup.appendChild(this.pinBtn);
    bar.appendChild(viewGroup);

    // recording controls
    const recGroup = document.createElement('div');
    recGroup.className = 'trp-tb-group';
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'trp-tb-btn trp-tb-pause';
    this.pauseBtn.title = 'Pause recording';
    this.pauseBtn.textContent = '⏸';
    this.pauseBtn.addEventListener('click', (e) => this.onPauseToggle(e));
    const stopBtn = document.createElement('button');
    stopBtn.className = 'trp-tb-btn trp-tb-stop';
    stopBtn.title = 'Stop recording';
    stopBtn.textContent = '⏹';
    stopBtn.addEventListener('click', (e) => this.onStop(e));
    this.stopBtn = stopBtn;
    recGroup.appendChild(this.pauseBtn);
    recGroup.appendChild(stopBtn);
    bar.appendChild(recGroup);
    this.controlButtons = [this.pauseBtn, this.stopBtn];

    this.toolbar = bar;
    bar.style.display = 'none';
    document.documentElement.appendChild(bar);
    this.applyTheme(this.theme);
    this.updatePinButton();

    this.makeDraggable(bar);
  }

  makeDraggable(bar) {
    let dragging = false, offsetX = 0, offsetY = 0;
    const isInteractiveTarget = (target) => {
      return !!(target && target.closest && target.closest('button, input, select, textarea, label'));
    };
    const onMove = (e) => {
      if (!dragging) return;
      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;
      x = Math.max(0, Math.min(x, window.innerWidth - bar.offsetWidth));
      y = Math.max(0, Math.min(y, window.innerHeight - bar.offsetHeight));
      bar.style.left = x + 'px';
      bar.style.top = y + 'px';
      bar.style.right = 'auto';
      bar.style.transform = 'none';
      e.preventDefault();
      e.stopPropagation();
    };
    const onUp = () => {
      dragging = false;
      bar.classList.remove('trp-dragging');
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
    };
    bar.addEventListener('pointerdown', (e) => {
      if (isInteractiveTarget(e.target)) return;
      dragging = true;
      const rect = bar.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      bar.classList.add('trp-dragging');
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    });
  }

  showToolbar() { if (this.toolbar) this.toolbar.style.display = 'flex'; }
  hideToolbar() { if (this.toolbar) this.toolbar.style.display = 'none'; }

  updateToolbarVisibilityMode() {
    if (!this.toolbar) return;
    const shouldAutoHide = this.hideToolbarInRecording && !this.toolbarPinnedOpen;
    this.toolbar.classList.toggle('trp-auto-hide', shouldAutoHide);
    this.toolbar.title = shouldAutoHide
      ? 'Hover here to show annotation controls'
      : '';
  }

  revealToolbarTemporarily() {
    if (!this.toolbar) return;
    this.toolbar.classList.add('trp-reveal');
    setTimeout(() => {
      if (this.toolbar) this.toolbar.classList.remove('trp-reveal');
    }, 2200);
  }

  // ---------- toolbar actions ----------

  onToolClick(tool) {
    const next = this.activeTool === tool ? null : tool;
    this.setTool(next);
    this.updateToolButtonStates(next);
    if (next) {
      // selecting a drawing tool turns off click-highlight
      if (this.clickHighlightEnabled) {
        this.toggleClickHighlight(false);
      }
    }
    try {
      if (next) chrome.storage.sync.set({ tool: next });
      else chrome.storage.sync.remove('tool');
    } catch (e) {}
  }

  stopToolbarEvent(e) {
    if (!e) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  async onPauseToggle(e) {
    this.stopToolbarEvent(e);
    if (this.controlActionInFlight) return;
    this.setControlActionInFlight(true);
    const currentState = await this.getRecorderState();
    const isPaused = currentState && typeof currentState.isPaused === 'boolean'
      ? currentState.isPaused
      : this.isPaused;
    const action = isPaused ? 'resume-recording' : 'pause-recording';
    const result = await this.sendControl(action);
    if (result && result.success) {
      const nextState = result.state || {};
      this.setRecordingState(
        typeof nextState.isPaused === 'boolean' ? nextState.isPaused : action === 'pause-recording',
        nextState.startedAt || this.startedAt
      );
    }
    this.setControlActionInFlight(false);
  }

  async onStop(e) {
    this.stopToolbarEvent(e);
    if (this.controlActionInFlight) return;
    this.setControlActionInFlight(true);
    const result = await this.sendControl('stop-recording');
    if (result && result.success) {
      if (this.pauseBtn) this.pauseBtn.disabled = true;
      if (this.stopBtn) this.stopBtn.disabled = true;
      this.showRecordingBadge(false);
      this.stopTimer();
    }
    this.setControlActionInFlight(false);
  }

  async sendControl(action) {
    const bridgeResponse = await this.sendControlViaBridge(action);
    if (bridgeResponse && bridgeResponse.success !== false) return bridgeResponse;

    // Fall back to direct extension messaging for older injected content scripts.
    if (bridgeResponse && bridgeResponse.error !== 'Toolbar bridge did not respond') {
      this.showToolbarError(bridgeResponse.error || 'Recording control failed');
      return bridgeResponse;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (response) => {
        if (settled) return;
        settled = true;
        if (!response || response.success === false) {
          this.showToolbarError((response && response.error) || 'Recording control failed');
        }
        resolve(response || { success: false, error: 'No response from recorder' });
      };

      const timeout = setTimeout(() => {
        finish({ success: false, error: 'Recorder did not respond' });
      }, 2500);

      try {
        chrome.runtime.sendMessage({ action }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            finish({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          finish(response || { success: true });
        });
      } catch (e) {
        clearTimeout(timeout);
        finish({ success: false, error: e.message || String(e) });
      }
    });
  }

  async getRecorderState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get-state' });
      return response && response.state ? response.state : null;
    } catch (e) {
      return null;
    }
  }

  sendControlViaBridge(action) {
    return new Promise((resolve) => {
      const id = `trp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let settled = false;

      const finish = (response) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('trp-toolbar-control-response', onResponse);
        clearTimeout(timeout);
        resolve(response || { success: false, error: 'Toolbar bridge did not respond' });
      };

      const onResponse = (event) => {
        const detail = event.detail || {};
        if (detail.id !== id) return;
        finish(detail.response);
      };

      const timeout = setTimeout(() => {
        finish({ success: false, error: 'Toolbar bridge did not respond' });
      }, 1200);

      window.addEventListener('trp-toolbar-control-response', onResponse);
      window.dispatchEvent(new CustomEvent('trp-toolbar-control', {
        detail: { id, action },
      }));
    });
  }

  showToolbarError(message) {
    if (!this.toolbar) return;
    this.toolbar.title = message;
    this.toolbar.classList.add('trp-control-error');
    setTimeout(() => {
      if (!this.toolbar) return;
      this.toolbar.classList.remove('trp-control-error');
      this.toolbar.title = '';
    }, 1800);
  }

  setRecordingState(isPaused, startedAt, options = {}) {
    this.isPaused = !!isPaused;
    if (Object.prototype.hasOwnProperty.call(options, 'hideToolbarInRecording')) {
      this.hideToolbarInRecording = options.hideToolbarInRecording !== false;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'toolbarTheme')) {
      this.applyTheme(options.toolbarTheme || 'dark');
    }
    if (options.annotationState && this.isAnnotationCanvasEmpty()) {
      this.restoreAnnotationState(options.annotationState);
    }
    if (startedAt) this.startedAt = startedAt;
    this.updateToolbarVisibilityMode();
    this.updatePinButton();
    this.showRecordingBadge(this.isPaused);
    this.updatePauseButton();
    if (this.isPaused) this.stopTimer(); else this.startTimer();
  }

  updatePauseButton() {
    if (this.pauseBtn) {
      this.pauseBtn.textContent = this.isPaused ? '▶' : '⏸';
      this.pauseBtn.title = this.isPaused ? 'Resume' : 'Pause';
    }
    if (this.toolbar) {
      this.toolbar.classList.toggle('trp-is-paused', this.isPaused);
    }
  }

  setControlActionInFlight(inFlight) {
    this.controlActionInFlight = inFlight;
    this.controlButtons.forEach((button) => {
      if (button) button.disabled = inFlight;
    });
    if (this.toolbar) {
      this.toolbar.classList.toggle('trp-control-pending', inFlight);
    }
  }

  // ---------- events ----------

  bindEvents() {
    this.boundHandlers.resize = () => this.handleResize();
    this.boundHandlers.pointerDown = (e) => this.handlePointerDown(e);
    this.boundHandlers.pointerMove = (e) => this.handlePointerMove(e);
    this.boundHandlers.pointerUp = (e) => this.handlePointerUp(e);
    this.boundHandlers.pageClick = (e) => this.handlePageClick(e);
    this.boundHandlers.keyDown = (e) => this.handleKeyDown(e);

    window.addEventListener('resize', this.boundHandlers.resize);
    window.addEventListener('keydown', this.boundHandlers.keyDown, true);
    this.canvas.addEventListener('pointerdown', this.boundHandlers.pointerDown);
    this.canvas.addEventListener('pointermove', this.boundHandlers.pointerMove);
    this.canvas.addEventListener('pointerup', this.boundHandlers.pointerUp);
    this.canvas.addEventListener('pointerleave', this.boundHandlers.pointerUp);
    document.addEventListener('click', this.boundHandlers.pageClick, true);
    document.addEventListener('keydown', this.boundHandlers.keyDown, true);
  }

  unbindEvents() {
    window.removeEventListener('resize', this.boundHandlers.resize);
    window.removeEventListener('keydown', this.boundHandlers.keyDown, true);
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.boundHandlers.pointerDown);
      this.canvas.removeEventListener('pointermove', this.boundHandlers.pointerMove);
      this.canvas.removeEventListener('pointerup', this.boundHandlers.pointerUp);
      this.canvas.removeEventListener('pointerleave', this.boundHandlers.pointerUp);
    }
    document.removeEventListener('click', this.boundHandlers.pageClick, true);
    document.removeEventListener('keydown', this.boundHandlers.keyDown, true);
  }

  handleResize() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.render();
  }

  getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  handlePointerDown(e) {
    if (!this.activeTool || this.clickHighlightEnabled) return;
    const { x, y } = this.getCanvasCoords(e);

    if (this.activeTool === 'text') { this.placeText(x, y); return; }

    if (this.activeTool === 'eraser') {
      this.isErasing = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.eraseAt(x, y);
      return;
    }

    if (['square', 'filled-rect', 'arrow'].includes(this.activeTool)) {
      this.isDrawing = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.currentShape = {
        id: this.nextAnnotationId('shape'),
        kind: this.activeTool,
        color: this.color,
        width: this.strokeWidth,
        startX: x,
        startY: y,
        endX: x,
        endY: y,
      };
      this.shapes.push(this.currentShape);
      this.annotationHistory.push({ type: 'shape', id: this.currentShape.id });
      this.render();
      return;
    }

    if (['blur', 'board'].includes(this.activeTool)) {
      this.isDrawing = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.currentArea = this.createAreaAnnotation({
        id: this.nextAnnotationId('area'),
        kind: this.activeTool,
        startX: x,
        startY: y,
        endX: x,
        endY: y,
      });
      this.areaElements.push(this.currentArea);
      this.annotationHistory.push({ type: 'area', id: this.currentArea.id });
      return;
    }

    this.isDrawing = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.currentPath = {
      id: this.nextAnnotationId('path'),
      tool: this.activeTool,
      color: this.color,
      width: this.activeTool === 'highlighter' ? this.strokeWidth * 3 : this.strokeWidth,
      points: [{ x, y }],
    };
    this.paths.push(this.currentPath);
    this.annotationHistory.push({ type: 'path', id: this.currentPath.id });
    this.render();
  }

  handlePointerMove(e) {
    if (this.isErasing) {
      const { x, y } = this.getCanvasCoords(e);
      this.eraseAt(x, y);
      return;
    }
    if (!this.isDrawing || (!this.currentPath && !this.currentShape && !this.currentArea)) return;
    const { x, y } = this.getCanvasCoords(e);
    if (this.currentShape) {
      this.currentShape.endX = x;
      this.currentShape.endY = y;
    } else if (this.currentArea) {
      this.currentArea.endX = x;
      this.currentArea.endY = y;
      this.updateAreaElement(this.currentArea);
    } else {
      this.currentPath.points.push({ x, y });
    }
    this.render();
  }

  handlePointerUp(e) {
    if (this.isDrawing) {
      let shouldPersist = false;
      if (this.currentShape) {
        const rect = this.normalizeRect(
          this.currentShape.startX,
          this.currentShape.startY,
          this.currentShape.endX,
          this.currentShape.endY
        );
        const arrowLength = Math.hypot(
          this.currentShape.endX - this.currentShape.startX,
          this.currentShape.endY - this.currentShape.startY
        );
        if ((this.currentShape.kind === 'arrow' && arrowLength < 6) || (this.currentShape.kind !== 'arrow' && rect.width < 2 && rect.height < 2)) {
          this.shapes = this.shapes.filter((shape) => shape.id !== this.currentShape.id);
          if (this.annotationHistory.length && this.annotationHistory[this.annotationHistory.length - 1].id === this.currentShape.id) {
            this.annotationHistory.pop();
          }
          this.render();
        } else {
          shouldPersist = true;
        }
      } else if (this.currentArea) {
        const rect = this.normalizeRect(
          this.currentArea.startX,
          this.currentArea.startY,
          this.currentArea.endX,
          this.currentArea.endY
        );
        if (rect.width < 8 && rect.height < 8) {
          this.removeAreaById(this.currentArea.id);
          if (this.annotationHistory.length && this.annotationHistory[this.annotationHistory.length - 1].id === this.currentArea.id) {
            this.annotationHistory.pop();
          }
        } else {
          shouldPersist = true;
        }
      } else if (this.currentPath) {
        shouldPersist = true;
      }
      this.isDrawing = false;
      this.currentPath = null;
      this.currentShape = null;
      this.currentArea = null;
      if (shouldPersist) this.scheduleAnnotationPersist();
    }
    this.isErasing = false;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  }

  handlePageClick(e) {
    if (!this.clickHighlightEnabled || !this.active) return;
    if (this.toolbar && this.toolbar.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#trp-overlay, #trp-toolbar, #trp-recording-badge')) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    this.highlightElement(e.target, e.clientX, e.clientY);
  }

  handleKeyDown(e) {
    if (!this.active) return;
    if (this.isEditableTarget(e.target) || this.isEditableTarget(document.activeElement)) return;
    const key = e.key || e.code;

    if (key === 'Escape') {
      this.clearActiveModes();
      this.consumeShortcutEvent(e);
      return;
    }

    if (key === 'Delete' || key === 'Backspace') {
      const removed = this.undoLastAnnotation();
      if (removed) {
        this.consumeShortcutEvent(e);
      }
    }
  }

  // ---------- drawing ----------

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    for (const path of this.paths) {
      if (path.points.length < 1) continue;
      ctx.beginPath();
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = path.tool === 'highlighter' ? 0.3 : 1;

      if (path.points.length === 1) {
        const p = path.points[0];
        ctx.arc(p.x, p.y, path.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = path.color;
        ctx.fill();
      } else {
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
        ctx.stroke();
      }
    }

    for (const shape of this.shapes) {
      ctx.globalAlpha = 1;
      if (shape.kind === 'arrow') {
        this.renderArrow(ctx, shape);
        continue;
      }
      const rect = this.normalizeRect(shape.startX, shape.startY, shape.endX, shape.endY);
      if (rect.width < 1 && rect.height < 1) continue;
      ctx.beginPath();
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      if (shape.kind === 'filled-rect') {
        ctx.fillStyle = this.hexToRGBA(shape.color, 0.18);
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.globalAlpha = 1;
  }

  placeText(x, y) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'trp-text-input';
    input.style.left = x + 'px';
    input.style.top = y + 'px';
    input.style.color = this.color;
    input.style.borderBottomColor = this.color;
    input.style.fontSize = this.textSize + 'px';

    this.container.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const commit = () => {
      const text = input.value.trim();
      if (text) this.addTextLabel(text, x, y, { color: this.color, fontSize: this.textSize });
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = ''; input.blur(); }
    });
  }

  addTextLabel(text, x, y, options = {}) {
    const id = this.nextAnnotationId('text');
    const item = this.createTextAnnotation({
      id,
      text,
      x,
      y,
      color: options.color || this.color,
      fontSize: options.fontSize || this.textSize,
    });
    this.textElements.push(item);
    this.annotationHistory.push({ type: 'text', id });
    this.scheduleAnnotationPersist();
  }

  eraseAt(x, y) {
    const threshold = Math.max(12, this.strokeWidth * 2);
    const before = this.getAnnotationCounts();
    this.paths = this.paths.filter((path) => {
      for (const pt of path.points) {
        if (Math.hypot(pt.x - x, pt.y - y) < threshold) return false;
      }
      return true;
    });
    this.shapes = this.shapes.filter((shape) => !this.isPointNearShape(shape, x, y, threshold));
    this.textElements = this.textElements.filter((el) => {
      const rect = el.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (Math.hypot(cx - x, cy - y) < threshold + 10) {
        if (el.el.parentNode) el.el.parentNode.removeChild(el.el);
        return false;
      }
      return true;
    });
    this.highlightedElements = this.highlightedElements.filter((item) => {
      if (this.isPointInRect(item, x, y, threshold)) {
        if (item.el.parentNode) item.el.parentNode.removeChild(item.el);
        return false;
      }
      return true;
    });
    this.areaElements = this.areaElements.filter((item) => {
      if (this.isPointInRect(this.getAreaRect(item), x, y, threshold)) {
        if (item.el.parentNode) item.el.parentNode.removeChild(item.el);
        return false;
      }
      return true;
    });
    this.pruneAnnotationHistory();
    this.render();
    if (this.didAnnotationCountsChange(before)) this.scheduleAnnotationPersist();
  }

  highlightElement(el, clickX, clickY) {
    if (!el || !el.getBoundingClientRect) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const item = this.createHighlightAnnotation({
      id: this.nextAnnotationId('highlight'),
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      color: this.color,
      background: this.hexToRGBA(this.color, 0.12),
    });
    this.highlightedElements.push(item);
    this.annotationHistory.push({ type: 'highlight', id: item.id });
    this.scheduleAnnotationPersist();

    if (clickX != null && clickY != null) {
      this.showClickRipple(clickX, clickY);
      this.showClickArrow(rect);
    }
  }

  showClickRipple(x, y) {
    if (!this.clickCircleEnabled) return;
    const el = document.createElement('div');
    el.className = 'trp-click-ripple';
    el.style.left = (x - 25) + 'px';
    el.style.top = (y - 25) + 'px';
    el.style.borderColor = this.color;
    this.highlightLayer.appendChild(el);
    el.addEventListener('animationend', () => { if (el.parentNode) el.parentNode.removeChild(el); });
  }

  showClickArrow(rect) {
    if (!this.clickArrowEnabled) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'trp-click-arrow');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 28 28');
    svg.style.left = (rect.left + rect.width / 2 - 14) + 'px';
    svg.style.top = (rect.top - 28) + 'px';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M14 3 L14 23 M7 16 L14 23 L21 16');
    path.setAttribute('stroke', this.color);
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    this.highlightLayer.appendChild(svg);
    svg.addEventListener('animationend', () => { if (svg.parentNode) svg.parentNode.removeChild(svg); });
  }

  hexToRGBA(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return `rgba(255,0,0,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  clearAll(options = {}) {
    this.paths = [];
    this.shapes = [];
    this.currentPath = null;
    this.currentShape = null;
    this.currentArea = null;
    this.textElements.forEach(({ el }) => { if (el.parentNode) el.parentNode.removeChild(el); });
    this.textElements = [];
    this.highlightedElements.forEach(({ el }) => { if (el.parentNode) el.parentNode.removeChild(el); });
    this.highlightedElements = [];
    this.areaElements.forEach(({ el }) => { if (el.parentNode) el.parentNode.removeChild(el); });
    this.areaElements = [];
    this.annotationHistory = [];
    this.render();
    if (options.persist !== false) this.scheduleAnnotationPersist();
  }

  undoLastAnnotation() {
    while (this.annotationHistory.length) {
      const entry = this.annotationHistory.pop();
      if (entry.type === 'path') {
        const nextPaths = this.paths.filter((path) => path.id !== entry.id);
        if (nextPaths.length !== this.paths.length) {
          this.paths = nextPaths;
          this.render();
          this.scheduleAnnotationPersist();
          return true;
        }
      }
      if (entry.type === 'shape') {
        const nextShapes = this.shapes.filter((shape) => shape.id !== entry.id);
        if (nextShapes.length !== this.shapes.length) {
          this.shapes = nextShapes;
          this.render();
          this.scheduleAnnotationPersist();
          return true;
        }
      }
      if (entry.type === 'text') {
        const index = this.textElements.findIndex((item) => item.id === entry.id);
        if (index !== -1) {
          const [{ el }] = this.textElements.splice(index, 1);
          if (el.parentNode) el.parentNode.removeChild(el);
          this.scheduleAnnotationPersist();
          return true;
        }
      }
      if (entry.type === 'area') {
        const removed = this.removeAreaById(entry.id);
        if (removed) {
          this.scheduleAnnotationPersist();
          return true;
        }
      }
      if (entry.type === 'highlight') {
        const index = this.highlightedElements.findIndex((item) => item.id === entry.id);
        if (index !== -1) {
          const [{ el }] = this.highlightedElements.splice(index, 1);
          if (el.parentNode) el.parentNode.removeChild(el);
          this.scheduleAnnotationPersist();
          return true;
        }
      }
    }
    return false;
  }

  createTextAnnotation(data) {
    const el = document.createElement('span');
    el.className = 'trp-text-label';
    el.dataset.annotationId = data.id;
    el.textContent = data.text;
    el.style.left = data.x + 'px';
    el.style.top = data.y + 'px';
    el.style.color = data.color;
    el.style.fontSize = data.fontSize + 'px';
    this.container.appendChild(el);
    return { ...data, el };
  }

  createHighlightAnnotation(data) {
    const el = document.createElement('div');
    el.className = 'trp-highlight';
    el.dataset.annotationId = data.id;
    el.style.left = data.x + 'px';
    el.style.top = data.y + 'px';
    el.style.width = data.width + 'px';
    el.style.height = data.height + 'px';
    el.style.borderColor = data.color;
    el.style.background = data.background;
    this.highlightLayer.appendChild(el);
    return { ...data, el };
  }

  createAreaAnnotation(data) {
    const el = document.createElement('div');
    el.className = `trp-area-annotation trp-area-${data.kind}`;
    el.dataset.annotationId = data.id;
    this.effectLayer.appendChild(el);
    const item = { ...data, el };
    this.updateAreaElement(item);
    return item;
  }

  updateAreaElement(item) {
    if (!item || !item.el) return;
    const rect = this.normalizeRect(item.startX, item.startY, item.endX, item.endY);
    item.el.style.left = rect.x + 'px';
    item.el.style.top = rect.y + 'px';
    item.el.style.width = rect.width + 'px';
    item.el.style.height = rect.height + 'px';
  }

  removeAreaById(id) {
    const index = this.areaElements.findIndex((item) => item.id === id);
    if (index === -1) return false;
    const [{ el }] = this.areaElements.splice(index, 1);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    return true;
  }

  renderArrow(ctx, shape) {
    const dx = shape.endX - shape.startX;
    const dy = shape.endY - shape.startY;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    const angle = Math.atan2(dy, dx);
    const headLength = Math.max(12, shape.width * 4);

    ctx.beginPath();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(shape.startX, shape.startY);
    ctx.lineTo(shape.endX, shape.endY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(shape.endX, shape.endY);
    ctx.lineTo(
      shape.endX - headLength * Math.cos(angle - Math.PI / 6),
      shape.endY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(shape.endX, shape.endY);
    ctx.lineTo(
      shape.endX - headLength * Math.cos(angle + Math.PI / 6),
      shape.endY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  restoreAnnotationState(annotationState) {
    this.clearAll({ persist: false });
    this.paths = Array.isArray(annotationState.paths) ? annotationState.paths.map((path) => ({
      ...path,
      points: Array.isArray(path.points) ? path.points.map((point) => ({ x: point.x, y: point.y })) : [],
    })) : [];
    this.shapes = Array.isArray(annotationState.shapes) ? annotationState.shapes.map((shape) => ({ ...shape })) : [];
    this.textElements = Array.isArray(annotationState.textElements)
      ? annotationState.textElements.map((item) => this.createTextAnnotation({ ...item }))
      : [];
    this.highlightedElements = Array.isArray(annotationState.highlightedElements)
      ? annotationState.highlightedElements.map((item) => this.createHighlightAnnotation({ ...item }))
      : [];
    this.areaElements = Array.isArray(annotationState.areaElements)
      ? annotationState.areaElements.map((item) => this.createAreaAnnotation({ ...item }))
      : [];
    this.annotationHistory = Array.isArray(annotationState.annotationHistory)
      ? annotationState.annotationHistory.map((entry) => ({ ...entry }))
      : [];
    this.annotationRevision = typeof annotationState.revision === 'number' ? annotationState.revision : 0;
    this.pruneAnnotationHistory();
    this.render();
  }

  serializeAnnotationState(nextRevision) {
    return {
      paths: this.paths.map((path) => ({
        ...path,
        points: path.points.map((point) => ({ x: point.x, y: point.y })),
      })),
      shapes: this.shapes.map((shape) => ({ ...shape })),
      textElements: this.textElements.map(({ el, ...item }) => ({ ...item })),
      highlightedElements: this.highlightedElements.map(({ el, ...item }) => ({ ...item })),
      areaElements: this.areaElements.map(({ el, ...item }) => ({ ...item })),
      annotationHistory: this.annotationHistory.map((entry) => ({ ...entry })),
      revision: nextRevision,
    };
  }

  scheduleAnnotationPersist() {
    if (!this.active) return;
    if (this.annotationPersistTimer) clearTimeout(this.annotationPersistTimer);
    this.annotationPersistTimer = setTimeout(() => {
      this.annotationPersistTimer = null;
      this.persistAnnotationState();
    }, 80);
  }

  persistAnnotationState() {
    if (!this.active) return;
    this.pruneAnnotationHistory();
    const nextRevision = this.annotationRevision + 1;
    this.annotationRevision = nextRevision;
    const annotationState = this.serializeAnnotationState(nextRevision);
    try {
      chrome.runtime.sendMessage({ action: 'set-annotation-state', annotationState }).catch(() => {});
    } catch (e) {}
  }

  getAnnotationCounts() {
    return {
      paths: this.paths.length,
      shapes: this.shapes.length,
      texts: this.textElements.length,
      highlights: this.highlightedElements.length,
      areas: this.areaElements.length,
    };
  }

  didAnnotationCountsChange(before) {
    const after = this.getAnnotationCounts();
    return Object.keys(after).some((key) => after[key] !== before[key]);
  }

  isAnnotationCanvasEmpty() {
    const counts = this.getAnnotationCounts();
    return !Object.values(counts).some(Boolean);
  }

  pruneAnnotationHistory() {
    const activeIds = new Set([
      ...this.paths.map((item) => item.id),
      ...this.shapes.map((item) => item.id),
      ...this.textElements.map((item) => item.id),
      ...this.highlightedElements.map((item) => item.id),
      ...this.areaElements.map((item) => item.id),
    ]);
    this.annotationHistory = this.annotationHistory.filter((entry) => activeIds.has(entry.id));
  }

  getAreaRect(item) {
    return this.normalizeRect(item.startX, item.startY, item.endX, item.endY);
  }

  // ---------- setters ----------

  setTool(tool) { this.activeTool = tool; this.updatePointerMode(); }
  setColor(color) { this.color = color; if (this.colorInput) this.colorInput.value = color; }
  setStrokeWidth(width) { this.strokeWidth = width; }
  setTextSize(size) { this.textSize = size; }
  applyTheme(theme) {
    this.theme = theme === 'light' ? 'light' : 'dark';
    if (this.toolbar) this.toolbar.dataset.theme = this.theme;
    if (this.themeBtn) {
      this.themeBtn.textContent = this.theme === 'light' ? '☾' : '☀';
      this.themeBtn.title = this.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    }
  }

  toggleTheme() {
    const nextTheme = this.theme === 'light' ? 'dark' : 'light';
    this.applyTheme(nextTheme);
    try { chrome.storage.sync.set({ toolbarTheme: nextTheme }); } catch (e) {}
  }

  toggleToolbarPin() {
    this.toolbarPinnedOpen = !this.toolbarPinnedOpen;
    this.updatePinButton();
    this.updateToolbarVisibilityMode();
    try { chrome.storage.sync.set({ toolbarPinnedOpen: this.toolbarPinnedOpen }); } catch (e) {}
  }

  updatePinButton() {
    if (!this.pinBtn) return;
    this.pinBtn.textContent = this.toolbarPinnedOpen ? 'P' : 'A';
    this.pinBtn.title = this.toolbarPinnedOpen
      ? 'Allow toolbar to collapse again'
      : 'Keep toolbar expanded';
    this.pinBtn.classList.toggle('active', this.toolbarPinnedOpen || !this.hideToolbarInRecording);
  }

  toggleClickHighlight(enabled) {
    this.clickHighlightEnabled = enabled;
    if (enabled) {
      this.setTool(null);
      this.updateToolButtonStates(null);
    }
    if (this.toolButtons.__highlight) {
      this.toolButtons.__highlight.classList.toggle('active', enabled);
    }
    this.updatePointerMode();
  }

  clearActiveModes() {
    this.setTool(null);
    if (this.clickHighlightEnabled) this.toggleClickHighlight(false);
    this.updateToolButtonStates(null);
  }

  updateToolButtonStates(activeTool) {
    Object.keys(this.toolButtons).forEach((k) => {
      if (k === '__highlight' || k === '__circle' || k === '__arrow') return;
      this.toolButtons[k].classList.toggle('active', k === activeTool);
    });
  }

  isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (!target.closest) return false;
    return !!target.closest('input, textarea, select, [contenteditable="true"]');
  }

  nextAnnotationId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  normalizeRect(startX, startY, endX, endY) {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    return {
      x,
      y,
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
    };
  }

  isPointNearShape(shape, x, y, threshold) {
    if (shape.kind === 'arrow') {
      const shaftDistance = this.distanceToSegment(x, y, shape.startX, shape.startY, shape.endX, shape.endY);
      const angle = Math.atan2(shape.endY - shape.startY, shape.endX - shape.startX);
      const headLength = Math.max(12, shape.width * 4);
      const leftX = shape.endX - headLength * Math.cos(angle - Math.PI / 6);
      const leftY = shape.endY - headLength * Math.sin(angle - Math.PI / 6);
      const rightX = shape.endX - headLength * Math.cos(angle + Math.PI / 6);
      const rightY = shape.endY - headLength * Math.sin(angle + Math.PI / 6);
      return shaftDistance <= threshold
        || this.distanceToSegment(x, y, shape.endX, shape.endY, leftX, leftY) <= threshold
        || this.distanceToSegment(x, y, shape.endX, shape.endY, rightX, rightY) <= threshold;
    }
    const rect = this.normalizeRect(shape.startX, shape.startY, shape.endX, shape.endY);
    if (rect.width < 1 && rect.height < 1) return Math.hypot(rect.x - x, rect.y - y) < threshold;
    if (shape.kind === 'filled-rect') {
      return this.isPointInRect(rect, x, y, threshold);
    }
    const left = rect.x - threshold;
    const right = rect.x + rect.width + threshold;
    const top = rect.y - threshold;
    const bottom = rect.y + rect.height + threshold;
    if (x < left || x > right || y < top || y > bottom) return false;
    const onVerticalEdge = (Math.abs(x - rect.x) <= threshold || Math.abs(x - (rect.x + rect.width)) <= threshold)
      && y >= top && y <= bottom;
    const onHorizontalEdge = (Math.abs(y - rect.y) <= threshold || Math.abs(y - (rect.y + rect.height)) <= threshold)
      && x >= left && x <= right;
    return onVerticalEdge || onHorizontalEdge;
  }

  isPointInRect(rect, x, y, threshold = 0) {
    if (!rect) return false;
    return x >= rect.x - threshold
      && x <= rect.x + rect.width + threshold
      && y >= rect.y - threshold
      && y <= rect.y + rect.height + threshold;
  }

  distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  consumeShortcutEvent(e) {
    if (!e) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  updatePointerMode() {
    if (!this.active || !this.canvas) return;
    if (this.activeTool && !this.clickHighlightEnabled) {
      this.canvas.style.pointerEvents = 'auto';
      this.container.style.pointerEvents = 'auto';
      this.canvas.classList.toggle('eraser-mode', this.activeTool === 'eraser');
      this.canvas.classList.toggle('active-pointer', this.activeTool !== 'eraser');
    } else {
      this.canvas.style.pointerEvents = 'none';
      this.container.style.pointerEvents = 'none';
      this.canvas.classList.remove('active-pointer', 'eraser-mode');
    }
  }

  // ---------- badge / timer ----------

  showRecordingBadge(isPaused) {
    if (!this.badge) return;
    this.badge.style.display = 'flex';
    this.badge.className = isPaused ? 'paused' : '';
    this.badge.innerHTML = isPaused
      ? '<span class="dot" style="background:#fbbc04"></span> Paused'
      : '<span class="dot"></span> Recording';
  }

  hideRecordingBadge() { if (this.badge) this.badge.style.display = 'none'; }
}

window.__TRP_OVERLAY = RecorderOverlay;
})();
