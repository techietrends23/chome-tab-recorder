let state = { isRecording: false, isPaused: false, startedAt: null, error: null };
let timerInterval = null;
let recordingOptions = {
  codec: 'auto',
  captureTabAudio: true,
  monitorTabAudio: true,
  hideToolbarInRecording: true,
};

const $ = (id) => document.getElementById(id);
const els = {};

function cache() {
  ['statusDot', 'statusText', 'timer', 'startBtn', 'pauseBtn', 'resumeBtn', 'stopBtn',
   'formatSelect', 'qualitySelect', 'errorBar', 'settingsBtn', 'toolbarInfo', 'showToolbarBtn'
  ].forEach((id) => els[id] = $(id));
}

async function retrieveState() {
  const r = await chrome.runtime.sendMessage({ action: 'get-state' }).catch(() => null);
  if (r && r.state) state = r.state;
}

async function loadSettings() {
  const s = await chrome.storage.sync.get([
    'format', 'quality', 'codec', 'captureTabAudio',
    'monitorTabAudio', 'hideToolbarInRecording',
  ]);
  configureFormatOptions();
  const format = normalizeFormat(s.format);
  els.formatSelect.value = format;
  if (s.format && s.format !== format) chrome.storage.sync.set({ format });
  if (s.quality) els.qualitySelect.value = s.quality;
  recordingOptions = {
    codec: s.codec || 'auto',
    captureTabAudio: s.captureTabAudio !== false,
    monitorTabAudio: s.monitorTabAudio !== false,
    hideToolbarInRecording: s.hideToolbarInRecording !== false,
  };
}

function normalizeFormat(format) {
  if (format === 'gif') return 'gif';
  if (format === 'mp4' && isMp4RecordingSupported()) return 'mp4';
  return 'webm';
}

function isMp4RecordingSupported() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return false;
  return [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ].some((type) => MediaRecorder.isTypeSupported(type));
}

function configureFormatOptions() {
  const mp4Option = Array.from(els.formatSelect.options).find((option) => option.value === 'mp4');
  if (!mp4Option) return;
  const supported = isMp4RecordingSupported();
  mp4Option.disabled = !supported;
  mp4Option.textContent = supported ? 'MP4' : 'MP4 (not supported by this browser)';
}

function updateUI() {
  const dot = els.statusDot;
  dot.className = 'status-dot';
  if (state.isRecording && state.isPaused) { dot.classList.add('paused'); els.statusText.textContent = 'Paused'; }
  else if (state.isRecording) { dot.classList.add('recording'); els.statusText.textContent = 'Recording'; }
  else { dot.classList.add('idle'); els.statusText.textContent = 'Ready to record'; }

  els.startBtn.disabled = state.isRecording;
  els.stopBtn.disabled = !state.isRecording;
  els.pauseBtn.disabled = !state.isRecording;
  els.pauseBtn.style.display = state.isRecording && !state.isPaused ? 'block' : 'none';
  els.resumeBtn.style.display = state.isRecording && state.isPaused ? 'block' : 'none';
  els.toolbarInfo.style.display = state.isRecording ? 'flex' : 'none';

  if (state.isRecording && !state.isPaused && state.startedAt) startTimer(state.startedAt);
  else stopTimer();
  if (!state.isRecording) els.timer.textContent = '00:00';

  if (state.error) showError(state.error); else hideError();
}

function startTimer(startedAt) {
  stopTimer();
  const tick = () => {
    const e = Math.floor((Date.now() - startedAt) / 1000);
    els.timer.textContent = `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
  };
  tick();
  timerInterval = setInterval(tick, 250);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
function showError(m) { els.errorBar.textContent = m; els.errorBar.style.display = 'block'; }
function hideError() { els.errorBar.style.display = 'none'; }

function getMediaStreamId(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(streamId);
    });
  });
}

function getTabUrl(tab) {
  return (tab && (tab.url || tab.pendingUrl || '')) || '';
}

function isRecordableTab(tab) {
  return !!(tab && typeof tab.id === 'number');
}

async function startRecording() {
  hideError();
  const format = normalizeFormat(els.formatSelect.value);
  const quality = els.qualitySelect.value;
  els.formatSelect.value = format;
  chrome.storage.sync.set({ format, quality });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showError('No active tab found.'); return; }

    if (!isRecordableTab(tab)) {
      showError('No recordable browser tab was found. Switch to a tab and try again.');
      return;
    }

    // Acquire the stream id here, inside the popup's user-gesture context.
    const streamId = await getMediaStreamId(tab.id);

    const resp = await chrome.runtime.sendMessage({
      action: 'start-recording',
      streamId,
      tabId: tab.id,
      format,
      quality,
      ...recordingOptions,
    });

    if (!resp || !resp.success) {
      showError(resp && resp.error ? resp.error : 'Failed to start recording.');
      return;
    }

    state.isRecording = true;
    state.isPaused = false;
    state.startedAt = Date.now();
    state.error = null;
    updateUI();
  } catch (e) {
    showError(e.message || 'Could not start recording.');
  }
}

async function stopRecording() {
  const resp = await chrome.runtime.sendMessage({ action: 'stop-recording' }).catch(() => null);
  if (!resp || !resp.success) {
    showError(resp && resp.error ? resp.error : 'Could not stop recording.');
  }
}
async function pauseRecording() {
  const resp = await chrome.runtime.sendMessage({ action: 'pause-recording' }).catch(() => null);
  if (!resp || !resp.success) {
    showError(resp && resp.error ? resp.error : 'Could not pause recording.');
    return;
  }
  state.isPaused = true; updateUI();
}
async function resumeRecording() {
  const resp = await chrome.runtime.sendMessage({ action: 'resume-recording' }).catch(() => null);
  if (!resp || !resp.success) {
    showError(resp && resp.error ? resp.error : 'Could not resume recording.');
    return;
  }
  state.isPaused = false; updateUI();
}

async function showToolbar() {
  const resp = await chrome.runtime.sendMessage({ action: 'show-toolbar' }).catch(() => null);
  if (!resp || !resp.success) {
    showError(resp && resp.error ? resp.error : 'Could not show annotation toolbar.');
    return;
  }
  hideError();
}

document.addEventListener('DOMContentLoaded', async () => {
  cache();
  await loadSettings();
  await retrieveState();
  updateUI();

  els.startBtn.addEventListener('click', startRecording);
  els.stopBtn.addEventListener('click', stopRecording);
  els.pauseBtn.addEventListener('click', pauseRecording);
  els.resumeBtn.addEventListener('click', resumeRecording);
  els.showToolbarBtn.addEventListener('click', showToolbar);
  els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'popup') return false;
  if (msg.action === 'recording-state-update' && msg.state) { Object.assign(state, msg.state); updateUI(); }
  if (msg.action === 'recording-error') { showError(msg.error); state.isRecording = false; state.isPaused = false; updateUI(); }
  if (msg.action === 'recording-complete') {
    state.isRecording = false; state.isPaused = false; state.startedAt = null;
    updateUI();
    if (msg.data && msg.data.warning) showError(msg.data.warning);
    else { els.statusText.textContent = 'Saved: ' + (msg.data ? msg.data.filename : 'recording'); }
  }
  return false;
});
