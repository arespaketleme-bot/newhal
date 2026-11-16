/* ═══════════════════════════════════════════════════════════════
   NewHal — Sesli tanıtım: neden üye olmalı?
   Tarayıcılar kullanıcı dokunmadan ses çalmaya izin vermez; bu yüzden
   anlatım ziyaretçinin sayfaya ilk dokunuşunda başlar. Yalnızca üye
   olmayanlara, her tarayıcıda bir kez.

   İki yol:
   1) Cihazda Türkçe ses varsa tarayıcı okur (cümle cümle; bilgisayardaki
      Chrome uzun metni ~15 sn sonra kestiği için tek parça okutulmaz).
   2) Türkçe ses yoksa (çoğu bilgisayar) hazır ses dosyası çalınır.
   Kartta Durdur/Devam, Üye Ol ve kapat düğmeleri vardır.
   ═══════════════════════════════════════════════════════════════ */
const VOICE_INTRO_KEY = 'newhalVoiceIntroDone';
const VOICE_INTRO_AUDIO = '/ses/tanitim.mp3';

function voiceIntroSentences() {
  const gift = typeof welcomeGiftPoints !== 'undefined' && Number(welcomeGiftPoints) > 0
    ? `Üstelik yeni üyelere ${Number(welcomeGiftPoints)} Para Puan hediye ediyoruz.` : null;
  return [
    "NewHal'e hoş geldiniz!",
    "Burası Mersin Hal Kompleksi'nin dijital rehberi.",
    'Ücretsiz üye olursanız ilan verebilir, ürününüzü ya da aracınızı binlerce kişiye duyurabilirsiniz.',
    'Aradığınız ürün halde satışa çıktığında size anında haber veririz.',
    'Esnafla doğrudan mesajlaşabilir, beğendiğiniz ilanları kaydedebilir ve her girişte Para Puan kazanabilirsiniz.',
    gift,
    'Üye olmak bir dakikanızı alır; Google hesabınızla tek dokunuşla giriş yapabilirsiniz.',
  ].filter(Boolean);
}

function voiceIntroEligible() {
  try {
    if (localStorage.getItem(VOICE_INTRO_KEY)) return false;
    if (localStorage.getItem('userToken')) return false;   // üyeye anlatılmaz
  } catch { return false; }
  return true;
}

function voiceIntroMarkDone() {
  try { localStorage.setItem(VOICE_INTRO_KEY, '1'); } catch {}
}

const hasSpeech = () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

// Türkçe ses yoksa İngilizce sesle bozuk okunmasın; o durumda ses dosyası çalınır
function turkishVoice() {
  if (!hasSpeech()) return null;
  const voices = speechSynthesis.getVoices();
  return voices.find(v => /^tr(-|_|$)/i.test(v.lang) && /google|natural|online/i.test(v.name))
      || voices.find(v => /^tr(-|_|$)/i.test(v.lang)) || null;
}

// Sesler bazı tarayıcılarda (bilgisayardaki Chrome) geç yüklenir: kısa süre beklenir
function waitForVoices(ms = 1500) {
  if (!hasSpeech()) return Promise.resolve();
  if (speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { speechSynthesis.removeEventListener?.('voiceschanged', done); resolve(); };
    speechSynthesis.addEventListener?.('voiceschanged', done);
    setTimeout(done, ms);
  });
}

// ── Oynatıcı: tarayıcı sesi ya da ses dosyası, aynı düğmelerle yönetilir ──
const voicePlayer = {
  mode: null,          // 'speech' | 'audio'
  voice: null,
  audio: null,
  sentences: [],
  index: 0,
  paused: false,
  stopped: false,
  startedAt: 0,
  pausedMs: 0,
  pausedAt: 0,

  start(voice) {
    this.stopped = false;
    this.paused = false;
    this.startedAt = Date.now();
    if (voice) {
      this.mode = 'speech';
      this.voice = voice;
      this.sentences = voiceIntroSentences();
      this.index = 0;
      speechSynthesis.cancel();
      this.speakNext();
    } else {
      this.mode = 'audio';
      this.audio = new Audio(VOICE_INTRO_AUDIO);
      this.audio.preload = 'auto';
      this.audio.onended = () => this.finished();
      this.audio.onerror = () => this.failed();
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => this.failed());
    }
  },

  speakNext() {
    if (this.stopped || this.paused) return;
    if (this.index >= this.sentences.length) return this.finished();
    const u = new SpeechSynthesisUtterance(this.sentences[this.index]);
    u.voice = this.voice;
    u.lang = this.voice.lang || 'tr-TR';
    u.rate = 1;
    u.onend = () => {
      // Durdurulunca bazı tarayıcılar da "bitti" der: o zaman sıradaki cümleye geçilmez
      if (this.stopped || this.paused) return;
      this.index++;
      this.speakNext();
    };
    u.onerror = e => {
      if (this.stopped || this.paused || (e && /interrupted|canceled/.test(e.error))) return;
      this.failed();
    };
    speechSynthesis.speak(u);
  },

  // Duraklatma: Android'de speechSynthesis.pause() güvenilir değil; okunan cümle
  // kesilir ve "Devam"da aynı cümlenin başından sürdürülür.
  pause() {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.pausedAt = Date.now();
    if (this.mode === 'speech') speechSynthesis.cancel();
    else this.audio?.pause();
  },

  resume() {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    this.pausedMs += Date.now() - this.pausedAt;
    if (this.mode === 'speech') this.speakNext();
    else this.audio?.play().catch(() => this.failed());
  },

  stop() {
    this.stopped = true;
    if (this.mode === 'speech') { try { speechSynthesis.cancel(); } catch {} }
    else if (this.audio) { this.audio.pause(); this.audio.src = ''; }
  },

  finished() {
    if (this.stopped) return;
    this.stopped = true;
    const seconds = (Date.now() - this.startedAt - this.pausedMs) / 1000;
    // Sonuna kadar dinlendiyse yöneticiye Telegram bildirimi gider
    if (seconds >= 10) {
      fetch('/api/voice-intro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'completed', seconds: Math.round(seconds),
          voice: this.mode === 'audio' ? 'Ses dosyası' : (this.voice.name || this.voice.lang || ''),
        }),
        keepalive: true,
      }).catch(() => {});
    }
    voiceIntroCardDone();
  },

  failed() {
    this.stopped = true;
    voiceIntroCard?.remove();
    voiceIntroCard = null;
  },
};

// ── Kart ─────────────────────────────────────────────────────
let voiceIntroCard = null;
const VOICE_ICON_PAUSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const VOICE_ICON_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

function closeVoiceIntro() {
  voicePlayer.stop();
  voiceIntroCard?.remove();
  voiceIntroCard = null;
  voiceIntroMarkDone();
}

function toggleVoiceIntroPause() {
  if (!voiceIntroCard) return;
  const btn = voiceIntroCard.querySelector('.voice-intro-pause');
  const status = voiceIntroCard.querySelector('.voice-intro-text span');
  if (voicePlayer.paused) {
    voicePlayer.resume();
    voiceIntroCard.classList.remove('paused');
    btn.innerHTML = VOICE_ICON_PAUSE;
    btn.setAttribute('aria-label', 'Sesi durdur');
    btn.title = 'Durdur';
    status.textContent = 'Sesli tanıtım oynatılıyor';
  } else {
    voicePlayer.pause();
    voiceIntroCard.classList.add('paused');
    btn.innerHTML = VOICE_ICON_PLAY;
    btn.setAttribute('aria-label', 'Sese devam et');
    btn.title = 'Devam et';
    status.textContent = 'Durduruldu';
  }
}

function voiceIntroCardDone() {
  if (!voiceIntroCard) return;
  voiceIntroCard.classList.add('done');
  voiceIntroCard.querySelector('.voice-intro-pause')?.remove();
  voiceIntroCard.querySelector('.voice-intro-text span').textContent = 'Ücretsiz üye olun, hemen başlayın';
  setTimeout(() => { if (voiceIntroCard?.classList.contains('done')) { voiceIntroCard.remove(); voiceIntroCard = null; } }, 12000);
}

function showVoiceIntroCard() {
  const card = document.createElement('div');
  card.className = 'voice-intro';
  card.setAttribute('role', 'status');
  card.innerHTML = `
    <span class="voice-intro-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <div class="voice-intro-text"><b>🔊 Neden üye olmalısınız?</b><span>Sesli tanıtım oynatılıyor</span></div>
    <button type="button" class="voice-intro-pause" aria-label="Sesi durdur" title="Durdur">${VOICE_ICON_PAUSE}</button>
    <button type="button" class="voice-intro-join">Üye Ol</button>
    <button type="button" class="voice-intro-stop" aria-label="Sesi kapat" title="Kapat">✕</button>`;
  card.querySelector('.voice-intro-pause').onclick = toggleVoiceIntroPause;
  card.querySelector('.voice-intro-join').onclick = () => {
    closeVoiceIntro();
    if (typeof openAuthModal === 'function') { openAuthModal(); if (typeof setAuthTab === 'function') setAuthTab('register'); }
  };
  card.querySelector('.voice-intro-stop').onclick = closeVoiceIntro;
  document.body.appendChild(card);
  voiceIntroCard = card;
}

function playVoiceIntro() {
  voiceIntroMarkDone();
  showVoiceIntroCard();
  voicePlayer.start(turkishVoice());
}

function setupVoiceIntro() {
  if (!voiceIntroEligible()) return;
  if (hasSpeech()) speechSynthesis.getVoices();   // listeyi erkenden yüklemeye başlat
  const start = () => {
    document.removeEventListener('pointerup', start, true);
    document.removeEventListener('keydown', start, true);
    if (!voiceIntroEligible()) return;   // bu arada giriş yaptıysa
    // iPhone'da ses dokunuşun içinde başlamalı: sesler hazırsa beklemeden çalınır
    if (!hasSpeech() || speechSynthesis.getVoices().length) return playVoiceIntro();
    // Sesler henüz yüklenmediyse (bilgisayardaki Chrome) kısa süre beklenir;
    // dokunuştan sonra kazanılan izin bu süre içinde de geçerlidir
    waitForVoices().then(playVoiceIntro);
  };
  document.addEventListener('pointerup', start, true);
  document.addEventListener('keydown', start, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupVoiceIntro);
else setupVoiceIntro();
