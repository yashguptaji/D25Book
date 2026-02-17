(function () {
  const storageKey = 'iima-scrapbook-theme';
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');

  const saved = localStorage.getItem(storageKey);
  const initialTheme = saved === 'dark' || saved === 'light' ? saved : 'dark';
  root.setAttribute('data-theme', initialTheme);

  function syncToggleIcon() {
    if (!toggle) return;
    const current = root.getAttribute('data-theme') || 'light';
    if (current === 'light') {
      toggle.textContent = '🌙';
      toggle.setAttribute('aria-label', 'Switch to dark mode');
    } else {
      toggle.textContent = '☀️';
      toggle.setAttribute('aria-label', 'Switch to light mode');
    }
  }

  syncToggleIcon();

  if (!toggle) return;

  toggle.addEventListener('click', function () {
    const current = root.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem(storageKey, next);
    syncToggleIcon();
  });
})();
