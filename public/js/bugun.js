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
const TODAY_NEW_PIN_LIMIT = 3;
const TODAY_TOP_ADS_LIMIT = 3;
const TODAY_TAB_KEY = 'newhal-today-tab';
const TODAY_DAY_MS = 24 * 60 * 60 * 1000;

let todaySettings = null;
let todayStats = null;

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

// Mevsim ürünleri ve en çok aranan kelimeler sayfadaki ilanlarda aranır
function todaySearchAds(name) {
  try { if (typeof isMapFullscreen === 'function' && isMapFullscreen()) toggleMapFullscreen(false); } catch {}
  const input = document.getElementById('adsSearch');
  if (!input) return;
  input.value = name;
  // İlan aramasının kendi dinleyicisi listeyi süzer ve aramayı istatistiğe kaydeder
  input.dispatchEvent(new Event('input', { bubbles: true }));
  (document.querySelector('.ads-head') || input).scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const addStat = (num, label, onClick, live) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'today-stat';
    b.onclick = onClick;
    const n = document.createElement('b');
    if (live) {
      const dot = document.createElement('i');
      dot.className = 'today-live-dot';
      dot.setAttribute('aria-hidden', 'true');
      n.appendChild(dot);
    }
    n.append(typeof num === 'number' ? num.toLocaleString('tr-TR') : num);
    const l = document.createElement('span');
    l.textContent = label;
    b.append(n, l);
    stats.appendChild(b);
  };
  if (pins.length) addStat(pins.length, 'işletme', () => typeof showPinList === 'function' ? showPinList() : null);
  if (pinsWeek) addStat(`+${pinsWeek}`, 'yeni işletme', () => todayShowTab('todayNewCol'));
  if (ads.length) addStat(adsToday || ads.length, adsToday ? 'ilan bugün' : 'ilan', () => document.getElementById('adsGrid')?.scrollIntoView({ behavior: 'smooth' }));
  const presence = window.todayPresence || {};
  const toMap = () => document.getElementById('heroStats')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (typeof presence.online === 'number') addStat(presence.online, 'online', toMap, true);
  if (typeof presence.visits === 'number') addStat(presence.visits, 'ziyaretçi', toMap);
  if (todayStats && todayStats.totalViews) addStat(todayStats.totalViews, 'görüntülenme', () => todayShowTab('todayTopAdsCol'));
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

  // Mevsim ürünleri: o ürünün geçtiği ilan sayısıyla birlikte; dokununca ilanlarda aranır
  const chips = document.getElementById('todayProducts');
  chips.replaceChildren();
  for (const name of todayProducts()) {
    const matching = typeof adMatchesSearch === 'function' ? ads.filter(ad => adMatchesSearch(ad, name)).length : 0;
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'today-chip';
    c.textContent = name;
    if (matching) {
      const n = document.createElement('small');
      n.textContent = matching;
      n.title = `${matching} ilan`;
      c.appendChild(n);
    }
    c.onclick = () => todaySearchAds(name);
    chips.appendChild(c);
  }

  renderTodayTopAds(ads);
  renderTodaySearches();
  renderTodayTabs();
}

// Bölümler sekmeli: aynı anda tek bölüm görünür, seçim bu cihazda hatırlanır
// Kullanıcı seçim yapmadıysa ilk dolu bölüm açılır (veri geç gelse de)
let todayChosenTab = null;
try { todayChosenTab = localStorage.getItem(TODAY_TAB_KEY); } catch {}

function todayShowTab(id) {
  todayChosenTab = id;
  try { localStorage.setItem(TODAY_TAB_KEY, id); } catch {}
  renderTodayTabs();
  document.getElementById('todayTabs')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderTodayTabs() {
  const bar = document.getElementById('todayTabs');
  if (!bar) return;
  const cols = [...document.querySelectorAll('#todayBox .today-col')].filter(c => !c.hidden);
  const todayActiveTab = cols.some(c => c.id === todayChosenTab) ? todayChosenTab : (cols[0] ? cols[0].id : null);
  bar.replaceChildren();
  for (const col of cols) {
    const on = col.id === todayActiveTab;
    col.classList.toggle('is-active', on);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'today-tab' + (on ? ' is-active' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.setAttribute('aria-controls', col.id);
    b.textContent = col.dataset.tab || '';
    b.onclick = () => todayShowTab(col.id);
    bar.appendChild(b);
  }
  bar.hidden = cols.length < 2;
}

// En çok görüntülenen ilanlar: dokununca ilan büyük pencerede açılır
function renderTodayTopAds(ads) {
  const col = document.getElementById('todayTopAdsCol');
  const list = document.getElementById('todayTopAds');
  // Yayından kalkmış ilanlar listede gösterilmez (ilanlar yüklendiyse)
  const live = ads.length ? new Map(ads.map(a => [a.id, a])) : null;
  const top = ((todayStats && todayStats.topAds) || []).filter(a => !live || live.has(a.id)).slice(0, TODAY_TOP_ADS_LIMIT);
  list.replaceChildren();
  for (const item of top) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'today-pin';
    b.onclick = () => {
      const ad = live && live.get(item.id);
      if (ad && typeof openAdViewer === 'function') openAdViewer(ad, 0);
      else document.getElementById('adsGrid')?.scrollIntoView({ behavior: 'smooth' });
    };
    const name = document.createElement('span');
    name.className = 'today-pin-name';
    name.textContent = `${item.no ? `#${item.no} ` : ''}${item.title}`;
    const meta = document.createElement('span');
    meta.className = 'today-pin-meta';
    meta.textContent = `👁 ${Number(item.views).toLocaleString('tr-TR')}`;
    b.append(name, meta);
    li.appendChild(b);
    list.appendChild(li);
  }
  col.hidden = !top.length;
}

// En çok aranan kelimeler: dokununca ilanlarda aranır
function renderTodaySearches() {
  const col = document.getElementById('todaySearchCol');
  const box = document.getElementById('todaySearches');
  const terms = (todayStats && todayStats.searches) || [];
  box.replaceChildren();
  terms.forEach((t, i) => {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'today-chip';
    c.textContent = `${i + 1}. ${t.term}`;
    const n = document.createElement('small');
    n.textContent = Number(t.count).toLocaleString('tr-TR');
    n.title = `${t.count} kez arandı`;
    c.appendChild(n);
    c.onclick = () => todaySearchAds(t.term);
    box.appendChild(c);
  });
  col.hidden = !terms.length;
}
window.renderTodayBox = renderTodayBox;

async function loadTodaySettings() {
  try {
    const res = await fetch('/api/bugun-halde');
    if (res.ok) todaySettings = await res.json();
  } catch {}
  renderTodayBox();
  loadTodayStats();
}

async function loadTodayStats() {
  try {
    const res = await fetch('/api/bugun-halde/stats');
    if (res.ok) todayStats = await res.json();
  } catch {}
  renderTodayBox();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadTodaySettings);
else loadTodaySettings();
// Gece yarısını geçen açık sekmelerde tarih ve "bugün" sayıları yenilenir
setInterval(loadTodayStats, 10 * 60 * 1000);
