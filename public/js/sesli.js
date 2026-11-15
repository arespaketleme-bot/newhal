/* ═══════════════════════════════════════════════════════════════
   NewHal — Sesli tanıtım: neden üye olmalı?
   Tarayıcılar kullanıcı dokunmadan ses çalmaya izin vermez; bu yüzden
   anlatım ziyaretçinin sayfaya ilk dokunuşunda başlar. Yalnızca üye
   olmayanlara, her tarayıcıda bir kez, Türkçe ses varsa okunur.
   ═══════════════════════════════════════════════════════════════ */
const VOICE_INTRO_KEY = 'newhalVoiceIntroDone';

function voiceIntroText() {
  const gift = typeof welcomeGiftPoints !== 'undefined' && Number(welcomeGiftPoints) > 0
    ? ` Üstelik yeni üyelere ${Number(welcomeGiftPoints)} Para Puan hediye ediyoruz.` : '';
  return "NewHal'e hoş geldiniz! Burası Mersin Hal Kompleksi'nin dijital rehberi. " +
    'Ücretsiz üye olursanız ilan verebilir, ürününüzü ya da aracınızı binlerce kişiye duyurabilirsiniz. ' +
    'Aradığınız ürün halde satışa çıktığında size anında haber veririz. ' +
    'Esnafla doğrudan mesajlaşabilir, beğendiğiniz ilanları kaydedebilir ve her girişte Para Puan kazanabilirsiniz.' +
    gift +
    ' Üye olmak bir dakikanızı alır; Google hesabınızla tek dokunuşla giriş yapabilirsiniz.';
}

function voiceIntroEligible() {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    if (localStorage.getItem(VOICE_INTRO_KEY)) return false;
    if (localStorage.getItem('userToken')) return false;   // üyeye anlatılmaz
  } catch { return false; }
  return true;
}

function voiceIntroMarkDone() {
  try { localStorage.setItem(VOICE_INTRO_KEY, '1'); } catch {}
}

// Türkçe ses yoksa İngilizce sesle bozuk okunmasın diye hiç okunmaz
function turkishVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => /^tr(-|_|$)/i.test(v.lang) && /google/i.test(v.name))
      || voices.find(v => /^tr(-|_|$)/i.test(v.lang)) || null;
}

let voiceIntroCard = null;

function closeVoiceIntro() {
  try { speechSynthesis.cancel(); } catch {}
  voiceIntroCard?.remove();
  voiceIntroCard = null;
  voiceIntroMarkDone();
}

function showVoiceIntroCard() {
  const card = document.createElement('div');
  card.className = 'voice-intro';
  card.setAttribute('role', 'status');
  card.innerHTML = `
    <span class="voice-intro-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <div class="voice-intro-text"><b>🔊 Neden üye olmalısınız?</b><span>Sesli tanıtım oynatılıyor</span></div>
    <button type="button" class="voice-intro-join">Üye Ol</button>
    <button type="button" class="voice-intro-stop" aria-label="Sesi durdur ve kapat">✕</button>`;
  card.querySelector('.voice-intro-join').onclick = () => {
    closeVoiceIntro();
    if (typeof openAuthModal === 'function') { openAuthModal(); if (typeof setAuthTab === 'function') setAuthTab('register'); }
  };
  card.querySelector('.voice-intro-stop').onclick = closeVoiceIntro;
  document.body.appendChild(card);
  voiceIntroCard = card;
}

function playVoiceIntro() {
  const voice = turkishVoice();
  if (!voice) return false;
  const u = new SpeechSynthesisUtterance(voiceIntroText());
  u.voice = voice;
  u.lang = voice.lang || 'tr-TR';
  u.rate = 1;
  u.pitch = 1;
  u.onend = () => {
    if (!voiceIntroCard) return;
    voiceIntroCard.classList.add('done');
    voiceIntroCard.querySelector('.voice-intro-text span').textContent = 'Ücretsiz üye olun, hemen başlayın';
    setTimeout(() => { if (voiceIntroCard?.classList.contains('done')) { voiceIntroCard.remove(); voiceIntroCard = null; } }, 12000);
  };
  u.onerror = () => { voiceIntroCard?.remove(); voiceIntroCard = null; };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  voiceIntroMarkDone();
  showVoiceIntroCard();
  return true;
}

function setupVoiceIntro() {
  if (!voiceIntroEligible()) return;
  // Sesler bazı tarayıcılarda geç yüklenir; dokunuş anında hazır olsun
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
  const start = () => {
    document.removeEventListener('pointerup', start, true);
    document.removeEventListener('keydown', start, true);
    if (!voiceIntroEligible()) return;   // bu arada giriş yaptıysa
    // iPhone'da ses yalnızca dokunuşun içinde başlatılabilir, bu yüzden beklemeden çağrılır
    if (!playVoiceIntro()) voiceIntroMarkDone();
  };
  document.addEventListener('pointerup', start, true);
  document.addEventListener('keydown', start, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupVoiceIntro);
else setupVoiceIntro();
