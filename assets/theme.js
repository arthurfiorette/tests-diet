// Runs before styles are parsed so saved preferences apply to the first paint.
(() => {
  let theme;
  try {
    theme = localStorage.getItem('tests-diet-theme');
  } catch {}
  if (theme !== 'dark' && theme !== 'light') {
    theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    const width = Number(localStorage.getItem('tests-diet-sidebar-width'));
    if (width >= 190 && width <= 480)
      document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  } catch {}
})();
