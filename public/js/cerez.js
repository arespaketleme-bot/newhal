// Çerez tercihi: ziyaretçinin seçimini saklar, seçim yoksa kutuyu gösterir.
(function () {
  var KEY = 'newhal_cerez';
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  window.newhalCerezTercihi = get;
  if (get()) return;

  var btn = 'padding:8px 14px;border-radius:9px;border:1px solid #4b5563;background:transparent;color:#e5e7eb;font:inherit;cursor:pointer';
  var box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Çerez tercihi');
  box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:99999;max-width:520px;margin:0 auto;padding:14px 16px;border-radius:14px;background:#111827;border:1px solid rgba(52,211,153,.35);color:#e5e7eb;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45)';
  box.innerHTML = '<div>Sitenin çalışması için gerekli çerezleri kullanıyoruz. Ölçüm ve reklam çerezleri için tercihinizi seçin. <a href="/gizlilik#cerezler" style="color:#34d399">Ayrıntılar</a></div>' +
    '<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">' +
    '<button type="button" data-v="reddedildi" style="' + btn + '">Reddet</button>' +
    '<button type="button" data-v="kabul" style="' + btn + '">Kabul et</button></div>';
  box.addEventListener('click', function (e) {
    var v = e.target.getAttribute && e.target.getAttribute('data-v');
    if (!v) return;
    set(v);
    box.remove();
    if (v === 'kabul' && window.newhalOlcumBaslat) window.newhalOlcumBaslat();
  });
  document.body.appendChild(box);
})();
