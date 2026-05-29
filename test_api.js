const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.request({ hostname: 'localhost', port: 3000, path, method: 'GET', headers }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('=== NewHal API Smoke Test ===\n');

  // 1. Public pins (bos olmali)
  const pins = await get('/api/pins');
  console.log(`[1] GET /api/pins       → ${pins.status} | ${JSON.stringify(pins.body)}`);

  // 2. Admin login
  const login = await post('/api/admin/login', { username: 'admin', password: 'newhal2024' });
  console.log(`[2] POST /admin/login   → ${login.status} | token: ${login.body.token ? 'OK ✅' : 'FAIL ❌'}`);
  const token = login.body.token;

  // 3. Yanlis sifre
  const badLogin = await post('/api/admin/login', { username: 'admin', password: 'yanlis' });
  console.log(`[3] POST /admin/login   → ${badLogin.status} (yanlis sifre, 401 olmali) ${badLogin.status===401?'✅':'❌'}`);

  // 4. Yeni pin ekle
  const addPin = await post('/api/pins', {
    title: 'Test Işletme', address: 'Hal Blok A-1',
    phone: '0324 111 22 33', email: 'test@hal.com',
    website: 'https://test.com', category: 'Sebze & Meyve',
    lat: 36.7944, lng: 34.6063
  });
  console.log(`[4] POST /api/pins      → ${addPin.status} | id:${addPin.body.id} ${addPin.status===201?'✅':'❌'}`);
  const pinId = addPin.body.id;

  // 5. Admin: bekleyen pinler
  const pending = await get('/api/admin/pins?status=pending', token);
  console.log(`[5] GET /admin/pins     → ${pending.status} | ${pending.body.length} bekleyen ${pending.status===200?'✅':'❌'}`);

  // 6. Admin: istatistik
  const stats = await get('/api/admin/stats', token);
  console.log(`[6] GET /admin/stats    → ${stats.status} | total:${stats.body.total} pending:${stats.body.pending} ${stats.status===200?'✅':'❌'}`);

  // 7. Onayla
  const approve = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: 3000,
      path: `/api/admin/pins/${pinId}/approve`, method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    }, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)})); });
    req.on('error', reject); req.end();
  });
  console.log(`[7] PATCH approve       → ${approve.status} | ${approve.body.message} ${approve.status===200?'✅':'❌'}`);

  // 8. Onaylı pin listede gorunmeli
  const approved = await get('/api/pins');
  console.log(`[8] GET /api/pins       → ${approved.status} | ${approved.body.length} onaylı işletme ${approved.body.length>0?'✅':'❌'}`);

  // 9. Yeni Kategori Ekle
  const catName = 'Kategori ' + Date.now();
  const addCat = await post('/api/categories', { name: catName, icon: '🌸' });
  console.log(`[9] POST /api/categories → ${addCat.status} | ${addCat.body.name} ${addCat.status===201?'✅':'❌'}`);

  // 10. Admin: İğne Güncelle
  const updatePinRes = await new Promise((resolve, reject) => {
    const data = JSON.stringify({
      title: 'Güncellenmiş Test İşletmesi',
      category: catName,
      address: 'Hal Blok B-2',
      phone: '0324 222 33 44',
      email: 'yeni@hal.com',
      website: 'https://yeni.com',
      lat: 36.8000,
      lng: 34.6100
    });
    const req = http.request({
      hostname: 'localhost', port: 3000,
      path: `/api/admin/pins/${pinId}`, method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)})); });
    req.on('error', reject); req.write(data); req.end();
  });
  console.log(`[10] PUT update pin      → ${updatePinRes.status} | ${updatePinRes.body.message} ${updatePinRes.status===200?'✅':'❌'}`);

  // 11. Yorum Ekle
  const addComment = await post(`/api/pins/${pinId}/comments`, { nickname: 'Aydın Gıda', message: 'Çok güvenilir ve kaliteli hizmet.' });
  console.log(`[11] POST comment        → ${addComment.status} | nick:${addComment.body.nickname} ip:${addComment.body.ip} ${addComment.status===201?'✅':'❌'}`);

  // 12. Hata Bildir
  const addReport = await post(`/api/pins/${pinId}/reports`, { message: 'Telefon numarası güncel değil, lütfen 0324 222 33 44 yapın.' });
  console.log(`[12] POST report         → ${addReport.status} | msg:${addReport.body.message} ${addReport.status===201?'✅':'❌'}`);
  const reportId = addReport.body.id;

  // 13. Admin: Hata Bildirimlerini Gör
  const reports = await get('/api/admin/reports', token);
  console.log(`[13] GET reports         → ${reports.status} | ${reports.body.length} bildirim mevcut ${reports.status===200?'✅':'❌'}`);

  // 14. Admin: Hata Bildirimini Sil (Kapat)
  const deleteRepRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: 3000,
      path: `/api/admin/reports/${reportId}`, method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    }, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)})); });
    req.on('error', reject); req.end();
  });
  console.log(`[14] DELETE report       → ${deleteRepRes.status} | ${deleteRepRes.body.message} ${deleteRepRes.status===200?'✅':'❌'}`);

  console.log('\n=== Tüm testler tamamlandı ===');
}

main().catch(console.error);
