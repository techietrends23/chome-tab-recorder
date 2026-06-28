const themeToggle = document.getElementById('themeToggle');
const root = document.documentElement;
const storageKey = 'tab-recorder-site-theme';

function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  root.dataset.theme = nextTheme;

  if (!themeToggle) return;

  themeToggle.setAttribute(
    'aria-label',
    nextTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
  );

  const label = themeToggle.querySelector('.theme-toggle-label');
  if (label) {
    label.textContent = nextTheme === 'light' ? 'Light mode' : 'Dark mode';
  }
}

function getInitialTheme() {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (error) {
    // Ignore storage errors and use the default theme.
  }
  return 'light';
}

applyTheme(getInitialTheme());

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(storageKey, nextTheme);
    } catch (error) {
      // Ignore storage errors and keep the theme applied for the session.
    }
  });
}
