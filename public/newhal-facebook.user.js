// ==UserScript==
// @name         NewHal: Facebook gönderisini ilana çevir
// @namespace    https://newhal.com/
// @version      1.0.0
// @description  Facebook gönderilerine "NewHal'e Gönder" düğmesi ekler. Basınca NewHal yönetim panelinde ilan formu kendiliğinden dolar.
// @author       NewHal
// @match        https://www.facebook.com/*
// @match        https://web.facebook.com/*
// @match        https://m.facebook.com/*
// @icon         https://newhal.com/icons/icon-192.png
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @downloadURL  https://newhal.com/newhal-facebook.user.js
// @updateURL    https://newhal.com/newhal-facebook.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ADMIN_URL = 'https://newhal.com/admin.html';
  // Gönderi linki gibi görünen adresler
  const POST_RX = /\/(posts|permalink|videos|reel|photo|photos)\/|\/(permalink|story|photo)\.php|story_fbid=|[?&]fbid=|\/share\/(p|v|r)\//i;

  // Linki sadeleştirir: takip parametreleri atılır, gönderiyi bulan parçalar kalır
  function cleanLink(href) {
    let u;
    try { u = new URL(href, location.href); } catch { return null; }
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    if (u.searchParams.has('comment_id')) return null;   // yorum linki, gönderi değil
    const keep = ['story_fbid', 'id', 'fbid', 'set', 'v'];
    const clean = new URL(u.origin + u.pathname);
    keep.forEach(k => { if (u.searchParams.has(k)) clean.searchParams.set(k, u.searchParams.get(k)); });
    clean.hostname = 'www.facebook.com';
    return clean.href;
  }

  function findPostLink(article) {
    for (const a of article.querySelectorAll('a[href]')) {
      // Gönderinin içindeki yorumlar da "article"; onların linkleri atlanır
      if (a.closest('[role="article"]') !== article) continue;
      const href = a.getAttribute('href') || '';
      if (POST_RX.test(href)) {
        const link = cleanLink(href);
        if (link) return link;
      }
    }
    return null;
  }

  function sendToNewHal(link) {
    window.open(`${ADMIN_URL}?fbLink=${encodeURIComponent(link)}`, 'newhal_admin');
  }

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

  // Facebook bazı linkleri fare üstüne gelince doldurur: gerekirse linklere "dokunup" tekrar bakılır
  async function resolveLink(article) {
    let link = findPostLink(article);
    if (link) return link;
    for (const a of article.querySelectorAll('a[role="link"], a[href="#"]')) {
      if (a.closest('[role="article"]') !== article) continue;
      a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      a.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 500));
    return findPostLink(article);
  }

  function addButtons() {
    document.querySelectorAll('div[role="article"]').forEach(article => {
      if (article.dataset.newhal) return;
      if (article.parentElement && article.parentElement.closest('[role="article"]')) return;   // yorumlar
      article.dataset.newhal = '1';
      if (getComputedStyle(article).position === 'static') article.style.position = 'relative';
      article.appendChild(makeButton(async (btn) => {
        btn.textContent = '⏳ Link aranıyor...';
        const link = await resolveLink(article);
        btn.textContent = '🟢 NewHal\'e Gönder';
        if (!link) {
          toast('Bu gönderinin linki bulunamadı. Gönderinin tarihine tıklayıp gönderiyi açın, sonra sağ alttaki düğmeye basın.');
          return;
        }
        btn.textContent = '✅ Gönderildi';
        setTimeout(() => { btn.textContent = '🟢 NewHal\'e Gönder'; }, 2500);
        sendToNewHal(link);
      }));
    });
  }

  // Açık sayfa zaten bir gönderiyse sağ altta tek düğme
  function pageButton() {
    let b = document.getElementById('newhal-page-btn');
    const isPost = POST_RX.test(location.pathname + location.search);
    if (!isPost) { if (b) b.remove(); return; }
    if (b) return;
    b = makeButton(() => {
      const link = cleanLink(location.href);
      if (link) sendToNewHal(link); else toast('Bu sayfanın linki okunamadı');
    });
    b.id = 'newhal-page-btn';
    Object.assign(b.style, { position: 'fixed', top: 'auto', right: '20px', bottom: '20px', zIndex: 2147483646, padding: '12px 18px', fontSize: '14px' });
    document.body.appendChild(b);
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Bu sayfayı NewHal\'e gönder', () => {
      const link = cleanLink(location.href);
      if (link) sendToNewHal(link); else toast('Bu sayfanın linki okunamadı');
    });
  }

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => { addButtons(); pageButton(); }, 400);
  }).observe(document.body, { childList: true, subtree: true });
  addButtons();
  pageButton();
})();
