// Tarsus Hal Kompleksi icindeki isletmeleri Google Haritalar'dan Apify ile toplar.
//   node scripts/import_tarsus.js           -> tarar ve listeyi gosterir
//   node scripts/import_tarsus.js --ekle    -> tarar, tekrar kontrolu yapar ve ekler
//   node scripts/import_tarsus.js --ekle --dosya scripts/tarsus_son_tarama.json
//                                            -> onceki tarama sonucunu ekler
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { ApifyClient } = require('apify-client');
const { createClient } = require('@supabase/supabase-js');

const ARGS = process.argv.slice(2);
const INSERT = ARGS.includes('--ekle');
const FILE_ARG = ARGS.includes('--dosya') ? ARGS[ARGS.indexOf('--dosya') + 1] : null;
const LAST_SCAN = path.join(__dirname, 'tarsus_son_tarama.json');
const SEARCHES = ['komisyoncu', 'sebze meyve', 'toptan meyve', 'tüccar', 'Tarsus Hali', 'nakliyat'];
const MAX_PER_SEARCH = 60;
const SAME_PLACE_M = 20;
const market = JSON.parse(fs.readFileSync(path.join(__dirname, 'tarsus_hal_siniri.json'), 'utf8'));
const POLYGON = market.polygon; // [lat, lng]

function insidePolygon([lat, lng]) {
  let inside = false;
  for (let i = 0, j = POLYGON.length - 1; i < POLYGON.length; j = i++) {
    const [yi, xi] = POLYGON[i], [yj, xj] = POLYGON[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function metersBetween([lat1, lng1], [lat2, lng2]) {
  const R = 6371000, rad = n => n * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const normalize = s => String(s || '').toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9çğıöşü]+/g, ' ').replace(/\b(ltd|şti|sti|tic|san|ve|a ş|as)\b/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/\D/g, '').slice(-10);

function readApifyToken() {
  const envPath = path.join(__dirname, '../../../_knowledge/credentials/master.env');
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const m = text.match(/^APIFY_(?:API_KEY|TOKEN)="?([^"\r\n]+)"?/m);
  return process.env.APIFY_TOKEN || (m && m[1].trim()) || null;
}

function category(item, categories) {
  const value = normalize(`${item.title} ${(item.categories || []).join(' ')} ${item.categoryName || ''}`);
  if (/komisyon/.test(value)) return 'KOMİSYONCU';
  if (/üretici|uretici|çiftçi|ciftci|müstahsil|mustahsil/.test(value)) return 'MÜSTAHSİL';
  if (/manav/.test(value)) return 'MANAV';
  if (/market|bakkal/.test(value)) return 'MARKET';
  if (/tüccar|tuccar|toptan|ticaret/.test(value)) return 'TÜCCAR';
  return categories.includes('KOMİSYONCU') ? 'KOMİSYONCU' : 'Genel';
}

async function scan(token) {
  const client = new ApifyClient({ token });
  const input = {
    searchStringsArray: SEARCHES,
    customGeolocation: { type: 'Polygon', coordinates: [POLYGON.map(([lat, lng]) => [lng, lat])] },
    maxCrawledPlacesPerSearch: MAX_PER_SEARCH,
    language: 'tr', countryCode: 'tr', skipClosedPlaces: true,
  };
  console.log(`Tarsus Hali cevresinde ${SEARCHES.length} Apify aramasi baslatiliyor...`);
  const run = await client.actor('compass/crawler-google-places').call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.log(`Apify ${items.length} sonuc buldu. Tarama kullanimi: ${run.usageTotalUsd == null ? 'bilinmiyor' : '$' + run.usageTotalUsd.toFixed(2)}`);
  fs.writeFileSync(LAST_SCAN, JSON.stringify(items, null, 1));
  return items;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('Supabase ayarlari eksik.');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  let items;
  if (FILE_ARG) items = JSON.parse(fs.readFileSync(path.resolve(FILE_ARG), 'utf8'));
  else {
    const token = readApifyToken();
    if (!token) throw new Error('Apify anahtari bulunamadi.');
    items = await scan(token);
  }

  const [{ data: categories, error: catError }, { data: existing, error: pinsError }] = await Promise.all([
    db.from('categories').select('name'),
    db.from('pins').select('id,title,phone,lat,lng,address'),
  ]);
  if (catError || pinsError) throw new Error('NewHal kayitlari okunamadi.');
  const categoryNames = (categories || []).map(c => c.name);
  const picked = [], seen = new Set();
  for (const item of items) {
    const loc = item.location;
    if (!item.title || !loc || loc.lat == null || loc.lng == null) continue;
    if (item.permanentlyClosed || item.temporarilyClosed || !insidePolygon([loc.lat, loc.lng])) continue;
    const key = item.placeId || `${normalize(item.title)}|${loc.lat},${loc.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const phone = item.phoneUnformatted || item.phone || '';
    const duplicate = (existing || []).concat(picked).some(p =>
      normalize(p.title) === normalize(item.title) ||
      (digits(phone).length >= 10 && digits(p.phone) === digits(phone)) ||
      (Number.isFinite(p.lat) && Number.isFinite(p.lng) && metersBetween([p.lat, p.lng], [loc.lat, loc.lng]) <= SAME_PLACE_M && normalize(p.title).slice(0, 6) === normalize(item.title).slice(0, 6))
    );
    if (duplicate) continue;
    picked.push({
      title: item.title.trim().slice(0, 120),
      address: (item.address || item.street || 'Tarsus Toptanci Sebze Hali').slice(0, 200),
      phone, website: item.website || '', email: '', lat: loc.lat, lng: loc.lng,
      category: category(item, categoryNames), sells: [], seeks: [], images: [],
      status: 'approved', reviewed_at: new Date().toISOString(),
    });
  }

  console.log(`\nNewHal'e eklenecek ${picked.length} yeni isletme:`);
  picked.forEach((p, i) => console.log(`${i + 1}. ${p.title}${p.phone ? ' | ' + p.phone : ''} | ${p.address}`));
  if (!INSERT) return console.log('\nDeneme modu: kayit eklenmedi. Eklemek icin --ekle kullanin.');
  if (!picked.length) return;
  const { error } = await db.from('pins').insert(picked);
  if (error) throw new Error('Kayitlar eklenemedi: ' + error.message);
  console.log(`\n${picked.length} isletme eklendi.`);
}

main().catch(err => { console.error('Hata:', err.message); process.exit(1); });
