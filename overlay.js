class RecorderOverlay {
  constructor() {
    this.active = false;
    this.activeTool = null;
    this.color = '#ff0000';
    this.strokeWidth = 3;
    this.textSize = 18;
    this.clickHighlightEnabled = false;
    this.isPaused = false;
    this.hideToolbarInRecording = true;

    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.highlightLayer = null;
    this.badge = null;
    this.toolbar = null;
    this.toolButtons = {};
    this.pauseBtn = null;

    this.isDrawing = false;
    this.isErasing = false;
    this.currentPath = null;
    this.paths = [];
    this.textElements = [];
    this.highlightedElements = [];

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
    this.textElements = [];
    this.highlightedElements = [];
  }

  startSession(isPaused, startedAt, options = {}) {
    this.activate();
    this.isPaused = !!isPaused;
    this.hideToolbarInRecording = options.hideToolbarInRecording !== false;
    this.startedAt = startedAt || Date.now();
    this.showToolbar();
    this.updateToolbarVisibilityMode();
    this.showRecordingBadge(this.isPaused);
    this.updatePauseButton();
    if (this.isPaused) this.stopTimer(); else this.startTimer();
  }

  endSession() {
    if (!this.active) return;
    this.stopTimer();
    this.clearAll();
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
      chrome.storage.sync.get(['color', 'strokeWidth', 'defaultColor', 'defaultStrokeWidth'], (s) => {
        const color = s.color || s.defaultColor;
        const width = s.strokeWidth || s.defaultStrokeWidth;
        if (color) this.setColor(color);
        if (width) this.setStrokeWidth(width);
        if (this.colorInput && color) this.colorInput.value = color;
        if (this.strokeInput && width) { this.strokeInput.value = width; this.strokeValue.textContent = width; }
      });
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

    this.badge = document.createElement('div');
    this.badge.id = 'trp-recording-badge';
    this.badge.style.display = 'none';

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
    this.textElements.forEach(remove);
    this.highlightedElements.forEach(remove);
    this.container = this.canvas = this.ctx = this.highlightLayer = this.badge = this.toolbar = null;
    this.toolButtons = {};
    this.pauseBtn = null;
  }

  buildToolbar() {
    const bar = document.createElement('div');
    bar.id = 'trp-toolbar';

    const handle = document.createElement('div');
    handle.className = 'trp-tb-handle';
    handle.title = 'Drag to move';
    handle.innerHTML = '<span class="trp-rec-dot"></span><span class="trp-tb-timer">00:00</span>';
    bar.appendChild(handle);
    this.timerEl = handle.querySelector('.trp-tb-timer');

    const tools = [
      { tool: 'pen', label: '✎', title: 'Pen' },
      { tool: 'highlighter', label: '🖍', title: 'Highlighter' },
      { tool: 'text', label: 'T', title: 'Text' },
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
    bar.appendChild(actionGroup);

    // recording controls
    const recGroup = document.createElement('div');
    recGroup.className = 'trp-tb-group';
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'trp-tb-btn trp-tb-pause';
    this.pauseBtn.title = 'Pause / Resume';
    this.pauseBtn.textContent = '⏸';
    this.pauseBtn.addEventListener('click', (e) => this.onPauseToggle(e));
    const stopBtn = document.createElement('button');
    stopBtn.className = 'trp-tb-btn trp-tb-stop';
    stopBtn.title = 'Stop recording';
    stopBtn.textContent = '⏹';
    stopBtn.addEventListener('click', (e) => this.onStop(e));
    recGroup.appendChild(this.pauseBtn);
    recGroup.appendChild(stopBtn);
    bar.appendChild(recGroup);

    this.toolbar = bar;
    bar.style.display = 'none';
    document.documentElement.appendChild(bar);

    this.makeDraggable(handle, bar);
  }

  makeDraggable(handle, bar) {
    let dragging = false, offsetX = 0, offsetY = 0;
    const onMove = (e) => {
      if (!dragging) return;
      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;
      x = Math.max(0, Math.min(x, window.innerWidth - bar.offsetWidth));
      y = Math.max(0, Math.min(y, window.innerHeight - bar.offsetHeight));
      bar.style.left = x + 'px';
      bar.style.top = y + 'px';
      bar.style.right = 'auto';
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
    };
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      const rect = bar.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      e.preventDefault();
    });
  }

  showToolbar() { if (this.toolbar) this.toolbar.style.display = 'flex'; }
  hideToolbar() { if (this.toolbar) this.toolbar.style.display = 'none'; }

  updateToolbarVisibilityMode() {
    if (!this.toolbar) return;
    this.toolbar.classList.toggle('trp-auto-hide', this.hideToolbarInRecording);
    this.toolbar.title = this.hideToolbarInRecording
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
    Object.keys(this.toolButtons).forEach((k) => {
      if (k === '__highlight') return;
      this.toolButtons[k].classList.toggle('active', k === next);
    });
    if (next) {
      // selecting a drawing tool turns off click-highlight
      if (this.clickHighlightEnabled) {
        this.toggleClickHighlight(false);
        this.toolButtons['__highlight'].classList.remove('active');
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
    const nextPaused = !this.isPaused;
    const action = nextPaused ? 'pause-recording' : 'resume-recording';
    const result = await this.sendControl(action);
    if (result && result.success) {
      this.setRecordingState(nextPaused, this.startedAt);
    }
  }

  async onStop(e) {
    this.stopToolbarEvent(e);
    const result = await this.sendControl('stop-recording');
    if (result && result.success) {
      if (this.pauseBtn) this.pauseBtn.disabled = true;
      this.showRecordingBadge(false);
      this.stopTimer();
    }
  }

  async sendControl(action) {
    try {
      const response = await chrome.runtime.sendMessage({ action });
      if (response && response.success === false) {
        this.showToolbarError(response.error || 'Recording control failed');
      }
      return response || { success: true };
    } catch (e) {
      this.showToolbarError(e.message || 'Recording control failed');
      return { success: false, error: e.message || String(e) };
    }
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
    if (startedAt) this.startedAt = startedAt;
    this.updateToolbarVisibilityMode();
    this.showRecordingBadge(this.isPaused);
    this.updatePauseButton();
    if (this.isPaused) this.stopTimer(); else this.startTimer();
  }

  updatePauseButton() {
    if (this.pauseBtn) {
      this.pauseBtn.textContent = this.isPaused ? '▶' : '⏸';
      this.pauseBtn.title = this.isPaused ? 'Resume' : 'Pause';
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
    this.canvas.addEventListener('pointerdown', this.boundHandlers.pointerDown);
    this.canvas.addEventListener('pointermove', this.boundHandlers.pointerMove);
    this.canvas.addEventListener('pointerup', this.boundHandlers.pointerUp);
    this.canvas.addEventListener('pointerleave', this.boundHandlers.pointerUp);
    document.addEventListener('click', this.boundHandlers.pageClick, true);
    document.addEventListener('keydown', this.boundHandlers.keyDown, true);
  }

  unbindEvents() {
    window.removeEventListener('resize', this.boundHandlers.resize);
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

    this.isDrawing = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.currentPath = {
      tool: this.activeTool,
      color: this.color,
      width: this.activeTool === 'highlighter' ? this.strokeWidth * 3 : this.strokeWidth,
      points: [{ x, y }],
    };
    this.paths.push(this.currentPath);
    this.render();
  }

  handlePointerMove(e) {
    if (this.isErasing) {
      const { x, y } = this.getCanvasCoords(e);
      this.eraseAt(x, y);
      return;
    }
    if (!this.isDrawing || !this.currentPath) return;
    const { x, y } = this.getCanvasCoords(e);
    this.currentPath.points.push({ x, y });
    this.render();
  }

  handlePointerUp(e) {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.currentPath = null;
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
    this.highlightElement(e.target);
  }

  handleKeyDown(e) {
    if (e.key === 'Escape' && this.active) {
      this.setTool(null);
      Object.keys(this.toolButtons).forEach((k) => {
        if (k !== '__highlight') this.toolButtons[k].classList.remove('active');
      });
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
      if (text) this.addTextLabel(text, x, y);
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = ''; input.blur(); }
    });
  }

  addTextLabel(text, x, y) {
    const el = document.createElement('span');
    el.className = 'trp-text-label';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.color = this.color;
    el.style.fontSize = this.textSize + 'px';
    this.container.appendChild(el);
    this.textElements.push(el);
  }

  eraseAt(x, y) {
    const threshold = Math.max(12, this.strokeWidth * 2);
    this.paths = this.paths.filter((path) => {
      for (const pt of path.points) {
        if (Math.hypot(pt.x - x, pt.y - y) < threshold) return false;
      }
      return true;
    });
    this.textElements = this.textElements.filter((el) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (Math.hypot(cx - x, cy - y) < threshold + 10) {
        if (el.parentNode) el.parentNode.removeChild(el);
        return false;
      }
      return true;
    });
    this.render();
  }

  highlightElement(el) {
    if (!el || !el.getBoundingClientRect) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const box = document.createElement('div');
    box.className = 'trp-highlight';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    box.style.borderColor = this.color;
    box.style.background = this.hexToRGBA(this.color, 0.12);
    this.highlightLayer.appendChild(box);
    this.highlightedElements.push(box);
  }

  hexToRGBA(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return `rgba(255,0,0,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  clearAll() {
    this.paths = [];
    this.textElements.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });
    this.textElements = [];
    this.highlightedElements.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });
    this.highlightedElements = [];
    this.render();
  }

  // ---------- setters ----------

  setTool(tool) { this.activeTool = tool; this.updatePointerMode(); }
  setColor(color) { this.color = color; if (this.colorInput) this.colorInput.value = color; }
  setStrokeWidth(width) { this.strokeWidth = width; }
  setTextSize(size) { this.textSize = size; }

  toggleClickHighlight(enabled) {
    this.clickHighlightEnabled = enabled;
    if (enabled) {
      this.setTool(null);
      Object.keys(this.toolButtons).forEach((k) => {
        if (k !== '__highlight') this.toolButtons[k].classList.remove('active');
      });
    }
    this.updatePointerMode();
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
