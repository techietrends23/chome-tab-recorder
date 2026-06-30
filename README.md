# Chrome Tab Recorder

A Manifest V3 Chrome extension for recording browser tabs with live annotation tools.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this project folder.

## Usage

1. Open a regular website tab.
2. Click the extension icon and press Start.
3. Use the floating annotation toolbar for pen, highlighter, text, eraser, click highlight, pause/resume, and stop.
4. Open Settings to configure export format, quality, WebM codec, audio capture, save behavior, and toolbar auto-hide.

## Keyboard Shortcuts During Recording

- `Esc`: turn off the active annotation mode (pen, highlighter, text, eraser, or click highlight).
- `Delete` / `Backspace`: undo the most recent annotation change.

## Export Notes

WebM is the most reliable local recording format because Chrome's `MediaRecorder` records WebM natively in most environments.

MP4 is enabled only when the current browser reports native MP4 `MediaRecorder` support. If native MP4 is unavailable, the extension records WebM instead. A full MP4 fallback would require bundling a real converter such as `ffmpeg.wasm` or using a native/server conversion step.

GIF export is intended for short clips and is generated from recorded video frames.

## Toolbar Visibility

The annotation toolbar is injected into the page so Chrome may capture it when it is visible. The default auto-hide setting keeps the toolbar transparent during recording and reveals it on hover or via the popup's Show toolbar button. Annotations remain visible.

## Limitations

Chrome extensions cannot inject the annotation toolbar into browser-internal pages such as `chrome://` pages or some new-tab/start surfaces. Use a regular website URL for annotation recording.

Chrome extensions also cannot write to arbitrary filesystem paths. Downloads are saved through Chrome's downloads API, optionally using a subfolder or Save As dialog.
