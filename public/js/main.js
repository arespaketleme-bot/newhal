/* ═══════════════════════════════════════════════════════════════
   NewHal — main.js
   ═══════════════════════════════════════════════════════════════ */

// ── AUTH YARDIMCISI ──────────────────────────────
function openAuthModal() {
  const googleLink = document.getElementById('googleAuthLink');
  const referralCode = localStorage.getItem('newhalReferralCode');
  if (googleLink) googleLink.href = referralCode
    ? `/auth/google?ref=${encodeURIComponent(referralCode)}`
    : '/auth/google';
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
    btn.title = 'Profilim';
    btn.onclick = (e) => {
      e.preventDefault();
      if (btn.id === 'mobileAuthBtn') toggleMobileMenu();
      openProfileModal();
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
  const referralFromUrl = new URLSearchParams(window.location.search).get('ref');
  if (/^NH[1-9]\d{0,17}$/i.test(referralFromUrl || '')) {
    localStorage.setItem('newhalReferralCode', referralFromUrl.toUpperCase());
  }
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
    const points = urlParams.get('points') === '100' ? ' 100 Para Puan kazandın!' : '';
    localStorage.removeItem('newhalReferralCode');
    setTimeout(() => showToast(`✅ Başarıyla giriş yapıldı. Hoş geldin, ${name}!${points}`, 'success'), 500);
  } else if (urlParams.get('error') === 'google_auth_failed') {
    showToast('❌ Google ile giriş yapılamadı.', 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Restore UI for logged in user
  const savedName = localStorage.getItem('userName');
  if (savedName) {
    updateAuthUI(savedName);
  }
  if (readToken('userToken')) {
    refreshMessageBadges();
    refreshNotificationBadge();
    setInterval(refreshMessageBadges, 60000);
    setInterval(refreshNotificationBadge, 30000);
  }
  if (urlParams.get('openNotifications') === '1' && readToken('userToken')) {
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(openNotifications, 400);
  } else if (urlParams.get('openMessages') === '1' && readToken('userToken')) {
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(openMessages, 400);
  }

  initMap();
  initSearch();
  // Site haritayla, tam ekran açılır; "Küçült" ya da alt menü ile sayfanın geri kalanına geçilir
  toggleMapFullscreen(true);
  // İlk açılışta harita 20 sn sonra kendiliğinden küçülür; sayaç karşılama ekranı kapanınca başlar
  mapAutoClosePending = true;
  await loadCategories();
  loadPins();
  initAdsSearch();
  loadAds();
  loadSponsor();
  loadFbStories();
  setInterval(loadFbStories, 5 * 60 * 1000);
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
  // Karşılama ekranı açılmadıysa harita sayacı hemen, açıldıysa kapanınca başlar
  if (!(await showWelcomePopup())) startInitialMapAutoClose();

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

let mapAutoCloseTimer = null;
let mapAutoClosePending = false;   // ilk açılış sayacı henüz başlamadı

function startInitialMapAutoClose() {
  if (!mapAutoClosePending) return;
  mapAutoClosePending = false;
  // Tek seferlik: bu tarayıcıda daha önce çalıştıysa bir daha başlamaz
  try {
    if (localStorage.getItem('mapAutoCloseShown')) return;
    localStorage.setItem('mapAutoCloseShown', '1');
  } catch {}
  startMapAutoClose(20);
}

function stopMapAutoClose() {
  if (!mapAutoCloseTimer) return;
  clearInterval(mapAutoCloseTimer);
  mapAutoCloseTimer = null;
}

function startMapAutoClose(seconds) {
  stopMapAutoClose();
  if (!isMapFullscreen()) return;
  let left = seconds;
  const label = document.getElementById('mapFsLabel');
  const show = () => { label.textContent = `Küçült / İlanlara Geç · ${left} sn`; };
  show();
  mapAutoCloseTimer = setInterval(() => {
    left--;
    if (left > 0) return show();
    stopMapAutoClose();
    if (isMapFullscreen()) toggleMapFullscreen(false);
  }, 1000);
}

function toggleMapFullscreen(force) {
  // Kullanıcı haritayı kendisi açar ya da kapatırsa geri sayım biter (başlamadıysa hiç başlamaz)
  stopMapAutoClose();
  mapAutoClosePending = false;
  const panel = document.getElementById('mapPanel');
  const on = typeof force === 'boolean' ? force : !isMapFullscreen();
  panel.classList.toggle('map-fullscreen', on);
  document.body.classList.toggle('map-fs-open', on);
  const btn = document.getElementById('mapFsBtn');
  document.getElementById('mapFsLabel').textContent = on ? 'Küçült / İlanlara Geç' : 'Tam Ekran';
  btn.setAttribute('aria-label', on ? 'Haritayı eski haline döndür' : 'Haritayı tam ekran yap');
  if (on) setChatOpen(false);
  if (typeof updateBottomNav === 'function') updateBottomNav();
  // Leaflet yeni boyutu ölçsün, harita aynı yeri göstermeye devam etsin
  const center = map.getCenter();
  setTimeout(() => { map.invalidateSize(); map.setView(center, map.getZoom(), { animate: false }); }, 50);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isMapFullscreen()) toggleMapFullscreen(false);
});

let myLocMarker = null;
function goToMyLocation() {
  const btn = document.getElementById('locateMeBtn');
  if (!navigator.geolocation) { alert('Tarayıcınız konum bulmayı desteklemiyor.'); return; }
  btn.textContent = '⏳ Bulunuyor';
  navigator.geolocation.getCurrentPosition(pos => {
    btn.textContent = '📍 Konumum';
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (myLocMarker) myLocMarker.setLatLng(ll);
    else myLocMarker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map).bindPopup('Buradasınız');
    map.setView(ll, 17);
  }, () => {
    btn.textContent = '📍 Konumum';
    alert('Konumunuz alınamadı. Konum iznini açıp tekrar deneyin.');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

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
  fillAddressFromLocation(lat, lng);

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

function pinLevelSize(level, baseSize = 52) {
  const levelGrowth = Math.min(8, Math.max(0, Number(level || 1) - 1));
  return baseSize + levelGrowth * 4;
}

function pinLevelBadge(level) {
  return `<span class="pin-level-badge" aria-label="Seviye ${Math.max(1, Number(level) || 1)}">${Math.max(1, Number(level) || 1)}</span>`;
}

function createIcon(emoji, isTemp = false, story = null, level = 1) {
  const size = isTemp ? 38 : pinLevelSize(level);
  if (story) {
    const storySize = pinLevelSize(level, 60);
    return L.divIcon({
      className: '',
      html: `<div class="story-marker ${story}" style="width:${storySize}px;height:${storySize}px">${pinLevelBadge(level)}<div class="story-marker-inner">${escHtml(emoji)}</div></div>`,
      iconSize: [storySize, storySize],
      iconAnchor: [storySize / 2, storySize / 2],
      popupAnchor: [0, -Math.round(storySize * 0.55)],
    });
  }
  return L.divIcon({
    className: '',
    html: `<div style="
      position:relative; width:${size}px; height:${size}px;
      background:${isTemp ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)'};
      border:2px solid ${isTemp ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)'};
      border-radius:50%; display:flex; align-items:center; justify-content:center;
      font-size:${isTemp ? 20 : 23}px; box-shadow:0 4px 16px rgba(0,0,0,0.4);
      backdrop-filter:blur(4px); cursor:pointer;
      transition:all 0.2s ease;
    ">${escHtml(emoji)}${isTemp ? '' : pinLevelBadge(level)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, isTemp ? -24 : -30],
  });
}

// ── Pin Yükle ─────────────────────────────────────────────────
async function loadPins() {
  loadMyClaims();
  try {
    const userToken = localStorage.getItem('userToken');
    const res = await fetch('/api/pins', {
      headers: userToken ? { Authorization: 'Bearer ' + userToken } : {},
    });
    allPins = await res.json();
    renderPins(allPins);
    renderStoryBar();
    openPinFromLink();
    updateStats();
    await updateHeroStats();
  } catch (err) {
    console.error('Pinler yüklenemedi:', err);
  }
}

// İşletme sayfasından gelen "?isletme=12" bağlantısı: o işletmeyi haritada açar
let pinLinkHandled = false;
function openPinFromLink() {
  if (pinLinkHandled) return;
  pinLinkHandled = true;
  const id = Number(new URLSearchParams(location.search).get('isletme'));
  if (!id || !allPins.some(p => p.id === id)) return;
  if (!isMapFullscreen()) document.getElementById('mapSection').scrollIntoView();
  focusPin(id);
  setTimeout(() => showPinDetail(id), 600);
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
      const size = n < 10 ? 44 : n < 50 ? 54 : 64;
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
    const storyMark = storyState(pin.id);
    const marker = L.marker([pin.lat, pin.lng], { icon: createIcon(emoji, false, storyMark, pin.level), title: pin.title, zIndexOffset: storyMark ? 500 : 0 });
    // İzlenmemiş hikayesi olan dükkana dokununca hikaye açılır
    if (storyMark === 'new') marker.on('click', () => { setTimeout(() => marker.closePopup(), 0); openStories(pin.id); });
    pinMarkers[pin.id] = marker;
    // Hikayesi olan dükkan gruba girmez, uzaktan da görünsün
    if (cluster && !storyMark) cluster.addLayer(marker); else marker.addTo(map);
    
    // Popup shows contact info optionally
    marker.bindPopup(`
      <div style="font-family:'Inter',sans-serif; min-width:200px;">
        <div style="font-size:18px;margin-bottom:6px;">${escHtml(emoji)} <strong style="color:#f0fdf4;font-size:14px;">${escHtml(pin.title)}</strong>${verifiedBadge(pin)}</div>
        <div style="font-size:12px;color:#fbbf24;margin-bottom:5px;">⭐ Seviye ${Math.max(1, Number(pin.level) || 1)} · ${Number(pin.like_count) || 0} beğeni · ${(pin.comments || []).length} yorum</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">📍 ${escHtml(pin.address)}</div>
        ${showContactInfo && pin.phone ? `<div style="font-size:12px;color:#86efac;">📞 <a href="tel:${escHtml(pin.phone)}" style="color:#4ade80;">${escHtml(pin.phone)}</a></div>` : ''}
        ${(pin.images || []).length ? `<img class="popup-photo" src="${escHtml(pin.images[0])}" alt="" loading="lazy" />` : ''}
        ${popupProducts('🛒 Satıyor', pin.sells)}
        ${popupProducts('🔎 Arıyor', pin.seeks)}
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          ${storyMark ? `<button onclick="openStories(${pin.id})" class="popup-story-btn">▶ Hikayeyi izle</button>` : ''}
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
        <div class="pin-card-title">${escHtml(pin.title)}${verifiedBadge(pin)}</div>
        <div class="pin-card-level">⭐ Seviye ${Math.max(1, Number(pin.level) || 1)} · ${Number(pin.like_count) || 0} beğeni</div>
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
    if (pin.verified) title.insertAdjacentHTML('beforeend', verifiedBadge(pin));
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
  trackSearch('map', searchQuery, true);
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
  input.addEventListener('input', () => { onSearchInput(input.value); trackSearch('map', input.value); });
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
  // Haritadaki ve listedeki kategori tuşları birlikte güncellenir
  document.querySelectorAll('.filter-btn, .map-cat-chip').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  if (btn) btn.classList.add('active');
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
  // Yönetim panelindeki önizleme (çerçeve içi) ziyaret sayılmaz
  if (window.self !== window.top) counted = true;
  if (!counted) {
    try {
      // Ziyaret bilgisi (yöneticiye Telegram bildirimi için): nereden geldi, hangi sayfa, cihaz
      let isAdmin = false;
      try { isAdmin = !!localStorage.getItem('newhal_admin_token'); } catch {}
      const token = (() => { try { return localStorage.getItem('userToken'); } catch { return null; } })();
      const res = await fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({
          referrer: document.referrer || '',
          page: location.pathname + location.search,
          screen: `${screen.width}x${screen.height}`,
          lang: navigator.language || '',
          app: isStandaloneApp(),
          admin: isAdmin,
        }),
      });
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

// ── Sponsorlu reklamlar (yönetimden açılıp kapanır; birden fazla sponsor yerleri paylaşır) ──
let sponsors = [];

function sponsorUsable(s, place) {
  return !!(s && s.enabled && s.places && s.places[place]
    && typeof s.url === 'string' && s.url.startsWith('https://'));
}
const sponsorsFor = place => sponsors.filter(s => sponsorUsable(s, place));
// Tek bir yerde gösterilecek sponsor: her sayfa açılışında sırayla değil rastgele seçilir
const pickSponsor = place => { const list = sponsorsFor(place); return list.length ? list[Math.floor(Math.random() * list.length)] : null; };

// Metinler textContent ile yazılır: yönetimden gelen yazı HTML olarak çalışmaz
function buildSponsorCard(place, s) {
  const card = document.createElement('a');
  card.className = `sponsor-card sponsor-${place}`;
  card.href = s.url;
  card.target = '_blank';
  card.rel = 'sponsored noopener noreferrer';
  const image = typeof s.image === 'string' ? s.image : '';
  if (image.startsWith('https://') || /^img\/[\w.-]+$/.test(image)) {
    const img = document.createElement('img');
    img.className = 'sponsor-img';
    img.src = image.startsWith('https://') ? image : '/' + image;
    img.alt = `${s.name || 'Sponsor'} reklamı`;
    img.loading = 'lazy';
    img.decoding = 'async';
    card.appendChild(img);
  } else {
    card.classList.add('no-img');
  }
  const label = document.createElement('span');
  label.className = 'sponsor-label';
  label.textContent = `Sponsorlu · ${s.name || ''}`;
  const body = document.createElement('span');
  body.className = 'sponsor-body';
  const title = document.createElement('strong');
  title.className = 'sponsor-title';
  title.textContent = s.title || '';
  body.appendChild(title);
  if (s.text) {
    const text = document.createElement('span');
    text.className = 'sponsor-text';
    text.textContent = s.text;
    body.appendChild(text);
  }
  const btn = document.createElement('span');
  btn.className = 'sponsor-btn';
  btn.textContent = s.button || 'İncele';
  card.append(label, body, btn);
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      fetch('/api/logs', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: `Sponsorlu reklama tıkladı (${s.name}, ${place})` }) });
    } catch {}
  });
  return card;
}

let stripSponsor = null;   // vitrin altı bant sayfa boyunca aynı sponsoru gösterir
function renderSponsorStrip() {
  document.getElementById('sponsorStrip')?.remove();
  const vitrin = document.getElementById('vitrin');
  if (!stripSponsor || !sponsorUsable(stripSponsor, 'strip')) stripSponsor = pickSponsor('strip');
  if (!vitrin || !stripSponsor) return;
  const strip = buildSponsorCard('strip', stripSponsor);
  strip.id = 'sponsorStrip';
  vitrin.insertAdjacentElement('afterend', strip);
}

function renderSponsorDetail() {
  document.getElementById('sponsorDetail')?.remove();
  const box = document.getElementById('pinDetailBox');
  const s = pickSponsor('detail');
  if (!box || !s) return;
  const card = buildSponsorCard('detail', s);
  card.id = 'sponsorDetail';
  box.appendChild(card);
}

// İlan listesi: 6., 12. … sıralara birer sponsor kartı (az ilan varsa ilki sona)
function insertGridSponsors(grid, count) {
  const list = sponsorsFor('grid');
  if (!count || !list.length) return;
  const start = Math.floor(Math.random() * list.length);
  list.forEach((s, k) => {
    const pos = 5 + k * 6;
    if (k > 0 && pos > count + k) return;
    grid.insertBefore(buildSponsorCard('grid', list[(start + k) % list.length]), grid.children[pos] || null);
  });
}

// Masaüstü sağ/sol reklam: yalnızca geniş ekranda (CSS) görünür; × ile o oturum boyunca kapanır.
// İki sponsor varsa biri solda, diğeri sağda durur.
const SPONSOR_SIDE_CLOSED = side => `sponsorSideClosed_${side}`;
function renderSponsorSides() {
  document.querySelectorAll('.sponsor-rail').forEach(el => el.remove());
  const list = sponsorsFor('side');
  if (!list.length) return;
  ['left', 'right'].forEach((side, i) => {
    try { if (sessionStorage.getItem(SPONSOR_SIDE_CLOSED(side))) return; } catch {}
    const s = list[i % list.length];
    const rail = document.createElement('aside');
    rail.className = `sponsor-rail sponsor-rail-${side}`;
    rail.setAttribute('aria-label', `Sponsorlu reklam: ${s.name}`);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sponsor-close';
    close.setAttribute('aria-label', 'Reklamı kapat');
    close.textContent = '×';
    close.addEventListener('click', () => {
      rail.remove();
      try { sessionStorage.setItem(SPONSOR_SIDE_CLOSED(side), '1'); } catch {}
    });
    rail.append(close, buildSponsorCard('side', s));
    document.body.appendChild(rail);
  });
}

async function loadSponsor() {
  try {
    const res = await fetch('/api/sponsor');
    if (res.ok) {
      const data = await res.json();
      sponsors = Array.isArray(data.sponsors) ? data.sponsors : (data && data.name ? [data] : []);
    }
  } catch {}
  renderSponsorStrip();
  renderSponsorSides();
  // İlanlar önce geldiyse listeyi sponsor kartlarıyla yeniden çiz
  if (document.getElementById('adsGrid')?.children.length) renderAdsGrid();
}

function showPinDetail(id) {
  const pin = allPins.find(p => p.id === id);
  if (!pin) return;
  currentDetailPinId = id;
  renderSponsorDetail();

  // Reset report form
  const rForm = document.getElementById('reportFormContainer');
  if (rForm) rForm.style.display = 'none';
  const rText = document.getElementById('reportText');
  if (rText) rText.value = '';

  const emoji = CATEGORY_ICONS[pin.category] || '📦';

  document.getElementById('detailIcon').textContent = emoji;
  document.getElementById('detailTitle').textContent = pin.title;
  if (pin.verified) document.getElementById('detailTitle').insertAdjacentHTML('beforeend', verifiedBadge(pin));
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
  renderPinEngagement(pin);

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
  document.getElementById('infoEditor').style.display = 'none';
  document.getElementById('infoEditBtn').style.display = canEditCatalog(pin) ? 'inline-flex' : 'none';
  renderOwnerBox(pin);
}

// ── "Bu dükkan benim": sahiplenme ve onay rozeti ──────────────
let myClaims = [];

function verifiedBadge(pin) {
  return pin && pin.verified ? '<span class="verified-badge" title="Sahibi onaylı dükkan">✓</span>' : '';
}

async function loadMyClaims() {
  const user = readToken('userToken');
  if (!user) { myClaims = []; return; }
  try {
    const res = await fetch('/api/my-claims', { headers: { 'Authorization': 'Bearer ' + user.token } });
    if (res.ok) myClaims = await res.json();
  } catch {}
}

function renderOwnerBox(pin) {
  const box = document.getElementById('ownerBox');
  const user = readToken('userToken');
  const mine = user && pin.owner_id && pin.owner_id === user.payload.id;
  const claim = [...myClaims].reverse().find(c => c.pinId === pin.id);
  document.getElementById('claimForm').style.display = 'none';

  if (pin.verified) {
    box.innerHTML = mine
      ? '<div class="owner-note ok">✅ Bu dükkan sizin. Bilgilerinizi ve ürünlerinizi aşağıdan güncelleyebilirsiniz.</div>'
      : '<div class="owner-note ok">✅ Onaylı dükkan. Bu sayfayı dükkanın sahibi yönetiyor.</div>';
  } else if (claim && claim.status === 'pending') {
    box.innerHTML = '<div class="owner-note wait">⏳ Sahiplenme isteğiniz alındı. Sizi arayıp doğruladıktan sonra dükkan size geçecek.</div>';
  } else {
    const rejected = claim && claim.status === 'rejected'
      ? `<div class="owner-note no">Önceki isteğiniz onaylanmadı${claim.reason ? `: ${escHtml(claim.reason)}` : '.'}</div>` : '';
    box.innerHTML = `${rejected}<button type="button" class="claim-btn" onclick="toggleClaimForm(true)">🏷️ Bu dükkan benim</button>`;
  }
}

function toggleClaimForm(show) {
  if (show && !readToken('userToken')) {
    showToast('Dükkanı sahiplenmek için önce giriş yapın', 'error');
    return openAuthModal();
  }
  document.getElementById('claimForm').style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('claimPhone').focus();
}

async function submitClaim() {
  const pin = allPins.find(p => p.id === currentDetailPinId);
  const user = readToken('userToken');
  if (!pin) return;
  if (!user) return openAuthModal();
  const phone = document.getElementById('claimPhone').value.trim();
  if (phone.replace(/\D/g, '').length < 10) return showToast('Size ulaşabileceğimiz bir telefon numarası yazın', 'error');

  const btn = document.getElementById('claimSendBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/pins/${pin.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + user.token },
      body: JSON.stringify({ phone, note: document.getElementById('claimNote').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { openAuthModal(); throw new Error('Oturum süresi doldu, tekrar giriş yapın'); }
    if (!res.ok) throw new Error(data.error || 'İstek gönderilemedi');
    myClaims.push({ pinId: pin.id, status: 'pending' });
    document.getElementById('claimPhone').value = '';
    document.getElementById('claimNote').value = '';
    renderOwnerBox(pin);
    showToast('✅ İsteğiniz alındı, sizi arayacağız', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function toggleInfoEditor() {
  const editor = document.getElementById('infoEditor');
  const pin = allPins.find(p => p.id === currentDetailPinId);
  if (!pin) return;
  if (editor.style.display !== 'none') { editor.style.display = 'none'; return; }
  const select = document.getElementById('infoCategory');
  const names = Object.keys(CATEGORY_ICONS);
  if (!names.includes(pin.category)) names.unshift(pin.category);
  select.innerHTML = '';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${CATEGORY_ICONS[name] || '📦'} ${name}`;
    select.appendChild(opt);
  });
  select.value = pin.category;
  document.getElementById('infoTitle').value = pin.title || '';
  document.getElementById('infoAddress').value = pin.address || '';
  document.getElementById('infoPhone').value = pin.phone || '';
  document.getElementById('infoWebsite').value = pin.website || '';
  document.getElementById('infoEmail').value = pin.email || '';
  editor.style.display = 'flex';
}

async function saveInfo() {
  const pin = allPins.find(p => p.id === currentDetailPinId);
  if (!pin) return;
  const val = id => document.getElementById(id).value.trim();
  if (!val('infoTitle') || !val('infoAddress')) return showToast('Dükkan adı ve adres boş olamaz', 'error');

  const btn = document.getElementById('infoSaveBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/pins/${pin.id}/info`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getCatalogToken(pin) },
      body: JSON.stringify({
        title: val('infoTitle'), category: val('infoCategory'), address: val('infoAddress'),
        phone: val('infoPhone'), website: val('infoWebsite'), email: val('infoEmail'),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');
    const { title, category, address, phone, website, email } = data.pin;
    Object.assign(pin, { title, category, address, phone, website, email });
    renderPins(allPins);
    showPinDetail(pin.id);
    showToast('✅ Dükkan bilgileri güncellendi', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
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
    addFiles,
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

// ── Konumdan adres: seçilen noktanın adresi forma kendiliğinden yazılır ──
let addressAuto = '';      // en son kendiliğinden yazılan adres (kişi değiştirdiyse dokunulmaz)
let addressSeq = 0;
let addressTimer = null;

function setAddressHint(text) {
  const hint = document.getElementById('pinAddressHint');
  hint.textContent = text || '';
  hint.hidden = !text;
}

function fillAddressFromLocation(lat, lng) {
  const input = document.getElementById('pinAddress');
  // Kişi adresi kendisi yazdıysa üzerine yazma
  if (input.value.trim() && input.value !== addressAuto) return setAddressHint('');
  const seq = ++addressSeq;
  clearTimeout(addressTimer);
  setAddressHint('📍 Adres konumdan bulunuyor...');
  addressTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
      const data = await res.json().catch(() => ({}));
      if (seq !== addressSeq) return;                      // bu arada başka bir nokta seçildi
      if (!res.ok || !data.address) throw new Error();
      if (input.value.trim() && input.value !== addressAuto) return setAddressHint('');
      input.value = data.address;
      addressAuto = data.address;
      setAddressHint('📍 Adres konumdan yazıldı. Blok ve dükkan numarasını ekleyebilirsiniz.');
    } catch {
      if (seq === addressSeq) setAddressHint('Adres bulunamadı, lütfen kendiniz yazın.');
    }
  }, 400);
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
  addressAuto = '';
  addressSeq++;
  setAddressHint('');
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
const BOTTOM_NAV_SECTIONS = { home: 'hero', map: 'mapSection', ads: 'adsSection' };
let bottomNavSection = 'home';
let bottomNavPreviousSection = 'home';

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
  if (tab === 'profile') {
    setChatOpen(false);
    if (isMapFullscreen()) toggleMapFullscreen(false);
    if (bottomNavSection !== 'profile') bottomNavPreviousSection = bottomNavSection;
    bottomNavSection = 'profile';
    openProfileModal();
    updateBottomNav();
    return;
  }
  if (tab === 'chat') {
    setChatOpen(!isChatOpen());
    return;
  }
  setChatOpen(false);
  // Harita tuşu haritayı tam ekran açar; diğerleri tam ekrandan çıkıp ilgili bölüme gider
  if (tab === 'map') {
    if (!isMapFullscreen()) toggleMapFullscreen(true);
  } else {
    if (isMapFullscreen()) toggleMapFullscreen(false);
    if (tab === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
    else document.getElementById(BOTTOM_NAV_SECTIONS[tab]).scrollIntoView({ behavior: 'smooth' });
  }
  bottomNavSection = tab;
  updateBottomNav();
}

function updateBottomNav() {
  const profileOpen = document.getElementById('profileModal')?.classList.contains('open');
  const active = profileOpen ? 'profile' : isMapFullscreen() ? 'map' : bottomNavSection;
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
  renderMapCategoryBar(categories);
}

// Haritanın üstündeki kategori şeridi
function renderMapCategoryBar(categories) {
  const bar = document.getElementById('mapCatBar');
  if (!bar) return;
  bar.innerHTML = '';
  const chip = (cat, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `map-cat-chip${activeFilter === cat ? ' active' : ''}`;
    b.dataset.cat = cat;
    b.textContent = label;
    b.onclick = () => {
      filterPins(cat, b);
      b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    };
    bar.appendChild(b);
  };
  chip('all', 'Tümü');
  categories.forEach(cat => chip(cat.name, `${cat.icon || '📦'} ${cat.name}`));
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

function renderPinEngagement(pin) {
  const level = Math.max(1, Number(pin.level) || 1);
  const commentCount = (pin.comments || []).length;
  const likeCount = Number(pin.like_count) || 0;
  const levelEl = document.getElementById('detailPinLevel');
  const countEl = document.getElementById('detailPinLikeCount');
  const labelEl = document.getElementById('detailPinLikeLabel');
  const button = document.getElementById('detailPinLikeButton');
  if (levelEl) levelEl.textContent = `⭐ Seviye ${level} · ${commentCount} yorum`;
  if (countEl) countEl.textContent = likeCount.toLocaleString('tr-TR');
  if (labelEl) labelEl.textContent = pin.liked_by_me ? '❤️ Beğenildi' : '🤍 Beğen';
  if (button) button.setAttribute('aria-pressed', pin.liked_by_me ? 'true' : 'false');
}

async function togglePinLike() {
  if (!checkAuthAndRun()) return;
  const pin = allPins.find(p => p.id === currentDetailPinId);
  if (!pin) return;
  const liked = !!pin.liked_by_me;
  const button = document.getElementById('detailPinLikeButton');
  if (button) button.disabled = true;
  try {
    const res = await fetch(`/api/pins/${pin.id}/likes`, {
      method: liked ? 'DELETE' : 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('userToken') },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Beğeni kaydedilemedi');
    Object.assign(pin, { liked_by_me: data.liked, like_count: data.like_count, level: data.level });
    renderPinEngagement(pin);
    renderPins(allPins);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
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
      renderPinEngagement(pin);
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
// Paylaşım linkinden gelene büyük açılış ekranı yerine işine yarayan küçük kart
const LANDINGS = {
  davet: { icon: '📍', title: 'Dükkanınız haritada olabilir', text: 'Adını yazın, bulun ve ücretsiz sahiplenin.', button: 'Dükkanımı Bul', action: focusMapSearch },
  tanitim: { icon: '🗺️', title: 'Mersin Hali cebinizde', text: 'Aradığınız esnafı ya da ürünü yazın.', button: 'Aramaya Başla', action: focusMapSearch },
  ilan: { icon: '📢', title: 'İlanınızı 1 dakikada verin', text: 'Ücretsiz. Hal esnafı görsün.', button: 'İlan Ver', action: () => openUserAdModal() },
};

function focusMapSearch() {
  if (!isMapFullscreen()) toggleMapFullscreen(true);
  const input = document.getElementById('mapSearch');
  if (input) input.focus();
}

function showLandingCard(key) {
  const info = LANDINGS[key];
  const card = document.createElement('div');
  card.className = 'landing-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', info.title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'landing-card-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Kapat');
  close.onclick = () => card.remove();
  const icon = document.createElement('div');
  icon.className = 'landing-card-icon';
  icon.textContent = info.icon;
  const body = document.createElement('div');
  body.className = 'landing-card-body';
  const title = document.createElement('b');
  title.textContent = info.title;
  const text = document.createElement('span');
  text.textContent = info.text;
  body.append(title, text);
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'landing-card-go';
  go.textContent = info.button;
  go.onclick = () => { card.remove(); info.action(); };
  card.append(close, icon, body, go);
  document.body.appendChild(card);
}

let welcomeVersion = 1;
async function showWelcomePopup() {
  const popup = document.getElementById('welcomePopup');
  if (!popup || window.self !== window.top) return false;
  const kaynak = new URLSearchParams(location.search).get('kaynak');
  if (kaynak && Object.prototype.hasOwnProperty.call(LANDINGS, kaynak)) { showLandingCard(kaynak); return false; }
  let w = {};
  try {
    const res = await fetch('/api/welcome');
    if (res.ok) w = await res.json();
  } catch {}
  if (w.enabled === false) return false;
  welcomeVersion = Number(w.version) || 1;
  let seen = 0;
  try { seen = Number(localStorage.getItem('welcomeSeen')) || 0; } catch {}
  if (seen >= welcomeVersion) return false;
  if (w.image) document.getElementById('welcomeImage').src = w.image;
  if (w.title) document.getElementById('welcomeTitle').textContent = w.title;
  if (typeof w.text === 'string') document.getElementById('welcomeText').textContent = w.text;
  if (w.button) document.getElementById('welcomeButton').textContent = w.button;
  popup.classList.add('open');
  return true;
}

function closeWelcomePopup() {
  const popup = document.getElementById('welcomePopup');
  if (popup) {
    popup.classList.remove('open');
  }
  try { localStorage.setItem('welcomeSeen', String(welcomeVersion)); } catch {}
  startInitialMapAutoClose();
}

function closeWelcomePopupOnBg(e) {
  if (e.target === e.currentTarget) {
    closeWelcomePopup();
  }
}

// ── Canlı Aktivite Log Akışı (Activity Logger) ───────────────────────
function logActivity(text, isReal = false) {
  // Kayıt, ekranda gösterim kutusu olmasa da yönetim paneline gönderilir
  if (isReal) saveActivityToBackend(text);
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
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'NEWHAL_OPEN_NOTIFICATION') openNotifications();
    else if (event.data?.type === 'NEWHAL_OPEN_MESSAGES') openMessages();
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

// Menüdeki kalıcı "Uygulamayı Yükle": bant kapatılmış olsa da her zaman çalışır
async function installFromMenu() {
  if (isStandaloneApp()) return showToast('NewHal zaten uygulama olarak açık', 'success');
  if (deferredInstallPrompt) return installApp();
  try { localStorage.removeItem('installDismissedUntil'); } catch {}
  const banner = document.getElementById('installBanner');
  const hint = document.getElementById('installBannerHint');
  if (isIos()) {
    hint.textContent = 'Safari\'de alttaki Paylaş ⬆️ simgesine, sonra "Ana Ekrana Ekle"ye dokun';
  } else if (/android/i.test(navigator.userAgent)) {
    hint.textContent = 'Chrome\'da sağ üstteki ⋮ menüsüne, sonra "Ana ekrana ekle" ya da "Uygulamayı yükle"ye dokun';
  } else {
    hint.textContent = 'Adres çubuğunun sağındaki yükle simgesine ya da tarayıcı menüsünden "Uygulamayı yükle"ye tıkla';
  }
  banner.hidden = false;
}

// Uygulama olarak açıldıysa menüdeki düğmeyi gizle
if (isStandaloneApp()) {
  document.querySelectorAll('.install-nav-link').forEach(el => { el.hidden = true; });
}


// ── İlanlar (yönetici ekler, herkes görür) ────────────────────
async function loadAds() {
  try {
    const [res, settingsRes] = await Promise.all([fetch('/api/ads'), fetch('/api/ad-story-settings').catch(() => null)]);
    if (!res.ok) return;
    if (settingsRes && settingsRes.ok) {
      const settings = await settingsRes.json();
      adStorySettings = {
        enabled: settings.enabled !== false,
        days: Math.min(30, Math.max(1, Number(settings.days) || 7)),
        groupSize: Math.min(50, Math.max(1, Number(settings.groupSize) || 10)),
      };
    }
    renderAds(await res.json());
    openAdFromLink();
  } catch (err) {
    console.error('İlanlar yüklenemedi:', err);
  }
}

// WhatsApp/Facebook'ta paylaşılan "?ilan=..." bağlantısı: ilana kaydır ve büyük pencerede aç
let adLinkHandled = false;
function openAdFromLink() {
  if (adLinkHandled) return;
  adLinkHandled = true;
  const id = new URLSearchParams(location.search).get('ilan');
  if (!id) return;
  const ad = allAds.find(a => a.id === id);
  if (isMapFullscreen()) toggleMapFullscreen(false);
  document.getElementById('adsSection').scrollIntoView();
  if (ad) openAdViewer(ad, 0);
  else showToast('Bu ilan artık yayında değil', 'error');
}

function showAds() {
  if (isMapFullscreen()) toggleMapFullscreen(false);
  document.getElementById('adsSection').scrollIntoView({ behavior: 'smooth' });
}

let allAds = [];
let adStorySettings = { enabled: true, days: 7, groupSize: 10 };
let adsQuery = '';

// ── Görsel hava durumu kartı (ilk ekranda) ───────────────────
// Çizimler sabit SVG; tür adı sunucudan gelse de yalnızca bu listeden seçilir
const WEATHER_SVG = (() => {
  const sun = '<circle cx="24" cy="24" r="9" fill="#fbbf24"/><g stroke="#fbbf24" stroke-width="3" stroke-linecap="round"><path d="M24 5v5M24 38v5M5 24h5M38 24h5M10.6 10.6l3.5 3.5M33.9 33.9l3.5 3.5M10.6 37.4l3.5-3.5M33.9 14.1l3.5-3.5"/></g>';
  const moon = '<path d="M30 8a15 15 0 1 0 10 25A13 13 0 0 1 30 8z" fill="#fde68a"/>';
  const cloud = (fill = '#e2e8f0') => `<path d="M15 38h20a8 8 0 0 0 0-16 11 11 0 0 0-21-2 9 9 0 0 0 1 18z" fill="${fill}"/>`;
  const smallSun = '<g transform="translate(-6 -8) scale(.8)">' + sun + '</g>';
  const smallMoon = '<g transform="translate(-8 -9) scale(.8)">' + moon + '</g>';
  const drops = '<g stroke="#38bdf8" stroke-width="3" stroke-linecap="round"><path d="M17 41l-2 5M25 41l-2 5M33 41l-2 5"/></g>';
  return {
    clear: n => n ? moon : sun,
    partly: n => (n ? smallMoon : smallSun) + cloud(),
    cloudy: () => '<path d="M28 30h12a6 6 0 0 0 0-12 8 8 0 0 0-15-1" fill="#94a3b8"/>' + cloud(),
    rain: () => '<g transform="translate(0 -4)">' + cloud('#cbd5e1') + '</g>' + drops,
    storm: () => '<g transform="translate(0 -4)">' + cloud('#94a3b8') + '</g><path d="M26 34l-6 9h5l-3 7 9-11h-5l3-5z" fill="#fbbf24"/>',
    snow: () => '<g transform="translate(0 -4)">' + cloud() + '</g><g fill="#f8fafc"><circle cx="17" cy="44" r="2"/><circle cx="25" cy="46" r="2"/><circle cx="33" cy="44" r="2"/></g>',
    fog: () => '<g stroke="#cbd5e1" stroke-width="3" stroke-linecap="round"><path d="M8 18h32M5 25h38M10 32h28M14 39h20"/></g>',
  };
})();

function weatherIcon(kind, night, size) {
  const draw = WEATHER_SVG[kind] || WEATHER_SVG.partly;
  const span = document.createElement('span');
  span.className = 'weather-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 48 48">${draw(night)}</svg>`;
  return span;
}

// Havaya göre etiketler: ölçümler + hal esnafı için kısa öneriler
function weatherTags(w) {
  const kind = w.kind || 'partly';
  const high = Number(w.high), low = Number(w.low), wind = w.wind === null ? NaN : Number(w.wind);
  const tags = [{ text: `${high}° / ${low}°`, tone: 'info' }];
  if (Number.isFinite(wind)) tags.push({ text: `Rüzgâr ${wind} km/sa`, tone: 'info' });
  if (kind === 'storm') tags.push({ text: 'Fırtına: açık alanda dikkat', tone: 'warn' });
  if (kind === 'rain' || kind === 'storm') tags.push({ text: 'Ürünleri örtün', tone: 'warn' }, { text: 'Yükleme alanı kaygan olabilir', tone: 'warn' });
  if (kind === 'snow') tags.push({ text: 'Kar: yollar kapanabilir', tone: 'warn' });
  if (kind === 'fog') tags.push({ text: 'Sis: yolda dikkatli sürün', tone: 'warn' });
  if (high >= 30) tags.push({ text: 'Sıcak: soğuk zincir önerilir', tone: 'warn' }, { text: 'Sabah erken sevkiyat', tone: 'good' });
  if (low <= 3) tags.push({ text: 'Don riski: hassas ürünleri koruyun', tone: 'warn' });
  if (wind >= 40) tags.push({ text: 'Kuvvetli rüzgâr: brandaları sabitleyin', tone: 'warn' });
  if ((kind === 'clear' || kind === 'partly') && high < 30 && low > 3 && !(wind >= 40)) {
    tags.push({ text: 'Sevkiyata uygun hava', tone: 'good' }, { text: 'Açık tezgâh için ideal', tone: 'good' });
  }
  return tags;
}

function buildWeatherPanel(w) {
  const box = document.createElement('div');
  box.className = 'weather-panel';
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const night = nowHour >= 19 || nowHour < 6;

  const main = document.createElement('div');
  main.className = 'weather-main';
  main.appendChild(weatherIcon(w.kind, night, 72));
  const info = document.createElement('div');
  info.className = 'weather-info';
  const place = document.createElement('span');
  place.className = 'weather-place';
  place.textContent = `Mersin · ${w.formattedDate || 'Bugün'}`;
  const desc = document.createElement('strong');
  desc.className = 'weather-desc';
  desc.textContent = w.description || 'Hava durumu';
  const temps = document.createElement('span');
  temps.className = 'weather-temps';
  const high = document.createElement('span');
  high.className = 'weather-high';
  high.textContent = `${Number(w.high)}°`;
  const low = document.createElement('span');
  low.className = 'weather-low';
  low.textContent = ` / ${Number(w.low)}°`;
  temps.append(high, low);
  info.append(place, desc, temps);
  if (Number.isFinite(Number(w.wind)) && w.wind !== null) {
    const wind = document.createElement('span');
    wind.className = 'weather-wind';
    wind.textContent = `Rüzgâr en fazla ${Number(w.wind)} km/sa`;
    info.appendChild(wind);
  }
  main.appendChild(info);
  box.appendChild(main);

  const hours = Array.isArray(w.hours) ? w.hours : [];
  if (hours.length) {
    const list = document.createElement('ol');
    list.className = 'weather-hours';
    list.setAttribute('aria-label', 'Saatlik tahmin');
    // Şu anki 3 saatlik dilim vurgulanır
    const current = hours.reduce((best, h) => (h.hour <= nowHour ? h : best), null);
    for (const h of hours) {
      const li = document.createElement('li');
      if (h === current) li.className = 'is-now';
      const label = document.createElement('span');
      label.className = 'weather-hour';
      label.textContent = h === current ? 'Şimdi' : `${String(h.hour).padStart(2, '0')}:00`;
      const temp = document.createElement('span');
      temp.className = 'weather-hour-temp';
      temp.textContent = `${Number(h.temp)}°`;
      li.append(label, weatherIcon(h.kind, h.hour >= 19 || h.hour < 6, 30), temp);
      list.appendChild(li);
    }
    box.appendChild(list);
  }

  const tags = document.createElement('ul');
  tags.className = 'weather-tags';
  tags.setAttribute('aria-label', 'Hava durumu etiketleri');
  for (const t of weatherTags(w)) {
    const li = document.createElement('li');
    li.className = `weather-tag tone-${t.tone}`;
    li.textContent = t.text;
    tags.appendChild(li);
  }
  box.appendChild(tags);
  return box;
}

function renderAds(ads) {
  allAds = ads;
  refreshStories();
  // Alan hep görünür: ilan yokken de kullanıcılar "İlan Ver" diyebilsin
  document.getElementById('adsSection').hidden = false;
  document.querySelectorAll('.ads-nav-link').forEach(el => { el.hidden = false; });
  document.getElementById('adsEmpty').hidden = ads.some(ad => !ad.weather);
  renderAdsGrid();
  renderAdsTicker();
}

// ── Kayan ilan şeridi (vitrinin üstünde, sağdan sola) ─────────
const TICKER_MAX_ADS = 25;
const TICKER_SPEED = 70;          // saniyede kayan piksel

function renderAdsTicker() {
  const box = document.getElementById('adsTicker');
  const track = document.getElementById('adsTickerTrack');
  const ads = allAds.filter(ad => !ad.weather).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, TICKER_MAX_ADS);
  box.hidden = !ads.length;
  track.innerHTML = '';
  if (!ads.length) return;
  // Kesintisiz akış için liste iki kez yan yana dizilir, şerit yarısı kadar kayınca başa döner
  for (let copy = 0; copy < 2; copy++) {
    ads.forEach(ad => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ads-ticker-item';
      if (copy) item.setAttribute('aria-hidden', 'true'), item.tabIndex = -1;
      const text = [ad.title, String(ad.body || '').replace(/\s+/g, ' ')].filter(Boolean).join(' · ').slice(0, 140);
      item.innerHTML = `${ad.no ? `<b>#${ad.no}</b> ` : ''}${escHtml(text || 'İlan')}`;
      item.onclick = () => openAdViewer(ad, 0);
      track.appendChild(item);
    });
  }
  requestAnimationFrame(() => {
    track.style.animationDuration = `${Math.max(20, Math.round(track.scrollWidth / 2 / TICKER_SPEED))}s`;
  });
}

// Başlık ve metinde arar; telefon numarası rakamlarla da bulunur ("0537 032" = "+90 537 032")
function adMatchesSearch(ad, query) {
  const noMatch = query.trim().match(/^#?\s*(\d{4,6})$/);
  if (noMatch && ad.no === Number(noMatch[1])) return true;
  const text = normalizeSearch(`${ad.title || ''} ${ad.body || ''}`);
  const digits = `${ad.title || ''} ${ad.body || ''}`.replace(/\D/g, '');
  return normalizeSearch(query).split(' ').every(word => {
    if (text.includes(word)) return true;
    const d = word.replace(/\D/g, '').replace(/^0/, '');
    return d.length >= 3 && word.replace(/\d/g, '') === '' && digits.includes(d);
  });
}

function renderAdsGrid() {
  const grid = document.getElementById('adsGrid');
  const info = document.getElementById('adsSearchInfo');
  grid.innerHTML = '';
  // Arama yokken vitrin ilanları üstteki vitrinde, altta tekrar edilmez
  const regularAds = allAds.filter(ad => !ad.weather);
  const featured = allAds.filter(ad => ad.featured);
  renderVitrin(adsQuery ? [] : featured);
  const list = adsQuery
    ? regularAds.filter(ad => adMatchesSearch(ad, adsQuery)).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0))
    : regularAds.filter(ad => !ad.featured);
  // Telefonda liste sayfanın akışında 6'şar 6'şar açılır (iç kaydırma kutusu parmağı tuzağa düşürüyordu)
  if (adsShownQuery !== adsQuery) { adsShownQuery = adsQuery; adsMobileShown = ADS_MOBILE_PAGE; }
  const shown = isAdsMobile() ? list.slice(0, adsMobileShown) : list;
  shown.forEach(ad => grid.appendChild(buildAdCard(ad)));
  // Sponsorlu kartlar 6., 12. … sıraya (daha az ilan varsa ilki sona) girer
  insertGridSponsors(grid, shown.length);
  grid.scrollTop = 0;
  fitAdsGridRows();
  renderAdsMoreButton(list.length - shown.length);
  info.hidden = !adsQuery;
  info.textContent = list.length
    ? `"${adsQuery}" için ${list.length} ilan bulundu`
    : `"${adsQuery}" için ilan bulunamadı`;
}

// Telefonda sayfalama: iç kaydırma yok, "Daha fazla ilan göster" ile 6'şar ilan açılır
const ADS_MOBILE_PAGE = 6;
let adsMobileShown = ADS_MOBILE_PAGE;
let adsShownQuery = null;
const isAdsMobile = () => window.matchMedia('(max-width: 768px)').matches;

function renderAdsMoreButton(remaining) {
  let btn = document.getElementById('adsMoreBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'adsMoreBtn';
    btn.className = 'ads-more-btn';
    btn.addEventListener('click', () => {
      const grid = document.getElementById('adsGrid');
      const before = grid.children.length;
      adsMobileShown += ADS_MOBILE_PAGE;
      const keepY = window.scrollY;
      renderAdsGrid();
      // Liste yeniden çizilince sayfa yerinde kalsın, yeni ilk kart klavyeyle de bulunabilsin
      window.scrollTo(0, keepY);
      grid.children[before]?.querySelector('a,button,[tabindex]')?.focus({ preventScroll: true });
    });
    document.getElementById('adsGrid').insertAdjacentElement('afterend', btn);
  }
  btn.hidden = remaining <= 0;
  btn.textContent = `Daha fazla ilan göster (${remaining} ilan daha)`;
}

// Masaüstünde liste en fazla 2 satır yüksekliğinde; fazlası kutunun içinde kaydırılır.
// Telefonda iç kaydırma yoktur: parmak listenin üstündeyken de sayfa kayar.
const ADS_VISIBLE_ROWS = 2;

// Duvar (masonry) düzeni: her kart kendi boyu kadar yer kaplar, kısa kartların altında boşluk kalmaz.
// Izgara 2 px'lik ince satırlara bölünür; her kart boyuna göre o kadar satır kaplar.
const ADS_MASONRY_ROW = 2;
const ADS_GAP = 18;

function layoutAdsMasonry(grid) {
  const cards = [...grid.children];
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  const on = cols > 1;
  grid.classList.toggle('masonry', on);
  for (const card of cards) {
    card.style.gridRowEnd = on ? `span ${Math.ceil((card.offsetHeight + ADS_GAP) / ADS_MASONRY_ROW)}` : '';
  }
  return cols;
}

function fitAdsGridRows() {
  const grid = document.getElementById('adsGrid');
  const cols = layoutAdsMasonry(grid);
  if (isAdsMobile()) {
    grid.classList.remove('scrollable');
    grid.style.maxHeight = '';
    return;
  }
  // Kutu yaklaşık 2 kart boyu gösterir, fazlası içinde kaydırılır; en fazla ekranın %80'i
  const cards = [...grid.children];
  const scrollable = cards.length > cols * ADS_VISIBLE_ROWS;
  grid.classList.toggle('scrollable', scrollable);
  const top0 = cards.length ? Math.min(...cards.map(c => c.offsetTop)) : 0;
  const rowsHeight = scrollable
    ? Math.max(...cards.slice(0, cols * ADS_VISIBLE_ROWS).map(c => c.offsetTop + c.offsetHeight)) - top0 + 4
    : 0;
  grid.style.maxHeight = scrollable ? `${Math.min(rowsHeight, Math.round(window.innerHeight * 0.8))}px` : '';
}

(() => {
  const grid = document.getElementById('adsGrid');
  if (!grid) return;
  let timer = null;
  const refit = () => { clearTimeout(timer); timer = setTimeout(fitAdsGridRows, 120); };
  // Resimler yüklendikçe kart boyları değişir, ekran döndürülünce sütun sayısı değişir
  grid.addEventListener('load', refit, true);
  window.addEventListener('resize', refit);
  // Kart boyu sonradan değişirse (yorumlar açılınca, video yüklenince) duvar düzeni yenilenir
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(refit);
    new MutationObserver(records => {
      for (const r of records) r.addedNodes.forEach(n => { if (n.nodeType === 1) ro.observe(n); });
    }).observe(grid, { childList: true });
  }
  // Telefon ↔ masaüstü geçişinde (ör. tablet döndürülünce) sayfalama yeniden kurulur
  window.matchMedia('(max-width: 768px)').addEventListener('change', () => renderAdsGrid());
})();

function clearAdsSearch() {
  const input = document.getElementById('adsSearch');
  input.value = '';
  adsQuery = '';
  document.getElementById('adsSearchClear').hidden = true;
  renderAdsGrid();
  input.focus();
}

function initAdsSearch() {
  const input = document.getElementById('adsSearch');
  input.addEventListener('input', () => {
    adsQuery = input.value.trim();
    document.getElementById('adsSearchClear').hidden = !adsQuery;
    renderAdsGrid();
    trackSearch('ads', adsQuery);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.stopPropagation(); clearAdsSearch(); }
  });
}

function buildAdCard(ad) {
  const card = document.createElement('article');
  card.className = 'ad-card';
  const images = ad.images || [];

  if (ad.video && ad.video.type === 'file') {
    const video = document.createElement('video');
    video.className = 'ad-media';
    video.src = ad.video.url;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    if (images[0]) video.poster = images[0];
    card.appendChild(video);
  } else if (ad.video && ad.video.type === 'youtube') {
    // Önce sadece kapak resmi; dokununca video yüklenir (sayfa hızlı açılsın)
    const yt = document.createElement('button');
    yt.type = 'button';
    yt.className = 'ad-media ad-youtube';
    yt.setAttribute('aria-label', 'Videoyu oynat');
    yt.style.backgroundImage = `url("https://i.ytimg.com/vi/${encodeURIComponent(ad.video.id)}/hqdefault.jpg")`;
    yt.innerHTML = '<span class="ad-play">▶</span>';
    yt.onclick = (e) => { e.stopPropagation(); openAdViewer(ad, 0); };
    card.appendChild(yt);
  } else if (images.length) {
    const main = document.createElement('img');
    main.className = 'ad-media';
    main.src = images[0];
    main.alt = ad.title || 'İlan resmi';
    main.loading = 'lazy';
    card.appendChild(main);
  } else {
    // Resimsiz ilan NewHal logosuyla gösterilir
    const logo = document.createElement('img');
    logo.className = 'ad-media ad-logo-media';
    logo.src = AD_LOGO_URL;
    logo.alt = 'NewHal';
    logo.loading = 'lazy';
    card.appendChild(logo);
  }

  // Küçük resimler: videolu ilanda tüm resimler, resimli ilanda birden fazla resim varsa
  const thumbs = ad.video || images.length > 1 ? images : [];
  if (thumbs.length) {
    const strip = document.createElement('div');
    strip.className = 'ad-thumbs';
    thumbs.forEach((url, i) => {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openAdViewer(ad, (ad.video ? 1 : 0) + i); };
      a.appendChild(img);
      strip.appendChild(a);
    });
    card.appendChild(strip);
  }

  const body = document.createElement('div');
  body.className = 'ad-body';
  if (ad.title) {
    const title = document.createElement('h3');
    appendTextWithPhoneLinks(title, ad.title);
    body.appendChild(title);
  }
  if (ad.body) {
    const text = document.createElement('p');
    appendTextWithPhoneLinks(text, ad.body);
    body.appendChild(text);
  }
  body.appendChild(adMetaLine(ad));
  body.appendChild(buildAdEngagement(ad));
  card.appendChild(body);
  if (ad.featured) {
    card.classList.add('is-featured');
    const badge = document.createElement('span');
    badge.className = 'vitrin-badge';
    badge.textContent = '⭐ Vitrin';
    card.prepend(badge);
  }

  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${ad.title || 'İlan'}: büyüt`);
  observeAdView(card, ad);
  card.addEventListener('click', (e) => {
    if (e.target.closest('video')) return;
    openAdViewer(ad, 0);
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAdViewer(ad, 0); }
  });
  return card;
}

function updateAdEngagement(ad, update) {
  Object.assign(ad, update);
  const matching = allAds.find(item => item.id === ad.id);
  if (matching && matching !== ad) Object.assign(matching, update);
}

async function toggleAdLike(ad) {
  const token = readToken('userToken');
  if (!token) return openAuthModal();
  const liked = !ad.liked_by_me;
  try {
    const res = await fetch(`/api/ads/${encodeURIComponent(ad.id)}/likes`, {
      method: liked ? 'POST' : 'DELETE',
      headers: { Authorization: `Bearer ${token.token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return openAuthModal();
    if (!res.ok) throw new Error(data.error || 'Beğeni güncellenemedi');
    updateAdEngagement(ad, { liked_by_me: data.liked, like_count: data.like_count });
    renderAdsGrid();
    if (adViewer && adViewer.ad.id === ad.id) renderAdViewer();
    if (data.liked && data.points_awarded) showToast(`Beğeni için ${data.points_awarded} Para Puan kazandın!`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitAdComment(ad, input, button) {
  const token = readToken('userToken');
  if (!token) return openAuthModal();
  const message = input.value.trim();
  if (!message) return showToast('Önce bir yorum yazın', 'error');
  button.disabled = true;
  try {
    const res = await fetch(`/api/ads/${encodeURIComponent(ad.id)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.token}` },
      body: JSON.stringify({ message }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return openAuthModal();
    if (!res.ok) throw new Error(data.error || 'Yorum gönderilemedi');
    updateAdEngagement(ad, { comments: [data.comment, ...(ad.comments || [])] });
    renderAdsGrid();
    renderAdViewer();
    showToast(data.points_awarded ? `Yorumun için ${data.points_awarded} Para Puan kazandın!` : 'Yorumunuz eklendi', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function buildAdEngagement(ad, detailed = false) {
  const section = document.createElement('section');
  section.className = `ad-engagement${detailed ? ' detailed' : ''}`;
  section.addEventListener('click', event => event.stopPropagation());
  if (ad.weather) return section;

  const actions = document.createElement('div');
  actions.className = 'ad-engagement-actions';
  const like = document.createElement('button');
  like.type = 'button';
  like.className = `ad-like-btn${ad.liked_by_me ? ' is-liked' : ''}`;
  like.textContent = `${ad.liked_by_me ? '♥' : '♡'} Beğen${ad.like_count ? ` (${ad.like_count})` : ''}`;
  like.onclick = () => toggleAdLike(ad);
  actions.appendChild(like);

  const comment = document.createElement('button');
  comment.type = 'button';
  comment.className = 'ad-comment-btn';
  comment.textContent = `💬 Yorum${ad.comments?.length ? ` (${ad.comments.length})` : ''}`;
  comment.onclick = () => openAdViewer(ad, 0);
  actions.appendChild(comment);
  actions.appendChild(buildShareBar(ad, detailed));
  section.appendChild(actions);

  if (!detailed) return section;
  const comments = document.createElement('div');
  comments.className = 'ad-comments';
  const rows = ad.comments || [];
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'ad-comments-empty';
    empty.textContent = 'Henüz yorum yok. İlk yorumu sen yap.';
    comments.appendChild(empty);
  } else {
    rows.forEach(row => {
      const item = document.createElement('div');
      item.className = 'ad-comment';
      const name = document.createElement('strong');
      name.textContent = row.name || 'Kullanıcı';
      const message = document.createElement('span');
      message.textContent = row.message;
      item.append(name, message);
      comments.appendChild(item);
    });
  }
  section.appendChild(comments);

  const form = document.createElement('form');
  form.className = 'ad-comment-form';
  const input = document.createElement('input');
  input.maxLength = 500;
  input.placeholder = 'Yorumunuzu yazın';
  input.setAttribute('aria-label', 'Yorumunuz');
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Gönder';
  form.append(input, send);
  form.onsubmit = event => { event.preventDefault(); submitAdComment(ad, input, send); };
  section.appendChild(form);
  return section;
}

// Resimsiz ilanlarda gösterilen NewHal logosu
const AD_LOGO_URL = '/img/ilan-logo.jpg';

// ── İlan metnindeki telefon numaraları dokununca aranır ───────
// +90 537 032 88 42 · 0537 032 88 42 · 05370328842 · (0324) 234 10 00 · 0 324 234 10 00
const PHONE_IN_TEXT = /(?:\+?90[\s.-]?)?\(?0?\s?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;

// Numarayı arama biçimine çevirir: +90XXXXXXXXXX; uymuyorsa null
function toTelNumber(raw) {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return digits.length === 10 && /^[2-5]/.test(digits) ? '+90' + digits : null;
}

// Metni ekler; içindeki numaraları "tel:" bağlantısı yapar (HTML yorumlamadan, güvenli)
function appendTextWithPhoneLinks(parent, text) {
  let last = 0;
  for (const match of text.matchAll(PHONE_IN_TEXT)) {
    const tel = toTelNumber(match[0]);
    if (!tel) continue;
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const a = document.createElement('a');
    a.href = `tel:${tel}`;
    a.className = 'ad-phone';
    a.textContent = `📞 ${match[0].trim()}`;
    a.addEventListener('click', (e) => e.stopPropagation());   // karttaki büyütmeyi tetiklemesin
    parent.appendChild(a);
    last = match.index + match[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

// ── İlan büyütme penceresi ────────────────────────────────────
let adViewer = null;   // { ad, items, index }

// Pencerede gösterilecek parçalar: önce video (varsa), sonra resimler
function adViewerItems(ad) {
  const items = [];
  if (ad.video) items.push({ kind: ad.video.type === 'youtube' ? 'youtube' : 'video', value: ad.video.type === 'youtube' ? ad.video.id : ad.video.url });
  (ad.images || []).forEach(url => items.push({ kind: 'image', value: url }));
  if (!items.length) items.push({ kind: 'image', value: AD_LOGO_URL, logo: true });
  return items;
}

function ensureAdViewerDom() {
  let el = document.getElementById('adViewer');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'adViewer';
  el.className = 'ad-viewer';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="ad-viewer-box">
      <button type="button" class="ad-viewer-close" aria-label="Kapat">✕</button>
      <div class="ad-viewer-stage">
        <button type="button" class="ad-viewer-nav prev" aria-label="Önceki">‹</button>
        <div class="ad-viewer-media"></div>
        <button type="button" class="ad-viewer-nav next" aria-label="Sonraki">›</button>
        <div class="ad-viewer-count"></div>
      </div>
      <div class="ad-viewer-info"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) closeAdViewer(); });
  el.querySelector('.ad-viewer-close').onclick = closeAdViewer;
  el.querySelector('.prev').onclick = () => stepAdViewer(-1);
  el.querySelector('.next').onclick = () => stepAdViewer(1);
  // Telefonda parmakla sağa/sola kaydırma
  let startX = null;
  const stage = el.querySelector('.ad-viewer-stage');
  stage.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) stepAdViewer(dx < 0 ? 1 : -1);
  });
  return el;
}

function openAdViewer(ad, index) {
  trackOnce('open', ad.id);
  const el = ensureAdViewerDom();
  const firstOpen = !adViewer;
  adViewer = { ad, items: adViewerItems(ad), index: index || 0 };
  renderAdViewer();
  el.hidden = false;
  document.body.classList.add('ad-viewer-open');
  // Telefonun geri tuşu pencereyi kapatsın
  if (firstOpen) history.pushState({ adViewer: true }, '');
  el.querySelector('.ad-viewer-close').focus({ preventScroll: true });
}

function closeAdViewer(fromHistory) {
  const el = document.getElementById('adViewer');
  if (!el || el.hidden) return;
  el.hidden = true;
  el.querySelector('.ad-viewer-media').innerHTML = '';   // videoyu durdur
  document.body.classList.remove('ad-viewer-open');
  adViewer = null;
  if (fromHistory !== true && history.state && history.state.adViewer) history.back();
}

function stepAdViewer(dir) {
  if (!adViewer || adViewer.items.length < 2) return;
  adViewer.index = (adViewer.index + dir + adViewer.items.length) % adViewer.items.length;
  renderAdViewer();
}

function renderAdViewer() {
  const el = document.getElementById('adViewer');
  const { ad, items, index } = adViewer;
  const media = el.querySelector('.ad-viewer-media');
  media.innerHTML = '';
  const item = items[index];
  el.classList.toggle('no-media', !item);
  el.classList.toggle('logo-media', !!(item && item.logo));
  if (item && item.kind === 'image') {
    const img = document.createElement('img');
    img.src = item.value;
    img.alt = ad.title || 'İlan resmi';
    media.appendChild(img);
  } else if (item && item.kind === 'video') {
    const video = document.createElement('video');
    video.src = item.value;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    media.appendChild(video);
  } else if (item && item.kind === 'youtube') {
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.value)}?autoplay=1&rel=0`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.title = ad.title || 'İlan videosu';
    media.appendChild(iframe);
  }
  const multi = items.length > 1;
  el.querySelectorAll('.ad-viewer-nav').forEach(b => { b.hidden = !multi; });
  el.querySelector('.ad-viewer-count').textContent = multi ? `${index + 1} / ${items.length}` : '';

  const info = el.querySelector('.ad-viewer-info');
  info.innerHTML = '';
  if (ad.title) {
    const h = document.createElement('h3');
    appendTextWithPhoneLinks(h, ad.title);
    info.appendChild(h);
  }
  if (ad.body) {
    const p = document.createElement('p');
    appendTextWithPhoneLinks(p, ad.body);
    info.appendChild(p);
  }
  info.appendChild(adMetaLine(ad));
  info.appendChild(buildAdEngagement(ad, true));
}

document.addEventListener('keydown', (e) => {
  if (!adViewer) return;
  if (e.key === 'Escape') { e.stopPropagation(); closeAdViewer(); }
  else if (e.key === 'ArrowRight') stepAdViewer(1);
  else if (e.key === 'ArrowLeft') stepAdViewer(-1);
}, true);

window.addEventListener('popstate', () => { if (adViewer) closeAdViewer(true); });


// ── Telefonla giriş / hesap açma ──────────────────────────────
function setAuthTab(tab) {
  const login = tab === 'login';
  document.getElementById('authTabLogin').classList.toggle('active', login);
  document.getElementById('authTabRegister').classList.toggle('active', !login);
  document.getElementById('loginForm').hidden = !login;
  document.getElementById('registerForm').hidden = login;
  document.getElementById(login ? 'loginPhone' : 'registerName').focus();
}

function onLoggedIn({ token, name, pointsAwarded, referralAwarded }, message) {
  logEvent(/açıldı/.test(message || '') ? 'Yeni üye oldu' : 'Üye girişi yaptı');
  localStorage.setItem('userToken', token);
  localStorage.setItem('userName', name);
  updateAuthUI(name);
  closeAuthModal();
  localStorage.removeItem('newhalReferralCode');
  const reward = pointsAwarded ? ' 100 Para Puan kazandın!' : '';
  const referral = referralAwarded ? ' Davet bağlantısıyla kayıt olduğun için davet eden kişi 100 Para Puan kazandı.' : '';
  showToast(message + reward + referral, 'success');
  loadMyClaims();
  loadPins();
  refreshMessageBadges();
  refreshNotificationBadge();
}

async function authRequest(path, body, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'İşlem yapılamadı');
    return data;
  } finally {
    btn.disabled = false;
  }
}

async function submitLogin(e) {
  e.preventDefault();
  try {
    const data = await authRequest('/api/auth/login', {
      phone: document.getElementById('loginPhone').value,
      password: document.getElementById('loginPassword').value,
    }, document.getElementById('loginSubmit'));
    document.getElementById('loginForm').reset();
    onLoggedIn(data, `✅ Hoş geldin, ${data.name}!`);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitRegister(e) {
  e.preventDefault();
  try {
    const data = await authRequest('/api/auth/register', {
      name: document.getElementById('registerName').value,
      phone: document.getElementById('registerPhone').value,
      password: document.getElementById('registerPassword').value,
      referralCode: localStorage.getItem('newhalReferralCode') || '',
    }, document.getElementById('registerSubmit'));
    document.getElementById('registerForm').reset();
    onLoggedIn(data, `🎉 Hesabınız açıldı. Hoş geldin, ${data.name}!`);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logoutUser() {
  if (!confirm('Çıkış yapmak istiyor musunuz?')) return;
  localStorage.removeItem('userToken');
  localStorage.removeItem('userName');
  location.reload();
}

// ── Profilim ──────────────────────────────────────────────────
let myProfile = null;
let profileAvatarUrl = '';

function avatarHtml(name, url) {
  return url
    ? `<img src="${escHtml(url)}" alt="" referrerpolicy="no-referrer" />`
    : `<span>${escHtml((String(name || '?').trim()[0] || '?').toLocaleUpperCase('tr-TR'))}</span>`;
}

async function openProfileModal() {
  const user = readToken('userToken');
  if (!user) return openAuthModal();
  try {
    const res = await fetch('/api/profile/me', { headers: { 'Authorization': 'Bearer ' + user.token } });
    if (res.status === 401) { logoutSilently(); return openAuthModal(); }
    myProfile = await res.json();
    if (!res.ok) throw new Error(myProfile.error || 'Profil açılamadı');
  } catch (err) {
    return showToast(err.message, 'error');
  }
  profileAvatarUrl = myProfile.avatar;
  document.getElementById('profileAvatar').innerHTML = avatarHtml(myProfile.name, profileAvatarUrl);
  document.getElementById('profilePointsBalance').textContent = `${Number(myProfile.points_balance || 0).toLocaleString('tr-TR')} Para Puan`;
  document.getElementById('profileLevelLabel').textContent = `Seviye ${Number(myProfile.level || 1)}`;
  document.getElementById('profileLevelProgressText').textContent = `${Number(myProfile.level_progress || 0).toLocaleString('tr-TR')} / 1.000 puan`;
  document.getElementById('profileLevelProgressBar').style.width = `${Math.max(0, Math.min(100, Number(myProfile.level_progress || 0) / 10))}%`;
  document.getElementById('profileReferralLink').value = `${location.origin}/?ref=${encodeURIComponent(myProfile.referral_code)}`;
  document.getElementById('profileLoginInfo').textContent = myProfile.login === 'telefon'
    ? `Telefonla giriş: ${myProfile.login_phone}` : `Google ile giriş${myProfile.email ? ': ' + myProfile.email : ''}`;
  document.getElementById('profileName').value = myProfile.name;
  document.getElementById('profileAbout').value = myProfile.about;
  document.getElementById('profileContactPhone').value = myProfile.contact_phone ? '0' + myProfile.contact_phone.slice(3) : '';
  document.getElementById('profileShowPhone').checked = myProfile.show_phone;
  document.getElementById('profilePasswordBox').hidden = myProfile.login !== 'telefon';

  const shops = document.getElementById('profileShops');
  shops.innerHTML = '';
  (myProfile.shops || []).forEach(p => shops.appendChild(profileLink(`${CATEGORY_ICONS[p.category] || '🏪'} ${p.title}`, () => { closeProfileModal(); focusPin(p.id); })));
  document.getElementById('profileShopsBox').hidden = !(myProfile.shops || []).length;

  const mine = allAds.filter(a => a.owner_id === myProfile.id);
  const ads = document.getElementById('profileAds');
  ads.innerHTML = '';
  mine.slice(0, 20).forEach(a => ads.appendChild(profileLink(`#${a.no || ''} ${a.title || 'İlan'}`, () => { closeProfileModal(); openAdViewer(a, 0); })));
  const add = profileLink('➕ Yeni ilan ver / ilanlarımı yönet', () => { closeProfileModal(); openUserAdModal(); });
  add.classList.add('accent');
  ads.appendChild(add);

  const activities = document.getElementById('profileActivities');
  activities.innerHTML = '';
  const recentActivities = myProfile.activities || [];
  if (!recentActivities.length) {
    const empty = document.createElement('p');
    empty.className = 'profile-activities-empty';
    empty.textContent = 'Henüz gösterilecek bir aktivite yok.';
    activities.appendChild(empty);
  } else {
    recentActivities.forEach(activity => {
      const item = document.createElement('div');
      item.className = 'profile-activity';
      const text = document.createElement('span');
      text.textContent = `${activity.icon || '•'} ${activity.label || 'Aktivite'}`;
      const meta = document.createElement('small');
      const date = new Date(activity.created_at).toLocaleString('tr-TR');
      meta.textContent = `${activity.points ? `+${Number(activity.points).toLocaleString('tr-TR')} Para Puan · ` : ''}${date}`;
      item.append(text, meta);
      activities.appendChild(item);
    });
  }

  document.getElementById('profileModal').classList.add('open');
}

async function copyReferralLink() {
  const input = document.getElementById('profileReferralLink');
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('Davet bağlantısı kopyalandı. Yeni üyeye göndererek 100 Para Puan kazanabilirsin.', 'success');
  } catch {
    input.select();
    document.execCommand('copy');
    showToast('Davet bağlantısı kopyalandı.', 'success');
  }
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.remove('open');
  if (bottomNavSection === 'profile') bottomNavSection = bottomNavPreviousSection;
  updateBottomNav();
}

function logoutSilently() {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userName');
}

function profileLink(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'profile-link';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

async function changeProfilePhoto(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const box = document.getElementById('profileAvatar');
  box.classList.add('loading');
  try {
    profileAvatarUrl = await uploadPhoto(file);
    box.innerHTML = avatarHtml(myProfile.name, profileAvatarUrl);
    showToast('Fotoğraf yüklendi, kaydetmeyi unutmayın', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    box.classList.remove('loading');
  }
}

async function saveProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('profileSaveBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/profile/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
      body: JSON.stringify({
        name: document.getElementById('profileName').value,
        about: document.getElementById('profileAbout').value,
        contact_phone: document.getElementById('profileContactPhone').value,
        show_phone: document.getElementById('profileShowPhone').checked,
        avatar: profileAvatarUrl,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');
    localStorage.setItem('userToken', data.token);
    localStorage.setItem('userName', data.name);
    updateAuthUI(data.name);
    closeProfileModal();
    showToast('✅ Profiliniz kaydedildi', 'success');
    loadAds();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function changePassword() {
  const oldEl = document.getElementById('profileOldPass'), newEl = document.getElementById('profileNewPass');
  try {
    const res = await fetch('/api/profile/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
      body: JSON.stringify({ old: oldEl.value, new: newEl.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Şifre değiştirilemedi');
    oldEl.value = ''; newEl.value = '';
    document.getElementById('profilePasswordBox').open = false;
    showToast('✅ Şifreniz değiştirildi', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteMyAccount() {
  const sure = confirm('Hesabınız, ilanlarınız ve profil bilgileriniz kalıcı olarak silinecek. Bu işlem geri alınamaz.\n\nDevam etmek istiyor musunuz?');
  if (!sure) return;
  try {
    const res = await fetch('/api/profile/me', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + localStorage.getItem('userToken') } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Hesap silinemedi');
    logoutSilently();
    alert('Hesabınız ve verileriniz silindi.');
    location.reload();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── Herkese açık profil ──────────────────────────────────────
async function openPublicProfile(id) {
  if (!id) return;
  if (adViewer) closeAdViewer();
  closeProfileModal();
  const body = document.getElementById('publicProfileBody');
  body.innerHTML = '<p class="public-profile-loading">Yükleniyor...</p>';
  document.getElementById('publicProfileModal').classList.add('open');
  try {
    const auth = readToken('userToken');
    const headers = auth ? { Authorization: 'Bearer ' + auth.token } : {};
    const [res, socialRes] = await Promise.all([
      fetch(`/api/users/${encodeURIComponent(id)}`),
      fetch(`/api/users/${encodeURIComponent(id)}/social`, { headers }),
    ]);
    const u = await res.json();
    const socialData = await socialRes.json().catch(() => ({}));
    const social = { ...socialData, enabled: socialRes.ok };
    if (!res.ok) throw new Error(u.error || 'Profil bulunamadı');
    const since = u.created_at ? new Date(u.created_at).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }) : '';
    const tel = u.phone ? u.phone.replace(/\s/g, '') : '';
    const ownProfile = String(readToken('userToken')?.payload.id) === String(u.id);
    body.innerHTML = `
      <div class="public-profile-head">
        <div class="profile-avatar big">${avatarHtml(u.name, u.avatar)}</div>
        <div>
          <h3>${escHtml(u.name)}</h3>
          ${since ? `<small>${escHtml(since)} tarihinden beri üye</small>` : ''}
        </div>
      </div>
      ${u.about ? `<p class="public-profile-about">${escHtml(u.about)}</p>` : ''}
      ${social.enabled ? `<div class="public-social-stats">
        <button type="button" onclick="loadFollowList(${Number(u.id)},'followers')"><strong>${Number(social.followers) || 0}</strong> takipçi</button>
        <button type="button" onclick="loadFollowList(${Number(u.id)},'following')"><strong>${Number(social.following) || 0}</strong> takip</button>
      </div>` : ''}
      ${social.enabled && !ownProfile ? `<div class="public-social-actions">
        <button type="button" class="btn-outline" onclick="toggleUserFollow(${Number(u.id)},${!!social.is_following})">${social.is_following ? 'Takibi Bırak' : 'Takip Et'}</button>
        <button type="button" class="btn-primary" onclick="startPrivateMessage(${Number(u.id)})">✉ Mesaj Gönder</button>
      </div>` : ''}
      ${tel ? `<a class="btn-primary public-profile-call" href="tel:${escHtml(tel)}">📞 ${escHtml(u.phone)}</a>` : ''}`;
    if ((u.shops || []).length) {
      const h = document.createElement('h4'); h.textContent = '🏪 Dükkanları'; body.appendChild(h);
      const box = document.createElement('div'); box.className = 'profile-links';
      u.shops.forEach(p => box.appendChild(profileLink(`${CATEGORY_ICONS[p.category] || '🏪'} ${p.title}`, () => { closePublicProfile(); focusPin(p.id); })));
      body.appendChild(box);
    }
    const ads = allAds.filter(a => a.owner_id === u.id);
    const h = document.createElement('h4'); h.textContent = `📢 İlanları (${ads.length})`; body.appendChild(h);
    const box = document.createElement('div'); box.className = 'profile-links';
    ads.slice(0, 30).forEach(a => box.appendChild(profileLink(`#${a.no || ''} ${a.title || 'İlan'}`, () => { closePublicProfile(); openAdViewer(a, 0); })));
    if (!ads.length) box.innerHTML = '<p class="field-hint">Şu an yayında ilanı yok.</p>';
    body.appendChild(box);
  } catch (err) {
    body.innerHTML = `<p class="public-profile-loading">${escHtml(err.message)}</p>`;
  }
}

async function toggleUserFollow(id, isFollowing) {
  const auth = readToken('userToken');
  if (!auth) { closePublicProfile(); openAuthModal(); setAuthTab('login'); return; }
  try {
    const res = await fetch(`/api/users/${id}/follow`, {
      method: isFollowing ? 'DELETE' : 'POST',
      headers: { Authorization: 'Bearer ' + auth.token },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Takip işlemi yapılamadı');
    await openPublicProfile(id);
    showToast(isFollowing ? 'Takipten çıktınız' : 'Kullanıcı takip ediliyor', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function loadFollowList(id, list) {
  const body = document.getElementById('publicProfileBody');
  body.innerHTML = '<p class="public-profile-loading">Yükleniyor...</p>';
  try {
    const res = await fetch(`/api/users/${id}/${list}`);
    const users = await res.json();
    if (!res.ok) throw new Error(users.error || 'Liste açılamadı');
    const title = list === 'followers' ? 'Takipçiler' : 'Takip ettikleri';
    body.innerHTML = `<button type="button" class="btn-ghost" onclick="openPublicProfile(${id})">← Profile dön</button><h4>${title}</h4>`;
    if (!users.length) { body.insertAdjacentHTML('beforeend', '<p class="field-hint">Bu liste henüz boş.</p>'); return; }
    const listBox = document.createElement('div'); listBox.className = 'follow-list';
    users.forEach(person => {
      const item = document.createElement('button'); item.type = 'button'; item.className = 'follow-list-item';
      item.innerHTML = `<span class="conversation-avatar">${avatarHtml(person.name, person.avatar)}</span><span>${escHtml(person.name)}</span>`;
      item.onclick = () => openPublicProfile(person.id);
      listBox.appendChild(item);
    });
    body.appendChild(listBox);
  } catch (err) { body.innerHTML = `<p class="public-profile-loading">${escHtml(err.message)}</p>`; }
}

function startPrivateMessage(id) {
  closePublicProfile();
  openMessages(id);
}

function closePublicProfile() {
  document.getElementById('publicProfileModal').classList.remove('open');
}

// ── Takipçiler arası özel mesajlar ────────────────────────────
let activeMessagePartner = null;
let messageRefreshTimer = null;

async function messagesRequest(url, options = {}) {
  const auth = readToken('userToken');
  if (!auth) throw new Error('Giriş yapmak için oturum açın');
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + auth.token, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logoutSilently();
    closeMessages();
    closeNotifications();
    closeMemberSearch();
    openAuthModal();
    throw new Error('Oturumunuz sona erdi. Tekrar giriş yapın.');
  }
  if (!res.ok) throw new Error(data.error || 'İşlem yapılamadı');
  return data;
}

function openMessages(partnerId = null) {
  if (!readToken('userToken')) { openAuthModal(); setAuthTab('login'); return; }
  closeProfileModal();
  closePublicProfile();
  document.getElementById('messagesModal').classList.add('open');
  activeMessagePartner = partnerId ? Number(partnerId) : null;
  if (messageRefreshTimer) clearInterval(messageRefreshTimer);
  if (activeMessagePartner) loadMessageThread(activeMessagePartner);
  else loadConversations();
  messageRefreshTimer = setInterval(() => {
    if (!document.getElementById('messagesModal').classList.contains('open')) return;
    if (activeMessagePartner) {
      if (document.activeElement?.id !== 'directMessageInput') loadMessageThread(activeMessagePartner, true);
    } else loadConversations(true);
  }, 7000);
}

function closeMessages() {
  document.getElementById('messagesModal').classList.remove('open');
  if (messageRefreshTimer) clearInterval(messageRefreshTimer);
  messageRefreshTimer = null;
  activeMessagePartner = null;
}

function refreshMessageBadges() {
  if (!readToken('userToken')) return;
  messagesRequest('/api/messages').then(({ unread }) => {
    ['profileMessageUnreadBadge'].forEach(id => {
      const badge = document.getElementById(id);
      if (!badge) return;
      badge.textContent = unread > 99 ? '99+' : String(unread || '');
      badge.hidden = !unread;
    });
  }).catch(() => {});
}

async function loadConversations(silent = false) {
  const panel = document.getElementById('messagesPanel');
  if (!silent) panel.innerHTML = '<p class="messages-state">Mesajlar yükleniyor...</p>';
  try {
    const { conversations, unread } = await messagesRequest('/api/messages');
    ['profileMessageUnreadBadge'].forEach(id => {
      const badge = document.getElementById(id);
      if (!badge) return;
      badge.textContent = unread > 99 ? '99+' : String(unread || '');
      badge.hidden = !unread;
    });
    if (activeMessagePartner || !document.getElementById('messagesModal').classList.contains('open')) return;
    if (!conversations.length) { panel.innerHTML = '<p class="messages-state">Henüz mesajınız yok. Bir üyenin profilinden mesaj gönderebilirsiniz.</p>'; return; }
    panel.innerHTML = `<div class="conversation-list">${conversations.map(item => `
      <button type="button" class="conversation-item" onclick="loadMessageThread(${Number(item.user_id)})">
        <span class="conversation-avatar">${avatarHtml(item.user.name, item.user.avatar)}</span>
        <span class="conversation-copy"><strong>${escHtml(item.user.name)}</strong><small>${escHtml(item.last_message.body)}</small></span>
        ${item.unread ? `<span class="conversation-unread">${item.unread > 99 ? '99+' : item.unread}</span>` : ''}
      </button>`).join('')}</div>`;
  } catch (err) { if (!silent) panel.innerHTML = `<p class="messages-state">${escHtml(err.message)}</p>`; }
}

async function loadMessageThread(partnerId, silent = false) {
  const panel = document.getElementById('messagesPanel');
  if (!silent) panel.innerHTML = '<p class="messages-state">Konuşma yükleniyor...</p>';
  try {
    const thread = await messagesRequest(`/api/messages/${partnerId}`);
    activeMessagePartner = Number(partnerId);
    if (!document.getElementById('messagesModal').classList.contains('open')) return;
    const messagesHtml = thread.messages.map(message => {
      const own = Number(message.sender_id) === Number(readToken('userToken')?.payload.id);
      const at = new Date(message.created_at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<div class="direct-message${own ? ' mine' : ''}">${escHtml(message.body)}<time>${at}</time></div>`;
    }).join('') || '<p class="messages-state">Konuşmayı başlatmak için ilk mesajı yazın.</p>';
    panel.innerHTML = `<div class="message-thread">
      <div class="message-thread-head"><button type="button" class="message-back" onclick="activeMessagePartner=null; loadConversations()" aria-label="Mesaj listesine dön">‹</button><span class="conversation-avatar">${avatarHtml(thread.user.name, thread.user.avatar)}</span><strong>${escHtml(thread.user.name)}</strong></div>
      <div class="message-thread-messages" id="messageThreadMessages">${messagesHtml}</div>
      <form class="message-compose" onsubmit="sendDirectMessage(event,${Number(partnerId)})">
        <textarea id="directMessageInput" maxlength="2000" rows="1" aria-label="Mesajınız" placeholder="Mesaj yazın..." required></textarea>
        <button class="btn-primary" type="submit">Gönder</button>
      </form>
    </div>`;
    const scroller = document.getElementById('messageThreadMessages');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    refreshMessageBadges();
  } catch (err) { if (!silent) panel.innerHTML = `<p class="messages-state">${escHtml(err.message)}</p>`; }
}

async function sendDirectMessage(event, partnerId) {
  event.preventDefault();
  const input = document.getElementById('directMessageInput');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const body = input.value.trim();
  if (!body) return;
  button.disabled = true;
  try {
    await messagesRequest(`/api/messages/${partnerId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
    await loadMessageThread(partnerId);
    refreshMessageBadges();
  } catch (err) { showToast(err.message, 'error'); }
  finally { button.disabled = false; }
}

// ── Takip ve mesaj bildirimleri ───────────────────────────────
function updateNotificationBadges(unread) {
  ['notificationUnreadBadge', 'mobileNotificationUnreadBadge'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = unread > 99 ? '99+' : String(unread || '');
    badge.hidden = !unread;
  });
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function refreshBrowserNotificationButton() {
  const button = document.getElementById('browserNotificationButton');
  const status = document.getElementById('browserNotificationStatus');
  if (!button || !status) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    button.disabled = true;
    status.textContent = 'Bu tarayıcı bildirim desteği sunmuyor.';
    return;
  }
  if (Notification.permission === 'denied') {
    button.disabled = true;
    status.textContent = 'Bildirim izni tarayıcıda kapalı. NewHal için tarayıcı ayarlarından izin verebilirsin.';
    return;
  }
  button.disabled = false;
  if (Notification.permission === 'granted') {
    try {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      button.textContent = subscription ? 'Tarayıcı bildirimlerini kapat' : 'Tarayıcı bildirimlerini aç';
      status.textContent = subscription
        ? 'Açık. Yeni takip, mesaj ve duyurular tarayıcı bildirimi olarak gelir.'
        : 'Tarayıcı izni var. Bildirim aboneliğini etkinleştir.';
      return;
    } catch {}
  }
  button.textContent = 'Tarayıcı bildirimlerini aç';
  status.textContent = 'Tarayıcı kapalıyken de takip, mesaj ve duyuru bildirimi al.';
}

async function enableBrowserNotifications() {
  const button = document.getElementById('browserNotificationButton');
  if (button) button.disabled = true;
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('Bu tarayıcı bildirim desteği sunmuyor');
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Tarayıcı bildirim izni verilmedi');
    const { publicKey } = await messagesRequest('/api/push/public-key');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await messagesRequest('/api/push/subscriptions', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      showToast('Tarayıcı bildirimleri kapatıldı', 'success');
      return;
    }
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });
    await messagesRequest('/api/push/subscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    showToast('Tarayıcı bildirimleri açıldı', 'success');
  } catch (err) {
    showToast(err.message || 'Tarayıcı bildirimleri açılamadı', 'error');
  } finally {
    if (button) button.disabled = false;
    refreshBrowserNotificationButton();
  }
}

function refreshNotificationBadge() {
  if (!readToken('userToken')) return;
  messagesRequest('/api/notifications').then(({ unread }) => updateNotificationBadges(unread || 0)).catch(() => {});
}

function openNotifications() {
  if (!readToken('userToken')) { openAuthModal(); setAuthTab('login'); return; }
  closeProfileModal();
  closePublicProfile();
  document.getElementById('notificationsModal').classList.add('open');
  refreshBrowserNotificationButton();
  loadNotifications();
}

function closeNotifications() {
  document.getElementById('notificationsModal').classList.remove('open');
}

async function loadNotifications() {
  const list = document.getElementById('notificationsList');
  list.innerHTML = '<p class="notifications-state">Bildirimler yükleniyor...</p>';
  try {
    const { notifications, unread } = await messagesRequest('/api/notifications');
    updateNotificationBadges(unread || 0);
    if (!notifications.length) { list.innerHTML = '<p class="notifications-state">Henüz bildiriminiz yok.</p>'; return; }
    list.innerHTML = notifications.map(item => {
      const kind = item.type;
      const announcement = kind === 'announcement';
      const actorName = item.actor?.name || 'NewHal';
      const action = kind === 'message' ? 'sana mesaj gönderdi.' : 'seni takip etmeye başladı.';
      const when = new Date(item.created_at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<button type="button" class="notification-item${item.read_at ? '' : ' unread'}" onclick="openNotification(${Number(item.id)},'${kind}',${Number(item.actor_id) || 0})">
        <span class="conversation-avatar">${announcement ? '📣' : avatarHtml(actorName, item.actor?.avatar)}</span>
        <span class="notification-copy">${announcement
          ? `<strong>${escHtml(item.title || 'NewHal Duyurusu')}</strong><small class="notification-body">${escHtml(item.body || '')}</small>`
          : `<strong>${escHtml(actorName)}</strong> ${action}`}<small>${when}</small></span>
        ${item.read_at ? '' : '<span class="notification-dot" aria-label="Okunmadı"></span>'}
      </button>`;
    }).join('');
  } catch (err) { list.innerHTML = `<p class="notifications-state">${escHtml(err.message)}</p>`; }
}

async function openNotification(notificationId, type, actorId) {
  try {
    await messagesRequest(`/api/notifications/${notificationId}/read`, { method: 'PATCH' });
    closeNotifications();
    if (type === 'message') openMessages(actorId);
    else if (type === 'follow') openPublicProfile(actorId);
    refreshNotificationBadge();
  } catch (err) { showToast(err.message, 'error'); }
}

// ── Üye arama ─────────────────────────────────────────────────
function openMemberSearch() {
  if (!readToken('userToken')) { openAuthModal(); setAuthTab('login'); return; }
  closeProfileModal();
  closePublicProfile();
  document.getElementById('memberSearchModal').classList.add('open');
  document.getElementById('memberSearchInput').focus();
}

function closeMemberSearch() {
  document.getElementById('memberSearchModal').classList.remove('open');
}

async function searchMembers(event) {
  event.preventDefault();
  const input = document.getElementById('memberSearchInput');
  const results = document.getElementById('memberSearchResults');
  const query = input.value.trim();
  if (query.length < 2) return;
  results.innerHTML = '<p class="messages-state">Üyeler aranıyor...</p>';
  try {
    const params = new URLSearchParams({ q: query });
    const users = await messagesRequest(`/api/members?${params}`);
    if (!users.length) { results.innerHTML = '<p class="messages-state">Bu isimle eşleşen üye bulunamadı.</p>'; return; }
    const list = document.createElement('div');
    list.className = 'follow-list';
    users.forEach(user => {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'follow-list-item member-result';
      item.innerHTML = `<span class="conversation-avatar">${avatarHtml(user.name, user.avatar)}</span><span>${escHtml(user.name)}</span><span class="member-result-arrow">›</span>`;
      item.onclick = () => { closeMemberSearch(); openPublicProfile(user.id); };
      list.appendChild(item);
    });
    results.replaceChildren(list);
  } catch (err) { results.innerHTML = `<p class="messages-state">${escHtml(err.message)}</p>`; }
}


// ── Dükkan hikayeleri: işletmenin ilanı 24 saat haritada dükkanın üzerinde görünür ──
const STORY_IMAGE_MS = 6000;
const STORY_YOUTUBE_MS = 15000;
const STORY_MAX_VIDEO_MS = 60000;
const STORY_SEEN_KEY = 'seenStories';
let story = null;   // açık görüntüleyici: { queue, pinIndex, adIndex, ... }

function readSeenStories() {
  try { return new Set(JSON.parse(localStorage.getItem(STORY_SEEN_KEY) || '[]')); } catch { return new Set(); }
}

function markStorySeen(adId) {
  const seen = readSeenStories();
  if (seen.has(adId)) return;
  seen.add(adId);
  try { localStorage.setItem(STORY_SEEN_KEY, JSON.stringify([...seen].slice(-300))); } catch {}
}

// Dükkan → süresi dolmamış hikaye ilanları (eskiden yeniye)
function storyAdsByPin() {
  const now = Date.now();
  const map = {};
  allAds.filter(ad => !ad.weather && ad.pinId && Date.parse(ad.story_until) > now).forEach(ad => {
    (map[ad.pinId] = map[ad.pinId] || []).push(ad);
  });
  Object.values(map).forEach(list => list.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  return map;
}

// 'new': izlenmemiş hikaye var, 'seen': hepsi izlendi, null: hikaye yok
function storyState(pinId) {
  const list = storyAdsByPin()[pinId];
  if (!list) return null;
  const seen = readSeenStories();
  return list.some(ad => !seen.has(ad.id)) ? 'new' : 'seen';
}

// Hikayesi olan dükkanlar: izlenmemişler önce, sonra en yeni ilan
function storyQueue() {
  const map = storyAdsByPin();
  const seen = readSeenStories();
  const now = Date.now();
  const weekCutoff = now - adStorySettings.days * 24 * 60 * 60 * 1000;
  const weeklyAds = adStorySettings.enabled ? allAds
    .filter(ad => !ad.weather && Date.parse(ad.created_at) >= weekCutoff && Date.parse(ad.created_at) <= now)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)) : [];
  const weekly = [];
  const weeklyGroupSize = adStorySettings.groupSize;
  for (let i = 0; i < weeklyAds.length; i += weeklyGroupSize) {
    const number = weekly.length + 1;
    weekly.push({
      pin: { id: `weekly-${number}`, title: `İlanlar ${number}`, category: '', images: [] },
      ads: weeklyAds.slice(i, i + weeklyGroupSize),
      weekly: true,
      fresh: weeklyAds.slice(i, i + weeklyGroupSize).some(ad => !seen.has(ad.id)),
    });
  }
  const shops = Object.keys(map).map(Number)
    .map(id => ({ pin: allPins.find(p => p.id === id), ads: map[id] }))
    .filter(s => s.pin)
    .map(s => ({ ...s, fresh: s.ads.some(ad => !seen.has(ad.id)) }))
    .sort((a, b) => (b.fresh - a.fresh) || b.ads[b.ads.length - 1].created_at.localeCompare(a.ads[a.ads.length - 1].created_at));
  // Facebook sayfasının hikayeleri hep en sonda (şeridin en sağında)
  const queue = [...weekly, ...shops];
  if (!fbStories.ads.length) return queue;
  return [...queue, { pin: FB_STORY_PIN, ads: fbStories.ads, fb: true, fresh: fbStories.ads.some(ad => !seen.has(ad.id)) }];
}

// ── Facebook sayfasının hikayeleri (halkompleksi33) ──
const FB_STORY_PIN = { id: 'fb', title: 'NewHal', category: '', images: ['/icons/icon-192.png'], verified: true };
let fbStories = { page: null, ads: [] };

async function loadFbStories() {
  try {
    const res = await fetch('/api/fb-stories');
    if (!res.ok) return;
    const data = await res.json();
    fbStories = {
      page: data.page || null,
      // Hikaye görüntüleyicisi ilan biçiminde çalışır: resim ya da video dosyası
      ads: (data.stories || []).map(s => ({
        id: s.id, created_at: s.created_at, title: '', body: '', fb: true, url: s.url, thumb: s.thumb,
        images: s.type === 'photo' ? [s.src] : [],
        video: s.type === 'video' ? { type: 'file', url: s.src } : null,
      })),
    };
    if (!story) renderStoryBar();
  } catch {}
}

function storyThumb(entry) {
  if (entry.fb) return entry.pin.images[0];
  const ad = entry.ads[entry.ads.length - 1];
  return (ad.images && ad.images[0]) || (ad.video && ad.video.type === 'youtube' ? `https://i.ytimg.com/vi/${ad.video.id}/mqdefault.jpg` : null)
    || (entry.pin.images && entry.pin.images[0]) || null;
}

function renderStoryBar() {
  const bar = document.getElementById('storyBar');
  if (!bar) return;
  const queue = storyQueue();
  bar.innerHTML = '';
  bar.hidden = !queue.length;
  queue.forEach(entry => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `story-chip ${entry.fresh ? 'fresh' : 'seen'}`;
    btn.setAttribute('aria-label', `${entry.pin.title} hikayesi`);
    const ring = document.createElement('span');
    ring.className = 'story-ring';
    const inner = document.createElement('span');
    inner.className = 'story-ring-inner';
    const thumb = storyThumb(entry);
    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = '';
      img.loading = 'lazy';
      inner.appendChild(img);
    } else {
      inner.textContent = CATEGORY_ICONS[entry.pin.category] || '🏪';
    }
    ring.appendChild(inner);
    const name = document.createElement('span');
    name.className = 'story-chip-name';
    name.textContent = entry.pin.title;
    btn.append(ring, name);
    btn.onclick = () => openStories(entry.pin.id);
    bar.appendChild(btn);
  });
}

function refreshStories() {
  if (allPins.length) renderPins(allPins);
  renderStoryBar();
}

function ensureStoryDom() {
  let el = document.getElementById('storyViewer');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'storyViewer';
  el.className = 'story-viewer';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="story-frame">
      <div class="story-stage"></div>
      <div class="story-shade top"></div>
      <div class="story-shade bottom"></div>
      <div class="story-bars"></div>
      <div class="story-head">
        <button type="button" class="story-who">
          <span class="story-avatar"></span>
          <span class="story-who-text"><strong class="story-name"></strong><small class="story-time"></small></span>
        </button>
        <button type="button" class="story-close" aria-label="Kapat">✕</button>
      </div>
      <button type="button" class="story-tap prev" aria-label="Önceki"></button>
      <button type="button" class="story-tap next" aria-label="Sonraki"></button>
      <div class="story-caption"></div>
      <div class="story-actions"></div>
    </div>`;
  document.body.appendChild(el);

  el.querySelector('.story-close').onclick = () => closeStories();
  el.querySelector('.story-who').onclick = () => {
    const entry = story && story.queue[story.pinIndex];
    if (!entry) return;
    if (entry.fb) { pauseStory(true); if (fbStories.page) window.open(fbStories.page.url, '_blank', 'noopener'); return; }
    if (entry.weekly) { const ad = currentStoryAd(); closeStories(() => openAdViewer(ad, 0)); return; }
    closeStories(() => showPinDetail(entry.pin.id));
  };
  // Dokun: sağ ileri, sol geri; basılı tut: dur
  ['prev', 'next'].forEach(side => {
    const tap = el.querySelector(`.story-tap.${side}`);
    tap.addEventListener('pointerdown', () => { if (story) { story.holdAt = Date.now(); pauseStory(true); } });
    tap.addEventListener('pointerup', () => {
      if (!story) return;
      const held = Date.now() - (story.holdAt || 0) > 300;
      pauseStory(false);
      if (!held) side === 'next' ? stepStory(1) : stepStory(-1);
    });
    tap.addEventListener('pointerleave', () => { if (story && story.paused) pauseStory(false); });
    tap.addEventListener('contextmenu', e => e.preventDefault());
  });
  // Aşağı kaydır: kapat
  let startY = null;
  el.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (startY !== null && e.changedTouches[0].clientY - startY > 90) closeStories();
    startY = null;
  });
  document.addEventListener('keydown', e => {
    if (!story) return;
    if (e.key === 'Escape') closeStories();
    else if (e.key === 'ArrowRight') stepStory(1);
    else if (e.key === 'ArrowLeft') stepStory(-1);
  });
  document.addEventListener('visibilitychange', () => { if (story) pauseStory(document.hidden); });
  return el;
}

function openStories(pinId) {
  // Seçilen dükkan önce, ardından izlenmemiş diğer dükkanlar
  const all = storyQueue();
  const start = all.find(s => s.pin.id === pinId);
  if (!start) return;
  const queue = [start, ...all.filter(s => s !== start && s.fresh)];
  const pinIndex = 0;
  const el = ensureStoryDom();
  const seen = readSeenStories();
  const firstNew = queue[pinIndex].ads.findIndex(ad => !seen.has(ad.id));
  story = { queue, pinIndex, adIndex: Math.max(0, firstNew), elapsed: 0, paused: false, pushed: false };
  el.hidden = false;
  document.body.classList.add('story-open');
  // Telefonun geri tuşu hikayeyi kapatsın
  history.pushState({ story: true }, '');
  story.pushed = true;
  showStoryItem();
}

function currentStoryAd() {
  return story && story.queue[story.pinIndex].ads[story.adIndex];
}

function storyAgo(iso) {
  const min = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 60 ? `${min} dk önce` : `${Math.round(min / 60)} saat önce`;
}

function showStoryItem() {
  const el = ensureStoryDom();
  const entry = story.queue[story.pinIndex];
  const ad = currentStoryAd();
  const pin = entry.pin;
  markStorySeen(ad.id);
  if (!ad.fb) trackOnce('view', ad.id);

  // Üstteki ilerleme çubukları
  const bars = el.querySelector('.story-bars');
  bars.innerHTML = entry.ads.map((_, i) =>
    `<span class="story-bar-track"><span class="story-bar-fill" style="width:${i < story.adIndex ? 100 : 0}%"></span></span>`).join('');

  const avatar = el.querySelector('.story-avatar');
  avatar.innerHTML = '';
  if (pin.images && pin.images[0]) {
    const img = document.createElement('img');
    img.src = pin.images[0];
    img.alt = '';
    avatar.appendChild(img);
  } else {
    avatar.textContent = CATEGORY_ICONS[pin.category] || '🏪';
  }
  el.querySelector('.story-name').innerHTML = escHtml(pin.title) + verifiedBadge(pin);
  el.querySelector('.story-time').textContent = storyAgo(ad.created_at);

  // Medya: resim, video, YouTube ya da yazı kartı
  const stage = el.querySelector('.story-stage');
  stage.innerHTML = '';
  stage.className = 'story-stage';
  story.duration = STORY_IMAGE_MS;
  story.video = null;
  const caption = el.querySelector('.story-caption');
  const weatherCard = ad.weather && typeof ad.weather === 'object';
  const textOnly = !weatherCard && !(ad.images && ad.images.length) && !ad.video;

  if (weatherCard) {
    stage.classList.add('weather-card');
    const panel = document.createElement('div');
    panel.className = 'weather-story-panel';
    const city = document.createElement('span');
    city.className = 'weather-story-city';
    city.textContent = 'MERSİN';
    const date = document.createElement('span');
    date.className = 'weather-story-date';
    date.textContent = String(ad.weather.formattedDate || 'Bugün');
    const icon = document.createElement('span');
    icon.className = 'weather-story-icon';
    icon.textContent = String(ad.weather.icon || '🌤️');
    const description = document.createElement('strong');
    description.className = 'weather-story-description';
    description.textContent = String(ad.weather.description || 'Hava durumu');
    const temperatures = document.createElement('div');
    temperatures.className = 'weather-story-temperatures';
    temperatures.innerHTML = `<span>↑ ${Number(ad.weather.high)}°</span><span>↓ ${Number(ad.weather.low)}°</span>`;
    panel.append(city, date, icon, description, temperatures);
    stage.appendChild(panel);
  } else if (ad.video && ad.video.type === 'file') {
    const v = document.createElement('video');
    v.src = ad.video.url;
    v.playsInline = true;
    v.autoplay = true;
    v.muted = false;
    v.preload = 'auto';
    if (ad.thumb) v.poster = ad.thumb;
    v.onloadedmetadata = () => { if (story && story.video === v) story.duration = Math.min(STORY_MAX_VIDEO_MS, (v.duration || 6) * 1000); };
    v.onended = () => { if (story && story.video === v) stepStory(1); };
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });   // sesli başlamazsa sessiz oynat
    stage.appendChild(v);
    story.video = v;
    story.duration = STORY_MAX_VIDEO_MS;
  } else if (ad.video && ad.video.type === 'youtube') {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ad.video.id)}?autoplay=1&playsinline=1&controls=0&rel=0`;
    f.allow = 'autoplay; encrypted-media';
    f.title = ad.title || 'Video';
    stage.appendChild(f);
    story.duration = STORY_YOUTUBE_MS;
  } else if (!textOnly) {
    const img = document.createElement('img');
    img.src = ad.images[0];
    img.alt = ad.title || '';
    const blur = document.createElement('div');
    blur.className = 'story-blur';
    blur.style.backgroundImage = `url("${ad.images[0].replace(/"/g, '%22')}")`;
    stage.append(blur, img);
  } else {
    stage.classList.add('text-card');
  }

  caption.className = `story-caption${textOnly ? ' big' : ''}`;
  const body = String(ad.body || '');
  caption.innerHTML = `${ad.title ? `<strong>${escHtml(ad.title)}</strong>` : ''}${body ? `<p>${escHtml(textOnly ? body.slice(0, 400) : body.slice(0, 160))}${body.length > (textOnly ? 400 : 160) ? '…' : ''}</p>` : ''}`;

  // Alttaki tuşlar: ilanı aç, ara, dükkan
  const actions = el.querySelector('.story-actions');
  actions.innerHTML = '';
  if (weatherCard) {
    const sourceBtn = document.createElement('a');
    sourceBtn.className = 'story-action primary';
    sourceBtn.href = 'https://api.met.no/weatherapi/locationforecast/2.0/documentation';
    sourceBtn.target = '_blank';
    sourceBtn.rel = 'noopener';
    sourceBtn.textContent = '🌦️ MET Norway kaynağı';
    sourceBtn.onclick = () => pauseStory(true);
    actions.appendChild(sourceBtn);
    const licenseBtn = document.createElement('a');
    licenseBtn.className = 'story-action';
    licenseBtn.href = 'https://creativecommons.org/licenses/by/4.0/';
    licenseBtn.target = '_blank';
    licenseBtn.rel = 'noopener';
    licenseBtn.textContent = 'CC BY 4.0';
    licenseBtn.onclick = () => pauseStory(true);
    actions.appendChild(licenseBtn);
    story.elapsed = 0;
    story.startedAt = performance.now();
    story.paused = false;
    cancelAnimationFrame(story.raf);
    story.raf = requestAnimationFrame(tickStory);
    return;
  }
  if (ad.fb) {
    const fbBtn = document.createElement('a');
    fbBtn.className = 'story-action primary';
    fbBtn.href = (fbStories.page && fbStories.page.url) || 'https://www.facebook.com/halkompleksi33';
    fbBtn.target = '_blank';
    fbBtn.rel = 'noopener';
    fbBtn.textContent = '👍 Facebook';
    fbBtn.onclick = () => pauseStory(true);
    actions.appendChild(fbBtn);
    const waBtn = document.createElement('a');
    waBtn.className = 'story-action';
    waBtn.href = document.querySelector('.ads-wa-btn').href;
    waBtn.target = '_blank';
    waBtn.rel = 'noopener';
    waBtn.textContent = '💬 WhatsApp';
    waBtn.onclick = () => pauseStory(true);
    actions.appendChild(waBtn);
    story.elapsed = 0;
    story.startedAt = performance.now();
    story.paused = false;
    cancelAnimationFrame(story.raf);
    story.raf = requestAnimationFrame(tickStory);
    return;
  }
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'story-action primary';
  openBtn.textContent = '📄 İlanı Aç';
  openBtn.onclick = () => { const a = currentStoryAd(); closeStories(() => openAdViewer(a, 0)); };
  actions.appendChild(openBtn);
  const phone = (showContactInfo && pin.phone) || (String(ad.body || '').match(/(\+?90\s?)?0?\s?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/) || [])[0];
  if (phone) {
    const call = document.createElement('a');
    call.className = 'story-action';
    call.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
    call.textContent = '📞 Ara';
    call.onclick = () => pauseStory(true);
    actions.appendChild(call);
  }
  if (!entry.weekly) {
    const shopBtn = document.createElement('button');
    shopBtn.type = 'button';
    shopBtn.className = 'story-action';
    shopBtn.textContent = '🏪 Dükkan';
    shopBtn.onclick = () => closeStories(() => showPinDetail(pin.id));
    actions.appendChild(shopBtn);
  }

  story.elapsed = 0;
  story.startedAt = performance.now();
  story.paused = false;
  cancelAnimationFrame(story.raf);
  story.raf = requestAnimationFrame(tickStory);
}

function tickStory(now) {
  if (!story) return;
  if (!story.paused) {
    const elapsed = story.video && story.duration !== STORY_MAX_VIDEO_MS
      ? story.video.currentTime * 1000
      : story.elapsed + (now - story.startedAt);
    const fill = document.querySelectorAll('#storyViewer .story-bar-fill')[story.adIndex];
    if (fill) fill.style.width = `${Math.min(100, elapsed / story.duration * 100)}%`;
    if (elapsed >= story.duration) return stepStory(1);
  }
  story.raf = requestAnimationFrame(tickStory);
}

function pauseStory(on) {
  if (!story || story.paused === on) return;
  if (on) story.elapsed += performance.now() - story.startedAt;
  else story.startedAt = performance.now();
  story.paused = on;
  if (story.video) on ? story.video.pause() : story.video.play().catch(() => {});
}

function stepStory(dir) {
  if (!story) return;
  const entry = story.queue[story.pinIndex];
  let { pinIndex, adIndex } = story;
  adIndex += dir;
  if (adIndex >= entry.ads.length) { pinIndex++; adIndex = 0; }
  else if (adIndex < 0) { pinIndex--; adIndex = 0; }
  if (pinIndex < 0) { adIndex = 0; pinIndex = 0; }
  if (pinIndex >= story.queue.length) return closeStories();
  story.pinIndex = pinIndex;
  story.adIndex = adIndex;
  showStoryItem();
}

// Kapatır; "then" verilirse kapandıktan sonra çalışır (ilanı ya da dükkanı açmak için)
function closeStories(then) {
  if (!story) return;
  const pushed = story.pushed;
  hideStoryViewer();
  if (pushed && history.state && history.state.story) {
    storyAfterClose = then || null;
    history.back();
  } else if (then) {
    then();
  }
}

let storyAfterClose = null;

function hideStoryViewer() {
  if (!story) return;
  cancelAnimationFrame(story.raf);
  if (story.video) story.video.pause();
  story = null;
  const el = document.getElementById('storyViewer');
  el.hidden = true;
  el.querySelector('.story-stage').innerHTML = '';
  document.body.classList.remove('story-open');
  refreshStories();
}

window.addEventListener('popstate', () => {
  if (story) hideStoryViewer();
  const then = storyAfterClose;
  storyAfterClose = null;
  if (then) setTimeout(then, 0);
});


// ── Vitrin (öne çıkan ilanlar) ────────────────────────────────
const VITRIN_AUTOPLAY_MS = 5000;
let vitrinIndex = 0;
let vitrinTimer = null;

function renderVitrin(ads) {
  const box = document.getElementById('vitrin');
  const track = document.getElementById('vitrinTrack');
  const dots = document.getElementById('vitrinDots');
  clearInterval(vitrinTimer);
  track.innerHTML = '';
  dots.innerHTML = '';
  box.hidden = !ads.length;
  if (!ads.length) return;
  box.classList.toggle('single', ads.length === 1);
  // Günlük hava durumu vitrinin ilk kartı olur
  ads = [...ads].sort((a, b) => (b.weather ? 1 : 0) - (a.weather ? 1 : 0));

  ads.forEach((ad, i) => {
    const slide = document.createElement('article');
    slide.className = 'vitrin-slide';
    slide.tabIndex = 0;
    slide.setAttribute('role', 'button');
    slide.setAttribute('aria-label', `${ad.title || 'Vitrin ilanı'}: büyüt`);
    const weather = ad.weather && typeof ad.weather === 'object' ? ad.weather : null;
    if (weather) {
      const kind = Object.prototype.hasOwnProperty.call(WEATHER_SVG, weather.kind) ? weather.kind : 'partly';
      slide.classList.add('weather-slide', `sky-${kind}`);
      slide.setAttribute('aria-label', 'Mersin günlük hava durumu: büyüt');
      slide.appendChild(buildWeatherPanel(weather));
    } else {
    const cover = (ad.images || [])[0]
      || (ad.video && ad.video.type === 'youtube' ? `https://i.ytimg.com/vi/${encodeURIComponent(ad.video.id)}/hqdefault.jpg` : null)
      || (ad.video ? null : AD_LOGO_URL);
    if (cover === AD_LOGO_URL) slide.classList.add('logo-slide');
    if (cover) {
      const bg = document.createElement('div');
      bg.className = 'vitrin-bg';
      bg.style.backgroundImage = `url("${cover.replace(/"/g, '%22')}")`;
      const img = document.createElement('img');
      img.className = 'vitrin-img';
      img.src = cover;
      img.alt = ad.title || 'Vitrin ilanı';
      img.loading = i === 0 ? 'eager' : 'lazy';
      slide.append(bg, img);
    } else if (ad.video && ad.video.type === 'file') {
      const v = document.createElement('video');
      v.className = 'vitrin-img';
      v.src = ad.video.url;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'metadata';
      slide.appendChild(v);
    } else {
      slide.classList.add('text-only');
    }
    if (ad.video) {
      const play = document.createElement('span');
      play.className = 'vitrin-play';
      play.textContent = '▶';
      slide.appendChild(play);
    }

    const overlay = document.createElement('div');
    overlay.className = 'vitrin-overlay';
    const badges = document.createElement('div');
    badges.className = 'vitrin-badges';
    const badge = document.createElement('span');
    badge.className = 'vitrin-badge';
    badge.textContent = '⭐ Vitrin';
    badges.appendChild(badge);
    if (ad.no) {
      const no = document.createElement('span');
      no.className = 'ad-no ad-no-light';
      no.textContent = `#${ad.no}`;
      badges.appendChild(no);
    }
    if (ad.featured_until) {
      const timer = document.createElement('span');
      timer.className = 'vitrin-timer';
      timer.dataset.until = ad.featured_until;
      timer.textContent = vitrinRemaining(ad.featured_until);
      badges.appendChild(timer);
    }
    overlay.appendChild(badges);
    if (ad.title) {
      const h = document.createElement('h3');
      h.textContent = ad.title;
      overlay.appendChild(h);
    }
    if (ad.body) {
      const p = document.createElement('p');
      appendTextWithPhoneLinks(p, ad.body);
      overlay.appendChild(p);
    }
    const more = document.createElement('span');
    more.className = 'vitrin-more';
    more.textContent = 'İlanı incele →';
    overlay.appendChild(more);
    slide.appendChild(overlay);
    }

    observeAdView(slide, ad);
    slide.addEventListener('click', () => openAdViewer(ad, 0));
    slide.addEventListener('keydown', (e) => { if (e.key === 'Enter') openAdViewer(ad, 0); });
    track.appendChild(slide);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'vitrin-dot';
    dot.setAttribute('aria-label', `${i + 1}. vitrin ilanı`);
    dot.onclick = () => { vitrinGo(i); restartVitrinTimer(); };
    dots.appendChild(dot);
  });

  // Elle kaydırınca göstergeyi güncelle
  track.onscroll = () => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i !== vitrinIndex) { vitrinIndex = i; updateVitrinDots(); }
  };
  ['pointerdown', 'touchstart', 'mouseenter', 'focusin'].forEach(evt =>
    track.addEventListener(evt, () => clearInterval(vitrinTimer), { passive: true }));
  track.addEventListener('mouseleave', restartVitrinTimer);

  vitrinIndex = 0;
  updateVitrinDots();
  restartVitrinTimer();
}

function vitrinGo(i) {
  const track = document.getElementById('vitrinTrack');
  const n = track.children.length;
  if (!n) return;
  vitrinIndex = (i + n) % n;
  track.scrollTo({ left: vitrinIndex * track.clientWidth, behavior: 'smooth' });
  updateVitrinDots();
}

function vitrinStep(dir) {
  vitrinGo(vitrinIndex + dir);
  restartVitrinTimer();
}

function updateVitrinDots() {
  document.querySelectorAll('.vitrin-dot').forEach((d, i) => d.classList.toggle('active', i === vitrinIndex));
}

function restartVitrinTimer() {
  clearInterval(vitrinTimer);
  const n = document.getElementById('vitrinTrack').children.length;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (n > 1 && !reduce) vitrinTimer = setInterval(() => { if (!adViewer) vitrinGo(vitrinIndex + 1); }, VITRIN_AUTOPLAY_MS);
}


// ── Kullanıcı ilanı (giriş gerekir, yönetici onayından sonra yayınlanır) ──
let userAdPhotos = null;

function openUserAdModal() {
  if (!checkAuthAndRun()) return;
  if (!userAdPhotos) userAdPhotos = createPhotoEditor('userAdPhotos');
  document.getElementById('userAdModal').classList.add('open');
  loadMyAds();
  loadMyShops();
}

function captureUserAdPhoto() {
  if (!checkAuthAndRun()) return;
  if (!userAdPhotos) userAdPhotos = createPhotoEditor('userAdPhotos');
  if (userAdPhotos.getUrls().length >= MAX_PIN_PHOTOS) {
    return showToast(`En fazla ${MAX_PIN_PHOTOS} fotoğraf ekleyebilirsiniz`, 'error');
  }
  document.getElementById('userAdCameraInput').click();
}

function addUserAdCameraPhoto(input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (files.length && userAdPhotos) userAdPhotos.addFiles(files);
}

// Dükkan sahibiyse ilanı hangi dükkanı adına vereceğini seçer
async function loadMyShops() {
  const row = document.getElementById('userAdShopRow');
  const select = document.getElementById('userAdShop');
  try {
    const res = await fetch('/api/my-shops', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('userToken') } });
    const shops = res.ok ? await res.json() : [];
    const prev = select.value;
    select.innerHTML = '';
    shops.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${CATEGORY_ICONS[s.category] || '🏪'} ${s.title}`;
      select.appendChild(opt);
    });
    if (shops.length) select.appendChild(new Option('Hikaye olmasın', 'none'));
    if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
    row.hidden = !shops.length;
  } catch {
    row.hidden = true;
  }
}

function closeUserAdModal() {
  document.getElementById('userAdModal').classList.remove('open');
}

async function submitUserAd(e) {
  e.preventDefault();
  if (userAdPhotos.isBusy()) return showToast('Resimler yükleniyor, lütfen bekleyin', 'error');
  const youtube = document.getElementById('userAdYoutube').value.trim();
  const payload = {
    body: document.getElementById('userAdBody').value,
    pinId: document.getElementById('userAdShopRow').hidden ? undefined : document.getElementById('userAdShop').value,
    images: userAdPhotos.getUrls(),
    video: youtube ? { type: 'youtube', url: youtube } : null,
  };
  if (!payload.body.trim() && !payload.images.length && !payload.video) {
    return showToast('İlana yazı ya da resim ekleyin', 'error');
  }
  const btn = document.getElementById('userAdSubmitBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.status === 401) { closeUserAdModal(); openAuthModal(); throw new Error('Oturum süresi doldu, tekrar giriş yapın'); }
    if (!res.ok) throw new Error(data.error || 'İlan gönderilemedi');
    showToast(data.story ? '✅ İlanınız yayınlandı, 24 saat haritada dükkanınızda görünecek' : '✅ İlanınız yayınlandı', 'success');
    logEvent(`Yeni ilan verdi: '${String(payload.title || payload.body || '').split(/\n/)[0].slice(0, 60)}'`);
    if (window.newhalOlcum) window.newhalOlcum('ilan');
    const shop = document.getElementById('userAdShop').value;
    document.getElementById('userAdForm').reset();
    document.getElementById('userAdShop').value = shop;
    userAdPhotos.setUrls([]);
    loadMyAds();
    loadAds();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

const MY_AD_STATUS = { pending: '⏳ Onay bekliyor', live: '🟢 Yayında', hidden: '🙈 Yayından kaldırıldı' };

async function loadMyAds() {
  const box = document.getElementById('myAdsBox');
  const list = document.getElementById('myAdsList');
  try {
    const res = await fetch('/api/my-ads', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('userToken') } });
    if (!res.ok) { box.hidden = true; return; }
    const ads = await res.json();
    box.hidden = !ads.length;
    list.innerHTML = '';
    ads.forEach(ad => {
      const row = document.createElement('div');
      row.className = 'my-ad';
      const thumb = document.createElement('img');
      thumb.src = (ad.images || [])[0] || AD_LOGO_URL;
      thumb.alt = '';
      const info = document.createElement('div');
      info.className = 'my-ad-info';
      const t = document.createElement('strong');
      t.textContent = ad.title || (ad.body || 'İlan').slice(0, 60);
      const st = document.createElement('span');
      st.className = `my-ad-status ${ad.status}`;
      st.textContent = `${MY_AD_STATUS[ad.status] || ''} · ${new Date(ad.created_at).toLocaleDateString('tr-TR')}`;
      info.append(t, st);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'my-ad-delete';
      del.textContent = 'Sil';
      del.onclick = () => deleteMyAd(ad.id);
      const vitrin = document.createElement('button');
      vitrin.type = 'button'; vitrin.className = 'my-ad-vitrin';
      vitrin.textContent = ad.featured ? '⭐ Vitrinde' : ad.featured_request_status === 'pending' ? '⏳ Başvuru bekliyor' : '⭐ Vitrine başvur · 1.000 PP';
      vitrin.disabled = !!ad.featured || ad.featured_request_status === 'pending' || ad.status !== 'live';
      vitrin.onclick = () => applyMyAdToVitrin(ad.id);
      row.append(thumb, info, vitrin, del);
      list.appendChild(row);
    });
  } catch {
    box.hidden = true;
  }
}

async function applyMyAdToVitrin(id) {
  if (!confirm('Bu ilan için vitrin başvurusu yapılsın mı? 1.000 Para Puan hesabınızdan düşer.')) return;
  try {
    const res = await fetch(`/api/my-ads/${encodeURIComponent(id)}/vitrin-application`, { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('userToken') } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Vitrin başvurusu yapılamadı');
    showToast(`${data.points_spent.toLocaleString('tr-TR')} Para Puan kullanıldı. Başvurunuz yöneticinin onayını bekliyor.`, 'success');
    loadMyAds();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteMyAd(id) {
  if (!confirm('Bu ilan silinsin mi?')) return;
  const res = await fetch(`/api/my-ads/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'Authorization': 'Bearer ' + localStorage.getItem('userToken') },
  });
  if (!res.ok) return showToast('İlan silinemedi', 'error');
  showToast('İlan silindi', 'success');
  loadMyAds();
  loadAds();
}


// ── İlan numarası ve paylaşım ─────────────────────────────────
function adMetaLine(ad) {
  const line = document.createElement('div');
  line.className = 'ad-meta';
  if (ad.no) {
    const no = document.createElement('span');
    no.className = 'ad-no';
    no.textContent = `#${ad.no}`;
    line.appendChild(no);
  }
  const t = document.createElement('time');
  t.dateTime = ad.created_at;
  t.textContent = new Date(ad.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  line.appendChild(t);
  if (ad.owner_id && ad.owner_name) {
    const who = document.createElement('button');
    who.type = 'button';
    who.className = 'ad-owner';
    who.textContent = `👤 ${ad.owner_name}`;
    who.title = 'İlanı verenin profili';
    who.onclick = (e) => { e.stopPropagation(); openPublicProfile(ad.owner_id); };
    line.appendChild(who);
  }
  return line;
}

function adShareUrl(ad) {
  return `${location.origin}/?ilan=${encodeURIComponent(ad.id)}`;
}

function adShareText(ad) {
  const s = (ad.title || ad.body || 'İlan').replace(/\s+/g, ' ').trim();
  return `${ad.no ? `#${ad.no} · ` : ''}${s.length > 90 ? s.slice(0, 87) + '...' : s} | NewHal Mersin Hal İlanları`;
}

const SHARE_ICONS = {
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8V6.3c0-.8.2-1.3 1.4-1.3H17V2.2C16.7 2.1 15.7 2 14.6 2 12.2 2 10.6 3.4 10.6 6v2H8v3.1h2.6V22H14V11.1h2.7L17 8h-3z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.7 7.7L22 21h-6.2l-4.8-6.3L5.5 21H2.4l7.2-8.2L2 3h6.3l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.6 19.8c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2L6 13.4l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.5 3c.9-.3 1.7.2 1.4 1.3z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
};

function buildShareBar(ad, large) {
  const bar = document.createElement('div');
  bar.className = 'ad-share' + (large ? ' large' : '');
  // Karttaki büyütmeyi tetiklemesin
  bar.addEventListener('click', (e) => e.stopPropagation());
  bar.addEventListener('keydown', (e) => e.stopPropagation());

  const url = adShareUrl(ad);
  const text = adShareText(ad);
  const targets = [
    ['whatsapp', 'WhatsApp', `https://api.whatsapp.com/send?text=${encodeURIComponent(`${text}\n${url}`)}`],
    ['facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`],
    ['x', 'X', `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`],
    ['telegram', 'Telegram', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`],
  ];
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ad-share-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = `${SHARE_ICONS.more}<span>Paylaş</span>`;
  toggle.onclick = () => {
    const open = bar.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  };
  const options = document.createElement('div');
  options.className = 'ad-share-options';
  bar.append(toggle, options);
  targets.forEach(([key, name, href]) => {
    const a = document.createElement('a');
    a.className = `ad-share-btn ${key}`;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = `${name}'ta paylaş`;
    a.setAttribute('aria-label', `${name}'ta paylaş`);
    a.innerHTML = SHARE_ICONS[key];
    a.addEventListener('click', () => track({ type: 'share', adId: ad.id, channel: key }));
    options.appendChild(a);
  });

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'ad-share-btn copy';
  copy.title = 'Bağlantıyı kopyala';
  copy.setAttribute('aria-label', 'Bağlantıyı kopyala');
  copy.innerHTML = SHARE_ICONS.copy;
  copy.onclick = async () => {
    track({ type: 'share', adId: ad.id, channel: 'copy' });
    try {
      await navigator.clipboard.writeText(url);
      showToast('🔗 İlan bağlantısı kopyalandı', 'success');
    } catch {
      prompt('Bağlantıyı kopyalayın:', url);
    }
  };
  options.appendChild(copy);

  // Telefonda Instagram, Messenger vb. için cihazın kendi paylaş menüsü
  if (navigator.share) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'ad-share-btn more';
    more.title = 'Diğer uygulamalar';
    more.setAttribute('aria-label', 'Diğer uygulamalarda paylaş');
    more.innerHTML = SHARE_ICONS.more;
    more.onclick = () => {
      track({ type: 'share', adId: ad.id, channel: 'more' });
      navigator.share({ title: text, text, url }).catch(() => {});
    };
    options.appendChild(more);
  }
  return bar;
}


// ── Vitrin kalan süre sayacı ──────────────────────────────────
function vitrinRemaining(until) {
  const ms = Date.parse(until) - Date.now();
  if (ms <= 0) return '⏳ Süre doldu';
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.max(1, Math.floor(ms % 3600000 / 60000));
  if (d) return `⏳ ${d} gün${h ? ` ${h} saat` : ''} kaldı`;
  if (h) return `⏳ ${h} saat ${m} dk kaldı`;
  return `⏳ ${m} dk kaldı`;
}

// Her dakika güncelle; süresi dolan ilan vitrinden iner
setInterval(() => {
  let expired = false;
  document.querySelectorAll('.vitrin-timer').forEach(el => {
    el.textContent = vitrinRemaining(el.dataset.until);
    if (Date.parse(el.dataset.until) <= Date.now()) expired = true;
  });
  if (expired) loadAds();
}, 60 * 1000);


// ── İstatistik: görüntülenme, açılma, paylaşım ve aramalar (kimlik gönderilmez) ──
const statQueue = [];
const STAT_FLUSH_MS = 5000;

function track(ev) {
  logTrackedEvent(ev);
  statQueue.push(ev);
  if (statQueue.length >= 20) flushStats();
}

function flushStats(onLeave) {
  if (!statQueue.length) return;
  const body = JSON.stringify({ events: statQueue.splice(0, 50) });
  if (onLeave && navigator.sendBeacon) {
    navigator.sendBeacon('/api/stats', new Blob([body], { type: 'application/json' }));
  } else {
    fetch('/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
}
setInterval(flushStats, STAT_FLUSH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushStats(true); });

// Aynı ziyarette aynı ilan bir kez sayılır
function trackOnce(kind, adId) {
  const key = `stat:${kind}:${adId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {}
  track({ type: kind, adId });
}

// Ekranda en az yarısı görünen ilan kartı / vitrin = 1 görüntülenme
const adViewObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting && e.target.dataset.adId) {
      trackOnce('view', e.target.dataset.adId);
      adViewObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.5 }) : null;

function observeAdView(el, ad) {
  if (!adViewObserver || !ad || !ad.id) return;
  el.dataset.adId = ad.id;
  adViewObserver.observe(el);
}

// Arama: yazmayı 1,5 sn bırakınca ya da sonuç seçilince bir kez kaydedilir
const lastTrackedSearch = {};
const searchTimers = {};
function trackSearch(source, q, immediate) {
  clearTimeout(searchTimers[source]);
  const run = () => {
    const term = String(q || '').trim();
    if (term.length < 2 || lastTrackedSearch[source] === term.toLocaleLowerCase('tr-TR')) return;
    lastTrackedSearch[source] = term.toLocaleLowerCase('tr-TR');
    track({ type: 'search', q: term, source });
  };
  if (immediate) run(); else searchTimers[source] = setTimeout(run, 1500);
}

// ── Tıklama yoğunluk haritası ─────────────────────────────────
// Sadece ölçüm çerezine "Kabul et" diyen ziyaretçide çalışır. Kim olduğu değil,
// sadece ekranın neresine tıklandığı (ekran boyuna oranla) gönderilir.
// Kalma süresi: oturum başına bir kez, sayfadan ayrılırken gönderilir. Kişi bilgisi içermez.
(function setupEngagement() {
  if (window.self !== window.top) return;
  try {
    if (localStorage.getItem('newhal_admin_token') || sessionStorage.getItem('engagementSent')) return;
  } catch { return; }
  let start = document.visibilityState === 'visible' ? Date.now() : 0;
  let interacted = false;
  let sent = false;
  const markInteracted = () => { interacted = true; };
  document.addEventListener('pointerdown', markInteracted, { passive: true, capture: true, once: true });
  document.addEventListener('keydown', markInteracted, { passive: true, capture: true, once: true });
  function send() {
    if (sent || !start) return;
    sent = true;
    try { sessionStorage.setItem('engagementSent', '1'); } catch {}
    const body = JSON.stringify({
      seconds: Math.round((Date.now() - start) / 1000),
      interacted,
      kaynak: new URLSearchParams(location.search).get('kaynak') || '',
      referrer: document.referrer || '',
    });
    try {
      if (!navigator.sendBeacon || !navigator.sendBeacon('/api/engagement', new Blob([body], { type: 'application/json' }))) {
        fetch('/api/engagement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
    else if (!start) start = Date.now();
  });
  window.addEventListener('pagehide', send);
})();

(function setupClickHeatmap() {
  const COLS = 60, ROWS = 40;
  let queue = [];
  let enabled = false;   // yönetim panelinden açılıp kapatılır
  if (window.self === window.top) {
    fetch('/api/heatmap/status').then(r => r.json()).then(s => { enabled = !!(s && s.enabled); }).catch(() => {});
  }
  const allowed = () => enabled && typeof window.newhalCerezTercihi === 'function' && window.newhalCerezTercihi() === 'kabul';
  const device = () => (window.innerWidth < 768 ? 'mobile' : 'desktop');
  document.addEventListener('pointerdown', e => {
    if (!allowed() || !e.isPrimary) return;
    const x = Math.min(COLS - 1, Math.max(0, Math.floor(e.clientX / window.innerWidth * COLS)));
    const y = Math.min(ROWS - 1, Math.max(0, Math.floor(e.clientY / window.innerHeight * ROWS)));
    queue.push([x, y]);
    if (queue.length >= 40) flush();
  }, { passive: true, capture: true });
  function flush() {
    if (!queue.length) return;
    const body = JSON.stringify({ device: device(), points: queue.splice(0, 100) });
    try {
      if (!navigator.sendBeacon || !navigator.sendBeacon('/api/heatmap', new Blob([body], { type: 'application/json' }))) {
        fetch('/api/heatmap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }
  setInterval(flush, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
})();

// ── Aktivite Logları için ayrıntılı olaylar ───────────────────
// Kişi bilgisi gönderilmez; sadece ne yapıldığı kısa bir cümleyle yazılır.
function logEvent(text) {
  if (window.self !== window.top) return;   // yönetim panelindeki önizleme sayılmaz
  saveActivityToBackend(text);
}

const SEARCH_PLACE = { map: 'Haritada', ads: 'İlanlarda' };
const SHARE_PLACE = { whatsapp: "WhatsApp'ta", facebook: "Facebook'ta", telegram: "Telegram'da", x: "X'te", copy: 'bağlantısını kopyalayarak', more: 'telefonundan' };
function adLabel(adId) {
  const ad = (typeof allAds !== 'undefined' ? allAds : []).find(a => a.id === adId);
  if (!ad) return 'bir ilanı';
  const title = String(ad.title || ad.body || '').split(/\n/)[0].slice(0, 50);
  return `#${ad.no || ''} '${title}' ilanını`;
}
function logTrackedEvent(ev) {
  if (!ev) return;
  if (ev.type === 'search') logEvent(`${SEARCH_PLACE[ev.source] || ''} '${ev.q}' aradı`.trim());
  else if (ev.type === 'open') logEvent(`${adLabel(ev.adId)} açtı`);
  else if (ev.type === 'share') logEvent(`${adLabel(ev.adId)} ${SHARE_PLACE[ev.channel] || ''} paylaştı`.replace(/\s+/g, ' '));
}

// Telefon ve yol tarifi bağlantıları
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  const detail = document.getElementById('detailTitle');
  const pinName = detail && detail.closest && a.closest('#pinDetailModal') ? (detail.firstChild ? detail.firstChild.textContent : '') : '';
  if (href.startsWith('tel:')) logEvent(`${pinName ? `'${pinName.trim().slice(0, 60)}' işletmesini` : href.slice(4)} telefonla aradı`);
  else if (/google\.com\/maps|maps\.apple|yandex/.test(href)) logEvent(`${pinName ? `'${pinName.trim().slice(0, 60)}' için ` : ''}yol tarifi aldı`);
}, true);
