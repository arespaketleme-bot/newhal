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
  handleFbLinkParam();
}

// Chrome eklentisinden gelen "?fbLink=..." : İlanlar açılır, link yazılır, sorgu kendiliğinden başlar
function handleFbLinkParam() {
  const params = new URLSearchParams(location.search);
  const link = (params.get('fbLink') || '').trim();
  if (!link) return;
  params.delete('fbLink');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  if (!/^https:\/\/([^/]+\.)?(facebook\.com|fb\.com|fb\.watch)\//i.test(link)) {
    showToast('Gelen link bir Facebook linki değil', 'error');
    return;
  }
  setTimeout(() => {
    showSection('ads');
    const box = document.getElementById('fbImport');
    if (box) box.open = true;
    document.getElementById('fbImportLink').value = link;
    if (typeof loadApifyStatus === 'function') loadApifyStatus();
    document.getElementById('fbImport')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fetchFbPost();
  }, 300);
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

async function readApiJson(res, fallbackMessage = 'Sunucu geçerli bir yanıt vermedi') {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(fallbackMessage);
  return res.json();
}

// ── Load All Data ──────────────────────────────────────────────
async function loadAll() {
  api('/api/admin/ads').then(r => r && r.json()).then(ads => ads && updateAdsBadge(ads)).catch(() => {});
  await Promise.all([loadStats(), loadPending(), loadApproved(), loadRejected(), loadCategories(), loadReports(), loadLogs(), loadClaims(), loadBusinessLevelRules(), loadEconomyRules(), loadEconomyLedger()]);
}

const ECONOMY_LABELS = { ad_created: 'İlan ekledi', ad_like: 'İlan beğendi', ad_comment: 'İlana yorum yaptı', follow_given: 'Takip etti', followed_received: 'Takip edildi', new_user: 'Yeni kullanıcı kaydı', daily_login: 'Günlük giriş', referral: 'Davet ödülü' };

async function loadEconomyLedger() {
  const res = await api('/api/admin/economy-ledger');
  if (!res || !res.ok) return;
  try {
    const data = await readApiJson(res, 'Ekonomi kayıtları şu an yüklenemedi.');
    document.getElementById('economyTotalDistributed').textContent = Number(data.total_distributed || 0).toLocaleString('tr-TR');
    const body = document.getElementById('economyLedgerBody');
    const empty = document.getElementById('economyLedgerEmpty');
    body.innerHTML = '';
    const rows = data.entries || [];
    empty.style.display = rows.length ? 'none' : 'block';
    rows.forEach(row => {
      const reason = String(row.activity || '');
      const date = new Date(row.created_at).toLocaleString('tr-TR');
      body.insertAdjacentHTML('beforeend', `<tr><td><strong>${esc(row.user_name)}</strong> <small>#${Number(row.user_id)}</small></td><td>${esc(ECONOMY_LABELS[reason] || reason)}</td><td style="color:var(--green-400);font-weight:700;">+${Number(row.amount || 0).toLocaleString('tr-TR')}</td><td>${esc(date)}</td></tr>`);
    });
  } catch (err) { console.error(err); showToast(err.message, 'error'); }
}

async function loadEconomyRules() {
  const res = await api('/api/admin/economy-rules');
  if (!res || !res.ok) return;
  try {
    const rules = await readApiJson(res, 'Ekonomi ayarları şu an yüklenemedi. Lütfen tekrar deneyin.');
    document.getElementById('economyAdCreated').value = Number(rules.adCreated) || 0;
    document.getElementById('economyAdLike').value = Number(rules.adLike) || 0;
    document.getElementById('economyAdComment').value = Number(rules.adComment) || 0;
    document.getElementById('economyFollowGiven').value = Number(rules.followGiven) || 0;
    document.getElementById('economyFollowedReceived').value = Number(rules.followedReceived) || 0;
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function saveEconomyRules(event) {
  event.preventDefault();
  const payload = {
    adCreated: Number(document.getElementById('economyAdCreated').value),
    adLike: Number(document.getElementById('economyAdLike').value),
    adComment: Number(document.getElementById('economyAdComment').value),
    followGiven: Number(document.getElementById('economyFollowGiven').value),
    followedReceived: Number(document.getElementById('economyFollowedReceived').value),
  };
  if (Object.values(payload).some(value => !Number.isInteger(value) || value < 0 || value > 100000)) return showToast('Her ödül 0 ile 100.000 arasında tam sayı olmalı', 'error');
  const button = document.getElementById('economyRulesSave');
  button.disabled = true;
  try {
    const res = await api('/api/admin/economy-rules', { method: 'PUT', body: JSON.stringify(payload) });
    const data = res && await readApiJson(res, 'Ekonomi ayarları kaydedilirken geçersiz yanıt alındı');
    if (!res || !res.ok) throw new Error((data && data.error) || 'Ekonomi kuralları kaydedilemedi');
    await loadEconomyRules();
    showToast('Ekonomi kuralları kaydedildi', 'success');
  } catch (err) { showToast(err.message || 'Ekonomi kuralları kaydedilemedi', 'error'); }
  finally { button.disabled = false; }
}

async function loadBusinessLevelRules() {
  const res = await api('/api/admin/business-level-rules');
  if (!res || !res.ok) return;
  const rules = await res.json();
  const input = document.getElementById('businessInteractionsPerLevel');
  if (input) input.value = Number(rules.interactionsPerLevel) || 5;
}

async function saveBusinessLevelRules() {
  const input = document.getElementById('businessInteractionsPerLevel');
  const button = document.getElementById('saveBusinessLevelRules');
  const interactionsPerLevel = Number(input.value);
  if (!Number.isInteger(interactionsPerLevel) || interactionsPerLevel < 1 || interactionsPerLevel > 10000) {
    showToast('Etkileşim sayısı 1 ile 10.000 arasında tam sayı olmalı', 'error');
    return;
  }
  button.disabled = true;
  try {
    const res = await api('/api/admin/business-level-rules', {
      method: 'PUT', body: JSON.stringify({ interactionsPerLevel }),
    });
    const data = res && await res.json();
    if (!res || !res.ok) throw new Error((data && data.error) || 'Kural kaydedilemedi');
    input.value = data.interactionsPerLevel;
    showToast('Seviye atlama kuralı kaydedildi', 'success');
    await loadApproved();
  } catch (err) {
    showToast(err.message || 'Kural kaydedilemedi', 'error');
  } finally {
    button.disabled = false;
  }
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
  loadWaInviteTemplate();
  const res = await api('/api/admin/pins?status=approved');
  if (!res) return;
  const pins = await res.json();
  pins.forEach(p => allPinsCache[p.id] = p);
  renderApprovedTable(pins);
}

async function refreshApproved() {
  const btn = document.getElementById('refreshApproved');
  btn.disabled = true;
  btn.textContent = 'Yenileniyor...';
  try {
    await Promise.all([loadApproved(), loadStats()]);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Yenile';
  }
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:32px">Bekleyen iğne yok ✅</td></tr>';
    return;
  }
  pins.slice(0, 6).forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${Number(p.id)}</strong></td>
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
    const photos = (p.images || []).map(u =>
      `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" /></a>`
    ).join('');
    tr.innerHTML = `
      <td><strong>#${Number(p.id)}</strong></td>
      <td>
        <div class="td-title">${esc(p.title)}</div>
        ${(p.sells || []).length ? `<div class="td-sub">🛒 ${esc(p.sells.join(', '))}</div>` : ''}
        ${(p.seeks || []).length ? `<div class="td-sub">🔎 ${esc(p.seeks.join(', '))}</div>` : ''}
        ${photos ? `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">${photos}</div>` : ''}
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
    const photos = (p.images || []).map(u =>
      `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" /></a>`
    ).join('');
    tr.innerHTML = `
      <td><strong>#${Number(p.id)}</strong></td>
      <td>
        <div class="td-title">${esc(p.title)}</div>
        ${(p.sells || []).length ? `<div class="td-sub">🛒 ${esc(p.sells.join(', '))}</div>` : ''}
        ${(p.seeks || []).length ? `<div class="td-sub">🔎 ${esc(p.seeks.join(', '))}</div>` : ''}
        ${photos ? `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">${photos}</div>` : ''}
      </td>
      <td>${esc(p.category)}</td>
      <td style="max-width:180px;word-break:break-word">${esc(p.address)}</td>
      <td>
        ${p.phone  ? `<div class="pin-phone-action"><span style="font-size:12px">📞 ${esc(p.phone)}</span><button type="button" class="btn-sm btn-wa btn-pin-invite">💬 WhatsApp'tan Davet Et</button></div>` : ''}
        ${p.email  ? `<div style="font-size:12px">✉ ${esc(p.email)}</div>` : ''}
        ${p.website? `<div style="font-size:12px">🌐 ${esc(p.website)}</div>` : ''}
        ${!p.phone && !p.email && !p.website ? '<span style="color:var(--text-3)">—</span>' : ''}
      </td>
      <td style="color:var(--text-3);font-size:12px">${formatDate(p.created_at)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
          <strong style="color:#fbbf24">⭐ ${Math.max(1, Number(p.level) || 1)}</strong>
          <button class="btn-level-up" onclick="increaseBusinessLevel(${Number(p.id)})" title="İşletme seviyesini 1 artır">＋1</button>
        </div>
      </td>
      <td>
        <div class="actions">
          <button class="btn-edit" onclick="openEditPinModal(${p.id})" style="background:var(--accent); color:#111; border:none; padding:4px 8px; border-radius:4px; font-weight:600; cursor:pointer; margin-right:6px;">✏️ Düzenle</button>
          <button class="btn-delete" onclick="deletePin(${p.id})">🗑 Sil</button>
        </div>
      </td>
    `;
    const inviteButton = tr.querySelector('.btn-pin-invite');
    if (inviteButton) {
      if (waInvitedIds().has(Number(p.id))) markInviteSent(inviteButton);
      inviteButton.onclick = () => { if (inviteBusinessWhatsapp(p)) markInviteSent(inviteButton); };
    }
    tbody.appendChild(tr);
  });
}

async function increaseBusinessLevel(id) {
  const res = await api(`/api/admin/pins/${id}/level`, { method: 'PATCH' });
  if (!res || !res.ok) {
    const err = res ? await res.json() : { error: 'Hata oluştu' };
    showToast(err.error || 'Seviye artırılamadı', 'error');
    return;
  }
  const data = await res.json();
  showToast(`İşletme seviyesi ${data.level} oldu`, 'success');
  await loadApproved();
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
      <td><strong>#${Number(p.id)}</strong></td>
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
  ads:       'İlanlar',
  reports:   'Hata Bildirimleri',
  claims:    'Dükkan Sahipleri',
  users:     'Kullanıcılar',
  economy:   'Ekonomi',
  broadcast: 'Toplu Bildirim',
  stats:     'İstatistikler',
  logs:      'Aktivite Logları',
  welcome:   'Açılış Ekranı',
  sponsor:   'Sponsorlu Reklam',
  appPromo:  'Uygulama İndirme',
  trends:    'Gündem Şeridi',
  promo:    'WhatsApp Reklam',
  engage:    'Kalma Süresi',
  audit:     'Raporlar',
  heatmap:   'Tıklama Haritası'
};

function showSection(name) {
  if (isMobileLayout()) closeSidebar();
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section${cap(name)}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav${cap(name)}`).classList.add('active');
  document.getElementById('topbarTitle').textContent = sectionTitles[name];
  
  if (name === 'stats') {
    loadStatsOverview();
  } else if (name === 'ads') {
    loadAds();
  } else if (name === 'logs') {
    loadLogs();
  } else if (name === 'users') {
    loadUsers();
  } else if (name === 'economy') {
    loadEconomyRules();
    loadEconomyLedger();
  } else if (name === 'claims') {
    loadClaims();
  } else if (name === 'heatmap') {
    loadHeatmap();
  } else if (name === 'welcome') {
    loadWelcome();
  } else if (name === 'sponsor') {
    loadSponsor();
  } else if (name === 'appPromo') {
    loadAppPromo();
  } else if (name === 'trends') {
    loadTrendSetting();
  } else if (name === 'promo') {
    loadPromo();
  } else if (name === 'engage') {
    loadEngagement();
  } else if (name === 'audit') {
    loadAuditReport();
  }
}

// ── Açılış ekranı ayarı ──────────────────────────────────────
const WELCOME_DEFAULT_IMAGE = 'img/banner.png';
let welcomeImageUrl = WELCOME_DEFAULT_IMAGE;

function showWelcomePreview() {
  document.getElementById('welcomeImagePreview').src = welcomeImageUrl === WELCOME_DEFAULT_IMAGE ? '/' + WELCOME_DEFAULT_IMAGE : welcomeImageUrl;
}

async function loadWelcome() {
  try {
    const res = await fetch('/api/welcome');
    const w = await res.json();
    document.getElementById('welcomeEnabled').checked = w.enabled !== false;
    document.getElementById('welcomeTitleInput').value = w.title || '';
    document.getElementById('welcomeTextInput').value = w.text || '';
    document.getElementById('welcomeButtonInput').value = w.button || '';
    document.getElementById('welcomeShowAgain').checked = false;
    welcomeImageUrl = w.image || WELCOME_DEFAULT_IMAGE;
    showWelcomePreview();
  } catch {
    showToast('Açılış ekranı ayarları yüklenemedi', 'error');
  }
}

async function pickWelcomeImage(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const btn = document.getElementById('welcomeSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Resim yükleniyor...';
  try {
    welcomeImageUrl = await uploadAdFile(await shrinkImage(file), 'image');
    showWelcomePreview();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Kaydet';
    input.value = '';
  }
}

function resetWelcomeImage() {
  welcomeImageUrl = WELCOME_DEFAULT_IMAGE;
  showWelcomePreview();
}

async function saveWelcome(event) {
  event.preventDefault();
  const res = await api('/api/admin/welcome', {
    method: 'PUT',
    body: JSON.stringify({
      enabled: document.getElementById('welcomeEnabled').checked,
      image: welcomeImageUrl,
      title: document.getElementById('welcomeTitleInput').value,
      text: document.getElementById('welcomeTextInput').value,
      button: document.getElementById('welcomeButtonInput').value,
      showAgain: document.getElementById('welcomeShowAgain').checked,
    }),
  });
  if (!res) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(data.error || 'Kaydedilemedi', 'error'); return; }
  document.getElementById('welcomeShowAgain').checked = false;
  showToast('Açılış ekranı kaydedildi', 'success');
}

// ── Sponsorlu reklam ayarı (birden fazla sponsor) ─────────────
const SPONSOR_DEFAULT_IMAGE = 'img/sponsor-qmove.webp';
const SPONSOR_MAX = 4;
const SPONSOR_PLACE_LABELS = {
  grid: 'İlan listesinde (6., 12. … kart)',
  strip: 'Vitrinin altında bant',
  detail: 'İşletme detay penceresinin altında',
  side: 'Masaüstünde sağda/solda (geniş ekranlarda, × ile kapatılabilir)',
};
const SPONSOR_TEXT_FIELDS = [
  { key: 'name', label: 'Reklam veren', max: 40, required: true },
  { key: 'title', label: 'Başlık', max: 120, required: true },
  { key: 'text', label: 'Yazı', max: 300, multiline: true },
  { key: 'button', label: 'Düğme yazısı', max: 40, required: true },
  { key: 'url', label: 'Bağlantı (https://)', max: 500, required: true, type: 'url' },
];
let sponsorDrafts = [];

const sponsorImageSrc = url => (url ? (url.startsWith('https://') ? url : '/' + url) : '');

function sponsorField(id, labelText, input) {
  const group = document.createElement('div');
  group.className = 'form-group';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  input.id = id;
  group.append(label, input);
  return group;
}

function renderSponsorForms() {
  const list = document.getElementById('sponsorList');
  list.replaceChildren();
  sponsorDrafts.forEach((s, i) => {
    const card = document.createElement('fieldset');
    card.className = 'broadcast-card';
    card.style.cssText = 'margin:0;border:1px solid var(--border)';
    const legend = document.createElement('legend');
    legend.style.cssText = 'padding:0 8px;font-weight:700';
    legend.textContent = `${i + 1}. sponsor${s.name ? ` · ${s.name}` : ''}`;
    card.appendChild(legend);

    const enabled = document.createElement('label');
    const enabledBox = document.createElement('input');
    enabledBox.type = 'checkbox';
    enabledBox.checked = s.enabled === true;
    enabledBox.style.cssText = 'width:auto;margin-right:8px';
    enabledBox.onchange = () => { s.enabled = enabledBox.checked; };
    enabled.append(enabledBox, 'Bu reklam gösterilsin');
    const enabledGroup = document.createElement('div');
    enabledGroup.className = 'form-group';
    enabledGroup.appendChild(enabled);
    card.appendChild(enabledGroup);

    const places = document.createElement('div');
    places.className = 'form-group';
    const placesTitle = document.createElement('label');
    placesTitle.textContent = 'Gösterileceği yerler';
    places.appendChild(placesTitle);
    for (const [key, text] of Object.entries(SPONSOR_PLACE_LABELS)) {
      const row = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!(s.places && s.places[key]);
      box.style.cssText = 'width:auto;margin-right:8px';
      box.onchange = () => { s.places = { ...(s.places || {}), [key]: box.checked }; };
      row.append(box, text);
      places.appendChild(row);
    }
    card.appendChild(places);

    // Resim
    const imgGroup = document.createElement('div');
    imgGroup.className = 'form-group';
    const imgLabel = document.createElement('label');
    imgLabel.htmlFor = `sp${i}-file`;
    imgLabel.textContent = 'Resim';
    const preview = document.createElement('img');
    preview.alt = `${s.name || 'Sponsor'} resmi önizlemesi`;
    preview.style.cssText = 'display:block;max-width:200px;max-height:300px;border-radius:10px;margin-bottom:8px';
    const noImage = document.createElement('p');
    noImage.style.cssText = 'margin:0 0 8px;color:var(--text-3)';
    noImage.textContent = 'Resim yok, reklam yalnızca yazıyla görünür.';
    const showImage = () => {
      preview.hidden = !s.image;
      preview.src = sponsorImageSrc(s.image);
      noImage.hidden = !!s.image;
    };
    showImage();
    const file = document.createElement('input');
    file.type = 'file';
    file.id = `sp${i}-file`;
    file.accept = 'image/jpeg,image/png,image/webp';
    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const btn = document.getElementById('sponsorSaveBtn');
      btn.disabled = true;
      btn.textContent = 'Resim yükleniyor...';
      try {
        s.image = await uploadAdFile(await shrinkImage(f), 'image');
        showImage();
        showToast('Resim yüklendi, kaydetmeyi unutmayın', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Kaydet';
        file.value = '';
      }
    };
    const imgButtons = document.createElement('div');
    imgButtons.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
    if (s.id === 'qmove' || s.image === SPONSOR_DEFAULT_IMAGE) {
      const def = document.createElement('button');
      def.type = 'button';
      def.className = 'btn-sm';
      def.textContent = 'Varsayılan QMove afişi';
      def.onclick = () => { s.image = SPONSOR_DEFAULT_IMAGE; showImage(); };
      imgButtons.appendChild(def);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-sm';
    remove.textContent = 'Resmi kaldır';
    remove.onclick = () => { s.image = ''; showImage(); };
    imgButtons.appendChild(remove);
    imgGroup.append(imgLabel, preview, noImage, file, imgButtons);
    card.appendChild(imgGroup);

    for (const f of SPONSOR_TEXT_FIELDS) {
      const input = document.createElement(f.multiline ? 'textarea' : 'input');
      if (!f.multiline) input.type = f.type || 'text';
      else input.rows = 3;
      input.maxLength = f.max;
      input.required = !!f.required;
      if (f.type === 'url') input.pattern = 'https://.*';
      input.value = s[f.key] || '';
      input.oninput = () => {
        s[f.key] = input.value;
        if (f.key === 'name') legend.textContent = `${i + 1}. sponsor${input.value ? ` · ${input.value}` : ''}`;
      };
      card.appendChild(sponsorField(`sp${i}-${f.key}`, f.label, input));
    }

    if (sponsorDrafts.length > 1) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-sm btn-reject';
      del.textContent = 'Bu sponsoru sil';
      del.onclick = () => {
        if (!confirm(`${s.name || 'Bu sponsor'} silinsin mi? Kaydet'e basınca kalıcı olur.`)) return;
        sponsorDrafts.splice(i, 1);
        renderSponsorForms();
      };
      card.appendChild(del);
    }
    list.appendChild(card);
  });
  document.getElementById('sponsorAddBtn').hidden = sponsorDrafts.length >= SPONSOR_MAX;
}

function addSponsor() {
  if (sponsorDrafts.length >= SPONSOR_MAX) return;
  sponsorDrafts.push({ enabled: false, name: '', title: '', text: '', button: 'İncele', url: 'https://', image: '',
    places: { grid: true, strip: true, detail: true, side: true } });
  renderSponsorForms();
}

async function loadSponsor() {
  try {
    const res = await fetch('/api/sponsor');
    const data = res.ok ? await res.json() : {};
    const list = Array.isArray(data.sponsors) ? data.sponsors : (data.name ? [data] : []);
    sponsorDrafts = list.map(s => ({ ...s, places: { ...(s.places || {}) } }));
    document.getElementById('sponsorSideClose').checked = data.sideClose !== false;
    if (!sponsorDrafts.length) addSponsor();
    else renderSponsorForms();
  } catch {
    showToast('Sponsor ayarı okunamadı', 'error');
  }
}

// ── Gündem şeridi ayarı ───────────────────────────────────────
function renderTrendSetting(d) {
  document.getElementById('trendEnabled').checked = d.enabled !== false;
  const box = document.getElementById('trendPreview');
  const items = d.items || [];
  box.innerHTML = d.enabled === false
    ? 'Şerit şu an <b>kapalı</b>.'
    : (items.length ? `<b>Şu an akan ${items.length} etiket:</b><br>${items.map(t => escHtmlSafe(t.tag)).join(' · ')}` : 'Google şu an trend vermedi, şerit görünmüyor.');
}
async function loadTrendSetting() {
  const res = await api('/api/admin/trends');
  if (!res) return;
  renderTrendSetting(await res.json().catch(() => ({})));
}
async function saveTrendSetting(event) {
  event.preventDefault();
  const enabled = document.getElementById('trendEnabled').checked;
  const res = await api('/api/admin/trends', { method: 'PUT', body: JSON.stringify({ enabled }) });
  if (!res) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(data.error || 'Kaydedilemedi', 'error'); return; }
  showToast(enabled ? 'Gündem şeridi açıldı' : 'Gündem şeridi kapatıldı', 'success');
  loadTrendSetting();
}

// ── Uygulama indirme ayarı ────────────────────────────────────
function fillAppPromo(d) {
  document.getElementById('apMenuButton').checked = d.menuButton !== false;
  document.getElementById('apHomeCard').checked = d.homeCard !== false;
  document.getElementById('apPlayLink').checked = d.playLink !== false;
  document.getElementById('apLabel').value = d.label || 'Uygulamayı İndir';
}
async function loadAppPromo() {
  try {
    const res = await fetch('/api/app-promo', { cache: 'no-store' });
    fillAppPromo(res.ok ? await res.json() : {});
  } catch { showToast('Ayar okunamadı', 'error'); }
}
async function saveAppPromo(event) {
  event.preventDefault();
  const body = {
    menuButton: document.getElementById('apMenuButton').checked,
    homeCard: document.getElementById('apHomeCard').checked,
    playLink: document.getElementById('apPlayLink').checked,
    label: document.getElementById('apLabel').value.trim(),
  };
  const res = await api('/api/admin/app-promo', { method: 'PUT', body: JSON.stringify(body) });
  if (!res) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(data.error || 'Kaydedilemedi', 'error'); return; }
  fillAppPromo(data);
  showToast('Uygulama indirme ayarı kaydedildi', 'success');
}

async function saveSponsor(event) {
  event.preventDefault();
  const res = await api('/api/admin/sponsor', { method: 'PUT', body: JSON.stringify({ sponsors: sponsorDrafts, sideClose: document.getElementById('sponsorSideClose').checked }) });
  if (!res) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(data.error || 'Kaydedilemedi', 'error'); return; }
  sponsorDrafts = (data.sponsors || []).map(s => ({ ...s, places: { ...(s.places || {}) } }));
  document.getElementById('sponsorSideClose').checked = data.sideClose !== false;
  renderSponsorForms();
  const on = sponsorDrafts.filter(s => s.enabled).length;
  showToast(on ? `${on} sponsorlu reklam açık ve kaydedildi` : 'Tüm sponsorlu reklamlar kapatıldı', 'success');
}

// ── WhatsApp reklam mesajı ───────────────────────────────────
let promoBusinessCount = '470+';
let promoActive = 'genel';

const PROMO_TEMPLATES = {
  genel: { label: 'Genel Tanıtım', image: 'genel', link: 'https://newhal.com/tanitim', text: () => `🍊 *MERSİN HALİ ARTIK CEBİNİZDE!* 🍅

Hal esnafını aramakla vakit kaybetmeyin.
*NewHal* ile hepsi tek haritada:

🗺️ *${promoBusinessCount} işletme* haritada
📞 Esnafa *tek dokunuşla* ulaşın
📢 *Ücretsiz* ilan verin
🚚 Komisyoncu, tüccar, nakliyeci, market

━━━━━━━━━━━━
👉 https://newhal.com/tanitim
━━━━━━━━━━━━

_Ücretsiz. Uygulama indirmeye gerek yok._` },
  esnaf: { label: 'Esnafa Davet', image: 'esnaf', link: 'https://newhal.com/davet', text: () => `Merhaba, iyi çalışmalar 🌿

*Dükkanınız NewHal haritasında!* 📍
Mersin'in hal ve çevre esnafı burada buluşuyor.

Dükkanınızı *ücretsiz* sahiplenin:
✅ Bilgilerinizi kendiniz güncelleyin
✅ Ürün ve fotoğraflarınızı ekleyin
✅ *Ücretsiz ilan* verin
✅ Müşteriler sizi kolayca bulsun

━━━━━━━━━━━━
👉 https://newhal.com/davet
━━━━━━━━━━━━

_İstemiyorsanız yazmanız yeterli, bir daha rahatsız etmeyiz._` },
  ilan: { label: 'Ücretsiz İlan', image: 'ilan', link: 'https://newhal.com/ilan-ver', text: () => `📢 *ALIM SATIMINIZ VAR MI?*

Sebze, meyve, nakliye, kasa, iş ilanı...
İlanınızı *NewHal*'e verin, hal esnafı görsün!

💰 Tamamen *ücretsiz*
⏱️ *1 dakikada* yayında
📸 Fotoğraf ve video ekleyin

━━━━━━━━━━━━
👉 https://newhal.com/ilan-ver
━━━━━━━━━━━━` },
};

function renderPromoPreview() {
  document.getElementById('promoPreview').innerHTML = esc(document.getElementById('promoText').value)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<i>$2</i>');
}

function selectPromo(key) {
  promoActive = key;
  document.getElementById('promoText').value = PROMO_TEMPLATES[key].text();
  document.getElementById('promoImage').src = promoImageUrl();
  document.querySelectorAll('.promo-chip').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  renderPromoPreview();
}

async function loadPromo() {
  const chips = document.getElementById('promoChips');
  if (!chips.children.length) {
    Object.entries(PROMO_TEMPLATES).forEach(([key, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'promo-chip';
      b.dataset.key = key;
      b.textContent = t.label;
      b.onclick = () => selectPromo(key);
      chips.appendChild(b);
    });
    selectPromo(promoActive);
  }
  try {
    const res = await fetch('/api/pins');
    const pins = await res.json();
    if (Array.isArray(pins) && pins.length >= 10) {
      const next = `${Math.floor(pins.length / 10) * 10}+`;
      if (next !== promoBusinessCount) {
        const old = PROMO_TEMPLATES[promoActive].text();
        promoBusinessCount = next;
        if (document.getElementById('promoText').value === old) selectPromo(promoActive);
      }
    }
  } catch {}
}

function promoImageUrl() {
  return `/img/promo/${PROMO_TEMPLATES[promoActive].image}.jpg`;
}

async function promoImageFile() {
  const res = await fetch(promoImageUrl());
  if (!res.ok) throw new Error('Resim alınamadı');
  return new File([await res.blob()], `newhal-${PROMO_TEMPLATES[promoActive].image}.jpg`, { type: 'image/jpeg' });
}

function saveFileToDevice(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function downloadPromoImage() {
  try {
    saveFileToDevice(await promoImageFile());
    showToast('Resim indirildi', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function sharePromo() {
  const text = document.getElementById('promoText').value.trim();
  if (!text) { showToast('Mesaj boş', 'error'); return; }
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

async function copyPromoLink() {
  try {
    await navigator.clipboard.writeText(PROMO_TEMPLATES[promoActive].link);
    showToast('Link kopyalandı', 'success');
  } catch {
    showToast('Kopyalanamadı', 'error');
  }
}

async function copyPromo() {
  try {
    await navigator.clipboard.writeText(document.getElementById('promoText').value);
    showToast('Mesaj kopyalandı', 'success');
  } catch {
    showToast('Kopyalanamadı', 'error');
  }
}

// ── Kalma süresi ─────────────────────────────────────────────
const percent = (part, whole) => (whole ? Math.round(part * 100 / whole) : 0);
const formatSeconds = (s) => (s < 60 ? `${Math.round(s)} sn` : `${Math.floor(s / 60)} dk ${Math.round(s % 60)} sn`);

async function loadEngagement() {
  const res = await api('/api/admin/engagement');
  if (!res) return;
  const box = document.getElementById('engageBox');
  if (!res.ok) { box.textContent = 'Yüklenemedi'; return; }
  const data = await res.json();
  document.getElementById('engageMeta').textContent = `${formatDate(data.since)} tarihinden beri`;
  const rows = Object.entries(data.sources).sort((a, b) => b[1].total - a[1].total);
  if (!rows.length) { box.textContent = 'Henüz veri yok. Ziyaretçiler siteden ayrıldıkça burada görünecek.'; return; }
  const all = rows.reduce((sum, [, r]) => ({
    total: sum.total + r.total,
    interacted: sum.interacted + r.interacted,
    seconds: sum.seconds + r.seconds,
    buckets: sum.buckets.map((n, i) => n + r.buckets[i]),
  }), { total: 0, interacted: 0, seconds: 0, buckets: [0, 0, 0, 0, 0] });
  const line = (name, r, strong) => `<tr${strong ? ' style="font-weight:700"' : ''}>
    <td style="padding:8px">${esc(name)}</td>
    <td style="padding:8px">${r.total}</td>
    <td style="padding:8px">%${percent(r.buckets[0], r.total)}</td>
    <td style="padding:8px">%${percent(r.total - r.interacted, r.total)}</td>
    <td style="padding:8px">%${percent(r.buckets[3] + r.buckets[4], r.total)}</td>
    <td style="padding:8px">${formatSeconds(r.seconds / r.total)}</td>
  </tr>`;
  box.innerHTML = `<table style="width:100%;border-collapse:collapse;text-align:left">
    <thead><tr>
      <th style="padding:8px">Nereden geldi</th><th style="padding:8px">Ziyaret</th>
      <th style="padding:8px">10 sn'den kısa</th><th style="padding:8px">Hiç dokunmadan çıkan</th>
      <th style="padding:8px">2 dk'dan uzun</th><th style="padding:8px">Ortalama</th>
    </tr></thead>
    <tbody>${rows.map(([name, r]) => line(name, r)).join('')}${line('Toplam', all, true)}</tbody>
  </table>`;
}

async function resetEngagement() {
  if (!confirm('Kalma süresi verileri sıfırlansın mı?')) return;
  const res = await api('/api/admin/engagement', { method: 'DELETE' });
  if (!res) return;
  if (!res.ok) { showToast('Sıfırlanamadı', 'error'); return; }
  showToast('Sıfırlandı', 'success');
  loadEngagement();
}

async function sendBroadcast(event) {
  event.preventDefault();
  const title = document.getElementById('broadcastTitle').value.trim();
  const body = document.getElementById('broadcastBody').value.trim();
  const button = document.getElementById('broadcastSend');
  const status = document.getElementById('broadcastStatus');
  if (!title || !body) return;
  if (!confirm('Bu bildirim tüm kayıtlı üyelere gönderilecek. Göndermek istiyor musunuz?')) return;

  button.disabled = true;
  button.textContent = 'Gönderiliyor...';
  status.textContent = '';
  status.className = 'broadcast-status';
  try {
    const res = await api('/api/admin/notifications/broadcast', {
      method: 'POST', body: JSON.stringify({ title, body }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Bildirim gönderilemedi');
    status.textContent = `${data.sent} üyeye uygulama bildirimi gönderildi.`
      + (data.email?.configured
        ? ` ${data.email.sent} e-posta gönderildi${data.email.failed ? `, ${data.email.failed} başarısız` : ''}.`
        : ' E-posta gönderimi henüz ayarlanmamış.');
    status.classList.add('success');
    document.getElementById('broadcastForm').reset();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  } finally {
    button.disabled = false;
    button.textContent = '📣 Tüm Üyelere Gönder';
  }
}

const isMobileLayout = () => window.matchMedia('(max-width: 900px)').matches;

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (isMobileLayout()) {
    sb.classList.remove('collapsed');
    sb.classList.contains('open') ? closeSidebar() : openSidebar();
  } else {
    sb.classList.remove('open');
    sb.classList.toggle('collapsed');
  }
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('open');
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');
  document.body.classList.remove('sidebar-open');
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
window.addEventListener('resize', () => { if (!isMobileLayout()) closeSidebar(); });

// ── Helpers ────────────────────────────────────────────────────
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    let s = String(dateStr).replace(' ', 'T');
    if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z';
    const d = new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr; }
}

function showToast(msg, type='info') {
  const container = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// ── USERS ─────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('Auth hatası');
    const users = await res.json();
    
    const tbody = document.getElementById('usersBody');
    const empty = document.getElementById('usersEmpty');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      users.forEach(u => {
        const tr = document.createElement('tr');
        const d = new Date(u.created_at).toLocaleString('tr-TR');
        const avatar = u.avatar ? `<img src="${esc(u.avatar)}" style="width:32px;height:32px;border-radius:50%;" />` : '👤';
        tr.innerHTML = `
          <td>${avatar}</td>
          <td><strong>#${Number(u.id)}</strong></td>
          <td><strong>${esc(u.name)}</strong></td>
          <td>${esc(u.email)}</td>
          <td>${u.phone_number ? `<a href="tel:${esc(String(u.phone_number).replace(/\D/g, ''))}">${esc(u.phone_number)}</a>` : '—'}</td>
          <td style="color:var(--text-3); font-family:monospace; font-size:12px;">${esc(u.googleId) || '-'}</td>
          <td><strong id="userPointsBalance-${Number(u.id)}" data-balance="${Number(u.points_balance || 0)}">${Number(u.points_balance || 0).toLocaleString('tr-TR')} Para Puan</strong></td>
          <td><strong id="userLevel-${Number(u.id)}">Seviye ${Number(u.level || 1)}</strong></td>
          <td class="user-points-actions"><input type="number" id="userPointsAmount-${Number(u.id)}" min="1" max="100000" step="1" placeholder="Miktar" aria-label="Yüklenecek Para Puan" /><button type="button" class="btn-sm btn-approve" onclick="addUserPoints(${Number(u.id)})">Yükle</button></td>
          <td>${d}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    showToast('Kullanıcılar yüklenemedi', 'error');
  }
}

async function addUserPoints(userId) {
  const input = document.getElementById(`userPointsAmount-${userId}`);
  const amount = Number(input && input.value);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000) {
    return showToast('1 ile 100.000 arasında tam sayı girin', 'error');
  }
  try {
    const res = await api(`/api/admin/users/${userId}/points`, {
      method: 'POST', body: JSON.stringify({ amount }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Para Puan yüklenemedi');
    const balance = document.getElementById(`userPointsBalance-${userId}`);
    const next = Number(balance.dataset.balance || 0) + data.amount;
    balance.dataset.balance = String(next);
    balance.textContent = `${next.toLocaleString('tr-TR')} Para Puan`;
    document.getElementById(`userLevel-${userId}`).textContent = `Seviye ${Math.floor(next / 1000) + 1}`;
    input.value = '';
    showToast(`${data.amount.toLocaleString('tr-TR')} Para Puan yüklendi`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
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
          <button class="btn-edit" data-name="${esc(cat.name)}" data-icon="${esc(cat.icon || '')}" onclick="openEditCategoryModal(this.dataset.name, this.dataset.icon)" style="background:var(--accent); color:#111; border:none; padding:4px 8px; border-radius:4px; font-weight:600; cursor:pointer;">✏️ Düzenle</button>
          ${!isGenel ? `<button class="btn-delete" data-name="${esc(cat.name)}" onclick="deleteCategory(this.dataset.name)">🗑 Sil</button>` : `<span style="font-size: 11.5px; color: var(--text-3); font-style: italic; padding: 4px 6px;">Varsayılan (Kilitli)</span>`}
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
  '🥑', '🥕', '🧄', '🍞', '🥜', '🧀', '🥚', '🍗', '🦐', '🦀', '🧉', '🏺', '🌸', '🪴', '🚚', '🚜', '💰', '🛠️',
  '🍎', '🍏', '🍐', '🍑', '🥭', '🍍', '🥥', '🥝', '🍈', '🫐', '🫒', '🍆', '🌽', '🥒', '🫑', '🫛', '🍠', '🫚',
  '🫘', '🌰', '🍄', '🍚', '🌿', '🍃', '🧂', '🫙', '🍯', '🍫', '🍬', '☕', '🍵', '🥖', '🥐', '🥨', '🫓', '🍝',
  '🐠', '🦑', '🐙', '🦞', '🦪', '🐄', '🐑', '🐔', '🦃', '🥓', '🍖', '🥛', '🧈', '🍦', '🧃', '🥤', '🍷', '🧊',
  '💧', '🌻', '🌷', '🌹', '💐', '🌱', '🌳', '🧑‍🌾', '🐝', '🛒', '🧺', '🏬', '🏭', '🏢', '🚛', '🛻', '🚐', '🏗️',
  '📍', '🏷️', '⚖️', '🧾', '💳', '💵', '📞', '🤝', '⭐', '✅', '🔥', '🥡', '🛍️', '🪣', '🧹', '🧽', '🧴', '🔧',
  '🔨', '⚙️', '🔌', '💡', '❄️'
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

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxNativeZoom: 19,
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

// ── Dükkan Sahipleri ("Bu dükkan benim" istekleri) ─────────────
const CLAIM_STATUS = { pending: '⏳ Bekliyor', approved: '✅ Onaylandı', rejected: '✕ Reddedildi' };

function shortDate(iso) {
  try { return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso || ''; }
}

async function loadClaims() {
  const res = await api('/api/admin/claims');
  if (!res || !res.ok) return;
  const { requests, verified } = await res.json();

  const pending = requests.filter(r => r.status === 'pending');
  const badge = document.getElementById('claimsBadge');
  badge.textContent = pending.length || '';
  badge.style.display = pending.length ? '' : 'none';

  const tbody = document.getElementById('claimsBody');
  tbody.innerHTML = '';
  // Bekleyenler üstte, sonuçlananlardan son 30 tanesi altta
  const rows = [...pending, ...requests.filter(r => r.status !== 'pending').slice(0, 30)];
  document.getElementById('claimsEmpty').style.display = rows.length ? 'none' : 'block';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    if (r.status !== 'pending') tr.className = 'claim-done';
    tr.innerHTML = `
      <td><div style="font-weight:600;">${esc(r.pinTitle)}</div><div style="font-size:11px;color:var(--text-3);">No: ${r.pinId}</div></td>
      <td><div>${esc(r.userName)}</div><div style="font-size:11px;color:var(--text-3);">${esc(r.userEmail)}</div></td>
      <td><a href="tel:${esc(r.phone)}" class="claim-phone">📞 ${esc(r.phone)}</a></td>
      <td style="min-width:160px;max-width:260px;overflow-wrap:anywhere;font-size:13px;">${esc(r.note) || '<span style="color:var(--text-3);">—</span>'}</td>
      <td style="font-size:12px;color:var(--text-3);">${shortDate(r.createdAt)}</td>
      <td class="claim-actions">${r.status === 'pending'
        ? `<button class="btn-approve" onclick="approveClaim('${r.id}')">✓ Onayla</button>
           <button class="btn-reject" onclick="rejectClaim('${r.id}')">✕ Reddet</button>`
        : `<span class="claim-status ${r.status}">${CLAIM_STATUS[r.status]}</span>${r.reason ? `<div style="font-size:11px;color:var(--text-3);">${esc(r.reason)}</div>` : ''}`}</td>`;
    tbody.appendChild(tr);
  });

  const vbody = document.getElementById('verifiedBody');
  vbody.innerHTML = '';
  document.getElementById('verifiedEmpty').style.display = verified.length ? 'none' : 'block';
  const titles = Object.fromEntries(requests.map(r => [r.pinId, r.pinTitle]));
  verified.sort((a, b) => String(b.at).localeCompare(String(a.at))).forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div style="font-weight:600;">✅ ${esc(v.title || titles[v.pinId] || 'Dükkan')}</div><div style="font-size:11px;color:var(--text-3);">No: ${v.pinId}</div></td>
      <td><div>${esc(v.name)}</div><div style="font-size:11px;color:var(--text-3);">${esc(v.email)}</div></td>
      <td>${v.phone ? `<a href="tel:${esc(v.phone)}" class="claim-phone">📞 ${esc(v.phone)}</a>` : '—'}</td>
      <td style="font-size:12px;color:var(--text-3);">${shortDate(v.at)}</td>
      <td><button class="btn-reject" onclick="revokeOwner(${v.pinId})">Sahipliği kaldır</button></td>`;
    vbody.appendChild(tr);
  });
}

async function approveClaim(id) {
  if (!confirm('Bu kişiyi dükkanın sahibi olarak onaylıyor musunuz? Dükkanın bilgilerini ve ürünlerini kendisi değiştirebilecek.')) return;
  const res = await api(`/api/admin/claims/${id}/approve`, { method: 'PATCH' });
  const data = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) return showToast(data.error || 'Onaylanamadı', 'error');
  showToast('✅ Dükkan sahibi onaylandı', 'success');
  loadClaims();
}

async function rejectClaim(id) {
  const reason = prompt('Reddetme sebebi (isteğe bağlı, kişiye gösterilir):', '');
  if (reason === null) return;
  const res = await api(`/api/admin/claims/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) });
  if (!res || !res.ok) return showToast('Reddedilemedi', 'error');
  showToast('İstek reddedildi', 'success');
  loadClaims();
}

async function revokeOwner(pinId) {
  if (!confirm('Bu dükkanın sahipliği kaldırılsın mı? Onay rozeti gider ve sahibi artık düzenleyemez.')) return;
  const res = await api(`/api/admin/claims/verified/${pinId}`, { method: 'DELETE' });
  if (!res || !res.ok) return showToast('Kaldırılamadı', 'error');
  showToast('Sahiplik kaldırıldı', 'success');
  loadClaims();
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
  logs.forEach(log => {
    const tr = document.createElement('tr');
    
    let timeStr = '';
    try {
      const d = new Date(log.created_at);
      timeStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      timeStr = log.created_at;
    }

    tr.innerHTML = `
      <td style="font-size: 12px; color: var(--text-3); width: 140px;">${log.is_admin ? '🛡️ Yönetim' : '👤 Ziyaretçi'}</td>
      <td style="font-weight: 500; color: var(--text-1);">${esc(log.message || log.action || '')}</td>
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


// ── İlanlar ────────────────────────────────────────────────────
const AD_MAX_PHOTOS = 5;
let adPhotoUrls = [];
let adPhotoBusy = 0;
let adVideoUrl = null;
let adVideoBusy = false;

// Hikaye için dükkan listesi (onaylı dükkanlar, ada göre)
function fillAdPinSelect(selected) {
  const select = document.getElementById('adPin');
  const pins = Object.values(allPinsCache).filter(p => p.status === 'approved')
    .sort((a, b) => a.title.localeCompare(b.title, 'tr'));
  select.innerHTML = '<option value="">Hikaye olmasın</option>';
  pins.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    select.appendChild(opt);
  });
  select.value = selected ? String(selected) : '';
}

async function loadAds() {
  fillAdPinSelect(document.getElementById('adPin').value);
  loadFacebookStatus();
  loadWaTemplate();
  await loadAdStats();
  const [res, settingsRes] = await Promise.all([api('/api/admin/ads'), api('/api/admin/ad-story-settings')]);
  if (!res) return;
  const ads = await res.json();
  if (settingsRes && settingsRes.ok) {
    const settings = await settingsRes.json();
    document.getElementById('adStoryEnabled').checked = settings.enabled !== false;
    document.getElementById('adStoryDays').value = Number(settings.days) || 7;
    document.getElementById('adStoryGroupSize').value = Number(settings.groupSize) || 10;
  }
  // Onay bekleyenler en üstte
  ads.sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0));
  renderAdList(ads);
  renderAdPhotos();
  updateAdsBadge(ads);
  loadWaSentCounts();
}

// İlanlar başlığının yanında: bugün ve dün ilan sahiplerine gönderilen WhatsApp mesajı sayısı
async function loadWaSentCounts() {
  const res = await api('/api/admin/wa-sent-counts');
  if (!res || !res.ok) return;
  const d = await res.json().catch(() => ({}));
  document.getElementById('waSentToday').textContent = d.today ?? 0;
  document.getElementById('waSentYesterday').textContent = d.yesterday ?? 0;
}

async function saveAdStorySettings() {
  const payload = {
    enabled: document.getElementById('adStoryEnabled').checked,
    days: Number(document.getElementById('adStoryDays').value),
    groupSize: Number(document.getElementById('adStoryGroupSize').value),
  };
  if (!Number.isInteger(payload.days) || payload.days < 1 || payload.days > 30
    || !Number.isInteger(payload.groupSize) || payload.groupSize < 1 || payload.groupSize > 50) {
    showToast('Gün sayısı 1-30, hikaye başına ilan sayısı 1-50 arasında olmalı', 'error');
    return;
  }
  const button = document.getElementById('saveAdStorySettings');
  button.disabled = true;
  try {
    const res = await api('/api/admin/ad-story-settings', { method: 'PUT', body: JSON.stringify(payload) });
    const data = res && await readApiJson(res, 'Hikaye ayarları kaydedilirken geçersiz yanıt alındı');
    if (!res || !res.ok) throw new Error((data && data.error) || 'Hikaye ayarları kaydedilemedi');
    showToast('Harita hikayesi ayarları kaydedildi', 'success');
  } catch (err) { showToast(err.message || 'Hikaye ayarları kaydedilemedi', 'error'); }
  finally { button.disabled = false; }
}

function updateAdsBadge(ads) {
  const n = ads.filter(a => a.pending).length;
  const badge = document.getElementById('adsBadge');
  if (badge) badge.textContent = n > 0 ? n : '';
}

// ── Facebook sayfası ───────────────────────────────────────────
let fbConnected = false;

async function loadFacebookStatus() {
  const res = await api('/api/admin/facebook');
  if (!res) return;
  const d = await res.json();
  fbConnected = !!d.connected;
  document.getElementById('fbStatus').textContent = d.connected
    ? `✅ Bağlı: ${d.page_name} (facebook.com/${d.page_username})`
    : `Bağlı değil. İlanları facebook.com/${d.page_username} sayfasına göndermek için bağlayın.`;
  document.getElementById('fbToggleBtn').textContent = d.connected ? 'Bağlantıyı Kes' : 'Bağla';
  document.getElementById('fbCard').classList.toggle('connected', fbConnected);
  document.querySelectorAll('[data-act="facebook"]').forEach(b => { b.disabled = !fbConnected; });
}

async function toggleFbConnectForm() {
  if (fbConnected) {
    if (!confirm('Facebook sayfası bağlantısı kesilsin mi? İlanlar artık Facebook\'a gönderilemez.')) return;
    await api('/api/admin/facebook', { method: 'DELETE' });
    showToast('Facebook bağlantısı kesildi', 'success');
    return loadFacebookStatus();
  }
  const form = document.getElementById('fbConnectForm');
  form.hidden = !form.hidden;
}

async function connectFacebook(e) {
  e.preventDefault();
  const btn = document.getElementById('fbConnectBtn');
  btn.disabled = true;
  btn.textContent = 'Bağlanıyor...';
  try {
    const res = await api('/api/admin/facebook/connect', {
      method: 'POST',
      body: JSON.stringify({
        appId: document.getElementById('fbAppId').value,
        appSecret: document.getElementById('fbAppSecret').value,
        userToken: document.getElementById('fbUserToken').value,
      }),
    });
    if (!res) return;
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Bağlanamadı');
    document.getElementById('fbConnectForm').reset();
    document.getElementById('fbConnectForm').hidden = true;
    showToast(`📘 ${d.page_name} sayfası bağlandı`, 'success');
    loadFacebookStatus();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sayfayı Bağla';
  }
}

async function shareAdToFacebook(ad, btn) {
  if (!fbConnected) return showToast('Önce yukarıdan Facebook sayfasını bağlayın', 'error');
  const name = ad.title || 'Başlıksız ilan';
  const again = ad.facebook ? '\n\nBu ilan daha önce paylaşıldı, tekrar paylaşılacak.' : '';
  if (!confirm(`"${name}" Facebook sayfasında yayınlansın mı?${again}`)) return;
  btn.disabled = true;
  btn.textContent = 'Gönderiliyor...';
  try {
    const res = await api(`/api/admin/ads/${encodeURIComponent(ad.id)}/facebook`, { method: 'POST' });
    if (!res) return;
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Gönderilemedi');
    showToast('📘 İlan Facebook sayfasında yayınlandı', 'success');
    loadAds();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = '📘 Facebook\'a Gönder';
  }
}

// Tek kullanımlık adres al, dosyayı doğrudan depoya yükle (ilerleme göstererek)
async function uploadAdFile(file, kind, onProgress) {
  const res = await api('/api/admin/ads/upload-url', {
    method: 'POST',
    body: JSON.stringify({ kind, type: file.type, size: file.size }),
  });
  if (!res) throw new Error('Oturum süresi doldu');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Yükleme başlatılamadı');
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', data.uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('Yükleme başarısız')));
    xhr.onerror = () => reject(new Error('Bağlantı hatası'));
    xhr.send(file);
  });
  return data.publicUrl;
}

// Resmi tarayıcıda küçültür (en fazla 1600 px) ve JPEG yapar
function shrinkImage(file, maxSize = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(new File([b], 'ilan.jpg', { type: 'image/jpeg' })) : reject(new Error('Resim işlenemedi'))), 'image/jpeg', quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Bu dosya bir resim değil'));
    img.src = URL.createObjectURL(file);
  });
}

function renderAdPhotos() {
  const box = document.getElementById('adPhotos');
  box.innerHTML = '';
  adPhotoUrls.forEach((url, i) => {
    const item = document.createElement('div');
    item.className = 'ad-photo';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Resmi kaldır';
    del.onclick = () => { adPhotoUrls.splice(i, 1); renderAdPhotos(); };
    item.append(img, del);
    box.appendChild(item);
  });
  for (let i = 0; i < adPhotoBusy; i++) {
    const loading = document.createElement('div');
    loading.className = 'ad-photo loading';
    loading.textContent = '⟳';
    box.appendChild(loading);
  }
  if (adPhotoUrls.length + adPhotoBusy < AD_MAX_PHOTOS) {
    const add = document.createElement('label');
    add.className = 'ad-photo add';
    add.innerHTML = '<span>＋</span><small>Resim</small>';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
    input.hidden = true;
    input.onchange = () => addAdPhotos([...input.files]);
    add.appendChild(input);
    box.appendChild(add);
  }
}

async function addAdPhotos(files) {
  const room = AD_MAX_PHOTOS - adPhotoUrls.length - adPhotoBusy;
  if (files.length > room) showToast(`En fazla ${AD_MAX_PHOTOS} resim eklenebilir`, 'error');
  const batch = files.slice(0, Math.max(0, room));
  adPhotoBusy += batch.length;
  renderAdPhotos();
  await Promise.all(batch.map(async file => {
    try {
      adPhotoUrls.push(await uploadAdFile(await shrinkImage(file), 'image'));
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      adPhotoBusy--;
      renderAdPhotos();
    }
  }));
}

// ── Facebook gönderisinden ilan: yapıştırılan içerik yazı ve resim olarak ayrılır ──
let fbImportFiles = [];   // panodan gelen resim dosyaları
let fbImportUrls = [];    // yapıştırılan içerikteki Facebook resim adresleri
let fbImportText = '';    // yapıştırılan yazı (kutuda elle değiştirilirse o hali)

// Facebook ekranındaki düğme ve sayaç yazıları ilan metnine girmesin
const FB_NOISE = [
  /^(beğen|yorum yap|yorum|paylaş|gönder|yanıtla|takip et|katıl|mesaj gönder|daha fazla gör|daha fazlasını gör|tümünü gör|diğer yorumları gör|çeviriyi gör|en alakalı|herkese açık|sponsorlu|facebook|like|comment|share|send|reply|follow|see more|see translation|most relevant|all reactions:?)$/i,
  /^\d+([.,]\d+)?\s*(b|bn|k|m)?\s*(yorum|paylaşım|beğeni|tepki|görüntülenme|comments?|shares?|likes?|reactions?|views?)$/i,
  /^(\d+\s*(sn|dk|sa|g|h|hf|y|s|d|w|m)|dün|bugün|şimdi|az önce|just now|yesterday)(\s*(saat|at)?\s*[\d:.]*)?\s*·?$/i,
  /^[\d\s.,·•]+$/,
  /^·$/,
  /^yorum yaz.*$/i, /^write a comment.*$/i, /^.{0,3}$/,
];
function cleanFbText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/ /g, ' ').replace(/\s+/g, ' ').trim());
  const out = [];
  for (const l of lines) {
    if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    const digits = (l.match(/\d/g) || []).length;
    if (digits < 7 && FB_NOISE.some(rx => rx.test(l))) continue;   // telefon numarası korunur
    if (out.includes(l) && l.length < 40) continue;   // tekrar eden kısa satırlar (isim, grup adı)
    out.push(l.replace(/\s*…?\s*(daha fazla gör|see more)$/i, ''));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fbImageUrlsFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const urls = [];
  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!/^https:\/\/[^/]*(fbcdn\.net|fbsbx\.com)\//i.test(src)) return;
    if (/\/(emoji|rsrc)\.php|static\.xx\.fbcdn|\/images\/emoji/i.test(src)) return;   // emojiler ve simgeler
    const w = Number(img.getAttribute('width')) || 0, h = Number(img.getAttribute('height')) || 0;
    if ((w && w < 120) || (h && h < 120)) return;   // profil resimleri ve küçük simgeler
    if (/[?&]stp=[^&]*(p40x40|p32x32|s40x40|c\d+\.\d+\.\d+\.\d+a_cp0_dst-jpg_s\d{2}x)/i.test(src)) return;
    if (!urls.includes(src)) urls.push(src);
  });
  return urls;
}

function renderFbImportFound() {
  const box = document.getElementById('fbImportFound');
  const n = fbImportUrls.length + fbImportFiles.length;
  const text = cleanFbText(fbImportText);
  box.hidden = !n && !text;
  box.textContent = `Bulunan: ${text ? `${text.split('\n').filter(Boolean).length} satır yazı` : 'yazı yok'} · ${n} resim${n > AD_MAX_PHOTOS ? ` (ilk ${AD_MAX_PHOTOS} tanesi alınır)` : ''}`;
}

function setupFbImport() {
  // Yer imi düğmesi: Facebook'taki açık gönderinin linkini panele gönderir
  const bm = document.getElementById('fbBookmarklet');
  if (bm) {
    const code = "(function(){var h=location.hostname;if(!/(^|\\.)facebook\\.com$/.test(h)){alert('Bu düğme Facebook gönderisi açıkken çalışır');return;}"
      + "window.open('" + location.origin + "/admin.html?fbLink='+encodeURIComponent(location.href),'newhal_admin');})();";
    bm.href = 'javascript:' + encodeURI(code);
  }
  const paste = document.getElementById('fbImportPaste');
  if (!paste) return;
  paste.addEventListener('paste', (e) => {
    e.stopPropagation();   // sayfanın genel resim yapıştırması devreye girmesin
    e.preventDefault();
    const cd = e.clipboardData;
    const html = cd.getData('text/html');
    const plain = cd.getData('text/plain');
    const files = [...cd.items].filter(it => it.kind === 'file' && /^image\//.test(it.type)).map(it => it.getAsFile()).filter(Boolean);
    if (html) fbImageUrlsFromHtml(html).forEach(u => { if (!fbImportUrls.includes(u)) fbImportUrls.push(u); });
    fbImportFiles.push(...files);
    const textToAdd = plain || (html ? new DOMParser().parseFromString(html, 'text/html').body.innerText : '');
    if (textToAdd) {
      fbImportText = fbImportText.trim() ? `${fbImportText.trim()}\n${textToAdd}` : textToAdd;
      paste.innerText = fbImportText;
    }
    // Yapıştırılan resimleri kutunun içinde küçük önizleme olarak göster
    files.forEach(f => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.className = 'fb-import-thumb';
      paste.appendChild(img);
    });
    fbImportUrls.forEach(u => {
      if (paste.querySelector(`img[data-src="${CSS.escape(u)}"]`)) return;
      const img = document.createElement('img');
      img.src = u;
      img.dataset.src = u;
      img.className = 'fb-import-thumb';
      img.referrerPolicy = 'no-referrer';
      paste.appendChild(img);
    });
    renderFbImportFound();
  });
  paste.addEventListener('input', () => { fbImportText = paste.innerText; renderFbImportFound(); });
  document.getElementById('fbImport').addEventListener('toggle', (e) => { if (e.target.open) loadApifyStatus(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupFbImport);
else setupFbImport();

function clearFbImport() {
  document.getElementById('fbImportPaste').innerHTML = '';
  document.getElementById('fbImportLink').value = '';
  fbImportFiles = [];
  fbImportUrls = [];
  fbImportText = '';
  renderFbImportFound();
}

async function applyFbImport() {
  const btn = document.getElementById('fbImportBtn');
  const paste = document.getElementById('fbImportPaste');
  const text = cleanFbText(fbImportText);
  const link = document.getElementById('fbImportLink').value.trim();
  if (!text && !fbImportUrls.length && !fbImportFiles.length) {
    showToast('Önce gönderiyi kutuya yapıştırın', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Aktarılıyor...';
  try {
    // Yazı: ilan metnine (ilk satır başlık olur)
    let body = text;
    if (link && document.getElementById('fbImportAddLink').checked) body = `${body}\n\n${link}`.trim();
    if (body) {
      const area = document.getElementById('adBody');
      area.value = body.slice(0, Number(area.maxLength) > 0 ? Number(area.maxLength) : 2120);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Resimler: panodan gelen dosyalar yüklenir, Facebook adresleri sitenin deposuna kopyalanır
    let room = AD_MAX_PHOTOS - adPhotoUrls.length - adPhotoBusy;
    const files = fbImportFiles.slice(0, Math.max(0, room));
    room -= files.length;
    if (files.length) await addAdPhotos(files.map((f, i) => new File([f], `facebook-${Date.now()}-${i}.png`, { type: f.type })));
    let ok = 0, fail = 0;
    for (const url of fbImportUrls.slice(0, Math.max(0, room))) {
      adPhotoBusy++;
      renderAdPhotos();
      try {
        const res = await api('/api/admin/ads/import-image', { method: 'POST', body: JSON.stringify({ url }) });
        const data = res ? await res.json().catch(() => ({})) : {};
        if (res && res.ok && data.url) { adPhotoUrls.push(data.url); ok++; } else fail++;
      } catch { fail++; }
      finally { adPhotoBusy--; renderAdPhotos(); }
    }
    const imgCount = files.length + ok;
    showToast(`Forma aktarıldı: ${body ? 'yazı' : 'yazı yok'}, ${imgCount} resim${fail ? ` (${fail} resim alınamadı, onları tek tek kopyalayıp yapıştırın)` : ''}`, fail ? 'error' : 'success');
    document.getElementById('adBody').scrollIntoView({ behavior: 'smooth', block: 'center' });
    clearFbImport();
    document.getElementById('fbImport').open = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ayır ve Forma Aktar';
  }
}

// ── Facebook linkinden getir (Apify) ──────────────────────────
async function loadApifyStatus() {
  const status = document.getElementById('fbApifyStatus');
  const form = document.getElementById('fbApifyForm');
  if (!status) return;
  try {
    const res = await api('/api/admin/apify');
    const data = res ? await res.json() : {};
    if (data.configured) {
      status.innerHTML = `✅ Apify bağlı (${escHtmlSafe(data.hint)}). <a href="#" onclick="document.getElementById('fbApifyForm').hidden=false;return false">Anahtarı değiştir</a>`;
      form.hidden = true;
    } else {
      status.innerHTML = '⚠️ Linkten getirmek için Apify anahtarınızı bir kez kaydedin. Anahtarı Apify\'da <b>Settings → API &amp; Integrations</b> sayfasından kopyalayabilirsiniz.';
      form.hidden = false;
    }
  } catch { status.textContent = 'Apify durumu okunamadı'; }
}
function escHtmlSafe(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function saveApifyToken() {
  const input = document.getElementById('fbApifyToken');
  const res = await api('/api/admin/apify', { method: 'PUT', body: JSON.stringify({ token: input.value.trim() }) });
  if (!res) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(data.error || 'Kaydedilemedi', 'error'); return; }
  input.value = '';
  showToast('Apify anahtarı kaydedildi', 'success');
  loadApifyStatus();
}

// OrangeMonkey için betiği panoya kopyalar
async function copyFbUserscript(btn) {
  try {
    const res = await fetch('/newhal-facebook.user.js', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    await navigator.clipboard.writeText(await res.text());
    btn.textContent = '✅ Kopyalandı, şimdi OrangeMonkey\'e yapıştırın';
    showToast('Betik kopyalandı', 'success');
    setTimeout(() => { btn.textContent = '📋 Betiği Kopyala'; }, 6000);
  } catch {
    showToast('Kopyalanamadı. Betik yeni sekmede açılıyor, oradan Ctrl+A ve Ctrl+C yapın.', 'error');
    window.open('/newhal-facebook.user.js', '_blank', 'noopener');
  }
}

// Panodaki linki kutuya yapıştırır ve hemen sorgular
async function pasteFbLinkAndFetch() {
  const input = document.getElementById('fbImportLink');
  let text = '';
  try {
    text = (await navigator.clipboard.readText() || '').trim();
  } catch {
    input.focus();
    showToast('Panoya erişim izni verilmedi. Linki kutuya Ctrl+V ile yapıştırıp Linkten Getir\'e basın.', 'error');
    return;
  }
  const link = (text.match(/https?:\/\/\S+/) || [])[0] || '';
  if (!/^https?:\/\/([^/]+\.)?(facebook\.com|fb\.com|fb\.watch)\//i.test(link)) {
    showToast('Panoda Facebook linki yok. Önce Facebook\'ta gönderinin linkini kopyalayın.', 'error');
    return;
  }
  input.value = link;
  fetchFbPost();
}

async function fetchFbPost() {
  const link = document.getElementById('fbImportLink').value.trim();
  if (!link) { showToast('Önce Facebook linkini yapıştırın', 'error'); return; }
  const btn = document.getElementById('fbFetchBtn');
  btn.disabled = true;
  let sec = 0;
  btn.textContent = 'Gönderi okunuyor...';
  const tick = setInterval(() => { sec++; btn.textContent = `Gönderi okunuyor... ${sec} sn`; }, 1000);
  try {
    const res = await api('/api/admin/ads/from-facebook', { method: 'POST', body: JSON.stringify({ url: link }) });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Gönderi okunamadı', 'error');
      // Hata kutuda kalır: kısa uyarı kaçırılmasın
      const found = document.getElementById('fbImportFound');
      found.hidden = false;
      found.textContent = `⚠️ ${data.error || 'Gönderi okunamadı'}`;
      return;
    }
    let body = cleanFbText(data.text || '');
    if (document.getElementById('fbImportAddLink').checked) body = `${body}\n\n${link}`.trim();
    if (body) {
      const area = document.getElementById('adBody');
      area.value = body.slice(0, Number(area.maxLength) > 0 ? Number(area.maxLength) : 2120);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const room = AD_MAX_PHOTOS - adPhotoUrls.length - adPhotoBusy;
    (data.images || []).slice(0, Math.max(0, room)).forEach(u => adPhotoUrls.push(u));
    renderAdPhotos();
    const n = Math.min((data.images || []).length, Math.max(0, room));
    showToast(`Gönderi getirildi: ${body ? 'yazı' : 'yazı yok'}, ${n} resim${data.failed ? ` (${data.failed} resim alınamadı)` : ''}`, body || n ? 'success' : 'error');
    document.getElementById('fbImportLink').value = '';
    document.getElementById('fbImport').open = false;
    document.getElementById('adBody').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    clearInterval(tick);
    btn.disabled = false;
    btn.textContent = '🔗 Linkten Getir';
  }
}

// ── Resim yapıştırma (Ctrl+V ya da düğme) ─────────────────────
function isAdsSectionOpen() {
  const section = document.getElementById('sectionAds');
  return section && section.classList.contains('active');
}

// Panodan gelen resimleri yükler; resim yoksa false döner
function addPastedImages(files) {
  const images = files.filter(f => f && /^image\//.test(f.type));
  if (!images.length) return false;
  addAdPhotos(images.map((f, i) => new File([f], `yapistirilan-${Date.now()}-${i}.png`, { type: f.type })));
  showToast(`📋 ${images.length} resim yapıştırıldı, yükleniyor...`, 'success');
  return true;
}

document.addEventListener('paste', (e) => {
  if (!isAdsSectionOpen() || !e.clipboardData) return;
  const files = [...e.clipboardData.items].filter(it => it.kind === 'file').map(it => it.getAsFile());
  // Yazı kutusuna düz yazı yapıştırılıyorsa karışma
  if (addPastedImages(files)) e.preventDefault();
});

async function pasteAdImageFromButton() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    return showToast('Bu tarayıcıda düğme çalışmıyor, Ctrl+V ile yapıştırın', 'error');
  }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) files.push(new File([await item.getType(type)], 'pano.png', { type }));
    }
    if (!addPastedImages(files)) showToast('Panoda resim yok. Önce bir resmi kopyalayın.', 'error');
  } catch {
    showToast('Panoya erişim izni verilmedi, Ctrl+V ile yapıştırın', 'error');
  }
}

function setAdVideoType(type) {
  document.getElementById('adVideoFileBox').hidden = type !== 'file';
  document.getElementById('adVideoYoutubeBox').hidden = type !== 'youtube';
}

async function uploadAdVideo(file) {
  if (!file) return;
  const progress = document.getElementById('adVideoProgress');
  const bar = document.getElementById('adVideoBar');
  const text = document.getElementById('adVideoText');
  const preview = document.getElementById('adVideoPreview');
  adVideoUrl = null;
  adVideoBusy = true;
  preview.hidden = true;
  progress.hidden = false;
  bar.style.width = '0%';
  text.textContent = 'Yükleniyor... %0';
  try {
    adVideoUrl = await uploadAdFile(file, 'video', (ratio) => {
      bar.style.width = `${Math.round(ratio * 100)}%`;
      text.textContent = `Yükleniyor... %${Math.round(ratio * 100)}`;
    });
    text.textContent = '✅ Video yüklendi';
    preview.src = adVideoUrl;
    preview.hidden = false;
  } catch (err) {
    text.textContent = '❌ ' + err.message;
    document.getElementById('adVideoFile').value = '';
  } finally {
    adVideoBusy = false;
  }
}

let editingAdId = null;

function resetAdForm() {
  document.getElementById('adForm').reset();
  editingAdId = null;
  document.getElementById('adEditBanner').hidden = true;
  document.getElementById('adForm').classList.remove('editing');
  document.getElementById('adSubmitBtn').textContent = '📢 İlanı Yayınla';
  adPhotoUrls = [];
  adVideoUrl = null;
  setAdVideoType('none');
  document.getElementById('adVideoProgress').hidden = true;
  const preview = document.getElementById('adVideoPreview');
  preview.hidden = true;
  preview.removeAttribute('src');
  renderAdPhotos();
}

async function submitAd(e) {
  e.preventDefault();
  if (adPhotoBusy || adVideoBusy) return showToast('Dosyalar yükleniyor, lütfen bekleyin', 'error');
  const videoType = document.querySelector('input[name="adVideoType"]:checked').value;
  let video = null;
  if (videoType === 'file') {
    if (!adVideoUrl) return showToast('Önce video dosyasını seçin', 'error');
    video = { type: 'file', url: adVideoUrl };
  } else if (videoType === 'youtube') {
    const url = document.getElementById('adYoutube').value.trim();
    if (!url) return showToast('YouTube bağlantısını yapıştırın', 'error');
    video = { type: 'youtube', url };
  }
  const btn = document.getElementById('adSubmitBtn');
  btn.disabled = true;
  try {
    const editing = editingAdId;
    const res = await api(editing ? `/api/admin/ads/${encodeURIComponent(editing)}` : '/api/admin/ads', {
      method: editing ? 'PUT' : 'POST',
      body: JSON.stringify({
        body: document.getElementById('adBody').value,
        pinId: Number(document.getElementById('adPin').value) || null,
        images: adPhotoUrls,
        video,
        featured: document.getElementById('adFeatured').checked,
        featured_days: Number(document.getElementById('adFeaturedDays').value),
      }),
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'İlan kaydedilemedi');
    showToast(editing ? '✏️ İlan güncellendi' : '📢 İlan yayınlandı', 'success');
    resetAdForm();
    loadAds();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderAdList(ads) {
  const list = document.getElementById('adList');
  list.innerHTML = '';
  if (!ads.length) {
    list.innerHTML = '<div class="ad-empty">Henüz ilan yok. Yukarıdan ilk ilanı ekleyin.</div>';
    return;
  }
  ads.forEach(ad => {
    const card = document.createElement('div');
    card.className = 'ad-item' + (ad.pending ? ' pending-ad' : ad.active === false ? ' hidden-ad' : '') + (ad.featured ? ' featured-ad' : '');
    const media = (ad.images || []).length
      ? `<img src="${esc(ad.images[0])}" alt="" />`
      : ad.video ? `<div class="ad-thumb-icon">🎬</div>` : `<div class="ad-thumb-icon">📝</div>`;
    const tags = [
      (ad.images || []).length ? `🖼 ${ad.images.length} resim` : '',
      ad.video ? (ad.video.type === 'youtube' ? '▶️ YouTube' : '🎬 Video') : '',
    ].filter(Boolean).join(' · ');
    card.innerHTML = `
      <div class="ad-thumb">${media}</div>
      <div class="ad-info">
        <div class="ad-item-title">${ad.no ? `<span class="ad-item-no">#${ad.no}</span> ` : ''}${ad.title ? esc(ad.title) : '<span class="ad-untitled">(Başlıksız ilan)</span>'}</div>
        <div class="ad-item-meta">${ad.featured ? `<span class="ad-vitrin-badge">⭐ Vitrin · ${esc(featuredRemainingText(ad.featured_until))}</span> ` : ''}${ad.featured_request_status === 'pending' ? '<span class="ad-pending-badge">⭐ 1.000 PP vitrin başvurusu bekliyor</span> ' : ''}${ad.pending ? '<span class="ad-pending-badge">⏳ Onay bekliyor</span>' : ad.active === false ? '🙈 Gizli' : '🟢 Yayında'}${ad.owner ? ` · 👤 ${esc(ad.owner.name)}` : ''}${ad.pinId && ad.story_until && Date.parse(ad.story_until) > Date.now() ? ` · 🟣 Hikaye: ${esc((allPinsCache[ad.pinId] || {}).title || 'dükkan')}, ${esc(featuredRemainingText(ad.story_until))}` : ''} · ${esc(new Date(ad.created_at).toLocaleDateString('tr-TR'))}${tags ? ' · ' + tags : ''}</div>
        <div class="ad-stat-line">${adStatLine(ad)}</div>
        ${ad.whatsapp_sent_at ? `<div class="ad-wa-done">💬 WhatsApp'tan gönderildi · ${esc(new Date(ad.whatsapp_sent_at).toLocaleDateString('tr-TR'))}</div>` : ''}
        ${ad.facebook ? `<a class="ad-fb-done" href="${esc(ad.facebook.url)}" target="_blank" rel="noopener">📘 Facebook'ta paylaşıldı · ${esc(new Date(ad.facebook.shared_at).toLocaleDateString('tr-TR'))}</a>` : ''}
        ${ad.body ? `<div class="ad-item-body">${esc(ad.body)}</div>` : ''}
      </div>
      <div class="ad-item-actions">
        <button type="button" class="btn-sm btn-edit-ad" data-act="edit">✏️ Düzenle</button>
        ${adWhatsappNumber(ad) ? `<button type="button" class="btn-sm btn-wa" data-act="whatsapp">💬 WhatsApp'tan Gönder</button>` : ''}
        <button type="button" class="btn-sm btn-fb" data-act="facebook" ${fbConnected ? '' : 'disabled title="Önce Facebook sayfasını bağlayın"'}>📘 Facebook'a Gönder</button>
        <button type="button" class="btn-sm btn-vitrin" data-act="featured">${ad.featured ? '☆ Vitrinden Çıkar' : '⭐ Vitrine Ekle'}</button>
        ${ad.featured ? '<button type="button" class="btn-sm btn-vitrin" data-act="extend">⏳ Süre Uzat</button>' : ''}
        <button type="button" class="btn-sm${ad.pending ? ' btn-approve-ad' : ''}" data-act="toggle">${ad.pending ? '✅ Onayla' : ad.active === false ? '👁 Yayınla' : '🙈 Gizle'}</button>
        <button type="button" class="btn-sm btn-delete" data-act="delete">🗑 Sil</button>
      </div>`;
    card.querySelector('[data-act="facebook"]').onclick = (e) => shareAdToFacebook(ad, e.currentTarget);
    card.querySelector('[data-act="edit"]').onclick = () => editAd(ad);
    const waBtn = card.querySelector('[data-act="whatsapp"]');
    if (waBtn) waBtn.onclick = () => sendAdWhatsapp(ad);
    card.querySelector('[data-act="featured"]').onclick = () => setAdFeatured(ad.id, !ad.featured);
    const extendBtn = card.querySelector('[data-act="extend"]');
    if (extendBtn) extendBtn.onclick = () => setAdFeatured(ad.id, true, true);
    card.querySelector('[data-act="toggle"]').onclick = () => toggleAd(ad.id, ad.active === false);
    card.querySelector('[data-act="delete"]').onclick = () => deleteAd(ad.id, ad.title || 'Başlıksız');
    list.appendChild(card);
  });
}

// Vitrine ekle ya da süre uzat: kaç gün olacağını sorar
async function setAdFeatured(id, featured, extend) {
  let days;
  if (featured) {
    const answer = prompt(extend ? 'Vitrin süresi kaç gün uzatılsın? (1-90)' : 'Kaç gün vitrinde kalsın? (1-90)', '7');
    if (answer === null) return;
    days = Math.round(Number(answer));
    if (!(days >= 1 && days <= 90)) return showToast('1 ile 90 arasında bir gün sayısı yazın', 'error');
  }
  const res = await api(`/api/admin/ads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ featured, featured_days: days }) });
  if (!res || !res.ok) return showToast('İlan güncellenemedi', 'error');
  showToast(!featured ? 'İlan vitrinden çıkarıldı' : extend ? `⏳ Vitrin süresi ${days} gün uzatıldı` : `⭐ İlan ${days} günlüğüne vitrine eklendi`, 'success');
  loadAds();
}

// "3 gün 4 saat kaldı · bitiş 12 Kas 14:00"
function featuredRemainingText(until) {
  if (!until) return 'süre yok';
  const ms = Date.parse(until) - Date.now();
  if (ms <= 0) return 'süresi doldu';
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.max(1, Math.floor(ms % 3600000 / 60000));
  const left = d ? `${d} gün${h ? ` ${h} saat` : ''}` : h ? `${h} saat ${m} dk` : `${m} dk`;
  const end = new Date(until).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${left} kaldı · bitiş ${end}`;
}

async function toggleAd(id, active) {
  const res = await api(`/api/admin/ads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) });
  if (!res || !res.ok) return showToast('İlan güncellenemedi', 'error');
  showToast(active ? 'İlan yeniden yayında' : 'İlan gizlendi', 'success');
  loadAds();
}

async function deleteAd(id, title) {
  if (!confirm(`"${title}" ilanı ve dosyaları kalıcı olarak silinsin mi?`)) return;
  const res = await api(`/api/admin/ads/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res || !res.ok) return showToast('İlan silinemedi', 'error');
  showToast('İlan silindi', 'success');
  loadAds();
}


// ── WhatsApp'tan ilan sahibine mesaj ──────────────────────────
// Mesaj, bu bilgisayarda açık olan WhatsApp'ta (Mersin Manşet numarası) hazır açılır; gönder tuşuna yönetici basar.
const SITE_URL = 'https://newhal.com';
function whatsappBusinessNumber(value) {
  const raw = String(value || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('90') && digits.length >= 12 && digits.length <= 15) return digits;
  if (digits.startsWith('0') && digits.length === 11) return `90${digits.slice(1)}`;
  if (digits.length === 10) return `90${digits}`;
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

function inviteBusinessWhatsapp(pin) {
  const phone = whatsappBusinessNumber(pin.phone);
  if (!phone) return showToast('Telefon numarası WhatsApp bağlantısına uygun değil', 'error');
  const trMap = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  const slug = String(pin.title || 'isletme')
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, ch => trMap[ch])
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'isletme';
  const link = `${SITE_URL}/isletme/${Number(pin.id)}-${slug}`;
  const message = waInviteTemplate
    .split('{isletme}').join(pin.title || '')
    .split('{link}').join(link)
    .split('{site}').join(SITE_URL);
  window.open(waSendUrl(phone, message), '_blank', 'noopener');
  const ids = waInvitedIds(); ids.add(Number(pin.id));
  try { localStorage.setItem('waInvitedIds', JSON.stringify([...ids])); } catch {}
  return true;
}

// Davet gönderilen işletmeler bu tarayıcıda hatırlanır; buton griye döner
function waInvitedIds() {
  try { return new Set(JSON.parse(localStorage.getItem('waInvitedIds') || '[]').map(Number)); } catch { return new Set(); }
}
function markInviteSent(btn) {
  btn.textContent = '✅ Davet Gönderildi';
  btn.title = 'Tekrar göndermek için tıklayın';
  btn.style.background = '#64748b';
  btn.style.borderColor = '#64748b';
  btn.style.color = '#fff';
}

// wa.me yönlendirmesi bazı WhatsApp uygulamalarında emojileri "?" yapıyor; doğrudan api.whatsapp.com kullanılır
function waSendUrl(phone, message) {
  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
}

const DEFAULT_WA_INVITE_TEMPLATE = [
  'Merhaba 👋',
  '',
  '{isletme} işletmeniz NewHal Mersin Hal rehberinde yer alıyor. İşletme profilinizi sahiplenip bilgilerinizi güncellemek ve ücretsiz ilan paylaşmak için sizi NewHal’e davet ediyoruz.',
  '',
  '📍 İşletme sayfanız: {link}',
  '',
  'NewHal · Mersin Hal Kompleksi Rehberi',
].join('\n');
let waInviteTemplate = DEFAULT_WA_INVITE_TEMPLATE;

async function loadWaInviteTemplate() {
  const res = await api('/api/admin/whatsapp-invite-template');
  if (!res) return;
  const d = await res.json();
  waInviteTemplate = d.template || DEFAULT_WA_INVITE_TEMPLATE;
  const box = document.getElementById('waInviteTemplate');
  if (box && document.activeElement !== box) box.value = waInviteTemplate;
}

async function saveWaInviteTemplate() {
  const template = document.getElementById('waInviteTemplate').value.trim();
  if (!template) return showToast('Şablon boş olamaz', 'error');
  const res = await api('/api/admin/whatsapp-invite-template', { method: 'PUT', body: JSON.stringify({ template }) });
  if (!res || !res.ok) return showToast('Şablon kaydedilemedi', 'error');
  waInviteTemplate = template;
  showToast('💬 Davet şablonu kaydedildi', 'success');
}

function resetWaInviteTemplate() {
  document.getElementById('waInviteTemplate').value = DEFAULT_WA_INVITE_TEMPLATE;
  showToast('Varsayılan şablon yüklendi, kaydetmeyi unutmayın', 'success');
}

const DEFAULT_WA_TEMPLATE = [
  'Merhaba 👋',
  '',
  'Mersin Manşet olarak yazıyoruz. İlanınız NewHal · Mersin Hal Kompleksi Rehberi\'nde yayında 🎉',
  '',
  '📌 #{no} · {baslik}',
  '🔗 {link}',
  '',
  '✅ NewHal\'de ilanlarınızı *ücretsiz* yayınlayabilir, işletmenizi hal haritasına ekleyebilirsiniz.',
  '👉 {site}',
  '',
  'İyi çalışmalar dileriz 🌱',
].join('\n');
let waTemplate = DEFAULT_WA_TEMPLATE;

// İlan metnindeki ilk cep telefonu (WhatsApp için 5xx ile başlayan numara), +90 biçiminde rakamlar
function adWhatsappNumber(ad) {
  const text = `${ad.title || ''} ${ad.body || ''}`;
  const re = /(?:\+?90[\s.-]?)?\(?0?\s?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;
  for (const m of text.matchAll(re)) {
    let d = m[0].replace(/\D/g, '');
    if (d.startsWith('90') && d.length === 12) d = d.slice(2);
    else if (d.startsWith('0') && d.length === 11) d = d.slice(1);
    if (d.length === 10 && d.startsWith('5')) return '90' + d;
  }
  return null;
}

// İlanı anlatan kısa satır: telefon numaraları, "~İsim" ve "@kullanıcı" satırları çıkarılır
function adSummary(ad) {
  const phone = /(?:\+?90[\s.-]?)?\(?0?\s?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;
  const lines = `${ad.title || ''}\n${ad.body || ''}`.split('\n')
    .map(l => l.replace(phone, '').trim())
    .filter(l => !/^[~@]/.test(l))
    .map(l => l.replace(/^[\s\-–:.,📞]+|[\s\-–:.,]+$/gu, '').trim())
    .filter(l => l.length >= 3);
  const s = lines[0] || 'Hal ilanınız';
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

function buildWaMessage(ad) {
  return waTemplate
    .split('{no}').join(ad.no ? String(ad.no) : '')
    .split('{goruntulenme}').join(String((adStats[ad.id] || {}).views || 0))
    .split('{baslik}').join(adSummary(ad))
    .split('{link}').join(`${SITE_URL}/?ilan=${encodeURIComponent(ad.id)}`)
    .split('{site}').join(SITE_URL);
}

async function sendAdWhatsapp(ad) {
  const phone = adWhatsappNumber(ad);
  if (!phone) return showToast('Bu ilanda cep telefonu numarası bulunamadı', 'error');
  if (ad.whatsapp_sent_at && !confirm('Bu ilan sahibine daha önce WhatsApp mesajı gönderildi. Tekrar açılsın mı?')) return;
  const url = waSendUrl(phone, buildWaMessage(ad));
  window.open(url, '_blank', 'noopener');
  // "Gönderildi" olarak işaretle (mesajın gönder tuşuna WhatsApp'ta yönetici basar)
  const res = await api(`/api/admin/ads/${encodeURIComponent(ad.id)}`, { method: 'PATCH', body: JSON.stringify({ whatsapp_sent: true }) });
  if (res && res.ok) loadAds();
}

async function loadWaTemplate() {
  const res = await api('/api/admin/whatsapp-template');
  if (!res) return;
  const d = await res.json();
  waTemplate = d.template || DEFAULT_WA_TEMPLATE;
  const box = document.getElementById('waTemplate');
  if (box && document.activeElement !== box) box.value = waTemplate;
}

async function saveWaTemplate() {
  const template = document.getElementById('waTemplate').value.trim();
  if (!template) return showToast('Şablon boş olamaz', 'error');
  const res = await api('/api/admin/whatsapp-template', { method: 'PUT', body: JSON.stringify({ template }) });
  if (!res || !res.ok) return showToast('Şablon kaydedilemedi', 'error');
  waTemplate = template;
  showToast('💬 WhatsApp şablonu kaydedildi', 'success');
}

function resetWaTemplate() {
  document.getElementById('waTemplate').value = DEFAULT_WA_TEMPLATE;
  showToast('Varsayılan şablon yüklendi, kaydetmeyi unutmayın', 'success');
}


// ── İlanı düzenle: formu ilanın bilgileriyle doldurur ──────────
function editAd(ad) {
  resetAdForm();
  editingAdId = ad.id;
  document.getElementById('adBody').value = [ad.title, ad.body].filter(Boolean).join('\n');
  fillAdPinSelect(ad.pinId);
  document.getElementById('adFeatured').checked = !!ad.featured;
  adPhotoUrls = [...(ad.images || [])];
  renderAdPhotos();

  const type = ad.video ? (ad.video.type === 'youtube' ? 'youtube' : 'file') : 'none';
  document.querySelector(`input[name="adVideoType"][value="${type}"]`).checked = true;
  setAdVideoType(type);
  if (type === 'youtube') {
    document.getElementById('adYoutube').value = `https://youtu.be/${ad.video.id}`;
  } else if (type === 'file') {
    adVideoUrl = ad.video.url;
    const preview = document.getElementById('adVideoPreview');
    preview.src = adVideoUrl;
    preview.hidden = false;
    document.getElementById('adVideoProgress').hidden = false;
    document.getElementById('adVideoBar').style.width = '100%';
    document.getElementById('adVideoText').textContent = '✅ Mevcut video (değiştirmek için yeni dosya seçin)';
  }

  document.getElementById('adEditLabel').textContent = `#${ad.no || ''} numaralı ilan düzenleniyor`;
  document.getElementById('adEditBanner').hidden = false;
  document.getElementById('adForm').classList.add('editing');
  document.getElementById('adSubmitBtn').textContent = '💾 Değişiklikleri Kaydet';
  document.getElementById('adForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('adBody').focus({ preventScroll: true });
}


// ── İstatistikler ─────────────────────────────────────────────
let adStats = {};
const SHARE_LABELS = { whatsapp: 'WhatsApp', facebook: 'Facebook', x: 'X', telegram: 'Telegram', copy: 'Bağlantı', more: 'Diğer' };
const fmt = n => Number(n || 0).toLocaleString('tr-TR');

async function loadAdStats() {
  const res = await api('/api/admin/stats/ads');
  if (res && res.ok) adStats = await res.json();
}

function adStatLine(ad) {
  const s = adStats[ad.id] || { views: 0, opens: 0, shares: {} };
  const shares = Object.values(s.shares || {}).reduce((a, b) => a + b, 0);
  const detail = Object.entries(s.shares || {}).map(([k, v]) => `${SHARE_LABELS[k] || k}: ${v}`).join(', ');
  return `👁 ${fmt(s.views)} görüntülenme · 🔍 ${fmt(s.opens)} açılma · <span title="${esc(detail)}">📤 ${fmt(shares)} paylaşım</span>`;
}

async function loadStatsOverview() {
  const res = await api('/api/admin/stats/overview');
  if (!res) return;
  const d = await res.json();
  document.getElementById('stTotals').innerHTML = [
    ['👁', 'İlan görüntülenme', d.totals.views],
    ['🔍', 'İlan açılma', d.totals.opens],
    ['📤', 'Paylaşım', d.totals.shares],
    ['🔎', 'Farklı arama', d.searches.length],
  ].map(([i, l, v]) => `<div class="st-total"><span class="st-icon">${i}</span><strong>${fmt(v)}</strong><span>${l}</span></div>`).join('');

  const maxViews = Math.max(1, ...d.topAds.map(a => a.views));
  document.getElementById('stTopAds').innerHTML = d.topAds.length ? d.topAds.map(a => `
    <div class="st-row">
      ${a.image ? `<img src="${esc(a.image)}" alt="" />` : '<div class="st-noimg">📝</div>'}
      <div class="st-row-main">
        <div class="st-row-title"><span class="ad-item-no">#${a.no}</span> ${a.featured ? '⭐ ' : ''}${esc(a.title || '(Başlıksız ilan)')}</div>
        <div class="st-bar"><span style="width:${Math.round(a.views / maxViews * 100)}%"></span></div>
        <div class="st-row-meta">👁 ${fmt(a.views)} · 🔍 ${fmt(a.opens)} · 📤 ${fmt(a.shares)}</div>
      </div>
    </div>`).join('') : '<div class="st-empty">Henüz veri yok. Ziyaretçiler ilanlara baktıkça burada görünecek.</div>';

  const maxCount = Math.max(1, ...d.searches.map(s => s.count));
  document.getElementById('stSearches').innerHTML = d.searches.length ? d.searches.map((s, i) => `
    <div class="st-row st-search">
      <span class="st-rank">${i + 1}</span>
      <div class="st-row-main">
        <div class="st-row-title">${esc(s.term)}</div>
        <div class="st-bar search"><span style="width:${Math.round(s.count / maxCount * 100)}%"></span></div>
        <div class="st-row-meta">${fmt(s.count)} arama · haritada ${fmt(s.map)}, ilanlarda ${fmt(s.ads)} · son: ${esc(new Date(s.last).toLocaleDateString('tr-TR'))}</div>
      </div>
    </div>`).join('') : '<div class="st-empty">Henüz arama yapılmadı.</div>';
}

// ── Raporlar: kod denetimi bulguları (sunucudan, sadece yöneticiye) ──
async function loadAuditReport() {
  const box = document.getElementById('auditList');
  if (!box) return;
  try {
    const res = await api('/api/admin/audit-report');
    if (!res || !res.ok) throw new Error();
    const r = await res.json();
    const colors = { 'Önemli': '#dc2626', 'Orta': '#f59e0b', 'Küçük': '#64748b' };
    document.getElementById('auditMeta').textContent = `Kod denetimi · ${r.date} · ${r.items.length} bulgu`;
    box.innerHTML = `<p style="font-size:13px;margin:0 0 12px">${esc(r.note)}</p>` + r.items.map((it, i) => `
      <div style="border-left:4px solid ${colors[it.level] || '#64748b'};background:var(--bg-panel);padding:12px 14px;border-radius:8px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:${colors[it.level] || '#64748b'};text-transform:uppercase;margin-bottom:4px">${esc(it.level)}</div>
        <div style="font-weight:700;margin-bottom:4px">${i + 1}. ${esc(it.title)}</div>
        <div style="font-size:13px;color:var(--text-1);opacity:.8">${esc(it.detail)}</div>
      </div>`).join('');
  } catch {
    box.textContent = 'Rapor yüklenemedi';
  }
}

// ── Tıklama Haritası: sitenin görüntüsü üzerine renkli yoğunluk katmanı ──
let heatmapData = null;
let heatmapDevice = 'desktop';
const HEAT_VIEW = { desktop: [1366, 768], mobile: [390, 844] };

async function loadHeatmap() {
  const res = await api('/api/admin/heatmap');
  if (!res || !res.ok) return showToast('Tıklama haritası yüklenemedi', 'error');
  heatmapData = await res.json();
  renderHeatmapToggle();
  drawHeatmap();
}

function renderHeatmapToggle() {
  const btn = document.getElementById('heatToggle');
  if (!btn || !heatmapData) return;
  const on = heatmapData.enabled !== false;
  btn.textContent = on ? '🟢 Açık · Kapat' : '⏸️ Kapalı · Aç';
  btn.title = on ? 'Tıklama toplamayı durdur' : 'Tıklama toplamayı başlat';
  btn.style.background = on ? '#16a34a' : '#64748b';
  btn.style.color = '#fff';
  btn.style.border = 'none';
}

async function toggleHeatmapEnabled() {
  if (!heatmapData) return;
  const next = heatmapData.enabled === false;
  const res = await api('/api/admin/heatmap/enabled', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
  if (!res || !res.ok) return showToast('Ayar kaydedilemedi', 'error');
  heatmapData.enabled = (await res.json()).enabled;
  renderHeatmapToggle();
  showToast(heatmapData.enabled ? 'Tıklama haritası devreye alındı' : 'Tıklama haritası devre dışı bırakıldı', 'success');
}

function setHeatmapDevice(device) {
  heatmapDevice = device;
  document.getElementById('heatBtnDesktop').classList.toggle('btn-approve', device === 'desktop');
  document.getElementById('heatBtnMobile').classList.toggle('btn-approve', device === 'mobile');
  drawHeatmap();
}

async function resetHeatmap() {
  if (!confirm('Tüm tıklama verisi silinecek. Emin misiniz?')) return;
  const res = await api('/api/admin/heatmap', { method: 'DELETE' });
  if (!res || !res.ok) return showToast('Sıfırlanamadı', 'error');
  showToast('Tıklama haritası sıfırlandı', 'success');
  loadHeatmap();
}

function drawHeatmap() {
  if (!heatmapData) return;
  const [vw, vh] = HEAT_VIEW[heatmapDevice];
  const stage = document.getElementById('heatmapStage');
  const maxW = Math.min(stage.parentElement.clientWidth || vw, heatmapDevice === 'mobile' ? 360 : 1100);
  const scale = maxW / vw;
  stage.style.width = `${Math.round(vw * scale)}px`;
  stage.style.height = `${Math.round(vh * scale)}px`;

  const box = document.getElementById('heatmapFrameBox');
  if (box.dataset.device !== heatmapDevice) {
    box.dataset.device = heatmapDevice;
    box.innerHTML = `<iframe src="/" title="Site görüntüsü" tabindex="-1" style="width:${vw}px;height:${vh}px;border:0;display:block"></iframe>`;
  }
  box.style.transform = `scale(${scale})`;

  const d = heatmapData[heatmapDevice] || { clicks: 0, grid: [] };
  const since = heatmapData.since ? new Date(heatmapData.since).toLocaleDateString('tr-TR') : '';
  document.getElementById('heatmapMeta').textContent =
    `${heatmapDevice === 'mobile' ? 'Telefon' : 'Bilgisayar'} · ${Number(d.clicks || 0).toLocaleString('tr-TR')} tıklama${since ? ` · ${since} tarihinden beri` : ''}`;

  const canvas = document.getElementById('heatmapCanvas');
  const W = canvas.width = Math.round(vw * scale), H = canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const { cols, rows } = heatmapData;
  const max = Math.max(1, ...d.grid);
  if (!d.clicks) return;
  // Önce yoğunluk gri tonla çizilir, sonra renge çevrilir
  const cw = W / cols, ch = H / rows, r = Math.max(cw, ch) * 1.6;
  ctx.globalCompositeOperation = 'lighter';
  d.grid.forEach((n, i) => {
    if (!n) return;
    const x = (i % cols + 0.5) * cw, y = (Math.floor(i / cols) + 0.5) * ch;
    const a = Math.min(1, 0.15 + 0.85 * Math.sqrt(n / max));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a * 0.6})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  });
  ctx.globalCompositeOperation = 'source-over';
  const img = ctx.getImageData(0, 0, W, H), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.min(1, px[i] / 255);
    if (v < 0.02) { px[i + 3] = 0; continue; }
    // mavi → yeşil → sarı → kırmızı
    const hue = (1 - v) * 240;
    const [rr, gg, bb] = hslToRgb(hue / 360, 1, 0.5);
    px[i] = rr; px[i + 1] = gg; px[i + 2] = bb; px[i + 3] = Math.round(90 + v * 140);
  }
  ctx.putImageData(img, 0, 0);
}

function hslToRgb(h, s, l) {
  const f = n => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

async function refreshLogs() {
  const btn = document.getElementById('refreshLogsBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Yenileniyor...'; }
  try { await loadLogs(); } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Yenile'; }
  }
}
