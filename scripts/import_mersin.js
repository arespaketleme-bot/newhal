require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { ApifyClient } = require('apify-client');
const { createClient } = require('@supabase/supabase-js');

// APIFY_TOKEN'ı master.env'den okuma
const masterEnvPath = path.join(__dirname, '../../../_knowledge/credentials/master.env');
const envStr = fs.readFileSync(masterEnvPath, 'utf8');
const apifyTokenMatch = envStr.match(/APIFY_TOKEN="?([^"\n]+)"?/);
const apifyToken = apifyTokenMatch ? apifyTokenMatch[1] : null;

if (!apifyToken) {
  console.error("APIFY_TOKEN bulunamadı.");
  process.exit(1);
}

// Supabase istemcisi
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase bilgileri eksik (.env dosyasını kontrol edin)");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Apify istemcisi
const client = new ApifyClient({ token: apifyToken });

async function run() {
  console.log("🚀 Apify üzerinden Google Haritalar taraması başlatılıyor...");
  
  const input = {
      searchStringsArray: [
          "Mersin Toptancı Hali",
          "Mersin Hal komisyoncu"
      ],
      locationQuery: "Mersin",
      maxCrawledPlacesPerSearch: 30,
      language: "tr",
      countryCode: "tr"
  };

  try {
    // compassion/crawler-google-places veya compass/crawler-google-places
    // En güvenilir aktörlerden biri compass/crawler-google-places'dir.
    const actorCall = await client.actor("compass/crawler-google-places").call(input);
    console.log(`✅ Tarama bitti! Dataset ID: ${actorCall.defaultDatasetId}`);
    
    const { items } = await client.dataset(actorCall.defaultDatasetId).listItems();
    console.log(`📊 Toplam ${items.length} sonuç bulundu. Veritabanına aktarılıyor...`);

    let addedCount = 0;
    for (const item of items) {
      if (!item.title || !item.location || !item.location.lat) continue;
      
      const title = item.title;
      const address = item.address || item.street || 'Mersin Hal Kompleksi';
      const phone = item.phoneUnformatted || item.phone || '';
      const website = item.website || '';
      const lat = item.location.lat;
      const lng = item.location.lng;
      
      let category = 'Genel';
      const titleLower = title.toLowerCase();
      const catLower = (item.categories && item.categories.length > 0) ? item.categories.join(' ').toLowerCase() : '';
      
      if (titleLower.includes('sebze') || titleLower.includes('meyve') || catLower.includes('sebze') || catLower.includes('meyve') || titleLower.includes('komisyon')) {
        category = 'Sebze & Meyve';
      } else if (titleLower.includes('balık') || catLower.includes('balık')) {
        category = 'Balık';
      } else if (titleLower.includes('et') || titleLower.includes('tavuk')) {
        category = 'Et & Tavuk';
      }

      // Supabase'de aynı işletme var mı kontrolü
      const { data: existing } = await supabase.from('pins').select('id').eq('title', title).single();
      
      if (!existing) {
        await supabase.from('pins').insert({
          title,
          address,
          phone,
          website,
          email: '',
          lat,
          lng,
          category,
          status: 'approved',
          reviewed_at: new Date().toISOString()
        });
        addedCount++;
      }
    }

    console.log(`🎉 İşlem tamamlandı! ${addedCount} yeni işletme veritabanına (Supabase) başarıyla eklendi.`);
  } catch (err) {
    console.error("❌ Bir hata oluştu:", err.message);
  }
}

run();
