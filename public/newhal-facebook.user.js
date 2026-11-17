// ==UserScript==
// @name         NewHal: Facebook ilan toplayıcı
// @namespace    https://newhal.com/
// @version      2.0.0
// @description  Facebook'ta gezerken hal ilanlarını Apify'sız toplar: gönderilere "NewHal'e Gönder" düğmesi ekler, toplama modu açıkken gruplarda ekrandan geçen uygun gönderileri NewHal ilan ajanına yollar.
// @author       NewHal
// @match        https://www.facebook.com/*
// @match        https://web.facebook.com/*
// @icon         https://newhal.com/icons/icon-192.png
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      newhal.com
// @run-at       document-idle
// @downloadURL  https://newhal.com/newhal-facebook.user.js
// @updateURL    https://newhal.com/newhal-facebook.user.js
// ==/UserScript==

/*
  Nasıl çalışır?
  - Gönderiler sizin tarayıcınızda, ekranda gördüğünüz haliyle okunur; Apify kullanılmaz, ücret yoktur.
  - "NewHal'e Gönder": o gönderiyi onay bekleyen ilan olarak ekler.
  - Toplama modu (sol alttaki NewHal düğmesi): yalnızca GRUP sayfalarında çalışır. Ekrandan geçen
    gönderilerden yalnızca anahtar kelimeye (ya da fotoğraf + telefon kuralına) uyanlar NewHal'e gider;
    ana sayfa akışınız ve arkadaşlarınızın kişisel paylaşımları gönderilmez.
  - Facebook sayfa yapısını değiştirirse okuma bozulabilir; sol alttaki sayaçlar bunu fark etmenizi sağlar.
*/
(function () {
  'use strict';

  const SITE = 'https://newhal.com';
  const POST_RX = /\/(posts|permalink|videos|reel|photo|photos)\/|\/(permalink|story|photo)\.php|story_fbid=|[?&]fbid=|multi_permalinks=|\/share\/(p|v|r)\//i;
  const SEE_MORE_RX = /^(daha fazla gör|devamını gör|see more|…\s*daha fazla gör)$/i;
  const FLUSH_MS = 4000;
  const BATCH = 10;

  const state = {
    key: GM_getValue('newhalKey', ''),
    collecting: GM_getValue('newhalCollect', false),
    config: null,             // { keywords, photoPosts, sources }
    queue: [],
    sentKeys: new Set(GM_getValue('newhalSent', [])),
    stats: { seen: 0, sent: 0, added: 0 },
    lastError: '',
  };

  // ── Sunucu ────────────────────────────────────────────────
  function request(method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url: SITE + path, timeout: 60000,
        headers: { 'Content-Type': 'application/json', 'X-NewHal-Key': state.key },
        data: body ? JSON.stringify(body) : undefined,
        onload: r => {
          let data = {};
          try { data = JSON.parse(r.responseText || '{}'); } catch {}
          if (r.status >= 200 && r.status < 300) resolve(data);
          else reject(new Error(data.error || `NewHal hatası (${r.status})`));
        },
        onerror: () => reject(new Error('NewHal\'e bağlanılamadı')),
        ontimeout: () => reject(new Error('NewHal yanıt vermedi')),
      });
    });
  }

  async function loadConfig() {
    if (!state.key) return null;
    try {
      state.config = await request('GET', '/api/collector/config');
      state.lastError = '';
    } catch (err) {
      state.config = null;
      state.lastError = err.message;
    }
    renderPill();
    return state.config;
  }

  function askKey() {
    const k = prompt('NewHal betik anahtarını yapıştırın.\nYönetim paneli → İlan Ajanı → "Tarayıcıyla topla" bölümünde yazar (nh_ ile başlar).', state.key || '');
    if (k === null) return false;
    state.key = k.trim();
    GM_setValue('newhalKey', state.key);
    loadConfig();
    return !!state.key;
  }

  // ── Gönderiyi ekrandan okuma ─────────────────────────────
  const topArticles = () => [...document.querySelectorAll('div[role="article"]')]
    .filter(a => !(a.parentElement && a.parentElement.closest('[role="article"]')));   // yorumlar hariç

  const own = (el, article) => el.closest('[role="article"]') === article;

  function cleanLink(href) {
    let u;
    try { u = new URL(href, location.href); } catch { return null; }
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    if (u.searchParams.has('comment_id')) return null;   // yorum linki, gönderi değil
    const keep = ['story_fbid', 'id', 'fbid', 'set', 'v', 'multi_permalinks'];
    const clean = new URL(u.origin + u.pathname);
    keep.forEach(k => { if (u.searchParams.has(k)) clean.searchParams.set(k, u.searchParams.get(k)); });
    clean.hostname = 'www.facebook.com';
    return clean.href;
  }

  function findPostLink(article) {
    for (const a of article.querySelectorAll('a[href]')) {
      if (!own(a, article)) continue;
      const href = a.getAttribute('href') || '';
      if (POST_RX.test(href)) {
        const link = cleanLink(href);
        if (link) return link;
      }
    }
    return null;
  }

  // Facebook bazı linkleri fare üstüne gelince doldurur
  async function resolveLink(article) {
    let link = findPostLink(article);
    if (link) return link;
    for (const a of article.querySelectorAll('a[role="link"], a[href="#"]')) {
      if (!own(a, article)) continue;
      a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      a.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 400));
    return findPostLink(article);
  }

  function messageEl(article) {
    const sel = '[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]';
    return [...article.querySelectorAll(sel)].find(el => own(el, article)) || null;
  }

  // "Daha fazla gör" açılır, yoksa metnin yalnızca başı okunur
  async function expand(article) {
    const box = messageEl(article) || article;
    const btn = [...box.querySelectorAll('div[role="button"], span[role="button"]')]
      .find(b => own(b, article) && SEE_MORE_RX.test((b.innerText || '').trim()));
    if (btn) { btn.click(); await new Promise(r => setTimeout(r, 300)); }
  }

  function readText(article) {
    const msg = messageEl(article);
    if (msg) return msg.innerText.trim();
    // Yedek: gönderinin kendi (yorum olmayan) yazı blokları; başlık, düğme ve link yazıları atlanır
    const parts = [];
    for (const el of article.querySelectorAll('div[dir="auto"]')) {
      if (!own(el, article) || el.closest('h2, h3, h4, a, [role="button"]')) continue;
      if (el.querySelector('div[dir="auto"]')) continue;   // iç içe olanların en içi alınır
      const t = (el.innerText || '').trim();
      if (t.length >= 2 && !parts.includes(t)) parts.push(t);
    }
    return parts.join('\n');
  }

  function readAuthor(article) {
    const el = [...article.querySelectorAll('h2 a, h3 a, h4 a, h2 strong, h3 strong, h4 strong, strong a')].find(e => own(e, article));
    return el ? el.innerText.trim().split('\n')[0].slice(0, 120) : '';
  }

  function readImages(article) {
    const out = [];
    for (const img of article.querySelectorAll('img')) {
      if (!own(img, article)) continue;
      const src = img.currentSrc || img.src || '';
      if (!/^https:\/\/[^/]*fbcdn\.net\//.test(src)) continue;
      const w = img.naturalWidth || img.width || 0;
      if (w && w < 200) continue;                          // profil fotoğrafı, ifade vb.
      if (!out.includes(src)) out.push(src);
      if (out.length >= 6) break;
    }
    return out;
  }

  async function extract(article, { expandText }) {
    if (expandText) await expand(article);
    return {
      url: (await resolveLink(article)) || '',
      text: readText(article).slice(0, 5000),
      author: readAuthor(article),
      images: readImages(article),
    };
  }

  // ── Süzgeç (sunucudakinin aynısı; uymayan gönderi hiç gönderilmez) ──
  const trLower = t => String(t || '').toLocaleLowerCase('tr-TR');
  function matches(post) {
    const c = state.config;
    if (!c) return false;
    const low = trLower(post.text);
    const keywordHit = post.text.length >= 15 && (c.keywords || []).some(k => low.includes(k));
    const hasPhone = (post.text.replace(/\D/g, '').match(/0?5\d{9}/) || []).length > 0;
    return keywordHit || (c.photoPosts && post.images.length > 0 && hasPhone);
  }

  // Toplama yalnızca grup sayfalarında ve ajanın kaynak listesindeki sayfalarda çalışır
  function pageAllowed() {
    if (/\/groups\//i.test(location.pathname)) return true;
    const here = (location.origin.replace('web.', 'www.') + location.pathname).replace(/\/+$/, '').toLowerCase();
    return ((state.config && state.config.sources) || []).some(src => here.startsWith(src.replace(/\/+$/, '').toLowerCase()));
  }

  const postKey = p => p.url || 'txt:' + p.text.slice(0, 200);

  // ── Toplama modu ─────────────────────────────────────────
  const watched = new WeakSet();
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      // Ekranda 1 sn kaldıysa okunur (hızla geçilenler yüklenmemiş olabilir)
      setTimeout(() => collect(e.target), 1000);
    }
  }, { threshold: 0.4 });

  async function collect(article) {
    if (!state.collecting || !state.config || !pageAllowed() || !document.contains(article)) return;
    const post = await extract(article, { expandText: true });
    state.stats.seen++;
    renderPill();
    if (!post.text && !post.images.length) return;
    const key = postKey(post);
    if (state.sentKeys.has(key) || !matches(post)) return;
    state.sentKeys.add(key);
    state.queue.push(post);
  }

  async function flush() {
    if (!state.queue.length || !state.key) return;
    const batch = state.queue.splice(0, BATCH);
    try {
      const r = await request('POST', '/api/collector/posts', { mode: 'auto', pageUrl: location.href, posts: batch });
      state.stats.sent += batch.length;
      state.stats.added += r.added || 0;
      state.lastError = '';
      if (r.added) toast(`🟢 NewHal: ${r.added} yeni ilan eklendi (onay bekliyor)`);
      // Gönderilenler hatırlanır (sayfa yenilense de tekrar gönderilmez)
      GM_setValue('newhalSent', [...state.sentKeys].slice(-2000));
    } catch (err) {
      state.lastError = err.message;
      batch.forEach(p => state.sentKeys.delete(postKey(p)));   // bir dahaki sefere yeniden denenir
    }
    renderPill();
  }
  setInterval(flush, FLUSH_MS);

  function setCollecting(on) {
    if (on && !state.key && !askKey()) return;
    state.collecting = on;
    GM_setValue('newhalCollect', on);
    if (on) { loadConfig(); scan(); }
    renderPill();
    toast(on ? '🟢 Toplama açık: grupta gezinin, uygun ilanlar NewHal\'e gider' : '⏸ Toplama kapatıldı');
  }

  // ── Görünüm ─────────────────────────────────────────────
  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 2147483647,
      background: '#0b1220', color: '#fff', padding: '12px 18px', borderRadius: '12px', font: '600 14px system-ui, sans-serif',
      boxShadow: '0 10px 30px rgba(0,0,0,.4)', maxWidth: '90vw', textAlign: 'center',
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  function renderPill() {
    let pill = document.getElementById('newhal-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'newhal-pill';
      pill.type = 'button';
      Object.assign(pill.style, {
        position: 'fixed', left: '16px', bottom: '16px', zIndex: 2147483646, padding: '9px 14px', border: '0', borderRadius: '999px',
        font: '700 12.5px system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.35)', maxWidth: '70vw', textAlign: 'left',
      });
      pill.addEventListener('click', () => setCollecting(!state.collecting));
      document.body.appendChild(pill);
    }
    const on = state.collecting;
    let text;
    if (!state.key) text = '🔑 NewHal: anahtarı girin';
    else if (state.lastError) text = `⚠️ NewHal: ${state.lastError}`;
    else if (!on) text = '⏸ NewHal toplama kapalı';
    else if (!pageAllowed()) text = '🟢 NewHal açık · bir gruba girin';
    else text = `🟢 NewHal topluyor · 👀 ${state.stats.seen} · 📤 ${state.stats.sent} · ✅ ${state.stats.added}`;
    pill.textContent = text;
    pill.title = 'Tıklayınca toplama açılır/kapanır. 👀 okunan, 📤 NewHal\'e giden, ✅ ilan olan gönderi sayısı.';
    Object.assign(pill.style, on && !state.lastError
      ? { background: 'linear-gradient(135deg,#34d399,#10b981)', color: '#04130b' }
      : { background: '#0b1220', color: '#fff' });
  }

  function makeButton(onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'newhal-send-btn';
    b.textContent = '🟢 NewHal\'e Gönder';
    Object.assign(b.style, {
      position: 'absolute', top: '10px', right: '96px', zIndex: 5, padding: '6px 12px', border: '0', borderRadius: '999px',
      background: 'linear-gradient(135deg,#34d399,#10b981)', color: '#04130b', font: '800 12.5px system-ui, sans-serif',
      cursor: 'pointer', boxShadow: '0 4px 14px rgba(16,185,129,.45)',
    });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    return b;
  }

  // Elle gönderme: kelime ve yapay zeka elemesi olmadan onay bekleyen ilan olur
  async function sendOne(article, btn) {
    if (!state.key && !askKey()) return;
    btn.textContent = '⏳ Okunuyor...';
    btn.disabled = true;
    try {
      const post = await extract(article, { expandText: true });
      if (!post.text && !post.images.length) throw new Error('Bu gönderide yazı ya da fotoğraf bulunamadı');
      btn.textContent = '⏳ Gönderiliyor...';
      const r = await request('POST', '/api/collector/posts', { mode: 'manual', pageUrl: location.href, posts: [post] });
      state.sentKeys.add(postKey(post));
      btn.textContent = r.added ? '✅ Eklendi' : '☑️ Zaten var';
      toast(r.message || '✅ Gönderildi');
    } catch (err) {
      btn.textContent = '⚠️ Olmadı';
      toast(err.message);
    }
    setTimeout(() => { btn.textContent = '🟢 NewHal\'e Gönder'; btn.disabled = false; }, 3000);
  }

  function scan() {
    for (const article of topArticles()) {
      if (!article.dataset.newhal) {
        article.dataset.newhal = '1';
        if (getComputedStyle(article).position === 'static') article.style.position = 'relative';
        article.appendChild(makeButton(btn => sendOne(article, btn)));
      }
      if (state.collecting && !watched.has(article)) { watched.add(article); io.observe(article); }
    }
    renderPill();
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('NewHal: toplamayı aç / kapat', () => setCollecting(!state.collecting));
    GM_registerMenuCommand('NewHal: betik anahtarını gir', askKey);
  }

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 400);
  }).observe(document.body, { childList: true, subtree: true });
  loadConfig().then(scan);
})();
