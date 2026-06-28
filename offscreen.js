// Offscreen document: owns the MediaRecorder so recording survives popup closure.
// Receives a tabCapture streamId from the service worker and records it via getUserMedia.

let mediaRecorder = null;
let recordedChunks = [];
let captureStream = null;
let audioCtx = null;
let selectedFormat = 'webm';
let quality = 'medium';
let codec = 'auto';
let captureTabAudio = true;
let monitorTabAudio = true;
let recordingMimeType = 'video/webm';
let recordingComplete = false;

const $ = (id) => document.getElementById(id);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  (async () => {
    try {
      let result = { success: true };
      switch (message.action) {
        case 'start':
          await startRecording(message);
          break;
        case 'pause':
          pauseRecording();
          break;
        case 'resume':
          resumeRecording();
          break;
        case 'stop':
          await stopRecording();
          break;
        default:
          result = { success: false, error: 'Unknown action: ' + message.action };
      }
      sendResponse(result);
    } catch (error) {
      sendResponse({ success: false, error: error.message || String(error) });
    }
  })();

  return true;
});

function getSupportedMimeType(format, preferredCodec, withAudio) {
  if (format === 'mp4') {
    const mp4Types = withAudio
      ? [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=h264,aac',
          'video/mp4',
        ]
      : [
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4;codecs=h264',
          'video/mp4',
        ];
    for (const t of mp4Types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
  }

  const audioSuffix = withAudio ? ',opus' : '';
  const preferredTypes = preferredCodec === 'vp9'
    ? [`video/webm;codecs=vp9${audioSuffix}`]
    : preferredCodec === 'vp8'
      ? [`video/webm;codecs=vp8${audioSuffix}`]
      : [];
  const fallbackTypes = withAudio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ]
    : [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
  const types = [...preferredTypes, ...fallbackTypes];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'video/webm';
}

function getBitrate(q) {
  return q === 'high' ? 5000000 : q === 'low' ? 1000000 : 2500000;
}

function normalizeFormat(format) {
  return ['gif', 'mp4'].includes(format) ? format : 'webm';
}

function buildConstraints(streamId, withAudio) {
  const constraints = {
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  };
  if (withAudio) {
    constraints.audio = {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    };
  }
  return constraints;
}

async function startRecording(message) {
  selectedFormat = normalizeFormat(message.format);
  quality = message.quality || 'medium';
  codec = message.codec || 'auto';
  captureTabAudio = message.captureTabAudio !== false;
  monitorTabAudio = message.monitorTabAudio !== false;
  recordedChunks = [];
  recordingComplete = false;

  const streamId = message.streamId;
  if (!streamId) throw new Error('No stream id provided');

  // Try requested tab audio first; fall back to video-only if audio capture is unavailable.
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(buildConstraints(streamId, captureTabAudio));
  } catch (e) {
    stream = await navigator.mediaDevices.getUserMedia(buildConstraints(streamId, false));
  }

  captureStream = stream;

  // tabCapture mutes the tab for the user. Re-route the audio to the speakers so
  // playback is still audible while recording.
  if (monitorTabAudio && stream.getAudioTracks().length) {
    try {
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(audioCtx.destination);
    } catch (e) {
      // non-fatal
    }
  }

  recordingMimeType = getSupportedMimeType(selectedFormat, codec, stream.getAudioTracks().length > 0);
  const options = {
    mimeType: recordingMimeType,
    videoBitsPerSecond: getBitrate(quality),
  };
  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (e) {
    mediaRecorder = new MediaRecorder(stream);
  }
  recordingMimeType = mediaRecorder.mimeType || recordingMimeType || 'video/webm';

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    if (!recordingComplete) {
      recordingComplete = true;
      handleComplete();
    }
  };

  mediaRecorder.onerror = (e) => {
    sendToBackground({ action: 'recording-error', error: (e.error && e.error.message) || 'MediaRecorder error' });
  };

  // If the user closes/navigates so the stream ends, stop gracefully.
  stream.getVideoTracks().forEach((track) => {
    track.onended = () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) {}
      }
    };
  });

  mediaRecorder.start(1000);
}

function pauseRecording() {
  if (!mediaRecorder) throw new Error('Recorder is not ready');
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    return;
  }
  throw new Error('Recorder is not currently recording');
}

function resumeRecording() {
  if (!mediaRecorder) throw new Error('Recorder is not ready');
  if (mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    return;
  }
  throw new Error('Recorder is not currently paused');
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      cleanupStream();
      resolve();
      return;
    }
    mediaRecorder.onstop = () => {
      if (!recordingComplete) {
        recordingComplete = true;
        handleComplete().finally(() => {
          cleanupStream();
          resolve();
        });
      } else {
        cleanupStream();
        resolve();
      }
    };
    try {
      if (mediaRecorder.state === 'recording') {
        try { mediaRecorder.requestData(); } catch (e) {}
      }
      mediaRecorder.stop();
    } catch (e) {
      cleanupStream();
      resolve();
    }
  });
}

function cleanupStream() {
  if (captureStream) {
    captureStream.getTracks().forEach((t) => t.stop());
    captureStream = null;
  }
  if (audioCtx) {
    try { audioCtx.close(); } catch (e) {}
    audioCtx = null;
  }
}

async function handleComplete() {
  if (!recordedChunks.length) {
    sendToBackground({ action: 'recording-error', error: 'No video data was captured' });
    cleanupStream();
    mediaRecorder = null;
    return;
  }

  const blob = new Blob(recordedChunks, { type: recordingMimeType || 'video/webm' });
  recordedChunks = [];

  let finalBlob = blob;
  let extension = (recordingMimeType || '').startsWith('video/mp4') ? 'mp4' : 'webm';
  let warning = null;

  if (selectedFormat === 'gif') {
    try {
      finalBlob = await convertToGIF(blob);
      extension = 'gif';
    } catch (e) {
      finalBlob = blob;
      extension = 'webm';
      warning = 'GIF conversion failed, saved as WebM: ' + e.message;
    }
  } else if (selectedFormat === 'mp4' && extension !== 'mp4') {
    warning = 'MP4 recording is not supported by this browser. Saved as WebM.';
  }

  const filename = `tab-recording-${getTimestamp()}.${extension}`;
  const url = URL.createObjectURL(finalBlob);

  sendToBackground({
    action: 'recording-complete',
    url,
    filename,
    format: extension,
    size: finalBlob.size,
    warning,
  });

  // Keep the blob alive long enough for chrome.downloads to read it.
  setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch (e) {}
  }, 120000);

  mediaRecorder = null;
}

function getTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sendToBackground(message) {
  chrome.runtime.sendMessage({ target: 'background', ...message }).catch(() => {});
}

// ---------- GIF export ----------

async function convertToGIF(webmBlob) {
  const maxDuration = 15;
  const fps = 10;
  const maxWidth = 480;

  const video = $('preview');
  const url = URL.createObjectURL(webmBlob);
  video.src = url;
  video.load();

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Failed to load video for conversion'));
  });

  const dur = Math.min(video.duration || maxDuration, maxDuration);
  const frames = Math.max(1, Math.ceil(dur * fps));
  const interval = dur / frames;
  const scale = Math.min(1, maxWidth / (video.videoWidth || 640));
  const w = Math.round((video.videoWidth || 640) * scale);
  const h = Math.round((video.videoHeight || 360) * scale);

  const canvas = $('frameCanvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const encoder = new GIFEncoder(w, h);
  encoder.setDelay(Math.round(1000 / fps));
  encoder.setRepeat(0);

  for (let i = 0; i < frames; i++) {
    const time = i * interval;
    video.currentTime = time;
    await new Promise((resolve) => {
      const onSeek = () => { video.removeEventListener('seeked', onSeek); resolve(); };
      video.addEventListener('seeked', onSeek);
      if (Math.abs(video.currentTime - time) < 0.01) {
        video.removeEventListener('seeked', onSeek);
        resolve();
      }
    });
    ctx.drawImage(video, 0, 0, w, h);
    encoder.addFrame(ctx.getImageData(0, 0, w, h));
  }

  URL.revokeObjectURL(url);
  video.removeAttribute('src');
  video.load();

  return encoder.render();
}

class GIFEncoder {
  constructor(w, h) { this.width = w; this.height = h; this.frames = []; this.delay = 100; this.repeat = 0; }
  setDelay(d) { this.delay = d; }
  setRepeat(r) { this.repeat = r; }
  addFrame(d) { this.frames.push(d); }

  buildPalette() {
    const p = [];
    for (let r = 0; r < 8; r++) for (let g = 0; g < 8; g++) for (let b = 0; b < 4; b++) p.push([r * 32 + 16, g * 32 + 16, b * 64 + 32]);
    return p;
  }

  async render() {
    const palette = this.buildPalette();
    const palBytes = new Uint8Array(palette.length * 3);
    for (let i = 0; i < palette.length; i++) { palBytes[i * 3] = palette[i][0]; palBytes[i * 3 + 1] = palette[i][1]; palBytes[i * 3 + 2] = palette[i][2]; }

    const te = new TextEncoder();
    const lsd = (() => {
      const b = new ArrayBuffer(7); const v = new DataView(b);
      v.setUint16(0, this.width, true); v.setUint16(2, this.height, true);
      v.setUint8(4, 0xf7); v.setUint8(5, 0); v.setUint8(6, 0);
      return new Uint8Array(b);
    })();

    const gce = (() => {
      const b = new ArrayBuffer(8); const v = new DataView(b);
      v.setUint8(0, 0x21); v.setUint8(1, 0xf9); v.setUint8(2, 0x04); v.setUint8(3, 0);
      v.setUint16(4, Math.round(this.delay / 10), true); v.setUint8(6, 0); v.setUint8(7, 0);
      return new Uint8Array(b);
    })();

    const appExt = (() => {
      const b = new ArrayBuffer(19); const v = new DataView(b);
      v.setUint8(0, 0x21); v.setUint8(1, 0xff); v.setUint8(2, 0x0b);
      (new Uint8Array(b)).set(te.encode('NETSCAPE2.0'), 3);
      v.setUint8(14, 3); v.setUint8(15, 1); v.setUint16(16, this.repeat, true); v.setUint8(18, 0);
      return new Uint8Array(b);
    })();

    const imageDataList = [];
    for (const frame of this.frames) {
      const d = frame.data;
      const indexed = new Uint8Array(d.length / 4);
      for (let i = 0; i < indexed.length; i++) {
        const ri = i * 4; const r = d[ri], g = d[ri + 1], b = d[ri + 2];
        let best = Infinity, idx = 0;
        for (let j = 0; j < palette.length; j++) {
          const dr = r - palette[j][0], dg = g - palette[j][1], db = b - palette[j][2];
          const dist = dr * dr + dg * dg + db * db;
          if (dist < best) { best = dist; idx = j; }
        }
        indexed[i] = idx;
      }

      const clearCode = 256, endCode = 257;
      const codes = [clearCode];
      let cur = indexed[0], cs = 9, next = 258;
      const dict = new Map();
      for (let i = 0; i < 256; i++) dict.set(i, i);
      for (let i = 1; i < indexed.length; i++) {
        const key = cur * 256 + indexed[i];
        if (dict.has(key)) { cur = dict.get(key); }
        else { codes.push(cur); if (next < 4096) { dict.set(key, next++); if (next > (1 << cs)) cs++; } cur = indexed[i]; }
      }
      codes.push(cur); codes.push(endCode);

      const out = []; let buf = 0, bc = 0, ocs = 9;
      for (const code of codes) {
        if (code >= (1 << ocs)) ocs++;
        buf |= (code << bc); bc += ocs;
        while (bc >= 8) { out.push(buf & 0xff); buf >>= 8; bc -= 8; }
      }
      if (bc > 0) out.push(buf & 0xff);

      const blocks = [8];
      for (let i = 0; i < out.length; i += 255) { const c = out.slice(i, i + 255); blocks.push(c.length, ...c); }
      blocks.push(0);

      const imgDesc = new ArrayBuffer(10); const w = new DataView(imgDesc);
      w.setUint8(0, 0x2c); w.setUint16(1, 0, true); w.setUint16(3, 0, true);
      w.setUint16(5, this.width, true); w.setUint16(7, this.height, true); w.setUint8(9, 0);
      const ih = new Uint8Array(imgDesc);
      const id = new Uint8Array(blocks);
      const r = new Uint8Array(ih.length + id.length);
      r.set(ih, 0); r.set(id, ih.length);
      imageDataList.push(r);
    }

    const chunks = [te.encode('GIF89a'), lsd, palBytes, appExt];
    for (const img of imageDataList) { chunks.push(gce); chunks.push(img); }
    chunks.push(new Uint8Array([0x3b]));

    const len = chunks.reduce((s, c) => s + c.byteLength, 0);
    const result = new Uint8Array(len); let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.byteLength; }
    return new Blob([result], { type: 'image/gif' });
  }
}
