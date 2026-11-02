// Mersin Hal Kompleksi içindeki işletmeleri Google Haritalar'dan (Apify) toplayıp NewHal'e ekler.
//
//   node scripts/import_mersin.js            → deneme: sadece listeler, hiçbir şey eklemez
//   node scripts/import_mersin.js --ekle     → listeyi onaylı işletme olarak ekler
//   node scripts/import_mersin.js --ekle --dosya scripts/son_tarama.json
//                                            → yeniden taramadan önceki taramanın sonucunu ekler
//
// Sadece hal sınırının (scripts/hal_siniri.json) içindeki yerler alınır; aynı işletme iki kez eklenmez.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { ApifyClient } = require('apify-client');
const { createClient } = require('@supabase/supabase-js');

const ARGS        = process.argv.slice(2);
const INSERT      = ARGS.includes('--ekle');
const FROM_FILE   = ARGS.includes('--dosya') ? ARGS[ARGS.indexOf('--dosya') + 1] : null;
const LAST_SCAN   = path.join(__dirname, 'son_tarama.json');
const EDGE_BUFFER_M = 30;   // sınırın hemen dışına düşen iğneler için tolerans
const SAME_PLACE_M  = 20;   // bu mesafede ve benzer adla kayıtlı yer "aynı işletme" sayılır

// Hal içinde aranacak kelimeler (her biri ayrı arama; sonuçlar sınırla süzülür)
const SEARCHES = ['komisyoncu', 'sebze meyve', 'toptan meyve', 'tüccar', 'hal', 'nakliyat'];
const MAX_PER_SEARCH = 60;

const hal = JSON.parse(fs.readFileSync(path.join(__dirname, 'hal_siniri.json'), 'utf8'));
const POLYGON = hal.polygon; // [lat, lng]

// ── Geometri ──────────────────────────────────────────────────
function metersBetween([lat1, lng1], [lat2, lng2]) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function insidePolygon([lat, lng]) {
  let inside = false;
  for (let i = 0, j = POLYGON.length - 1; i < POLYGON.length; j = i++) {
    const [yi, xi] = POLYGON[i], [yj, xj] = POLYGON[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Noktanın sınır çizgisine en kısa uzaklığı (metre, küçük alan için düzlem yaklaşımı)
function distanceToEdge([lat, lng]) {
  const mPerLat = 111320, mPerLng = 111320 * Math.cos(lat * Math.PI / 180);
  let best = Infinity;
  for (let i = 0, j = POLYGON.length - 1; i < POLYGON.length; j = i++) {
    const ax = (POLYGON[j][1] - lng) * mPerLng, ay = (POLYGON[j][0] - lat) * mPerLat;
    const bx = (POLYGON[i][1] - lng) * mPerLng, by = (POLYGON[i][0] - lat) * mPerLat;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

const inHal = p => insidePolygon(p) || distanceToEdge(p) <= EDGE_BUFFER_M;

// ── Yardımcılar ───────────────────────────────────────────────
const normalize = s => String(s || '').toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9çğıöşü]+/g, ' ').replace(/\b(ltd|şti|sti|tic|san|ve|a ş|as)\b/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/\D/g, '').slice(-10);

function readApifyToken() {
  const envPath = path.join(__dirname, '../../../_knowledge/credentials/master.env');
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const m = text.match(/^APIFY_(?:API_KEY|TOKEN)="?([^"\r\n]+)"?/m);
  return process.env.APIFY_TOKEN || (m && m[1].trim()) || null;
}

// Google kategorisini sitedeki kategorilerden birine eşler
function pickCategory(item, categories) {
  const has = name => categories.find(c => c.name.toLocaleLowerCase('tr-TR') === name);
  const text = normalize(`${item.title} ${(item.categories || []).join(' ')} ${item.categoryName || ''}`);
  const rules = [
    [/komisyon/, 'komisyoncu'],
    [/müstahsil|mustahsil|üretici|çiftçi/, 'müstahsil'],
    [/manav|greengrocer/, 'manav'],
    [/market|süpermarket|bakkal|grocery|supermarket/, 'market'],
    [/tüccar|toptan|wholesal|ticaret/, 'tüccar'],
    [/balık|fish|seafood/, 'balık'],
    [/et |kasap|tavuk|butcher|meat/, 'et & tavuk'],
    [/bakliyat|kuruyemiş|baharat/, 'bakliyat'],
    [/sebze|meyve|fruit|vegetable|produce/, 'sebze & meyve'],
  ];
  for (const [re, name] of rules) {
    if (re.test(text) && has(name)) return has(name).name;
  }
  return 'Genel';
}

async function scan(token) {
  const client = new ApifyClient({ token });
  const input = {
    searchStringsArray: SEARCHES,
    customGeolocation: { type: 'Polygon', coordinates: [POLYGON.map(([lat, lng]) => [lng, lat])] },
    maxCrawledPlacesPerSearch: MAX_PER_SEARCH,
    language: 'tr',
    countryCode: 'tr',
    skipClosedPlaces: true,
  };
  console.log(`🔎 Google Haritalar'da ${SEARCHES.length} arama yapılıyor (her biri en fazla ${MAX_PER_SEARCH} yer)...`);
  const run = await client.actor('compass/crawler-google-places').call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.log(`📥 ${items.length} sonuç geldi. Tarama ücreti: ${run.usageTotalUsd != null ? '$' + run.usageTotalUsd.toFixed(2) : 'bilinmiyor'}`);
  fs.writeFileSync(LAST_SCAN, JSON.stringify(items, null, 1));
  return items;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('Supabase bilgileri eksik (.env)');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  let items;
  if (FROM_FILE) {
    items = JSON.parse(fs.readFileSync(path.resolve(FROM_FILE), 'utf8'));
    console.log(`📄 Önceki tarama dosyasından ${items.length} sonuç okundu.`);
  } else {
    const token = readApifyToken();
    if (!token) throw new Error('Apify anahtarı bulunamadı (master.env → APIFY_API_KEY)');
    items = await scan(token);
  }

  const { data: categories, error: catErr } = await supabase.from('categories').select('name');
  const { data: existingRows, error: pinErr } = await supabase.from('pins').select('id,title,phone,lat,lng');
  if (catErr || pinErr) throw new Error('Veritabanı okunamadı: ' + (catErr || pinErr).message);
  const existing = existingRows || [];

  const seenPlace = new Set();
  const picked = [], skipped = { disari: 0, kapali: 0, tekrar: 0, zatenVar: 0, eksik: 0 };
  for (const item of items) {
    const loc = item.location;
    if (!item.title || !loc || loc.lat == null) { skipped.eksik++; continue; }
    if (item.permanentlyClosed || item.temporarilyClosed) { skipped.kapali++; continue; }
    const point = [loc.lat, loc.lng];
    if (!inHal(point)) { skipped.disari++; continue; }

    const key = item.placeId || `${normalize(item.title)}|${point.join(',')}`;
    if (seenPlace.has(key)) { skipped.tekrar++; continue; }
    seenPlace.add(key);

    const phone = item.phoneUnformatted || item.phone || '';
    const dup = existing.concat(picked).find(p =>
      normalize(p.title) === normalize(item.title) ||
      (digits(phone).length >= 10 && digits(p.phone) === digits(phone)) ||
      (metersBetween([p.lat, p.lng], point) <= SAME_PLACE_M && normalize(p.title).slice(0, 6) === normalize(item.title).slice(0, 6))
    );
    if (dup) { skipped.zatenVar++; continue; }

    picked.push({
      title: item.title.trim().slice(0, 120),
      address: (item.address || item.street || 'Mersin Hal Kompleksi').slice(0, 200),
      phone,
      website: item.website || '',
      email: '',
      lat: loc.lat,
      lng: loc.lng,
      category: pickCategory(item, categories || []),
      sells: [], seeks: [], images: [],
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    });
  }

  console.log(`\n✅ Hal içinde eklenecek ${picked.length} işletme:`);
  picked.forEach((p, i) => console.log(`  ${String(i + 1).padStart(3)}. ${p.title}  [${p.category}]${p.phone ? '  ' + p.phone : ''}`));
  console.log(`\n⏭  Atlananlar: hal dışında ${skipped.disari}, kapalı ${skipped.kapali}, aynı sonuç ${skipped.tekrar}, sitede zaten var ${skipped.zatenVar}, eksik bilgi ${skipped.eksik}`);

  if (!INSERT) {
    console.log('\nℹ️  Deneme modu: hiçbir şey eklenmedi. Eklemek için: node scripts/import_mersin.js --ekle --dosya scripts/son_tarama.json');
    return;
  }
  if (!picked.length) return console.log('Eklenecek yeni işletme yok.');
  const { error } = await supabase.from('pins').insert(picked);
  if (error) throw new Error('Eklenemedi: ' + error.message);
  console.log(`\n🎉 ${picked.length} işletme onaylı olarak eklendi.`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
