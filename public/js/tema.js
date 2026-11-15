/* ═══════════════════════════════════════════════════════════════
   NewHal — Açık / koyu tema
   Seçim bu tarayıcıda saklanır; ilk açılış teması <head>'deki küçük
   betikle sayfa çizilmeden uygulanır. Renkler css/tema.css'te.
   ═══════════════════════════════════════════════════════════════ */
const THEME_KEY = 'newhalTheme';
const THEME_COLORS = { dark: '#080c16', light: '#f4f7f5' };

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.setAttribute('aria-label', theme === 'light' ? 'Koyu temaya geç' : 'Açık temaya geç');
}

function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next);
  if (typeof showToast === 'function') showToast(next === 'light' ? '☀️ Açık tema' : '🌙 Koyu tema', 'success');
}

applyTheme(currentTheme());
