// Google Ads ölçümü: yalnız çerez kutusunda "Kabul et" diyen ziyaretçide yüklenir.
(function () {
  var HESAP = 'AW-18517009098';
  var HEDEFLER = {
    telefon: 'AW-18517009098/SsORCNWIwLQdEMrFzP1E',
    ilan: 'AW-18517009098/q7jVCNiIwLQdEMrFzP1E'
  };
  var basladi = false;

  function izinVar() {
    try { return localStorage.getItem('newhal_cerez') === 'kabul'; } catch (e) { return false; }
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  function baslat() {
    if (basladi || !izinVar()) return;
    basladi = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + HESAP;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', HESAP);
  }

  function olc(ad) {
    if (!HEDEFLER[ad]) return;
    baslat();
    if (!basladi) return;
    gtag('event', 'conversion', { send_to: HEDEFLER[ad], value: 1.0, currency: 'TRY' });
  }

  window.newhalOlcumBaslat = baslat;
  window.newhalOlcum = olc;

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (a) olc('telefon');
  }, true);

  baslat();
})();
