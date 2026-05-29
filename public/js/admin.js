/* ═══════════════════════════════════════════════════════════════
   NewHal — admin.js
   ═══════════════════════════════════════════════════════════════ */

let token = localStorage.getItem('newhal_admin_token');
let rejectTargetId = null;
let allPinsCache = {};

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showAdminPanel();
  } else {
    document.getElementById('loginScreen').style.display = 'flex';
  }
  
  // Emoji picker init
  initAdminEmojiPicker();
  
  const newCatIconEl = document.getElementById('adminNewCatIcon');
  if (newCatIconEl) {
    newCatIconEl.addEventListener('click', (e) => {
      showAdminEmojiPicker(e.target);
    });
  }

  const editCatIconEl = document.getElementById('adminEditCatIcon');
  if (editCatIconEl) {
    editCatIconEl.addEventListener('click', (e) => {
      showAdminEmojiPicker(e.target);
    });
  }
});

// ── Login ──────────────────────────────────────────────────────
async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  btn.textContent = 'Giriş yapılıyor...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('loginUser').value,
        password: document.getElementById('loginPass').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Giriş başarısız');
    token = data.token;
    localStorage.setItem('newhal_admin_token', token);
    document.getElementById('adminName').textContent = data.username;
    showAdminPanel();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.textContent = 'Giriş Yap';
    btn.disabled = false;
  }
}

function doLogout() {
  localStorage.removeItem('newhal_admin_token');
  token = null;
  document.getElementById('adminLayout').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
}

// ── Show Admin Panel ───────────────────────────────────────────
function showAdminPanel() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminLayout').style.display = 'flex';
  loadAll();
}

// ── API Helper ─────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) { doLogout(); return null; }
  return res;
}

// ── Load All Data ──────────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadStats(), loadPending(), loadApproved(), loadRejected(), loadCategories(), loadReports(), loadLogs()]);
}

async function loadStats() {
  const res = await api('/api/admin/stats');
  if (!res) return;
  const d = await res.json();
  document.getElementById('dashVisits').textContent   = Number(d.visits || 0).toLocaleString('tr-TR');
  document.getElementById('dashTotal').textContent    = d.total;
  document.getElementById('dashPending').textContent  = d.pending;
  document.getElementById('dashApproved').textContent = d.approved;
  document.getElementById('dashRejected').textContent = d.rejected;

  const badge = document.getElementById('pendingBadge');
  badge.textContent = d.pending > 0 ? d.pending : '';
}

async function loadPending() {
  const res = await api('/api/admin/pins?status=pending');
  if (!res) return;
  const pins = await res.json();
  pins.forEach(p => allPinsCache[p.id] = p);
  renderPendingTable(pins);
  renderDashRecent(pins);
}

async function loadApproved() {
  const res = await api('/api/admin/pins?status=approved');
  if (!res) return;
  const pins = await res.json();
  pins.forEach(p => allPinsCache[p.id] = p);
  renderApprovedTable(pins);
}

async function loadRejected() {
  const res = await api('/api/admin/pins?status=rejected');
  if (!res) return;
  const pins = await res.json();
  pins.forEach(p => allPinsCache[p.id] = p);
  renderRejectedTable(pins);
}

// ── Render Dashboard Recent ────────────────────────────────────
function renderDashRecent(pins) {
  const tbody = document.getElementById('dashRecentBody');
  tbody.innerHTML = '';
  if (pins.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:32px">Bekleyen iğne yok ✅</td></tr>';
    return;
  }
  pins.slice(0, 6).forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="td-title">${esc(p.title)}</div>
        <div class="td-sub">📍 ${esc(p.address)}</div>
      </td>
      <td>${esc(p.category)}</td>
      <td><span class="badge badge-pending">⏳ Bekliyor</span></td>
      <td style="color:var(--text-3);font-size:12px">${formatDate(p.created_at)}</td>
      <td>
        <div class="actions">
          <button class="btn-approve" onclick="approvePin(${p.id})">✓ Onayla</button>
          <button class="btn-reject"  onclick="openRejectModal(${p.id})">✗ Reddet</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Render Pending ─────────────────────────────────────────────
function renderPendingTable(pins) {
  const tbody = document.getElementById('pendingBody');
  const empty = document.getElementById('pendingEmpty');
  tbody.innerHTML = '';
  if (pins.length === 0) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');
  pins.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="td-title">${esc(p.title)}</div>
      </td>
      <td>${esc(p.category)}</td>
      <td style="max-width:180px;word-break:break-word">${esc(p.address)}</td>
      <td>
        ${p.phone  ? `<div style="font-size:12px">📞 ${esc(p.phone)}</div>` : ''}
        ${p.email  ? `<div style="font-size:12px">✉ ${esc(p.email)}</div>` : ''}
        ${p.website? `<div style="font-size:12px">🌐 ${esc(p.website)}</div>` : ''}
        ${!p.phone && !p.email && !p.website ? '<span style="color:var(--text-3)">—</span>' : ''}
      </td>
      <td>
        <a href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank" style="font-size:12px;color:var(--green-400)">
          🗺 ${parseFloat(p.lat).toFixed(4)}, ${parseFloat(p.lng).toFixed(4)}
        </a>
      </td>
      <td style="color:var(--text-3);font-size:12px">${formatDate(p.created_at)}</td>
      <td>
        <div class="actions">
          <button class="btn-approve" onclick="approvePin(${p.id})">✓ Onayla</button>
          <button class="btn-edit" onclick="openEditPinModal(${p.id})" style="background:var(--accent); color:#111; border:none; padding:4px 8px; border-radius:4px; font-weight:600; cursor:pointer;">✏️ Düzenle</button>
          <button class="btn-reject"  onclick="openRejectModal(${p.id})">✗ Reddet</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Render Approved ────────────────────────────────────────────
function renderApprovedTable(pins) {
  const tbody = document.getElementById('approvedBody');
  const empty = document.getElementById('approvedEmpty');
  tbody.innerHTML = '';
  if (pins.length === 0) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');
  pins.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="td-title">${esc(p.title)}</div>
      </td>
      <td>${esc(p.category)}</td>
      <td style="max-width:180px;word-break:break-word">${esc(p.address)}</td>
      <td>
        ${p.phone  ? `<div style="font-size:12px">📞 ${esc(p.phone)}</div>` : ''}
        ${p.email  ? `<div style="font-size:12px">✉ ${esc(p.email)}</div>` : ''}
        ${p.website? `<div style="font-size:12px">🌐 ${esc(p.website)}</div>` : ''}
        ${!p.phone && !p.email && !p.website ? '<span style="color:var(--text-3)">—</span>' : ''}
      </td>
      <td style="color:var(--text-3);font-size:12px">${formatDate(p.created_at)}</td>
      <td>
        <div class="actions">
          <button class="btn-edit" onclick="openEditPinModal(${p.id})" style="background:var(--accent); color:#111; border:none; padding:4px 8px; border-radius:4px; font-weight:600; cursor:pointer; margin-right:6px;">✏️ Düzenle</button>
          <button class="btn-delete" onclick="deletePin(${p.id})">🗑 Sil</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Render Rejected ────────────────────────────────────────────
function renderRejectedTable(pins) {
  const tbody = document.getElementById('rejectedBody');
  const empty = document.getElementById('rejectedEmpty');
  tbody.innerHTML = '';
  if (pins.length === 0) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');
  pins.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="td-title">${esc(p.title)}</div>
        <div class="td-sub">📍 ${esc(p.address)}</div>
      </td>
      <td>${esc(p.category)}</td>
      <td style="color:var(--text-3);max-width:200px">${esc(p.reject_reason) || '—'}</td>
      <td style="color:var(--text-3);font-size:12px">${formatDate(p.created_at)}</td>
      <td>
        <div class="actions">
          <button class="btn-reapprove" onclick="approvePin(${p.id})">↩ Onayla</button>
          <button class="btn-edit" onclick="openEditPinModal(${p.id})" style="background:var(--accent); color:#111; border:none; padding:4px 8px; border-radius:4px; font-weight:600; cursor:pointer; margin: 0 4px;">✏️ Düzenle</button>
          <button class="btn-delete"    onclick="deletePin(${p.id})">🗑 Sil</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Actions ────────────────────────────────────────────────────
async function approvePin(id) {
  const res = await api(`/api/admin/pins/${id}/approve`, { method: 'PATCH' });
  if (!res || !res.ok) { showToast('Onaylama başarısız', 'error'); return; }
  showToast('✅ İğne onaylandı ve yayınlandı!', 'success');
  await loadAll();
}

function openRejectModal(id) {
  rejectTargetId = id;
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectModal').classList.add('open');
}

function closeRejectModal() {
  document.getElementById('rejectModal').classList.remove('open');
  rejectTargetId = null;
}

async function confirmReject() {
  if (!rejectTargetId) return;
  const reason = document.getElementById('rejectReason').value.trim();
  const res = await api(`/api/admin/pins/${rejectTargetId}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ reason }),
  });
  if (!res || !res.ok) { showToast('Red işlemi başarısız', 'error'); return; }
  closeRejectModal();
  showToast('❌ İğne reddedildi', 'success');
  await loadAll();
}

async function deletePin(id) {
  if (!confirm('Bu iğneyi kalıcı olarak silmek istediğinize emin misiniz?')) return;
  const res = await api(`/api/admin/pins/${id}`, { method: 'DELETE' });
  if (!res || !res.ok) { showToast('Silme başarısız', 'error'); return; }
  showToast('🗑 İğne silindi', 'success');
  await loadAll();
}

// ── Navigation ─────────────────────────────────────────────────
const sectionTitles = {
  dashboard: 'Genel Bakış',
  pending:   'Bekleyen İğneler',
  approved:  'Onaylananlar',
  rejected:  'Reddedilenler',
  categories:'Kategori Yönetimi',
  reports:   'Hata Bildirimleri',
  logs:      'Aktivite Logları'
};

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section${cap(name)}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav${cap(name)}`).classList.add('active');
  document.getElementById('topbarTitle').textContent = sectionTitles[name];
  
  if (name === 'logs') {
    loadLogs();
  }
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
  sb.classList.toggle('open');
}

// ── Helpers ────────────────────────────────────────────────────
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr; }
}

function showToast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── Admin Kategori Yönetimi ──────────────────────────────────────
async function loadCategories() {
  const res = await api('/api/categories');
  if (!res) return;
  const categories = await res.json();
  renderCategoriesTable(categories);
  populateEditCategoryDropdown(categories);
}

function renderCategoriesTable(categories) {
  const tbody = document.getElementById('categoriesBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (categories.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:32px">Kategori bulunamadı</td></tr>';
    return;
  }
  categories.forEach(cat => {
    const isGenel = cat.name.toLowerCase() === 'genel';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-size: 24px; width: 100px;">${esc(cat.icon || '📦')}</td>
      <td style="font-weight: 600;">${esc(cat.name)}</td>
      <td>
        <div class="actions">
          <button class="btn-edit" onclick="openEditCategoryModal('${esc(cat.name)}', '${esc(cat.icon || '')}')" style="background:var(--accent); color:#111; border:none; padding:4px 8px; border-radius:4px; font-weight:600; cursor:pointer;">✏️ Düzenle</button>
          ${!isGenel ? `<button class="btn-delete" onclick="deleteCategory('${esc(cat.name)}')">🗑 Sil</button>` : `<span style="font-size: 11.5px; color: var(--text-3); font-style: italic; padding: 4px 6px;">Varsayılan (Kilitli)</span>`}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function populateEditCategoryDropdown(categories) {
  const select = document.getElementById('editPinCategory');
  if (!select) return;
  select.innerHTML = '';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = `${cat.icon || '📦'} ${cat.name}`;
    select.appendChild(opt);
  });
}

function openAddCategoryModal() {
  document.getElementById('adminNewCatName').value = '';
  document.getElementById('adminNewCatIcon').value = '';
  document.getElementById('addCategoryModal').classList.add('open');
}

function closeAddCategoryModal() {
  document.getElementById('addCategoryModal').classList.remove('open');
  hideAdminEmojiPicker();
}

async function submitAdminCategory() {
  const name = document.getElementById('adminNewCatName').value.trim();
  const icon = document.getElementById('adminNewCatIcon').value.trim() || '📦';
  if (!name) {
    showToast('Lütfen kategori adını yazın', 'error');
    return;
  }
  const res = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name, icon })
  });
  if (!res || !res.ok) {
    const err = res ? await res.json() : { error: 'Hata oluştu' };
    showToast(err.error || 'Kategori eklenemedi', 'error');
    return;
  }
  closeAddCategoryModal();
  showToast('✅ Kategori başarıyla eklendi', 'success');
  await loadAll();
}

// ── Admin Kategori Düzenleme & Silme ──────────────────────────────
function openEditCategoryModal(name, icon) {
  document.getElementById('adminEditCatOldName').value = name;
  document.getElementById('adminEditCatName').value = name;
  document.getElementById('adminEditCatIcon').value = icon || '📦';
  document.getElementById('editCategoryModal').classList.add('open');
}

function closeEditCategoryModal() {
  document.getElementById('editCategoryModal').classList.remove('open');
  hideAdminEmojiPicker();
}

async function submitEditAdminCategory() {
  const oldName = document.getElementById('adminEditCatOldName').value;
  const name = document.getElementById('adminEditCatName').value.trim();
  const icon = document.getElementById('adminEditCatIcon').value.trim() || '📦';
  if (!name) {
    showToast('Lütfen kategori adını yazın', 'error');
    return;
  }
  const res = await api(`/api/admin/categories/${encodeURIComponent(oldName)}`, {
    method: 'PUT',
    body: JSON.stringify({ name, icon })
  });
  if (!res || !res.ok) {
    const err = res ? await res.json() : { error: 'Hata oluştu' };
    showToast(err.error || 'Kategori güncellenemedi', 'error');
    return;
  }
  closeEditCategoryModal();
  showToast('✅ Kategori başarıyla güncellendi', 'success');
  await loadAll();
}

async function deleteCategory(name) {
  if (name.toLowerCase() === 'genel') {
    showToast('Varsayılan Genel kategorisi silinemez', 'error');
    return;
  }
  if (!confirm(`"${name}" kategorisini silmek istediğinize emin misiniz?\nBu kategoriye ait tüm iğneler otomatik olarak "Genel" kategorisine aktarılacaktır.`)) {
    return;
  }
  const res = await api(`/api/admin/categories/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  });
  if (!res || !res.ok) {
    const err = res ? await res.json() : { error: 'Hata oluştu' };
    showToast(err.error || 'Kategori silinemedi', 'error');
    return;
  }
  showToast('🗑 Kategori silindi ve iğneler güncellendi', 'success');
  await loadAll();
}

// ── Admin Emoji Seçim Menüsü (Emoji Picker) ──────────────────────
const POPULAR_EMOJIS = [
  '🥦', '🌾', '🏪', '🐟', '🥩', '📦', '🍅', '🧅', '🥔', '🥬', '🌶️', '🍋', '🍇', '🍒', '🍓', '🍊', '🍉', '🍌',
  '🥑', '🥕', '🧄', '🍞', '🥜', '🧀', '🥚', '🍗', '🦐', '🦀', '🧉', '🏺', '🌸', '🪴', '🚚', '🚜', '💰', '🛠️'
];

let activeIconInput = null;

function initAdminEmojiPicker() {
  const picker = document.getElementById('adminEmojiPicker');
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
      if (activeIconInput) {
        activeIconInput.value = emoji;
      }
      hideAdminEmojiPicker();
    };
    grid.appendChild(el);
  });

  // Tıklanan yer dışındaysa kapat
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && (!activeIconInput || e.target !== activeIconInput)) {
      hideAdminEmojiPicker();
    }
  });
}

function showAdminEmojiPicker(inputEl) {
  activeIconInput = inputEl;
  const picker = document.getElementById('adminEmojiPicker');
  if (!picker) return;
  const rect = inputEl.getBoundingClientRect();
  picker.style.top = `${rect.bottom + window.scrollY + 6}px`;
  picker.style.left = `${rect.left + window.scrollX}px`;
  picker.style.display = 'block';
}

function hideAdminEmojiPicker() {
  const picker = document.getElementById('adminEmojiPicker');
  if (picker) {
    picker.style.display = 'none';
  }
  activeIconInput = null;
}

// ── Admin İğne Düzenleme Modülü ──────────────────────────────────
let editMapInstance = null;
let editMarkerInstance = null;

function openEditPinModal(id) {
  const pin = allPinsCache[id];
  if (!pin) return;

  document.getElementById('editPinId').value = pin.id;
  document.getElementById('editPinTitle').value = pin.title;
  document.getElementById('editPinCategory').value = pin.category;
  document.getElementById('editPinAddress').value = pin.address;
  document.getElementById('editPinPhone').value = pin.phone || '';
  document.getElementById('editPinEmail').value = pin.email || '';
  document.getElementById('editPinWebsite').value = pin.website || '';
  document.getElementById('editPinLat').value = pin.lat;
  document.getElementById('editPinLng').value = pin.lng;

  document.getElementById('editPinModal').classList.add('open');

  // Haritayı yükle
  initEditMap(pin.lat, pin.lng);
}

function initEditMap(lat, lng) {
  setTimeout(() => {
    if (!editMapInstance) {
      editMapInstance = L.map('editMap', {
        center: [lat, lng],
        zoom: 17,
        zoomControl: true
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 20
      }).addTo(editMapInstance);
      
      editMarkerInstance = L.marker([lat, lng], {
        draggable: true
      }).addTo(editMapInstance);

      editMarkerInstance.on('dragend', function (e) {
        const position = editMarkerInstance.getLatLng();
        document.getElementById('editPinLat').value = position.lat.toFixed(6);
        document.getElementById('editPinLng').value = position.lng.toFixed(6);
      });
      
      editMapInstance.on('click', function(e) {
        editMarkerInstance.setLatLng(e.latlng);
        document.getElementById('editPinLat').value = e.latlng.lat.toFixed(6);
        document.getElementById('editPinLng').value = e.latlng.lng.toFixed(6);
      });
    } else {
      editMapInstance.setView([lat, lng], 17);
      editMarkerInstance.setLatLng([lat, lng]);
    }
    
    // Harita boyutlarını geçersiz kıl (render düzeltmesi)
    editMapInstance.invalidateSize();
  }, 200);
}

function updateEditMapFromInputs() {
  const lat = parseFloat(document.getElementById('editPinLat').value);
  const lng = parseFloat(document.getElementById('editPinLng').value);
  if (!isNaN(lat) && !isNaN(lng) && editMapInstance && editMarkerInstance) {
    editMapInstance.setView([lat, lng]);
    editMarkerInstance.setLatLng([lat, lng]);
  }
}

function closeEditPinModal() {
  document.getElementById('editPinModal').classList.remove('open');
}

async function submitEditPin(e) {
  e.preventDefault();
  const id = document.getElementById('editPinId').value;
  const payload = {
    title:    document.getElementById('editPinTitle').value.trim(),
    category: document.getElementById('editPinCategory').value,
    address:  document.getElementById('editPinAddress').value.trim(),
    phone:    document.getElementById('editPinPhone').value.trim(),
    email:    document.getElementById('editPinEmail').value.trim(),
    website:  document.getElementById('editPinWebsite').value.trim(),
    lat:      parseFloat(document.getElementById('editPinLat').value),
    lng:      parseFloat(document.getElementById('editPinLng').value),
  };

  const res = await api(`/api/admin/pins/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

  if (!res || !res.ok) {
    showToast('Güncelleme başarısız', 'error');
    return;
  }

  closeEditPinModal();
  showToast('✅ İğne başarıyla güncellendi', 'success');
  await loadAll();
}

// ── Admin Hata Bildirimleri Modülü ──────────────────────────────
async function loadReports() {
  const res = await api('/api/admin/reports');
  if (!res) return;
  const reports = await res.json();
  renderReportsTable(reports);
}

function renderReportsTable(reports) {
  const tbody = document.getElementById('reportsBody');
  const empty = document.getElementById('reportsEmpty');
  const badge = document.getElementById('reportsBadge');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (badge) {
    badge.textContent = reports.length > 0 ? reports.length : '0';
  }

  if (reports.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  reports.forEach(r => {
    const tr = document.createElement('tr');
    
    let timeStr = '';
    try {
      const d = new Date(r.created_at);
      timeStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      timeStr = r.created_at;
    }

    tr.innerHTML = `
      <td>
        <div style="font-weight: 600;">${esc(r.pinTitle)}</div>
        <div style="font-size: 11px; color: var(--text-3);">ID: ${r.pinId}</div>
      </td>
      <td style="max-width: 300px; word-break: break-word; color: var(--amber-400); font-weight: 500;">${esc(r.message)}</td>
      <td style="font-family: monospace; font-size: 12px; color: var(--text-3);">🔌 ${esc(r.ip)}</td>
      <td style="font-size: 12px; color: var(--text-3);">${timeStr}</td>
      <td>
        <button class="btn-delete" onclick="deleteReport(${r.id})" style="border-radius: var(--radius); cursor:pointer;">🗑 Kapat</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function deleteReport(id) {
  if (!confirm('Bu bildirilimi kapatmak istediğinize emin misiniz?')) return;
  const res = await api(`/api/admin/reports/${id}`, { method: 'DELETE' });
  if (!res || !res.ok) {
    showToast('Bildirim kapatılamadı', 'error');
    return;
  }
  showToast('✅ Bildirim kapatıldı', 'success');
  await loadReports();
}

// ── Admin Aktivite Logları Modülü ──────────────────────────────
async function loadLogs() {
  const res = await api('/api/admin/logs');
  if (!res) return;
  const logs = await res.json();
  renderLogsTable(logs);
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('logsBody');
  const empty = document.getElementById('logsEmpty');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (logs.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // En yeni loglar en üstte görünsün
  const reversedLogs = [...logs].reverse();

  reversedLogs.forEach(log => {
    const tr = document.createElement('tr');
    
    let timeStr = '';
    try {
      const d = new Date(log.created_at);
      timeStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      timeStr = log.created_at;
    }

    tr.innerHTML = `
      <td style="font-family: monospace; font-size: 12px; color: var(--text-3); width: 140px;">🔌 ${esc(log.ip)}</td>
      <td style="font-weight: 500; color: var(--text-1);">${esc(log.action)}</td>
      <td style="font-size: 12px; color: var(--text-3); width: 180px;">${timeStr}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function clearLogs() {
  if (!confirm('Tüm aktivite loglarını silmek istediğinize emin misiniz?')) return;
  const res = await api('/api/admin/logs', { method: 'DELETE' });
  if (!res || !res.ok) {
    showToast('Loglar temizlenemedi', 'error');
    return;
  }
  showToast('🗑️ Tüm loglar başarıyla temizlendi', 'success');
  await loadLogs();
}

async function clearChat() {
  if (!confirm('Tüm sohbet geçmişini silmek istediğinize emin misiniz?')) return;
  const res = await api('/api/admin/chat', { method: 'DELETE' });
  if (!res || !res.ok) {
    showToast('Sohbet geçmişi temizlenemedi', 'error');
    return;
  }
  showToast('🗑️ Sohbet geçmişi başarıyla temizlendi', 'success');
}
