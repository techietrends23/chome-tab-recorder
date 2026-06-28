const $ = (id) => document.getElementById(id);

const fields = [
  'format', 'quality', 'codec', 'captureTabAudio', 'monitorTabAudio',
  'downloadFolder', 'askSaveAs', 'defaultColor', 'defaultStrokeWidth',
  'hideToolbarInRecording',
];

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
  const mp4Option = $('format').querySelector('option[value="mp4"]');
  const hint = $('formatHint');
  if (!mp4Option) return;
  const supported = isMp4RecordingSupported();
  mp4Option.disabled = !supported;
  mp4Option.textContent = supported ? 'MP4' : 'MP4 (not supported by this browser)';
  if (hint && !supported) {
    hint.textContent = 'MP4 is not supported by this browser for MediaRecorder output. WebM is the reliable local recording format.';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  configureFormatOptions();
  const saved = await chrome.storage.sync.get(fields);

  if (saved.format) $('format').value = normalizeFormat(saved.format);
  if (saved.quality) $('quality').value = saved.quality;
  if (saved.codec) $('codec').value = saved.codec;
  $('captureTabAudio').checked = saved.captureTabAudio !== false;
  $('monitorTabAudio').checked = saved.monitorTabAudio !== false;
  if (saved.downloadFolder) $('downloadFolder').value = saved.downloadFolder;
  if (saved.askSaveAs) $('askSaveAs').checked = saved.askSaveAs;
  if (saved.defaultColor) $('defaultColor').value = saved.defaultColor;
  if (saved.defaultStrokeWidth) {
    $('defaultStrokeWidth').value = saved.defaultStrokeWidth;
    $('strokeWidthValue').textContent = saved.defaultStrokeWidth;
  }
  $('hideToolbarInRecording').checked = saved.hideToolbarInRecording !== false;

  $('defaultStrokeWidth').addEventListener('input', (e) => {
    $('strokeWidthValue').textContent = e.target.value;
  });

  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      format: normalizeFormat($('format').value),
      quality: $('quality').value,
      codec: $('codec').value,
      captureTabAudio: $('captureTabAudio').checked,
      monitorTabAudio: $('monitorTabAudio').checked,
      downloadFolder: $('downloadFolder').value.trim(),
      askSaveAs: $('askSaveAs').checked,
      defaultColor: $('defaultColor').value,
      defaultStrokeWidth: parseInt($('defaultStrokeWidth').value),
      hideToolbarInRecording: $('hideToolbarInRecording').checked,
    };

    await chrome.storage.sync.set(data);

    const status = $('saveStatus');
    status.textContent = 'Settings saved';
    status.className = 'save-status saved';
    setTimeout(() => {
      status.textContent = '';
      status.className = 'save-status';
    }, 2000);
  });
});
