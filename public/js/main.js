/* ═══════════════════════════════════════════════════════════════
   NewHal — main.js
   ═══════════════════════════════════════════════════════════════ */

// ── AUTH YARDIMCISI ──────────────────────────────
function openAuthModal() {
  document.getElementById('authModal').classList.add('open');
}

function checkAuthAndRun(callback) {
  if (!localStorage.getItem('userToken')) {
    openAuthModal();
    return false;
  }
  if (callback) callback();
  return true;
}
function closeAuthModal() {
  document.getElementById('authModal').classList.remove('open');
}


function updateAuthUI(name) {
  const btn1 = document.getElementById('authBtn');
  const btn2 = document.getElementById('mobileAuthBtn');
  const setupBtn = (btn) => {
    if (!btn) return;
    btn.textContent = `👤 ${name}`;
    btn.onclick = (e) => {
      e.preventDefault();
      if(confirm('Çıkış yapmak istiyor musunuz?')) {
        localStorage.removeItem('userToken');
        localStorage.removeItem('userName');
        location.reload();
      }
    };
    btn.style.color = '#4ade80';
    btn.style.borderColor = '#4ade80';
  };
  setupBtn(btn1);
  setupBtn(btn2);
}

// ── State ──────────────────────────────────────────────────────
let map, allPins = [], tempMarker = null, pendingLat = null, pendingLng = null;
let activeFilter = 'all';

// Layer and option toggles
let currentLayer = null;
const layers = {};
let showContactInfo = true;
let showSpecialPlaces = true;
let isDraggingChat = false;

const CATEGORY_ICONS = {
  'Sebze & Meyve': '🥦',
  'Bakliyat': '🌾',
  'Kuru Gıda': '🏪',
  'Balık': '🐟',
  'Et & Tavuk': '🥩',
  'Genel': '📦',
};

// Mersin Hal Kompleksi merkezi koordinatları
const HAL_CENTER = [36.8278, 34.6560];
const HAL_ZOOM   = 16;

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Google Auth Handler
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('googleAuth') === 'success') {
    const name = urlParams.get('name') || 'Kullanıcı';
    const token = urlParams.get('token');
    
    if (token) {
      localStorage.setItem('userToken', token);
      localStorage.setItem('userName', name);
    }
    
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(() => showToast(`✅ Başarıyla giriş yapıldı. Hoş geldin, ${name}!`, 'success'), 500);
  } else if (urlParams.get('error') === 'google_auth_failed') {
    showToast('❌ Google ile giriş yapılamadı.', 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Restore UI for logged in user
  const savedName = localStorage.getItem('userName');
  if (savedName) {
    updateAuthUI(savedName);
  }

  initMap();
  initSearch();
  // Site haritayla, tam ekran açılır; "Küçült" ile sayfanın geri kalanına geçilir
  toggleMapFullscreen(true);
  await loadCategories();
  loadPins();
  initScrollEffect();

  // Online & ziyaretçi sayacı
  initPresence();
  initBottomNav();

  // Telefonda sohbet kapalı başlar, ekranı kaplamasın
  if (window.matchMedia('(max-width: 768px)').matches) {
    document.getElementById('chatWidget')?.classList.add('collapsed');
  }

  // Chat initialization & polling
  loadChatMessages();
  setInterval(loadChatMessages, 3000);
  initDraggableChat();
  initChatAutoCollapse();

  // Emoji picker init
  initUserEmojiPicker();
  const newCatIconEl = document.getElementById('newCategoryIcon');
  if (newCatIconEl) {
    newCatIconEl.addEventListener('click', (e) => {
      showUserEmojiPicker(e.target);
    });
  }

  // Açılış banner popup'ı sadece ilk ziyarette göster
  const welcomePopup = document.getElementById('welcomePopup');
  let welcomeSeen = false;
  try { welcomeSeen = localStorage.getItem('welcomeSeen') === '1'; } catch {}
  if (welcomePopup && !welcomeSeen) {
    setTimeout(() => {
      welcomePopup.classList.add('open');
    }, 300);
  }

});

// ── Harita ────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: HAL_CENTER,
    zoom: HAL_ZOOM,
    zoomControl: true,
  });

  // Define layers
  // Anahtar gerektirmeyen altlıklar (CARTO artık API anahtarı istiyor)
  layers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 19,
    maxZoom: 20,
  });

  layers.light = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    maxZoom: 20,
  });

  // Set default to light map
  currentLayer = layers.light;
  currentLayer.addTo(map);

  // Tıkla: konum seç (modal açıkken)
  map.on('click', (e) => {
    if (!document.getElementById('addPinModal').classList.contains('open')) {
      openAddPinModal();
      setTimeout(() => selectLocation(e.latlng.lat, e.latlng.lng), 100);
    } else {
      selectLocation(e.latlng.lat, e.latlng.lng);
    }
  });
}

// ── Harita tam ekran ──────────────────────────────────────────
function isMapFullscreen() {
  return document.getElementById('mapPanel').classList.contains('map-fullscreen');
}

function toggleMapFullscreen(force) {
  const panel = document.getElementById('mapPanel');
  const on = typeof force === 'boolean' ? force : !isMapFullscreen();
  panel.classList.toggle('map-fullscreen', on);
  document.body.classList.toggle('map-fs-open', on);
  const btn = document.getElementById('mapFsBtn');
  document.getElementById('mapFsLabel').textContent = on ? 'Küçült' : 'Tam Ekran';
  btn.setAttribute('aria-label', on ? 'Haritayı eski haline döndür' : 'Haritayı tam ekran yap');
  if (on) setChatOpen(false);
  // Leaflet yeni boyutu ölçsün, harita aynı yeri göstermeye devam etsin
  const center = map.getCenter();
  setTimeout(() => { map.invalidateSize(); map.setView(center, map.getZoom(), { animate: false }); }, 50);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isMapFullscreen()) toggleMapFullscreen(false);
});

function setMapLayer(type) {
  if (!layers[type]) return;
  if (currentLayer) map.removeLayer(currentLayer);

  currentLayer = layers[type];
  currentLayer.addTo(map);

  document.getElementById('layerBtnSatellite').classList.toggle('active', type === 'satellite');
  document.getElementById('layerBtnLight').classList.toggle('active', type === 'light');
}

function toggleOption(type) {
  if (type === 'contact') {
    showContactInfo = document.getElementById('toggleContactInfo').checked;
  } else if (type === 'special') {
    showSpecialPlaces = document.getElementById('toggleSpecialPlaces').checked;
  }
  renderPins(allPins);
}

// Telefonda form tam ekran: haritadan konum seçmek için formu geçici gizle
function startLocationPick() {
  document.getElementById('addPinModal').classList.add('picking');
  document.body.classList.add('location-picking');
  document.getElementById('mapSection').scrollIntoView({ behavior: 'smooth' });
}

function finishLocationPick() {
  if (isMapFullscreen()) toggleMapFullscreen(false);
  document.getElementById('addPinModal').classList.remove('picking');
  document.body.classList.remove('location-picking');
}

function selectLocation(lat, lng) {
  finishLocationPick();
  pendingLat = lat;
  pendingLng = lng;
  document.getElementById('pinLat').value = lat;
  document.getElementById('pinLng').value = lng;

  const display = document.getElementById('locationDisplay');
  display.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  display.classList.add('selected');

  if (tempMarker) {
    tempMarker.setLatLng([lat, lng]);
  } else {
    tempMarker = L.marker([lat, lng], { 
      icon: createIcon('🔴', true),
      draggable: true
    }).addTo(map);

    tempMarker.on('dragend', function (e) {
      const position = tempMarker.getLatLng();
      selectLocation(position.lat, position.lng);
    });
  }
}

function createIcon(emoji, isTemp = false) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${isTemp ? 38 : 42}px; height:${isTemp ? 38 : 42}px;
      background:${isTemp ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)'};
      border:2px solid ${isTemp ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)'};
      border-radius:50%; display:flex; align-items:center; justify-content:center;
      font-size:20px; box-shadow:0 4px 16px rgba(0,0,0,0.4);
      backdrop-filter:blur(4px); cursor:pointer;
      transition:all 0.2s ease;
    ">${escHtml(emoji)}</div>`,
    iconSize: [isTemp ? 38 : 42, isTemp ? 38 : 42],
    iconAnchor: [isTemp ? 19 : 21, isTemp ? 19 : 21],
    popupAnchor: [0, -24],
  });
}

// ── Pin Yükle ─────────────────────────────────────────────────
async function loadPins() {
  try {
    const res = await fetch('/api/pins');
    allPins = await res.json();
    renderPins(allPins);
    updateStats();
    await updateHeroStats();
  } catch (err) {
    console.error('Pinler yüklenemedi:', err);
  }
}

// Yakın iğneleri sayılı yuvarlaklarda gruplar; yaklaştıkça tek tek açılır
let pinCluster = null;
function getPinCluster() {
  if (pinCluster || typeof L.markerClusterGroup !== 'function') return pinCluster;
  pinCluster = L.markerClusterGroup({
    maxClusterRadius: 45,
    disableClusteringAtZoom: 19,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: (cluster) => {
      const n = cluster.getChildCount();
      const size = n < 10 ? 38 : n < 50 ? 46 : 54;
      return L.divIcon({
        html: `<div class="pin-cluster" style="width:${size}px;height:${size}px">${n}</div>`,
        className: 'pin-cluster-wrap',
        iconSize: [size, size],
      });
    },
  });
  map.addLayer(pinCluster);
  return pinCluster;
}

function renderPins(pins) {
  const cluster = getPinCluster();
  if (cluster) cluster.clearLayers();
  // Haritadaki eski markerları temizle (temp hariç)
  map.eachLayer(layer => {
    if (layer instanceof L.Marker && layer !== tempMarker && !(cluster && cluster.hasLayer(layer))) map.removeLayer(layer);
  });

  // Kartları temizle
  const grid = document.getElementById('pinsGrid');
  const empty = document.getElementById('emptyState');

  // Filter by category
  let filtered = activeFilter === 'all' ? pins : pins.filter(p => p.category === activeFilter);

  // Filter by Special Places (our seeded public places are id <= 6)
  if (!showSpecialPlaces) {
    filtered = filtered.filter(p => p.id > 6);
  }

  // Arama kutusundaki kelimeler
  if (searchQuery) filtered = searchPins(filtered, searchQuery);

  // Haritaya ekle
  pinMarkers = {};
  filtered.forEach(pin => {
    const emoji = CATEGORY_ICONS[pin.category] || '📦';
    const marker = L.marker([pin.lat, pin.lng], { icon: createIcon(emoji), title: pin.title });
    pinMarkers[pin.id] = marker;
    if (cluster) cluster.addLayer(marker); else marker.addTo(map);
    
    // Popup shows contact info optionally
    marker.bindPopup(`
      <div style="font-family:'Inter',sans-serif; min-width:200px;">
        <div style="font-size:18px;margin-bottom:6px;">${escHtml(emoji)} <strong style="color:#f0fdf4;font-size:14px;">${escHtml(pin.title)}</strong></div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">📍 ${escHtml(pin.address)}</div>
        ${showContactInfo && pin.phone ? `<div style="font-size:12px;color:#86efac;">📞 <a href="tel:${escHtml(pin.phone)}" style="color:#4ade80;">${escHtml(pin.phone)}</a></div>` : ''}
        ${(pin.images || []).length ? `<img class="popup-photo" src="${escHtml(pin.images[0])}" alt="" loading="lazy" />` : ''}
        ${popupProducts('🛒 Satıyor', pin.sells)}
        ${popupProducts('🔎 Arıyor', pin.seeks)}
        <div style="margin-top:8px;">
          <button onclick="showPinDetail(${pin.id})" style="
            background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;
            padding:5px 12px;border-radius:20px;font-size:12px;cursor:pointer;font-weight:600;
          ">Detay →</button>
        </div>
      </div>
    `);
  });

  // Kart listesi
  const existing = grid.querySelectorAll('.pin-card');
  existing.forEach(c => c.remove());

  if (filtered.length === 0) {
    empty.style.display = 'flex';
  } else {
    empty.style.display = 'none';
    filtered.forEach(pin => {
      const emoji = CATEGORY_ICONS[pin.category] || '📦';
      const card = document.createElement('div');
      card.className = 'pin-card';
      card.setAttribute('data-id', pin.id);
      card.onclick = () => showPinDetail(pin.id);
      card.innerHTML = `
        <div class="pin-card-header">
          <div class="pin-card-icon">${escHtml(emoji)}</div>
          <div class="pin-card-cat">${escHtml(pin.category)}</div>
        </div>
        ${(pin.images || []).length ? `<img class="pin-card-photo" src="${escHtml(pin.images[0])}" alt="" loading="lazy" />` : ''}
        <div class="pin-card-title">${escHtml(pin.title)}</div>
        <div class="pin-card-addr">📍 ${escHtml(pin.address)}</div>
        ${(pin.sells || []).length ? `<div class="pin-card-products">🛒 ${escHtml(pin.sells.slice(0, 4).join(', '))}${pin.sells.length > 4 ? ` +${pin.sells.length - 4}` : ''}</div>` : ''}
        ${(pin.seeks || []).length ? `<div class="pin-card-products seeks">🔎 ${escHtml(pin.seeks.slice(0, 4).join(', '))}${pin.seeks.length > 4 ? ` +${pin.seeks.length - 4}` : ''}</div>` : ''}
        ${showContactInfo && (pin.phone || pin.website) ? `
          <div class="pin-card-footer">
            ${pin.phone ? `<div class="pin-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.06 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/></svg><a href="tel:${escHtml(pin.phone)}" onclick="event.stopPropagation()">${escHtml(pin.phone)}</a></div>` : ''}
            ${pin.website ? `<div class="pin-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span style="user-select: text;">${escHtml(pin.website)}</span></div>` : ''}
          </div>
        ` : ''}
      `;
      grid.appendChild(card);
    });
  }
}

// ── İşletme Arama ─────────────────────────────────────────────
let searchQuery = '';
let pinMarkers = {};
const MAX_SEARCH_RESULTS = 8;

// Türkçe harf ve büyük/küçük harf farkını yok sayar: "ÇİÇEK" = "cicek"
function normalizeSearch(text) {
  return String(text || '').toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Önce ad, ürün ve kategoride aranır; adres (hepsinde "Akdeniz/Mersin" geçer) sadece yedektir
function pinMainText(pin) {
  return normalizeSearch([pin.title, pin.category, pin.phone, ...(pin.sells || []), ...(pin.seeks || [])].join(' '));
}

function matchesAll(text, query) {
  return normalizeSearch(query).split(' ').every(word => text.includes(word));
}

// Aramaya uyan işletmeler: ad/ürün eşleşmesi varsa sadece onlar, yoksa adres eşleşmeleri
function searchPins(list, query) {
  const main = list.filter(p => matchesAll(pinMainText(p), query));
  if (main.length) return main;
  return list.filter(p => matchesAll(pinMainText(p) + ' ' + normalizeSearch(p.address), query));
}

// Sonuç satırında neden eşleştiğini göster: ürün eşleştiyse ürünü yaz
function searchMatchHint(pin, query) {
  const words = normalizeSearch(query).split(' ');
  const product = (list, label) => {
    const hit = (list || []).find(item => words.some(w => normalizeSearch(item).includes(w)));
    return hit ? `${label} ${hit}` : '';
  };
  return product(pin.sells, '🛒') || product(pin.seeks, '🔎') || pin.category;
}

function onSearchInput(value) {
  searchQuery = value.trim();
  document.getElementById('mapSearchClear').hidden = !searchQuery;
  renderPins(allPins);
  renderSearchResults();
}

function renderSearchResults() {
  const box = document.getElementById('mapSearchResults');
  box.innerHTML = '';
  if (!searchQuery) { box.hidden = true; return; }

  const matches = searchPins(activeFilter === 'all' ? allPins : allPins.filter(p => p.category === activeFilter), searchQuery);
  // Adı aramayla başlayanlar önce
  const q = normalizeSearch(searchQuery);
  const starts = p => normalizeSearch(p.title).startsWith(q) ? 1 : 0;
  matches.sort((a, b) => starts(b) - starts(a));

  const head = document.createElement('div');
  head.className = 'map-search-count';
  head.textContent = matches.length ? `${matches.length} işletme bulundu` : 'Sonuç bulunamadı';
  box.appendChild(head);

  matches.slice(0, MAX_SEARCH_RESULTS).forEach(pin => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'map-search-item';
    const icon = document.createElement('span');
    icon.className = 'map-search-icon';
    icon.textContent = CATEGORY_ICONS[pin.category] || '📦';
    const text = document.createElement('span');
    text.className = 'map-search-text';
    const title = document.createElement('strong');
    title.textContent = pin.title;
    const sub = document.createElement('small');
    sub.textContent = searchMatchHint(pin, searchQuery);
    text.append(title, sub);
    row.append(icon, text);
    row.onclick = () => focusPin(pin.id);
    box.appendChild(row);
  });
  box.hidden = false;
}

// Haritada işletmeye git ve penceresini aç
function focusPin(id) {
  const marker = pinMarkers[id];
  document.getElementById('mapSearchResults').hidden = true;
  document.getElementById('mapSearch').blur();
  if (!marker) return showPinDetail(id);
  if (!isMapFullscreen()) document.getElementById('mapSection').scrollIntoView({ behavior: 'smooth' });
  const open = () => marker.openPopup();
  if (pinCluster && pinCluster.hasLayer(marker)) pinCluster.zoomToShowLayer(marker, open);
  else { map.setView(marker.getLatLng(), 18); open(); }
}

function clearSearch() {
  const input = document.getElementById('mapSearch');
  input.value = '';
  onSearchInput('');
  input.focus();
}

function initSearch() {
  const wrap = document.querySelector('.map-search');
  const input = document.getElementById('mapSearch');
  const box = document.getElementById('mapSearchResults');
  input.addEventListener('input', () => onSearchInput(input.value));
  input.addEventListener('focus', () => { if (searchQuery) renderSearchResults(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = box.querySelector('.map-search-item');
      if (first) first.click();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (input.value) clearSearch(); else input.blur();
    }
  });
  // Arama alanı dışına dokununca sonuç listesini kapat
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.map-search')) box.hidden = true;
  });
  // Arama kutusuna dokunmak haritaya tıklamak (işletme ekleme) sayılmasın
  L.DomEvent.disableClickPropagation(wrap);
  L.DomEvent.disableScrollPropagation(wrap);
}

function filterPins(cat, btn) {
  activeFilter = cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPins(allPins);
  if (searchQuery) renderSearchResults();

  logActivity(`Kategoriyi '${cat === 'all' ? 'Tümü' : cat}' olarak filtrelediniz`, true);
}

async function updateHeroStats() {
  // Sadece onaylı pinlerden hesapla (admin istatistikleri herkese açık değil)
  document.getElementById('statApproved').textContent = allPins.length;
}

async function updateStats() {
  document.getElementById('statApproved').textContent = allPins.length;
}

// ── Online & Ziyaretçi Sayacı ─────────────────────────────────
function getPresenceId() {
  try {
    let id = sessionStorage.getItem('presenceId');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
      sessionStorage.setItem('presenceId', id);
    }
    return id;
  } catch {
    return window.__presenceId || (window.__presenceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  }
}

function renderPresence({ online, visits }) {
  if (typeof online === 'number') document.getElementById('statOnline').textContent = online.toLocaleString('tr-TR');
  if (typeof visits === 'number') document.getElementById('statVisits').textContent = visits.toLocaleString('tr-TR');
}

async function sendPresence() {
  try {
    const res = await fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: getPresenceId() })
    });
    if (res.ok) renderPresence(await res.json());
  } catch {}
}

async function initPresence() {
  // Ziyaret, tarayıcı oturumu başına bir kez sayılır
  let counted = false;
  try { counted = sessionStorage.getItem('visitCounted') === '1'; } catch {}
  if (!counted) {
    try {
      const res = await fetch('/api/visit', { method: 'POST' });
      if (res.ok) {
        renderPresence(await res.json());
        try { sessionStorage.setItem('visitCounted', '1'); } catch {}
      }
    } catch {}
  }
  sendPresence();
  setInterval(sendPresence, 30000);
}

// ── Pin Detay ─────────────────────────────────────────────────
let currentDetailPinId = null;

function showPinDetail(id) {
  const pin = allPins.find(p => p.id === id);
  if (!pin) return;
  currentDetailPinId = id;

  // Reset report form
  const rForm = document.getElementById('reportFormContainer');
  if (rForm) rForm.style.display = 'none';
  const rText = document.getElementById('reportText');
  if (rText) rText.value = '';

  const emoji = CATEGORY_ICONS[pin.category] || '📦';

  document.getElementById('detailIcon').textContent = emoji;
  document.getElementById('detailTitle').textContent = pin.title;
  document.getElementById('detailCategory').textContent = pin.category;

  setDetailItem('detailAddressRow', 'detailAddress', pin.address);

  const phoneEl = document.getElementById('detailPhone');
  if (showContactInfo && pin.phone) {
    phoneEl.textContent = pin.phone;
    phoneEl.href = `tel:${pin.phone}`;
    document.getElementById('detailPhoneRow').style.display = 'flex';
  } else {
    document.getElementById('detailPhoneRow').style.display = 'none';
  }

  const emailEl = document.getElementById('detailEmail');
  if (showContactInfo && pin.email) {
    emailEl.textContent = pin.email;
    document.getElementById('detailEmailRow').style.display = 'flex';
  } else {
    document.getElementById('detailEmailRow').style.display = 'none';
  }

  const webEl = document.getElementById('detailWebsite');
  if (showContactInfo && pin.website) {
    webEl.textContent = pin.website;
    document.getElementById('detailWebsiteRow').style.display = 'flex';
  } else {
    document.getElementById('detailWebsiteRow').style.display = 'none';
  }

  renderPinCatalog(pin);

  // Render comments for this pin
  renderPinComments(pin.comments || []);

  document.getElementById('pinDetailModal').classList.add('open');

  // Log activity
  logActivity(`'${pin.title}' detaylarını inceliyorsunuz`, true);
}

// ── Ürünler & Fotoğraflar ─────────────────────────────────────
const MAX_PIN_PHOTOS = 5;

function splitProducts(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

function popupProducts(label, list) {
  if (!list || !list.length) return '';
  const shown = list.slice(0, 6).map(p => `<span class="popup-chip">${escHtml(p)}</span>`).join('');
  const more = list.length > 6 ? `<span class="popup-chip">+${list.length - 6}</span>` : '';
  return `<div class="popup-products"><span class="popup-products-label">${label}:</span>${shown}${more}</div>`;
}

function fillChips(rowId, listId, items) {
  const row = document.getElementById(rowId);
  const list = document.getElementById(listId);
  list.innerHTML = '';
  (items || []).forEach(item => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = item;
    list.appendChild(chip);
  });
  row.style.display = (items && items.length) ? 'flex' : 'none';
}

// Oturum anahtarının içini okur (süresi dolmuşsa null)
function readToken(key) {
  try {
    const token = localStorage.getItem(key);
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return { token, payload };
  } catch {
    return null;
  }
}

// Bu işletmeyi düzenleyebilecek oturum: ekleyen kullanıcı ya da admin paneline girmiş yönetici
function getCatalogToken(pin) {
  const user = readToken('userToken');
  if (user && pin.owner_id && pin.owner_id === user.payload.id) return user.token;
  const admin = readToken('newhal_admin_token');
  if (admin && admin.payload.role === 'admin') return admin.token;
  return null;
}

function canEditCatalog(pin) {
  return !!getCatalogToken(pin);
}

function renderPinCatalog(pin) {
  const gallery = document.getElementById('detailGallery');
  gallery.innerHTML = '';
  (pin.images || []).forEach(url => {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    const img = document.createElement('img');
    img.src = url;
    img.alt = pin.title;
    img.loading = 'lazy';
    a.appendChild(img);
    gallery.appendChild(a);
  });
  gallery.style.display = (pin.images && pin.images.length) ? 'flex' : 'none';

  fillChips('detailSellsRow', 'detailSells', pin.sells);
  fillChips('detailSeeksRow', 'detailSeeks', pin.seeks);

  document.getElementById('catalogEditor').style.display = 'none';
  document.getElementById('catalogEditBtn').style.display = canEditCatalog(pin) ? 'inline-flex' : 'none';
}

function toggleCatalogEditor() {
  const editor = document.getElementById('catalogEditor');
  const pin = allPins.find(p => p.id === currentDetailPinId);
  if (!pin) return;
  if (editor.style.display === 'none') {
    document.getElementById('catalogSells').value = (pin.sells || []).join(', ');
    document.getElementById('catalogSeeks').value = (pin.seeks || []).join(', ');
    catalogPhotos.setUrls(pin.images || []);
    editor.style.display = 'flex';
  } else {
    editor.style.display = 'none';
  }
}

async function saveCatalog() {
  const pin = allPins.find(p => p.id === currentDetailPinId);
  if (!pin) return;
  if (catalogPhotos.isBusy()) return showToast('Fotoğraflar yükleniyor, lütfen bekleyin', 'error');

  const btn = document.getElementById('catalogSaveBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/pins/${pin.id}/catalog`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getCatalogToken(pin) },
      body: JSON.stringify({
        sells: splitProducts(document.getElementById('catalogSells').value),
        seeks: splitProducts(document.getElementById('catalogSeeks').value),
        images: catalogPhotos.getUrls(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');
    Object.assign(pin, { sells: data.pin.sells, seeks: data.pin.seeks, images: data.pin.images });
    renderPinCatalog(pin);
    renderPins(allPins);
    showToast('✅ Ürünler ve fotoğraflar güncellendi', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Fotoğrafı tarayıcıda küçültüp (en fazla 1280 px) JPEG'e çevirir
function resizeImage(file, maxSize = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Dosya okunamadı'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Bu dosya bir fotoğraf değil'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhoto(file) {
  const data = await resizeImage(file);
  const auth = (readToken('userToken') || readToken('newhal_admin_token') || {}).token;
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Fotoğraf yüklenemedi');
  return json.url;
}

// Küçük resimler + "fotoğraf ekle" kutusu; seçilen fotoğraf hemen yüklenir
function createPhotoEditor(containerId) {
  let urls = [];
  let busy = 0;
  const container = document.getElementById(containerId);

  function render() {
    container.innerHTML = '';
    urls.forEach((url, i) => {
      const item = document.createElement('div');
      item.className = 'photo-thumb';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'photo-remove';
      del.title = 'Fotoğrafı kaldır';
      del.textContent = '✕';
      del.onclick = () => { urls.splice(i, 1); render(); };
      item.append(img, del);
      container.appendChild(item);
    });
    for (let i = 0; i < busy; i++) {
      const loading = document.createElement('div');
      loading.className = 'photo-thumb loading';
      loading.textContent = '⟳';
      container.appendChild(loading);
    }
    if (urls.length + busy < MAX_PIN_PHOTOS) {
      const add = document.createElement('label');
      add.className = 'photo-add';
      add.innerHTML = '<span>＋</span><small>Fotoğraf</small>';
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.multiple = true;
      input.hidden = true;
      input.onchange = () => addFiles([...input.files]);
      add.appendChild(input);
      container.appendChild(add);
    }
  }

  async function addFiles(files) {
    const room = MAX_PIN_PHOTOS - urls.length - busy;
    if (files.length > room) showToast(`En fazla ${MAX_PIN_PHOTOS} fotoğraf ekleyebilirsiniz`, 'error');
    const batch = files.slice(0, Math.max(0, room));
    busy += batch.length;
    render();
    await Promise.all(batch.map(async file => {
      try {
        urls.push(await uploadPhoto(file));
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        busy--;
        render();
      }
    }));
  }

  render();
  return {
    getUrls: () => urls.slice(),
    setUrls: (list) => { urls = list.slice(0, MAX_PIN_PHOTOS); render(); },
    isBusy: () => busy > 0,
  };
}

const addPinPhotos  = createPhotoEditor('pinPhotoEditor');
const catalogPhotos = createPhotoEditor('catalogPhotoEditor');

function setDetailItem(rowId, elId, val) {
  const el = document.getElementById(elId);
  const row = document.getElementById(rowId);
  if (val) { el.textContent = val; row.style.display = 'flex'; }
  else { row.style.display = 'none'; }
}

function closePinDetail() {
  document.getElementById('pinDetailModal').classList.remove('open');
}

// ── Pin Ekle Modal ────────────────────────────────────────────
function openAddPinModal() {
  if (!checkAuthAndRun()) return;
  document.getElementById('addPinModal').classList.add('open');
  document.getElementById('addPinForm').reset();
  document.getElementById('locationDisplay').innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    Haritaya tıklayarak konum seçin`;
  document.getElementById('locationDisplay').classList.remove('selected');
  pendingLat = null; pendingLng = null;
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  addPinPhotos.setUrls([]);
}

function closeAddPinModal() {
  finishLocationPick();
  document.getElementById('addPinModal').classList.remove('open');
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  pendingLat = null; pendingLng = null;
}

  function closeModalOnBg(e) {
    if (e.target === e.currentTarget) {
      closeAddPinModal();
      closePinDetail();
      if (typeof closeAuthModal === 'function') closeAuthModal();
    }
  }

// ── Submit Pin ────────────────────────────────────────────────
async function submitPin(e) {
  e.preventDefault();
  if (!pendingLat || !pendingLng) {
    showToast('Lütfen haritadan konum seçin', 'error');
    return;
  }

  const btn = document.getElementById('submitPinBtn');
  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-loader').style.display = 'inline';
  btn.disabled = true;

  const payload = {
    title:    document.getElementById('pinTitle').value.trim(),
    address:  document.getElementById('pinAddress').value.trim(),
    phone:    document.getElementById('pinPhone').value.trim(),
    website:  document.getElementById('pinWebsite').value.trim(),
    email:    document.getElementById('pinEmail').value.trim(),
    category: document.getElementById('pinCategory').value,
    sells:    splitProducts(document.getElementById('pinSells').value),
    seeks:    splitProducts(document.getElementById('pinSeeks').value),
    images:   addPinPhotos.getUrls(),
    lat: pendingLat,
    lng: pendingLng,
  };

  if (addPinPhotos.isBusy()) {
    showToast('Fotoğraflar yükleniyor, lütfen bekleyin', 'error');
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loader').style.display = 'none';
    btn.disabled = false;
    return;
  }

  try {
    const res = await fetch('/api/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata oluştu');
    closeAddPinModal();
    showToast('✅ İşletme gönderildi! Yönetici onayından sonra yayınlanacak.', 'success');
    logActivity(`'${payload.title}' için iğne ekleme talebi gönderdiniz`, true);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loader').style.display = 'none';
    btn.disabled = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function scrollToMap() {
  document.getElementById('mapSection').scrollIntoView({ behavior: 'smooth' });
}

function showPinList() {
  document.getElementById('listSection').scrollIntoView({ behavior: 'smooth' });
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('open');
}

function initScrollEffect() {
  window.addEventListener('scroll', () => {
    const header = document.getElementById('header');
    header.classList.toggle('scrolled', window.scrollY > 10);
  });
}

function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : '❌';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Canlı Sohbet İşlemleri ────────────────────────────────────
function toggleChatWidget(e) {
  if (isDraggingChat) {
    isDraggingChat = false;
    return;
  }
  const widget = document.getElementById('chatWidget');
  widget.classList.toggle('collapsed');
  
  if (!widget.classList.contains('collapsed')) {
    const msgsEl = document.getElementById('chatMessages');
    setTimeout(() => { msgsEl.scrollTop = msgsEl.scrollHeight; }, 100);
  }
  updateBottomNav();
  scheduleChatCollapse();
}

// ── Sohbet: 30 sn kullanılmazsa kendiliğinden küçülür ─────────
const CHAT_AUTO_COLLAPSE_MS = 30000;
let chatCollapseTimer = null;

function scheduleChatCollapse() {
  clearTimeout(chatCollapseTimer);
  if (!isChatOpen()) return;
  chatCollapseTimer = setTimeout(() => {
    // Yazı yazılıyorsa küçültme, süreyi baştan başlat
    const input = document.getElementById('chatMsg');
    if (input && (document.activeElement === input || input.value.trim())) return scheduleChatCollapse();
    setChatOpen(false);
  }, CHAT_AUTO_COLLAPSE_MS);
}

function initChatAutoCollapse() {
  const widget = document.getElementById('chatWidget');
  // Sohbetin içindeki her hareket süreyi baştan başlatır
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin', 'input'].forEach(evt => {
    widget.addEventListener(evt, () => { if (isChatOpen()) scheduleChatCollapse(); }, { passive: true });
  });
  scheduleChatCollapse();
}

// ── Telefon Alt Menüsü ────────────────────────────────────────
const BOTTOM_NAV_SECTIONS = { home: 'hero', map: 'mapSection', list: 'listSection' };
let bottomNavSection = 'home';

function isChatOpen() {
  return !document.getElementById('chatWidget').classList.contains('collapsed');
}

function setChatOpen(open) {
  const widget = document.getElementById('chatWidget');
  if (open === isChatOpen()) return;
  widget.classList.toggle('collapsed', !open);
  if (open) {
    const msgsEl = document.getElementById('chatMessages');
    setTimeout(() => { msgsEl.scrollTop = msgsEl.scrollHeight; }, 100);
  }
  updateBottomNav();
  scheduleChatCollapse();
}

function bottomNavGo(tab) {
  if (tab === 'chat') {
    setChatOpen(!isChatOpen());
    return;
  }
  setChatOpen(false);
  if (tab === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
  else document.getElementById(BOTTOM_NAV_SECTIONS[tab]).scrollIntoView({ behavior: 'smooth' });
  bottomNavSection = tab;
  updateBottomNav();
}

function updateBottomNav() {
  const active = isChatOpen() && window.matchMedia('(max-width: 768px)').matches ? 'chat' : bottomNavSection;
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === active);
  });
}

// Kaydırdıkça hangi bölümde olunduğunu alt menüde işaretle
function initBottomNav() {
  if (!('IntersectionObserver' in window)) return updateBottomNav();
  const visible = {};
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { visible[e.target.id] = e.intersectionRatio; });
    let best = bottomNavSection, bestRatio = 0;
    for (const [tab, id] of Object.entries(BOTTOM_NAV_SECTIONS)) {
      if ((visible[id] || 0) > bestRatio) { best = tab; bestRatio = visible[id]; }
    }
    bottomNavSection = best;
    updateBottomNav();
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  Object.values(BOTTOM_NAV_SECTIONS).forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

async function loadChatMessages() {
  try {
    const res = await fetch('/api/chat');
    if (!res.ok) return;
    const messages = await res.json();
    renderChatMessages(messages);
  } catch (err) {
    console.error('Chat yüklenemedi:', err);
  }
}

function renderChatMessages(messages) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  
  const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 30;

  container.innerHTML = '';
  
  if (messages.length === 0) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:12px;text-align:center;padding:20px;font-style:italic">Sohbet boş. İlk mesajı siz yazın!</div>';
    return;
  }

  messages.forEach(msg => {
    const row = document.createElement('div');
    row.className = 'chat-msg-row';
    
    let timeStr = '';
    try {
      const d = new Date(msg.created_at);
      timeStr = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      timeStr = '';
    }

    row.innerHTML = `
      <div class="chat-msg-meta">
        <span class="chat-msg-nick">${escHtml(msg.nickname)}</span>
        <span style="margin-left:auto;color:rgba(255,255,255,0.2)">${timeStr}</span>
      </div>
      <div class="chat-msg-text">${escHtml(msg.message)}</div>
    `;
    container.appendChild(row);
  });

  if (isScrolledToBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

async function sendChatMessage() {
  if (!checkAuthAndRun()) return;
  const msgInput = document.getElementById('chatMsg');
  if (!msgInput) return;

  const message = msgInput.value.trim();

  if (!message) return;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error('Mesaj gönderilemedi');
    
    msgInput.value = '';
    await loadChatMessages();
    logActivity(`Canlı sohbete mesaj gönderdiniz`, true);
    
    // Alıcıyı en aşağı kaydır
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Sohbet panelinin serbestçe sürüklenebilmesini sağlayan sistem (Desktop & Mobil Uyumlu)
function initDraggableChat() {
  const widget = document.getElementById('chatWidget');
  const header = widget.querySelector('.chat-header');

  // Telefonda sohbet alt menüye bağlı bir sayfa gibi açılır, sürüklenmez
  if (window.matchMedia('(max-width: 768px)').matches) return;

  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  header.onmousedown = dragMouseDown;
  header.ontouchstart = dragTouchStart;
  
  function dragMouseDown(e) {
    e = e || window.event;
    // Tıklanan şey kapatma simgesi ise sürüklemeyi tetikleme
    if (e.target.classList.contains('chat-toggle-icon')) return;
    
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }
  
  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    
    if (Math.abs(pos1) > 2 || Math.abs(pos2) > 2) {
      isDraggingChat = true;
    }
    
    let newTop = widget.offsetTop - pos2;
    let newLeft = widget.offsetLeft - pos1;
    
    // Ekran dışına taşmasını engelleme (Viewport boundaries)
    const maxLeft = window.innerWidth - widget.clientWidth;
    const maxTop = window.innerHeight - widget.clientHeight;
    
    if (newLeft < 0) newLeft = 0;
    if (newLeft > maxLeft) newLeft = maxLeft;
    if (newTop < 0) newTop = 0;
    if (newTop > maxTop) newTop = maxTop;
    
    widget.style.top = newTop + "px";
    widget.style.left = newLeft + "px";
    widget.style.bottom = "auto";
    widget.style.right = "auto";
  }
  
  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }

  // Mobil dokunmatik sürükleme
  function dragTouchStart(e) {
    if (e.target.classList.contains('chat-toggle-icon')) return;
    
    const touch = e.touches[0];
    pos3 = touch.clientX;
    pos4 = touch.clientY;
    document.ontouchend = closeTouchDragElement;
    document.ontouchmove = touchElementDrag;
  }

  function touchElementDrag(e) {
    const touch = e.touches[0];
    pos1 = pos3 - touch.clientX;
    pos2 = pos4 - touch.clientY;
    pos3 = touch.clientX;
    pos4 = touch.clientY;
    
    if (Math.abs(pos1) > 2 || Math.abs(pos2) > 2) {
      isDraggingChat = true;
    }
    
    let newTop = widget.offsetTop - pos2;
    let newLeft = widget.offsetLeft - pos1;
    
    const maxLeft = window.innerWidth - widget.clientWidth;
    const maxTop = window.innerHeight - widget.clientHeight;
    
    if (newLeft < 0) newLeft = 0;
    if (newLeft > maxLeft) newLeft = maxLeft;
    if (newTop < 0) newTop = 0;
    if (newTop > maxTop) newTop = maxTop;
    
    widget.style.top = newTop + "px";
    widget.style.left = newLeft + "px";
    widget.style.bottom = "auto";
    widget.style.right = "auto";
  }

  function closeTouchDragElement() {
    document.ontouchend = null;
    document.ontouchmove = null;
  }
}

// ── Dinamik Kategori & Kullanıcı Tarafından Kategori Ekleme ─────
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error('Kategoriler yüklenemedi');
    const categories = await res.json();
    
    // CATEGORY_ICONS güncelle
    categories.forEach(cat => {
      CATEGORY_ICONS[cat.name] = cat.icon || '📦';
    });

    // Filtre butonlarını güncelle
    renderFilters(categories);

    // Form dropdown'ını güncelle
    renderCategorySelect(categories);
  } catch (err) {
    console.error('Kategoriler yüklenirken hata:', err);
  }
}

function renderFilters(categories) {
  const filterContainer = document.querySelector('.map-filters');
  if (!filterContainer) return;
  
  const prevActive = activeFilter;
  filterContainer.innerHTML = `<button class="filter-btn ${prevActive === 'all' ? 'active' : ''}" data-cat="all" onclick="filterPins('all', this)">Tümü</button>`;
  
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `filter-btn ${prevActive === cat.name ? 'active' : ''}`;
    btn.setAttribute('data-cat', cat.name);
    btn.textContent = `${cat.icon || '📦'} ${cat.name}`;
    btn.onclick = () => filterPins(cat.name, btn);
    filterContainer.appendChild(btn);
  });
}

function renderCategorySelect(categories) {
  const select = document.getElementById('pinCategory');
  if (!select) return;
  select.innerHTML = '';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = `${cat.icon || '📦'} ${cat.name}`;
    select.appendChild(opt);
  });
}

function toggleNewCategorySection() {
  const section = document.getElementById('newCategorySection');
  if (!section) return;
  if (section.style.display === 'none') {
    section.style.display = 'flex';
    document.getElementById('newCategoryName').focus();
  } else {
    section.style.display = 'none';
  }
}

async function submitNewCategory() {
  const nameInput = document.getElementById('newCategoryName');
  const iconInput = document.getElementById('newCategoryIcon');
  const errorEl = document.getElementById('newCategoryError');

  const name = nameInput.value.trim();
  const icon = iconInput.value.trim() || '📦';

  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  if (!name) {
    if (errorEl) {
      errorEl.textContent = 'Lütfen kategori adını girin';
      errorEl.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
      body: JSON.stringify({ name, icon })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kategori eklenemedi');

    nameInput.value = '';
    iconInput.value = '';
    const section = document.getElementById('newCategorySection');
    if (section) section.style.display = 'none';
    
    showToast(`✅ Yeni kategori eklendi: ${name}`, 'success');

    // Kategorileri yenile ve dropdown'da seç
    await loadCategories();
    const select = document.getElementById('pinCategory');
    if (select) select.value = name;
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    }
  }
}

// ── İşletmeye Özel Yorum & Hata Bildirme Fonksiyonları ──────────
function renderPinComments(comments) {
  const list = document.getElementById('detailCommentsList');
  const countEl = document.getElementById('detailCommentCount');
  if (!list) return;

  list.innerHTML = '';
  countEl.textContent = comments.length;

  if (comments.length === 0) {
    list.innerHTML = `<div style="color:var(--text-3); font-size:12px; font-style:italic; text-align:center; padding:12px;">Henüz yorum yapılmamış. İlk yorumu siz yazın!</div>`;
    return;
  }

  comments.forEach(c => {
    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 6px;
    `;
    
    let timeStr = '';
    try {
      const d = new Date(c.created_at);
      timeStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      timeStr = '';
    }

    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--text-3);">
        <strong style="color: var(--text-2);">${escHtml(c.nickname)}</strong>
        <span>${timeStr}</span>
      </div>
      <div style="font-size: 13px; color: var(--text-1); word-break: break-word; padding: 2px 0;">${escHtml(c.message)}</div>
    `;
    list.appendChild(card);
  });

  // Scroll to bottom
  list.scrollTop = list.scrollHeight;
}

async function submitComment() {
  if (!checkAuthAndRun()) return;
  if (!currentDetailPinId) return;

  const msgInput = document.getElementById('commentMessage');
  const message = msgInput.value.trim();

  if (!message) {
    showToast('Lütfen yorumunuzu yazın', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/pins/${currentDetailPinId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Yorum gönderilemedi');

    msgInput.value = '';
    showToast('✅ Yorumunuz eklendi!', 'success');
    const existingPin = allPins.find(p => p.id === currentDetailPinId);
    if (existingPin) {
      logActivity(`'${existingPin.title}' iğnesine yorum yaptınız`, true);
    }
    
    // Reload pins to get updated comments
    await loadPins();
    
    // Find newly loaded pin and refresh comments
    const pin = allPins.find(p => p.id === currentDetailPinId);
    if (pin) {
      renderPinComments(pin.comments || []);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function toggleReportForm() {
  if (!checkAuthAndRun()) return;
  const container = document.getElementById('reportFormContainer');
  if (!container) return;
  if (container.style.display === 'none') {
    container.style.display = 'flex';
    document.getElementById('reportText').value = '';
    document.getElementById('reportText').focus();
  } else {
    container.style.display = 'none';
  }
}

async function submitReport() {
  if (!currentDetailPinId) return;

  const textInput = document.getElementById('reportText');
  const message = textInput.value.trim();

  if (!message) {
    showToast('Lütfen hata açıklamasını yazın', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/pins/${currentDetailPinId}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bildirim gönderilemedi');

    textInput.value = '';
    const container = document.getElementById('reportFormContainer');
    if (container) container.style.display = 'none';
    showToast('✅ Bildiriminiz iletildi, teşekkürler!', 'success');
    const pin = allPins.find(p => p.id === currentDetailPinId);
    if (pin) {
      logActivity(`'${pin.title}' iğnesi için hata bildirdiniz`, true);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── User Emoji Seçim Menüsü (Emoji Picker) ──────────────────────
const POPULAR_EMOJIS = [
  '🥦', '🌾', '🏪', '🐟', '🥩', '📦', '🍅', '🧅', '🥔', '🥬', '🌶️', '🍋', '🍇', '🍒', '🍓', '🍊', '🍉', '🍌',
  '🥑', '🥕', '🧄', '🍞', '🥜', '🧀', '🥚', '🍗', '🦐', '🦀', '🧉', '🏺', '🌸', '🪴', '🚚', '🚜', '💰', '🛠️',
  '🍎', '🍏', '🍐', '🍑', '🥭', '🍍', '🥥', '🥝', '🍈', '🫐', '🫒', '🍆', '🌽', '🥒', '🫑', '🫛', '🍠', '🫚',
  '🫘', '🌰', '🍄', '🍚', '🌿', '🍃', '🧂', '🫙', '🍯', '🍫', '🍬', '☕', '🍵', '🥖', '🥐', '🥨', '🫓', '🍝',
  '🐠', '🦑', '🐙', '🦞', '🦪', '🐄', '🐑', '🐔', '🦃', '🥓', '🍖', '🥛', '🧈', '🍦', '🧃', '🥤', '🍷', '🧊',
  '💧', '🌻', '🌷', '🌹', '💐', '🌱', '🌳', '🧑‍🌾', '🐝', '🛒', '🧺', '🏬', '🏭', '🏢', '🚛', '🛻', '🚐', '🏗️',
  '📍', '🏷️', '⚖️', '🧾', '💳', '💵', '📞', '🤝', '⭐', '✅', '🔥', '🥡', '🛍️', '🪣', '🧹', '🧽', '🧴', '🔧',
  '🔨', '⚙️', '🔌', '💡', '❄️'
];

let activeUserIconInput = null;

function initUserEmojiPicker() {
  const picker = document.getElementById('userEmojiPicker');
  if (!picker) return;
  const grid = picker.querySelector('.emoji-picker-grid');
  if (!grid) return;
  
  grid.innerHTML = '';
  POPULAR_EMOJIS.forEach(emoji => {
    const el = document.createElement('div');
    el.className = 'emoji-picker-item';
    el.textContent = emoji;
    el.onclick = (e) => {
      e.stopPropagation();
      if (activeUserIconInput) {
        activeUserIconInput.value = emoji;
      }
      hideUserEmojiPicker();
    };
    grid.appendChild(el);
  });

  // Tıklanan yer dışındaysa kapat
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && (!activeUserIconInput || e.target !== activeUserIconInput)) {
      hideUserEmojiPicker();
    }
  });
}

function showUserEmojiPicker(inputEl) {
  activeUserIconInput = inputEl;
  const picker = document.getElementById('userEmojiPicker');
  if (!picker) return;
  const rect = inputEl.getBoundingClientRect();
  picker.style.top = `${rect.bottom + window.scrollY + 6}px`;
  picker.style.left = `${rect.left + window.scrollX}px`;
  picker.style.display = 'block';
}

function hideUserEmojiPicker() {
  const picker = document.getElementById('userEmojiPicker');
  if (picker) {
    picker.style.display = 'none';
  }
  activeUserIconInput = null;
}

// ── Welcome Popup Close Helpers ──────────────────────────────────
function closeWelcomePopup() {
  const popup = document.getElementById('welcomePopup');
  if (popup) {
    popup.classList.remove('open');
  }
  try { localStorage.setItem('welcomeSeen', '1'); } catch {}
}

function closeWelcomePopupOnBg(e) {
  if (e.target === e.currentTarget) {
    closeWelcomePopup();
  }
}

// ── Canlı Aktivite Log Akışı (Activity Logger) ───────────────────────
function logActivity(text, isReal = false) {
  const container = document.getElementById('activityLogger');
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'activity-log-item';

  const d = new Date();
  const timeStr = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  item.innerHTML = `
    <div class="activity-pulse-dot"></div>
    <div class="activity-log-text">${escHtml(text)}</div>
    <div class="activity-log-time">${timeStr}</div>
  `;

  container.appendChild(item);

  // En fazla 4 log göster, eskileri sil
  const items = container.querySelectorAll('.activity-log-item');
  if (items.length > 4) {
    items[0].remove();
  }

  if (isReal) {
    saveActivityToBackend(text);
  }
}

async function saveActivityToBackend(text) {
  try {
    let actionText = text
      .replace("Siz (Mersin, Türkiye) rehbere bağlandınız", "Ziyaretçi rehbere bağlandı")
      .replace("filtrelediniz", "filtreledi")
      .replace("inceliyorsunuz", "inceliyor")
      .replace("yaptınız", "yaptı")
      .replace("bildirdiniz", "bildirdi")
      .replace("gönderdiniz", "gönderdi");

    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionText })
    });
  } catch (err) {
    console.error('Aktivite kaydedilemedi:', err);
  }
}




// ── Telefona Eklenen Uygulama (PWA) ───────────────────────────
let deferredInstallPrompt = null;
const INSTALL_DISMISS_DAYS = 14;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function installBannerDismissed() {
  try {
    const until = parseInt(localStorage.getItem('installDismissedUntil') || '0', 10);
    return Date.now() < until;
  } catch {
    return false;
  }
}

function showInstallBanner(iosMode) {
  if (isStandaloneApp() || installBannerDismissed()) return;
  const banner = document.getElementById('installBanner');
  if (iosMode) {
    document.getElementById('installBannerHint').textContent = 'Alttaki Paylaş ⬆️ simgesine, sonra "Ana Ekrana Ekle"ye dokun';
    document.getElementById('installBannerBtn').hidden = true;
  }
  banner.hidden = false;
}

function dismissInstallBanner() {
  document.getElementById('installBanner').hidden = true;
  try {
    localStorage.setItem('installDismissedUntil', String(Date.now() + INSTALL_DISMISS_DAYS * 86400000));
  } catch {}
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('installBanner').hidden = true;
  if (outcome === 'accepted') showToast('✅ NewHal telefonuna eklendi', 'success');
}

// Android ve bilgisayarda Chrome/Edge "yüklenebilir" dediğinde
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner(false);
});

window.addEventListener('appinstalled', () => {
  document.getElementById('installBanner').hidden = true;
});

// iPhone'da otomatik yükleme penceresi yok: Safari'de nasıl ekleneceğini göster
if (isIos() && !isStandaloneApp()) {
  setTimeout(() => showInstallBanner(true), 4000);
}
