(function () {
  const CONTENT_SCRIPT_VERSION = '1.2.2-toolbar-controls-drag';
  if (window.__trpContentScriptVersion === CONTENT_SCRIPT_VERSION) {
    if (window.__trpSyncOverlayFromBackground) window.__trpSyncOverlayFromBackground();
    return;
  }

  window.__trpContentScriptLoaded = true;
  window.__trpContentScriptVersion = CONTENT_SCRIPT_VERSION;

  const RecorderOverlay = window.__TRP_OVERLAY;
  if (!RecorderOverlay) return;

  let overlay = null;

  function ensureOverlay() {
    if (!overlay) overlay = new RecorderOverlay();
    return overlay;
  }

  function applyRecordingState(recordingState) {
    if (!recordingState) return;
    if (recordingState.isRecording) {
      const o = ensureOverlay();
      if (!o.active) o.startSession(recordingState.isPaused, recordingState.startedAt, recordingState);
      else o.setRecordingState(recordingState.isPaused, recordingState.startedAt, recordingState);
    } else if (overlay) {
      overlay.endSession();
    }
  }

  async function syncOverlayFromBackground() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get-state' });
      if (!response || !response.state) return;
      applyRecordingState(response.state);
    } catch (e) {
      // Ignore startup sync failures; live messages still drive the overlay.
    }
  }

  window.__trpApplyRecordingState = applyRecordingState;
  window.__trpSyncOverlayFromBackground = syncOverlayFromBackground;
  window.__trpRevealToolbar = () => {
    if (overlay) overlay.revealToolbarTemporarily();
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'recording-state':
        applyRecordingState(message);
        break;

      // Optional direct controls (kept for compatibility / external triggers)
      case 'set-tool':
        ensureOverlay().setTool(message.tool);
        break;
      case 'set-color':
        ensureOverlay().setColor(message.color);
        break;
      case 'set-stroke-width':
        ensureOverlay().setStrokeWidth(message.width);
        break;
      case 'clear-annotations':
        if (overlay) overlay.clearAll();
        break;
      case 'toggle-click-highlight':
        ensureOverlay().toggleClickHighlight(message.enabled);
        break;
      case 'cleanup':
        if (overlay) overlay.endSession();
        break;
    }
    if (sendResponse) sendResponse({ success: true });
    return false;
  });

  window.addEventListener('unload', () => {
    if (overlay) overlay.deactivate();
  });

  syncOverlayFromBackground();
})();
