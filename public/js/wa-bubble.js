// Sağ altta WhatsApp baloncuğu: "1 yeni mesaj" rozeti, karşılama kartı ve sekme başlığında yanıp sönen bildirim
(function () {
  const GROUP = 'https://chat.whatsapp.com/LmYOXYNJ6cMKMEE8LM6WPP';
  const KEY = 'nh_wa_bubble_seen';
  let seen = false;
  try { seen = sessionStorage.getItem(KEY) === '1'; } catch {}

  const css = document.createElement('style');
  css.textContent = `
  .nhwa { position: fixed; right: 18px; bottom: calc(18px + env(safe-area-inset-bottom)); z-index: 9990; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .nhwa-btn { width: 60px; height: 60px; border-radius: 50%; border: 0; background: #25d366; color: #fff; cursor: pointer; display: grid; place-items: center; box-shadow: 0 6px 20px rgba(0,0,0,.25); position: relative; animation: nhwa-pulse 2.4s infinite; }
  .nhwa-btn svg { width: 32px; height: 32px; }
  .nhwa-badge { position: absolute; top: -2px; right: -2px; min-width: 22px; height: 22px; border-radius: 11px; background: #ef4444; color: #fff; font-size: 13px; font-weight: 800; display: grid; place-items: center; border: 2px solid #fff; }
  .nhwa-card { position: absolute; right: 0; bottom: 74px; width: min(290px, calc(100vw - 36px)); background: #fff; color: #17211a; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 14px; display: none; }
  .nhwa.open .nhwa-card { display: block; animation: nhwa-in .25s ease; }
  .nhwa-msg { background: #f0f5f1; border-radius: 12px; padding: 10px 12px; font-size: 14.5px; line-height: 1.4; margin-bottom: 10px; }
  .nhwa-x { position: absolute; top: 6px; right: 8px; border: 0; background: none; font-size: 20px; color: #6b7280; cursor: pointer; }
  .nhwa-card a { display: block; text-align: center; border: 1.5px solid #25d366; color: #128c4a; border-radius: 999px; padding: 9px 12px; margin-top: 8px; text-decoration: none; font-weight: 700; font-size: 14px; }
  .nhwa-card a:hover { background: #25d366; color: #fff; }
  @keyframes nhwa-pulse { 0%,100% { box-shadow: 0 6px 20px rgba(0,0,0,.25), 0 0 0 0 rgba(37,211,102,.5); } 50% { box-shadow: 0 6px 20px rgba(0,0,0,.25), 0 0 0 12px rgba(37,211,102,0); } }
  @keyframes nhwa-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.className = 'nhwa';
  box.innerHTML = `
    <div class="nhwa-card" role="dialog" aria-label="NewHal WhatsApp">
      <button class="nhwa-x" type="button" aria-label="Kapat">×</button>
      <div class="nhwa-msg">👋 Merhaba! Hal'deki yeni ilanlar, fiyatlar ve duyurular WhatsApp grubumuzda. Katılmak ister misin?</div>
      <a href="${GROUP}" target="_blank" rel="noopener">WhatsApp grubuna katıl</a>
      <a href="/bulten">Bu haftanın bültenini gör</a>
    </div>
    <button class="nhwa-btn" type="button" aria-label="WhatsApp, 1 yeni mesaj">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>
      <span class="nhwa-badge">1</span>
    </button>`;
  document.body.appendChild(box);

  const badge = box.querySelector('.nhwa-badge');
  const baseTitle = document.title;
  let flip = false, timer = null;
  const startTitle = () => {
    if (timer) return;
    timer = setInterval(() => { flip = !flip; document.title = flip ? '(1) Yeni mesaj' : baseTitle; }, 1500);
  };
  const stopTitle = () => { clearInterval(timer); timer = null; document.title = baseTitle; };
  const open = () => {
    box.classList.add('open');
    badge.style.display = 'none';
    stopTitle();
    try { sessionStorage.setItem(KEY, '1'); } catch {}
  };
  box.querySelector('.nhwa-btn').addEventListener('click', () => (box.classList.contains('open') ? box.classList.remove('open') : open()));
  box.querySelector('.nhwa-x').addEventListener('click', () => box.classList.remove('open'));

  if (seen) { badge.style.display = 'none'; return; }
  // Rozet ve sekme bildirimi ziyaretçi baloncuğu açana kadar sürer
  startTitle();
  setTimeout(() => { if (!seen) box.classList.add('open'); }, 6000);
})();
