/* ═══════════════════════════════════════════════════════════════
   NewHal — main.js
   ═══════════════════════════════════════════════════════════════ */

// ── LOCAL AUTH (Kayıt / Giriş) ──────────────────────────────
function openAuthModal() {
  document.getElementById('authModal').classList.add('open');
  switchAuthTab('login');
}
function closeAuthModal() {
  document.getElementById('authModal').classList.remove('open');
}
function switchAuthTab(tab) {
  if (tab === 'login') {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('tabLogin').style.borderBottom = '2px solid var(--green-400)';
    document.getElementById('tabLogin').style.color = '#fff';
    document.getElementById('tabRegister').style.borderBottom = '2px solid transparent';
    document.getElementById('tabRegister').style.color = 'var(--text-2)';
  } else {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('tabRegister').style.borderBottom = '2px solid var(--green-400)';
    document.getElementById('tabRegister').style.color = '#fff';
    document.getElementById('tabLogin').style.borderBottom = '2px solid transparent';
    document.getElementById('tabLogin').style.color = 'var(--text-2)';
  }
}

async function submitLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('userToken', data.token);
      localStorage.setItem('userName', data.name);
      closeAuthModal();
      showToast('Başarıyla giriş yapıldı', 'success');
      updateAuthUI(data.name);
    } else {
      showToast(data.error || 'Giriş başarısız', 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası', 'error');
  }
}

async function submitRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('userToken', data.token);
      localStorage.setItem('userName', data.name);
      closeAuthModal();
      showToast('Kayıt başarılı, giriş yapıldı', 'success');
      updateAuthUI(data.name);
    } else {
      showToast(data.error || 'Kayıt başarısız', 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası', 'error');
  }
}

function updateAuthUI(name) {
  const btn1 = document.getElementById('authBtn');
  const btn2 = document.getElementById('mobileAuthBtn');
  const setupBtn = (btn) => {
    if (!btn) return;
    btn.innerHTML = `👤 ${name}`;
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
  // Restore UI for logged in user
  const savedName = localStorage.getItem('userName');
  if (savedName) {
    updateAuthUI(savedName);
  }

  initMap();
  await loadCategories();
  loadPins();
  initScrollEffect();

  // Chat initialization & polling
  loadChatMessages();
  setInterval(loadChatMessages, 3000);
  initDraggableChat();

  // Emoji picker init
  initUserEmojiPicker();
  const newCatIconEl = document.getElementById('newCategoryIcon');
  if (newCatIconEl) {
    newCatIconEl.addEventListener('click', (e) => {
      showUserEmojiPicker(e.target);
    });
  }

  // Açılış banner popup'ı tetikle
  const welcomePopup = document.getElementById('welcomePopup');
  if (welcomePopup) {
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
  layers.satellite = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    attribution: '&copy; Google Maps',
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20,
  });

  layers.light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
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

function selectLocation(lat, lng) {
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
    ">${emoji}</div>`,
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

function renderPins(pins) {
  // Haritadaki eski markerları temizle (temp hariç)
  map.eachLayer(layer => {
    if (layer instanceof L.Marker && layer !== tempMarker) map.removeLayer(layer);
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

  // Haritaya ekle
  filtered.forEach(pin => {
    const emoji = CATEGORY_ICONS[pin.category] || '📦';
    const marker = L.marker([pin.lat, pin.lng], { icon: createIcon(emoji) }).addTo(map);
    
    // Popup shows contact info optionally
    marker.bindPopup(`
      <div style="font-family:'Inter',sans-serif; min-width:200px;">
        <div style="font-size:18px;margin-bottom:6px;">${emoji} <strong style="color:#f0fdf4;font-size:14px;">${pin.title}</strong></div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">📍 ${pin.address}</div>
        ${showContactInfo && pin.phone ? `<div style="font-size:12px;color:#86efac;">📞 <a href="tel:${pin.phone}" style="color:#4ade80;">${pin.phone}</a></div>` : ''}
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
          <div class="pin-card-icon">${emoji}</div>
          <div class="pin-card-cat">${pin.category}</div>
        </div>
        <div class="pin-card-title">${escHtml(pin.title)}</div>
        <div class="pin-card-addr">📍 ${escHtml(pin.address)}</div>
        ${showContactInfo && (pin.phone || pin.website) ? `
          <div class="pin-card-footer">
            ${pin.phone ? `<div class="pin-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.06 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/></svg><a href="tel:${pin.phone}" onclick="event.stopPropagation()">${pin.phone}</a></div>` : ''}
            ${pin.website ? `<div class="pin-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span style="user-select: text;">${escHtml(pin.website)}</span></div>` : ''}
          </div>
        ` : ''}
      `;
      grid.appendChild(card);
    });
  }
}

function filterPins(cat, btn) {
  activeFilter = cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPins(allPins);

  logActivity(`Kategoriyi '${cat === 'all' ? 'Tümü' : cat}' olarak filtrelediniz`, true);
}

async function updateHeroStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return;
    // Stats endpoint requires auth, skip if not admin
  } catch {}
  // Sadece onaylı pinlerden hesapla
  document.getElementById('statApproved').textContent = allPins.length;
}

async function updateStats() {
  document.getElementById('statApproved').textContent = allPins.length;
  // Pending için ayrı endpoint yok (public), sadece approved göster
  document.getElementById('statPending').textContent = '—';
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

  // Render comments for this pin
  renderPinComments(pin.comments || []);

  document.getElementById('pinDetailModal').classList.add('open');

  // Log activity
  logActivity(`'${pin.title}' detaylarını inceliyorsunuz`, true);
}

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
  document.getElementById('addPinModal').classList.add('open');
  document.getElementById('addPinForm').reset();
  document.getElementById('locationDisplay').innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    Haritaya tıklayarak konum seçin`;
  document.getElementById('locationDisplay').classList.remove('selected');
  pendingLat = null; pendingLng = null;
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
}

function closeAddPinModal() {
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
    lat: pendingLat,
    lng: pendingLng,
  };

  try {
    const res = await fetch('/api/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata oluştu');
    closeAddPinModal();
    showToast('✅ İğne gönderildi! Admin onayı bekleniyor.', 'success');
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
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
        <span class="chat-msg-ip">🔌 ${escHtml(msg.ip)}</span>
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
  const msgInput = document.getElementById('chatMsg');
  const nickInput = document.getElementById('chatNick');
  if (!msgInput) return;

  const message = msgInput.value.trim();
  const nickname = nickInput.value.trim() || 'Anonim';

  if (!message) return;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, message }),
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
    btn.innerHTML = `${cat.icon || '📦'} ${cat.name}`;
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
      headers: { 'Content-Type': 'application/json' },
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
      <div style="font-size: 10px; color: rgba(255,255,255,0.15); font-family: monospace;">🔌 IP: ${c.ip}</div>
    `;
    list.appendChild(card);
  });

  // Scroll to bottom
  list.scrollTop = list.scrollHeight;
}

async function submitComment() {
  if (!currentDetailPinId) return;

  const nickInput = document.getElementById('commentNickname');
  const msgInput = document.getElementById('commentMessage');
  const nickname = nickInput.value.trim() || 'Anonim';
  const message = msgInput.value.trim();

  if (!message) {
    showToast('Lütfen yorumunuzu yazın', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/pins/${currentDetailPinId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, message })
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
      headers: { 'Content-Type': 'application/json' },
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
  '🥑', '🥕', '🧄', '🍞', '🥜', '🧀', '🥚', '🍗', '🦐', '🦀', '🧉', '🏺', '🌸', '🪴', '🚚', '🚜', '💰', '🛠️'
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



