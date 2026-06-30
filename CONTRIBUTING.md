# Contributing

Thanks for your interest in Tab Recorder Pro!

## Getting Started

1. Fork the repo and clone locally.
2. Open `chrome://extensions`, enable Developer mode, and click **Load unpacked** — select the project folder.
3. Make your changes and reload the extension to test.

## Code Guidelines

- **No external dependencies** — keep the extension self-contained. No npm packages, CDN scripts, or frameworks.
- Use `textContent` instead of `innerHTML` when inserting user-controlled data.
- Use `addEventListener` over inline event handlers.
- All user input must be validated or constrained to whitelisted values.
- Message passing must use the existing `target` + `action` routing pattern — do not introduce new ad-hoc channels.
- Avoid `eval`, `new Function`, `document.write`, and similar dynamic code execution.

## Security

- Never commit secrets, API keys, tokens, or the extension signing key (`*.pem`).
- If your change introduces a new permission in `manifest.json`, explain why it's needed.
- If your change adds a new message action, ensure it is whitelisted in the routing switch/case.
- `innerHTML` is only acceptable for hardcoded, static HTML strings — never with interpolated user data.

## Pull Request Process

1. Keep PRs focused on a single concern.
2. Update the README if your change affects installation, usage, or limitations.
3. Ensure the extension loads without console errors after your changes.
4. Test that recording, annotations, and export still work end-to-end.

## Reporting Issues

- **Bugs**: Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and browser version.
- **Security vulnerabilities**: Do **not** open a public issue. See `SECURITY.md` for the disclosure process.
