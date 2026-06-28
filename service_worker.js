// Service worker: orchestrates the offscreen recorder and the in-page toolbar.
// It owns the canonical recording state so the popup can close at any time.

let state = {
  isRecording: false,
  isPaused: false,
  tabId: null,
  format: 'webm',
  quality: 'medium',
  codec: 'auto',
  captureTabAudio: true,
  monitorTabAudio: true,
  hideToolbarInRecording: true,
  startedAt: null,
  error: null,
};

let offscreenCreated = false;
const notificationDownloads = new Map();

// ---------- Offscreen document lifecycle ----------

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    const exists = ctxs.length > 0;
    offscreenCreated = exists;
    return exists;
  }
  return offscreenCreated;
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (creatingOffscreen) { await creatingOffscreen; return; }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK', 'BLOBS'],
    justification: 'Recording the active tab with MediaRecorder.',
  });
  try {
    await creatingOffscreen;
    offscreenCreated = true;
  } finally {
    creatingOffscreen = null;
  }
}

function sendToOffscreen(message) {
  return chrome.runtime.sendMessage({ target: 'offscreen', ...message });
}

function normalizeFormat(format) {
  return ['gif', 'mp4'].includes(format) ? format : 'webm';
}

// ---------- Content script (in-page toolbar) ----------

async function ensureContentScript(tabId) {
  let cssInjected = false;
  let scriptInjected = false;

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['overlay.css'] });
    cssInjected = true;
  } catch (e) { /* already present */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js', 'contentScript.js'] });
    scriptInjected = true;
  } catch (e) { /* already present or restricted page */ }

  return cssInjected || scriptInjected;
}

function getContentRecordingState(overrides = {}) {
  return {
    target: 'content',
    action: 'recording-state',
    isRecording: state.isRecording,
    isPaused: state.isPaused,
    startedAt: state.startedAt,
    hideToolbarInRecording: state.hideToolbarInRecording,
    ...overrides,
  };
}

async function applyOverlayState(tabId, recordingState) {
  if (!tabId) return false;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (nextState) => {
        if (window.__trpApplyRecordingState) {
          window.__trpApplyRecordingState(nextState);
          return true;
        }
        return false;
      },
      args: [recordingState],
    });
    return !!(results && results.some((r) => r.result));
  } catch (e) {
    return false;
  }
}

async function notifyContent(overrides = {}) {
  if (!state.tabId) return false;
  const recordingState = getContentRecordingState(overrides);

  const applied = await applyOverlayState(state.tabId, recordingState);
  chrome.tabs.sendMessage(state.tabId, recordingState).catch(() => {});
  return applied;
}

async function showOverlayWithRetries(tabId) {
  const recordingState = getContentRecordingState();
  for (let i = 0; i < 5; i++) {
    if (await applyOverlayState(tabId, recordingState)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  chrome.tabs.sendMessage(tabId, recordingState).catch(() => {});
  return false;
}

async function revealToolbar(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__trpRevealToolbar) window.__trpRevealToolbar();
      },
    });
  } catch (e) {
    // Non-fatal; retry/show state above already handled injection failures.
  }
}

async function showToolbarForRecording() {
  if (!state.isRecording || !state.tabId) {
    return { success: false, error: 'Not recording' };
  }

  await ensureContentScript(state.tabId);
  const visible = await showOverlayWithRetries(state.tabId);
  if (!visible) {
    const error = 'Annotation toolbar is unavailable on this browser page. Try a regular website tab such as https://www.google.com.';
    state.error = error;
    broadcastPopup();
    return { success: false, error };
  }

  state.error = null;
  await revealToolbar(state.tabId);
  broadcastPopup();
  return { success: true };
}

function broadcastPopup() {
  chrome.runtime.sendMessage({
    target: 'popup',
    action: 'recording-state-update',
    state: { ...state },
  }).catch(() => {});
}

// ---------- Recording control ----------

async function startRecording(msg) {
  if (state.isRecording) return { success: false, error: 'Already recording' };

  await ensureOffscreen();
  const format = normalizeFormat(msg.format);

  const resp = await sendToOffscreen({
    action: 'start',
    streamId: msg.streamId,
    format,
    quality: msg.quality || 'medium',
    codec: msg.codec || 'auto',
    captureTabAudio: msg.captureTabAudio !== false,
    monitorTabAudio: msg.monitorTabAudio !== false,
  });

  if (!resp || !resp.success) {
    const error = (resp && resp.error) || 'Failed to start recording';
    state.error = error;
    broadcastPopup();
    return { success: false, error };
  }

  state.isRecording = true;
  state.isPaused = false;
  state.tabId = msg.tabId;
  state.format = format;
  state.quality = msg.quality || 'medium';
  state.codec = msg.codec || 'auto';
  state.captureTabAudio = msg.captureTabAudio !== false;
  state.monitorTabAudio = msg.monitorTabAudio !== false;
  state.hideToolbarInRecording = msg.hideToolbarInRecording !== false;
  state.startedAt = Date.now();
  state.error = null;

  await ensureContentScript(msg.tabId);
  const overlayVisible = await showOverlayWithRetries(msg.tabId);
  if (!overlayVisible) {
    state.error = 'Recording started, but the annotation toolbar is unavailable on this browser page. Try a regular website tab such as https://www.google.com.';
  }
  broadcastPopup();
  return { success: true };
}

async function controlRecording(kind) {
  if (!state.isRecording) return { success: false, error: 'Not recording' };
  const resp = await sendToOffscreen({ action: kind });
  if (!resp || !resp.success) {
    return { success: false, error: (resp && resp.error) || `Failed to ${kind} recording` };
  }
  state.isPaused = (kind === 'pause');
  state.error = null;
  await notifyContent();
  broadcastPopup();
  return { success: true };
}

async function stopRecording() {
  if (!state.isRecording) return { success: false, error: 'Not recording' };
  const resp = await sendToOffscreen({ action: 'stop' });
  if (!resp || !resp.success) {
    return { success: false, error: (resp && resp.error) || 'Failed to stop recording' };
  }
  // Final state transition happens when offscreen reports 'recording-complete'.
  return { success: true };
}

async function handleToolbarControl(msg, sender) {
  if (!state.isRecording) return { success: false, error: 'Not recording' };
  if (sender && sender.tab && state.tabId && sender.tab.id !== state.tabId) {
    return { success: false, error: 'Toolbar is not attached to the active recording tab' };
  }

  switch (msg.control) {
    case 'pause-recording':
      return controlRecording('pause');
    case 'resume-recording':
      return controlRecording('resume');
    case 'stop-recording':
      return stopRecording();
    default:
      return { success: false, error: 'Unknown toolbar control: ' + msg.control };
  }
}

async function onRecordingComplete(msg) {
  const finishedTabId = state.tabId;
  state.isRecording = false;
  state.isPaused = false;
  state.startedAt = null;
  state.error = null;
  if (finishedTabId != null) {
    await applyOverlayState(finishedTabId, getContentRecordingState({
      isRecording: false,
      isPaused: false,
      startedAt: null,
    }));
    chrome.tabs.sendMessage(finishedTabId, getContentRecordingState({
      isRecording: false,
      isPaused: false,
      startedAt: null,
    })).catch(() => {});
  }
  state.tabId = null;

  const settings = await chrome.storage.sync.get(['downloadFolder', 'askSaveAs']);
  const folder = (settings.downloadFolder || '').trim().replace(/^[\/\\]+|[\/\\]+$/g, '');
  const filename = folder ? `${folder}/${msg.filename}` : msg.filename;

  let downloadError = null;
  let downloadId = null;
  try {
    downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: msg.url,
        filename,
        saveAs: !!settings.askSaveAs,
      }, (downloadId) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else {
          resolve(downloadId);
        }
      });
    });
  } catch (e) {
    downloadError = e.message;
  }

  if (downloadError) {
    state.error = 'Download failed: ' + downloadError;
    chrome.runtime.sendMessage({ target: 'popup', action: 'recording-error', error: state.error }).catch(() => {});
  } else {
    await notifySavedFile({ downloadId, filename: msg.filename, warning: msg.warning });
    chrome.runtime.sendMessage({
      target: 'popup',
      action: 'recording-complete',
      data: { filename: msg.filename, format: msg.format, size: msg.size, warning: msg.warning, downloadId },
    }).catch(() => {});
  }

  broadcastPopup();
}

async function onRecordingError(error) {
  const failedTabId = state.tabId;
  state.error = error;
  state.isRecording = false;
  state.isPaused = false;
  state.startedAt = null;
  if (failedTabId != null) {
    await applyOverlayState(failedTabId, getContentRecordingState({
      isRecording: false,
      isPaused: false,
      startedAt: null,
    }));
    chrome.tabs.sendMessage(failedTabId, getContentRecordingState({
      isRecording: false,
      isPaused: false,
      startedAt: null,
    })).catch(() => {});
  }
  state.tabId = null;
  chrome.runtime.sendMessage({ target: 'popup', action: 'recording-error', error }).catch(() => {});
  broadcastPopup();
}

async function notifySavedFile({ downloadId, filename, warning }) {
  if (!chrome.notifications) return;

  const notificationId = `recording-saved-${Date.now()}`;
  const message = warning
    ? `${filename}\n${warning}`
    : `${filename}\nClick to show the saved file.`;

  if (downloadId != null) {
    notificationDownloads.set(notificationId, downloadId);
  }

  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Recording saved',
    message,
  });
}

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Messages aimed at other contexts are not for the service worker.
  if (msg.target === 'offscreen' || msg.target === 'content' || msg.target === 'popup') return false;

  (async () => {
    try {
      let r = { success: true };
      switch (msg.action) {
        case 'start-recording':  r = await startRecording(msg); break;
        case 'stop-recording':   r = await stopRecording(); break;
        case 'pause-recording':  r = await controlRecording('pause'); break;
        case 'resume-recording': r = await controlRecording('resume'); break;
        case 'toolbar-control':  r = await handleToolbarControl(msg, sender); break;
        case 'show-toolbar':     r = await showToolbarForRecording(); break;
        case 'get-state':        r = { state: { ...state } }; break;

        // From the offscreen document (target: 'background')
        case 'recording-complete': await onRecordingComplete(msg); break;
        case 'recording-error':    await onRecordingError(msg.error); break;

        default: r = { success: false, error: 'Unknown action: ' + msg.action };
      }
      sendResponse(r);
    } catch (e) {
      sendResponse({ success: false, error: e.message || String(e) });
    }
  })();

  return true;
});

// Re-attach the toolbar after the recorded tab navigates/reloads.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (tabId === state.tabId && state.isRecording && info.status === 'complete') {
    await ensureContentScript(tabId);
    await showOverlayWithRetries(tabId);
  }
});

// If the recorded tab is closed, stop recording.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId && state.isRecording) {
    stopRecording().catch(() => {});
  }
});

if (chrome.notifications) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const downloadId = notificationDownloads.get(notificationId);
    chrome.notifications.clear(notificationId);
    if (downloadId == null) return;
    chrome.downloads.show(downloadId);
    notificationDownloads.delete(notificationId);
  });

  chrome.notifications.onClosed.addListener((notificationId) => {
    notificationDownloads.delete(notificationId);
  });
}
