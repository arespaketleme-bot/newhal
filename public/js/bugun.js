/* ═══════════════════════════════════════════════════════════════
   NewHal — "Bugün Halde" kutusu
   Yönetici duyurusu + yeni işletmeler + günün ilanları + mevsim ürünleri.
   allPins / allAds main.js'te yüklenir; veri gelince renderTodayBox() çağrılır.
   ═══════════════════════════════════════════════════════════════ */

// Mersin ve çevresinde aylara göre halde bol bulunan ürünler (yönetici panelden değiştirebilir)
const TODAY_SEASON = [
  ['portakal', 'mandalina', 'limon', 'greyfurt', 'ıspanak', 'pırasa', 'karnabahar', 'lahana'],   // Ocak
  ['portakal', 'limon', 'mandalina', 'ıspanak', 'pırasa', 'enginar', 'marul', 'havuç'],          // Şubat
  ['limon', 'portakal', 'enginar', 'bakla', 'marul', 'yeşil soğan', 'ıspanak', 'roka'],          // Mart
  ['çilek', 'enginar', 'bakla', 'bezelye', 'marul', 'taze sarımsak', 'yeni dünya', 'limon'],     // Nisan
  ['çilek', 'kayısı', 'kiraz', 'yeni dünya', 'bezelye', 'taze fasulye', 'kabak', 'salatalık'],   // Mayıs
  ['kayısı', 'kiraz', 'şeftali', 'karpuz', 'domates', 'salatalık', 'biber', 'kabak'],            // Haziran
  ['karpuz', 'kavun', 'şeftali', 'üzüm', 'domates', 'biber', 'patlıcan', 'mısır'],               // Temmuz
  ['üzüm', 'karpuz', 'kavun', 'incir', 'domates', 'patlıcan', 'biber', 'bamya'],                 // Ağustos
  ['üzüm', 'incir', 'nar', 'armut', 'elma', 'biber', 'domates', 'patlıcan'],                     // Eylül
  ['nar', 'elma', 'ayva', 'armut', 'mandalina', 'kabak', 'ıspanak', 'pırasa'],                   // Ekim
  ['mandalina', 'portakal', 'limon', 'nar', 'ayva', 'ıspanak', 'pırasa', 'karnabahar'],          // Kasım
  ['portakal', 'mandalina', 'limon', 'greyfurt', 'ıspanak', 'pırasa', 'lahana', 'brokoli'],      // Aralık
];
const TODAY_NEW_PIN_LIMIT = 5;
const TODAY_DAY_MS = 24 * 60 * 60 * 1000;

let todaySettings = null;

function todayRelative(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startOfToday) {
    const mins = Math.max(1, Math.round((now - t) / 60000));
    return mins < 60 ? `${mins} dk önce` : `${Math.round(mins / 60)} saat önce`;
  }
  if (t >= startOfToday - TODAY_DAY_MS) return 'dün';
  const days = Math.ceil((startOfToday - t) / TODAY_DAY_MS);
  if (days < 7) return `${days} gün önce`;
  return new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
}

function todayPinDate(p) { return p.reviewed_at || p.created_at || ''; }

function todayProducts() {
  const custom = String((todaySettings && todaySettings.products) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return custom.length ? custom.slice(0, 16) : TODAY_SEASON[new Date().getMonth()];
}

function todaySearchProduct(name) {
  try { focusMapSearch(); }
  catch { document.getElementById('mapSection')?.scrollIntoView({ behavior: 'smooth' }); }
  const input = document.getElementById('mapSearch');
  if (!input) return;
  input.value = name;
  if (typeof onSearchInput === 'function') onSearchInput(name);
  if (typeof trackSearch === 'function') trackSearch('map', name);
}

function todayOpenPin(id) {
  if (typeof focusPin === 'function') focusPin(id);
  else if (typeof showPinDetail === 'function') showPinDetail(id);
}

function renderTodayBox() {
  const box = document.getElementById('todayBox');
  if (!box) return;
  if (todaySettings && todaySettings.enabled === false) { box.hidden = true; return; }
  box.hidden = false;

  const now = new Date();
  document.getElementById('todayDate').textContent =
    now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

  // Yönetici duyurusu
  const noteBox = document.getElementById('todayNote');
  const note = todaySettings && todaySettings.note;
  noteBox.hidden = !note;
  if (note) {
    document.getElementById('todayNoteText').textContent = note;
    const when = todayRelative(todaySettings.noteUpdatedAt);
    document.getElementById('todayNoteTime').textContent = when ? `Güncellendi: ${when}` : '';
  }

  // Sayılar
  const pins = typeof allPins !== 'undefined' && Array.isArray(allPins) ? allPins : [];
  const ads = typeof allAds !== 'undefined' && Array.isArray(allAds) ? allAds.filter(a => !a.weather) : [];
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = Date.now() - 7 * TODAY_DAY_MS;
  const adsToday = ads.filter(a => Date.parse(a.created_at) >= startOfToday).length;
  const pinsWeek = pins.filter(p => Date.parse(todayPinDate(p)) >= weekAgo).length;

  const stats = document.getElementById('todayStats');
  stats.replaceChildren();
  const addStat = (num, label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'today-stat';
    b.onclick = onClick;
    const n = document.createElement('b');
    n.textContent = num;
    const l = document.createElement('span');
    l.textContent = label;
    b.append(n, l);
    stats.appendChild(b);
  };
  if (pins.length) addStat(pins.length, 'işletme rehberde', () => typeof showPinList === 'function' ? showPinList() : null);
  if (pinsWeek) addStat(`+${pinsWeek}`, 'bu hafta katıldı', () => document.getElementById('todayNewCol')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  if (ads.length) addStat(adsToday || ads.length, adsToday ? 'bugünkü ilan' : 'güncel ilan', () => document.getElementById('adsGrid')?.scrollIntoView({ behavior: 'smooth' }));
  stats.hidden = !stats.children.length;

  // Yeni katılan işletmeler
  const newest = pins
    .filter(p => todayPinDate(p))
    .sort((a, b) => String(todayPinDate(b)).localeCompare(String(todayPinDate(a))))
    .slice(0, TODAY_NEW_PIN_LIMIT);
  const list = document.getElementById('todayNewPins');
  list.replaceChildren();
  for (const p of newest) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'today-pin';
    b.onclick = () => todayOpenPin(p.id);
    const name = document.createElement('span');
    name.className = 'today-pin-name';
    name.textContent = p.title || 'İşletme';
    const meta = document.createElement('span');
    meta.className = 'today-pin-meta';
    meta.textContent = [p.category, todayRelative(todayPinDate(p))].filter(Boolean).join(' · ');
    b.append(name, meta);
    li.appendChild(b);
    list.appendChild(li);
  }
  document.getElementById('todayNewCol').hidden = !newest.length;

  // Mevsim ürünleri: o ürünü satan işletme sayısıyla birlikte
  const chips = document.getElementById('todayProducts');
  chips.replaceChildren();
  const lower = s => String(s || '').toLocaleLowerCase('tr-TR');
  for (const name of todayProducts()) {
    const key = lower(name);
    const sellers = pins.filter(p => (p.sells || []).some(s => lower(s).includes(key))).length;
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'today-chip';
    c.textContent = name;
    if (sellers) {
      const n = document.createElement('small');
      n.textContent = sellers;
      n.title = `${sellers} işletme satıyor`;
      c.appendChild(n);
    }
    c.onclick = () => todaySearchProduct(name);
    chips.appendChild(c);
  }
}
window.renderTodayBox = renderTodayBox;

async function loadTodaySettings() {
  try {
    const res = await fetch('/api/bugun-halde');
    if (res.ok) todaySettings = await res.json();
  } catch {}
  renderTodayBox();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadTodaySettings);
else loadTodaySettings();
// Gece yarısını geçen açık sekmelerde tarih ve "bugün" sayıları yenilenir
setInterval(renderTodayBox, 10 * 60 * 1000);
