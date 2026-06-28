# Chrome Extension Recording Tool - Agent Prompt

Build a production-quality **Chrome Extension (Manifest V3)** that records the current browser tab and provides live annotation tools over the page. The extension must support pausing and resuming recording, freehand drawing, highlighting clicked elements, writing text on the screen, erasing annotations, and exporting the recording in a user-selected format. Use a clean MV3 architecture with a service worker, an offscreen document if needed for stable recording, and a content script overlay for annotations. Chrome’s `tabCapture` and `MediaRecorder` are the expected foundation for tab recording, and recording logic should be designed to survive popup closure and remain reliable during longer sessions.

## Product goals
- Record the active tab as a video.
- Allow pause, resume, and stop at any time.
- Support live annotation on top of the page while recording.
- Let the user choose output format: `MP4`, `WebM`, or `GIF`.
- Let the user configure the save destination folder or folder path behavior for downloads.
- Save the final file locally with a clear, timestamped filename.
- Keep the UI simple, responsive, and easy to use.

## Important implementation note
Because browser recording APIs typically emit WebM, the extension should record in the best-supported native format first, then convert to the selected export format when necessary. WebM should be the native/default output path, MP4 should be produced through a conversion step, and GIF should be treated as a special export mode with clear quality and performance tradeoffs. If direct MP4 or GIF recording is not feasible in-browser for a given browser/runtime, implement a fallback pipeline that records WebM and converts locally before download, rather than failing silently.

## Required features
1. **Recording controls**
   - Start recording the active tab.
   - Pause recording.
   - Resume recording.
   - Stop recording and export the final file.
   - Show current state clearly in the popup and overlay.

2. **Annotation tools**
   - Freehand pen tool.
   - Highlighter tool with semi-transparent strokes.
   - Text tool to place typed text onto the screen.
   - Eraser tool to remove annotations.
   - Clear-all annotations action.
   - Click-highlight mode that outlines clicked page elements when enabled.
   - Toggle annotation tools independently from recording state.

3. **Export options**
   - User can select output format from a dropdown: `webm`, `mp4`, `gif`.
   - User can set a default save folder preference in the extension options.
   - If Chrome restrictions prevent true arbitrary path access, implement the closest supported behavior using Chrome downloads, a selectable subfolder inside Downloads, or a Save As flow. Do not pretend the extension can write anywhere on disk without user/browser permission.
   - Use timestamped filenames such as `tab-recording-2026-06-28-1714.webm`.

4. **Folder and save settings**
   - Add an Options page.
   - Include:
     - default export format,
     - preferred download folder/subfolder name,
     - whether to ask every time with Save As,
     - video quality settings,
     - annotation defaults like color and stroke width.
   - If the browser does not allow a true absolute folder path, explain this in the UI and provide the best supported alternative.

## UX requirements
- Popup UI should include:
  - Start.
  - Pause.
  - Resume.
  - Stop.
  - Format selector.
  - Folder/save setting shortcut.
  - Tool selector.
  - Color picker.
  - Stroke width slider.
  - Clear annotations.
- Show a visible recording status indicator.
- Show a visible active tool indicator.
- Show error messages for unsupported actions, permission failures, or conversion failures.
- Provide keyboard shortcuts for the most common actions if practical.

## Architecture
Use this structure:
- `manifest.json`
- `service_worker.js`
- `offscreen.html`
- `offscreen.js`
- `popup.html`
- `popup.js`
- `options.html`
- `options.js`
- `contentScript.js`
- `overlay.css`
- `overlay.js`
- `icons/`

Recommended responsibilities:
- **service worker**: state management, message routing, permission handling, capture orchestration.
- **offscreen document**: recording stream handling, `MediaRecorder`, chunk assembly, export conversion pipeline.
- **content script**: inject annotation UI and page overlay.
- **popup**: controls, format selection, save settings, tool selection.
- **options page**: persistent user preferences.

## Recording behavior
- Use `chrome.tabCapture` to capture the current tab.
- Use `MediaRecorder` to record the stream where supported.
- Support `pause()` and `resume()` when available.
- If the recorder cannot directly produce the selected output format, record natively first and convert afterward.
- Handle tab changes, page reloads, popup closure, and extension suspension gracefully.
- Clean up stream tracks, overlays, listeners, and temporary data on stop.

## Annotation overlay behavior
- Create a transparent fixed overlay above the page.
- Use pointer events for drawing tools.
- When drawing is enabled, capture pointer positions and render paths on a canvas.
- For the text tool, place editable positioned text objects.
- For the eraser, remove the selected annotation object or clear strokes in a targeted way.
- For click-highlighting, intercept element clicks only when highlight mode is enabled and visually outline the clicked element without breaking the page unless explicitly intended.
- Keep annotations visually included in the recording output if possible.

## Export pipeline
- Default native recording format: WebM.
- For MP4:
  - convert from WebM in-browser or in a local processing step if required.
  - verify browser support before enabling the option.
- For GIF:
  - treat as an export option for short recordings or selected regions if needed.
  - warn the user that GIF is large and lower-quality for long videos.
- Add a format capability check before start so the user knows whether the chosen format is supported.
- Save the final file using `chrome.downloads.download`.
- Support a configurable subfolder under Downloads if that is the browser-safe path model available.
- Provide a Save As option when the user wants manual control over location.

## Data model
Maintain two main state objects:
- Recording state:
  - `isRecording`
  - `isPaused`
  - `currentTabId`
  - `streamId`
  - `recordedChunks`
  - `selectedFormat`
  - `quality`
  - `conversionStatus`
- Annotation state:
  - `activeTool`
  - `color`
  - `strokeWidth`
  - `textItems`
  - `drawPaths`
  - `highlightedElements`
  - `isClickHighlightEnabled`

## Acceptance criteria
- I can start a recording on the active tab.
- I can pause and resume without losing the recording session.
- I can draw, highlight, type text, and erase on top of the page.
- I can toggle click-highlight mode and clicked elements get outlined.
- I can choose WebM, MP4, or GIF before export.
- I can configure where files are saved using the extension’s supported save settings.
- The extension loads unpacked in Chrome MV3 and works without console errors in normal use.

## Deliverables
1. Full source code.
2. Setup/install instructions.
3. Architecture explanation.
4. Limitations and browser compatibility notes.
5. A short checklist of future enhancements.

## Suggested v1 scope
Implement these first:
- tab recording,
- pause/resume,
- WebM export,
- annotation overlay,
- click highlight mode,
- text and eraser tools,
- save settings page,
- format selector with WebM as the guaranteed baseline.

Then add:
- MP4 conversion,
- GIF export,
- undo/redo,
- hotkeys,
- annotation persistence,
- cloud sync of settings,
- region recording.

## Engineering constraints
- Keep modules small and testable.
- Use message passing cleanly between components.
- Avoid relying on popup lifetime for any recording work.
- Do not hardcode unsupported filesystem behavior.
- Prefer native browser capabilities over custom hacks.
- Provide graceful fallbacks when MP4 or GIF conversion is not supported in the current runtime.
```