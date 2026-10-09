// Mock-only shell: theme from ?theme=light, the real 11-tab nav (labels from src/renderer/main.ts TABS),
// and the backdrop layer. No app logic.
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('theme') === 'light') document.documentElement.dataset.theme = 'light';
  if (params.get('still') === '1') document.documentElement.classList.add('still');

  const TABS = ['Play', 'Learn', 'Train', 'Charts', 'Bank', 'Equity', 'Ranges', 'Dossier', 'Progress', 'Profile', 'Settings'];
  const active = document.body.dataset.tab;
  const nav = document.querySelector('[data-nav]');
  if (nav) {
    nav.className = 'nav glass';
    nav.setAttribute('role', 'navigation');
    nav.innerHTML =
      '<div class="brand" aria-hidden="true">♠</div><div class="tabs" role="tablist">' +
      TABS.map((t) => `<button class="tab" role="tab"${t === active ? ' aria-current="page" aria-selected="true"' : ''}>${t}</button>`).join('') +
      '</div>';
  }
  const field = document.createElement('div');
  field.className = 'field';
  document.body.prepend(field);

  // Slider fill follows the thumb.
  for (const r of document.querySelectorAll('input.range')) {
    const out = document.querySelector(r.dataset.out);
    const sync = () => {
      r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%');
      if (out) out.textContent = r.value;
    };
    r.addEventListener('input', sync);
    sync();
  }
})();
