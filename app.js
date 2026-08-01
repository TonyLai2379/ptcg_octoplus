// ==========================================
// 1. 全域變數與 Supabase 初始化
// ==========================================
const API_BASE = "https://ptcg-octoplus-api.onrender.com";
const SUPABASE_URL = "https://cnjajimwpuuhkdxelgwg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNuamFqaW13cHV1aGtkeGVsZ3dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTg4MTQsImV4cCI6MjEwMDYzNDgxNH0.0HYCJC25Mgv5lkdt5BdoWO825wvtFLbjuS7pi1loSfg";

let supabaseClient = null;
try {
    if (typeof window.supabase !== 'undefined') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
        console.error("❌ Supabase 初始化失敗：找不到 window.supabase，請檢查 CDN");
    }
} catch (e) {
    console.error("Supabase 初始化發生例外錯誤", e);
}

let currentLang = localStorage.getItem('app_lang') || 'zh';
let deckDict = {};
let gameCards = [];
let lastSimResult = null;
let targetList = {};
let chainList = {};
let tempSelectedKeys = [];
let searchMultiSelection = {};
let currentModalMode = "";
let searchTimeout = null;
let isDragging = false;
let benchSize = 5;
let historyStates = [];
let historyPtr = -1;
let prizesFaceUp = false;
let feedbackBase64 = "";

// 💡 終極修正版：直接使用 UTF-8 URL 編碼，完全棄用容易報錯的 btoa Base64
function getCardBackSVG(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="100%" height="100%" fill="${color}" rx="4" /><rect x="5%" y="5%" width="90%" height="90%" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" rx="2" /><text x="50%" y="50%" font-size="28" text-anchor="middle" dominant-baseline="central">🐙</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let DEFAULT_CARDBACK = getCardBackSVG("#2B579A");

// ==========================================
// 2. 教學導覽與 Splash 開場動畫
// ==========================================
function openProbTutorial() {
    document.getElementById('prob-tutorial-modal').style.display = 'flex';
}

let splashDismissed = false;
function dismissSplash() {
    if (splashDismissed) return;
    splashDismissed = true;
    const splash = document.getElementById('octopus-splash');
    if (splash) {
        splash.style.opacity = '0';
        splash.style.visibility = 'hidden';
        setTimeout(() => splash.remove(), 800);
    }
}

function runSplashAnimation() {
    let countEl = document.getElementById('splash-count');
    let phaseEl = document.getElementById('splash-phase-text');
    let barEl = document.getElementById('splash-bar-inner');
    if (!countEl) return;
    let progress = 0; let currentProb = 0.0; let targetProb = 47.0;
    let totalSteps = 5000 / 30; let stepProb = targetProb / (totalSteps * 0.7);
    let timer = setInterval(() => {
        progress += (100 / totalSteps);
        if (barEl) barEl.style.width = Math.min(100, progress) + '%';
        if (currentProb < targetProb) {
            currentProb += stepProb;
            if (currentProb >= targetProb) currentProb = targetProb;
            countEl.innerText = currentProb.toFixed(1) + '%';
        }
        if (progress > 30 && progress <= 65) {
            if (phaseEl) phaseEl.innerText = "🎯 萬次蒙地卡羅 ✕ 深度勝率精算";
        } else if (progress > 65) {
            if (phaseEl) phaseEl.innerText = "🏆 WIN MORE：掌舵對局，勝率大增";
        }
        if (progress >= 100) {
            clearInterval(timer);
            setTimeout(dismissSplash, 800);
        }
    }, 30);
}

const tourSteps = [
    { id: 'import-section', title: '💡 步驟 1/6：牌組匯入', desc: '牌組匯入，還可以手動編輯呦！支援繁中官方代碼與 Limitless 英文代碼。' },
    { id: 'btn-start-game', title: '🎲 步驟 2/6：開局沙盤', desc: '匯入好牌組就可以開局啦！系統會自動幫您隨機洗牌並發放手牌與獎賞卡。' },
    { id: 'cloud-save-section', title: '💾 步驟 3/6：雲端牌組紀錄', desc: '可以記錄牌組，節省時間。隨時儲存最愛的卡組，跨裝置一鍵載入！' },
    { id: 'battle-board-area', title: '⚔️ 步驟 4/6：覆盤戰場', desc: '設定覆盤戰場，卡片可以自動拖曳呦！支援完美疊放與錯位排列。' },
    { id: 'prob-panel', title: '🎯 步驟 5/6：萬次蒙地卡羅推演', desc: '複雜機率運算、情境分析沒煩惱！一鍵精算極限對局手牌率。' },
    { id: 'history-controls', title: '📤 步驟 6/6：一鍵對局分享', desc: '想跟朋友分享嗎？這裡可以一秒分享～產生 6 位數短代碼還原戰局與機率推演！' }
];

let currentTourIndex = 0;
function startInteractiveTour() {
    currentTourIndex = 0;
    document.getElementById('tour-backdrop').style.display = 'block';
    showTourStep(currentTourIndex);
}

function showTourStep(index) {
    document.querySelectorAll('.tour-active-target').forEach(el => el.classList.remove('tour-active-target'));
    if (index >= tourSteps.length) {
        endTour();
        return;
    }
    const step = tourSteps[index];
    const targetEl = document.getElementById(step.id);
    const box = document.getElementById('tour-tooltip-box');
    
    if (targetEl) {
        targetEl.classList.add('tour-active-target');
        if (step.id === 'history-controls') {
            box.style.display = 'block';
            box.style.top = (window.innerHeight - (box.offsetHeight || 220) - 80) + 'px';
            box.style.left = (window.innerWidth - (box.offsetWidth || 320) - 30) + 'px';
        } else {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            box.style.display = 'block';
            const rect = targetEl.getBoundingClientRect();
            let top = rect.bottom + 15;
            let left = rect.left;
            if (top + (box.offsetHeight || 220) > window.innerHeight) top = rect.top - (box.offsetHeight || 220) - 15;
            if (left + (box.offsetWidth || 320) > window.innerWidth) left = window.innerWidth - (box.offsetWidth || 320) - 25;
            box.style.top = Math.max(20, top) + 'px';
            box.style.left = Math.max(20, left) + 'px';
        }
        document.getElementById('tour-step-title').innerText = step.title;
        document.getElementById('tour-step-desc').innerText = step.desc;
    } else {
        nextTourStep();
    }
}

function nextTourStep() {
    currentTourIndex++;
    if (currentTourIndex < tourSteps.length) showTourStep(currentTourIndex); else endTour();
}

function endTour() {
    document.querySelectorAll('.tour-active-target').forEach(el => el.classList.remove('tour-active-target'));
    document.getElementById('tour-backdrop').style.display = 'none';
    document.getElementById('tour-tooltip-box').style.display = 'none';
    localStorage.setItem('octoplus_tour_done', 'Y');
}

// ==========================================
// 3. 戰術工具與吉祥物互動
// ==========================================
function rollDice() {
    let res = Math.floor(Math.random() * 6) + 1;
    let display = res === 1 ? '🐙' : res;
    showBigResult(display, res === 1 ? '#00E5FF' : '#FFD700');
}

function flipCoin() {
    let res = Math.random() < 0.5 ? '正' : '反';
    showBigResult(res, res === '正' ? '#FF5252' : '#888');
}

function showBigResult(text, color) {
    let modal = document.getElementById('dice-modal');
    let resEl = document.getElementById('dice-result');
    resEl.innerText = text;
    resEl.style.color = color;
    resEl.classList.remove('bounce-in');
    void resEl.offsetWidth;
    resEl.classList.add('bounce-in');
    modal.style.display = 'flex';
    setTimeout(() => { modal.style.display = 'none'; }, 2000);
}

const octoQuotes = [
    "Replay. Analyze. Win More! 今天也要贏！",
    "萬次蒙地卡羅算力已就緒！",
    "對局有精采操作？點右下角一鍵分享給朋友！",
    "需要幫忙嗎？可以點擊右上角「❓ 教學」喔！",
    "我是小章魚，為你的勝率保駕護航！",
    "覆盤是通往大師連勝唯一的捷徑！"
];

let isMascotDragging = false;
let mascotOffsetX = 0, mascotOffsetY = 0;
let speechBubbleTimer = null;

function triggerOctoMascotClick(e) {
    if (isMascotDragging) return;
    const bodyEl = document.getElementById('octo-3d-body');
    const bubble = document.getElementById('octo-speech-bubble');
    if (bodyEl) { bodyEl.classList.remove('jump'); void bodyEl.offsetWidth; bodyEl.classList.add('jump'); }
    if (bubble) {
        bubble.innerText = octoQuotes[Math.floor(Math.random() * octoQuotes.length)];
        bubble.classList.add('active');
        clearTimeout(speechBubbleTimer);
        speechBubbleTimer = setTimeout(() => { bubble.classList.remove('active'); }, 3500);
    }
}

function startMascotDrag(e) {
    const mascot = document.getElementById('octo-mascot-wrapper');
    if (!mascot) return;
    let clientX = e.clientX || (e.touches && e.touches[0].clientX);
    let clientY = e.clientY || (e.touches && e.touches[0].clientY);
    isMascotDragging = false;
    let startX = clientX; let startY = clientY;
    let rect = mascot.getBoundingClientRect();
    mascotOffsetX = clientX - rect.left;
    mascotOffsetY = clientY - rect.top;
    
    function onMove(moveEvent) {
        let curX = moveEvent.clientX || (moveEvent.touches && moveEvent.touches[0].clientX);
        let curY = moveEvent.clientY || (moveEvent.touches && moveEvent.touches[0].clientY);
        if (Math.abs(curX - startX) > 5 || Math.abs(curY - startY) > 5) { isMascotDragging = true; }
        if (isMascotDragging) {
            mascot.style.position = 'fixed';
            mascot.style.left = (curX - mascotOffsetX) + 'px';
            mascot.style.top = (curY - mascotOffsetY) + 'px';
            mascot.style.bottom = 'auto';
        }
    }
    
    function onEnd() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        setTimeout(() => { isMascotDragging = false; }, 50);
    }
    
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
}

// ==========================================
// 4. 登入、會員與表單機制
// ==========================================
function checkAgreements() {
    let termsAgreed = localStorage.getItem('octoplus_terms_agreed') === 'Y';
    let privacyAgreed = localStorage.getItem('octoplus_privacy_agreed') === 'Y';
    let tStatus = document.getElementById('terms-status');
    let pStatus = document.getElementById('privacy-status');
    let btn = document.getElementById('send-verify-btn');
    let rem = document.getElementById('read-reminder');
    
    if (tStatus) { tStatus.innerHTML = termsAgreed ? '✅ 已同意' : '❌ 尚未同意'; tStatus.style.color = termsAgreed ? '#34A853' : '#FF5252'; }
    if (pStatus) { pStatus.innerHTML = privacyAgreed ? '✅ 已同意' : '❌ 尚未同意'; pStatus.style.color = privacyAgreed ? '#34A853' : '#FF5252'; }
    
    if (btn && rem) {
        let lastSend = localStorage.getItem('magic_link_last_send');
        let count = parseInt(localStorage.getItem('octoplus_send_count')) || 0;
        let inCooldown = false;
        
        if (lastSend) {
            let diff = Math.floor((new Date().getTime() - parseInt(lastSend)) / 1000);
            let targetCooldown = count === 1 ? 5 : (count === 2 ? 30 : 300);
            if (diff < targetCooldown) inCooldown = true;
        }
        
        if (termsAgreed && privacyAgreed) {
            rem.style.color = '#34A853';
            rem.innerText = '✅ 條款皆已同意，可以發送驗證連結了！';
            if (!inCooldown) btn.disabled = false;
        } else {
            btn.disabled = true;
            rem.style.color = '#FF5252';
            rem.innerText = '⚠️ 請先點擊閱讀並同意上述兩項條款，方可發送';
        }
    }
}

function checkCooldownOnLoad() {
    let lastSend = localStorage.getItem('magic_link_last_send');
    let count = parseInt(localStorage.getItem('octoplus_send_count')) || 0;
    if (lastSend) {
        let diff = Math.floor((new Date().getTime() - parseInt(lastSend)) / 1000);
        let targetCooldown = count === 1 ? 5 : (count === 2 ? 30 : 300);
        if (diff < targetCooldown) startCooldownTimer(targetCooldown - diff);
    }
}

function startCooldownTimer(seconds) {
    const btn = document.getElementById('send-verify-btn');
    if (!btn) return;
    btn.disabled = true;
    let countdown = seconds;
    btn.innerText = `⏳ 冷卻中 (${countdown}s)`;
    const timer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            btn.innerText = `⏳ 冷卻中 (${countdown}s)`;
        } else {
            clearInterval(timer);
            btn.innerText = "✨ 發送驗證連結";
            checkAgreements();
        }
    }, 1000);
}

window.addEventListener('load', () => {
    checkAgreements();
    checkCooldownOnLoad();
    try {
        let savedDeck = localStorage.getItem('octoplus_deck');
        if (savedDeck) { deckDict = JSON.parse(savedDeck); updateDeckUI(); }
        let savedBoard = localStorage.getItem('octoplus_board');
        if (savedBoard) gameCards = JSON.parse(savedBoard);
    } catch(e) {}
    renderBenchSlots();
    renderBoard();
    runSplashAnimation();
});
setInterval(checkAgreements, 1000);
window.addEventListener('focus', checkAgreements);

window.addEventListener('DOMContentLoaded', async () => {
    if (supabaseClient) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) handleSession(session);
    }
});

if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) handleSession(session);
        else document.getElementById('gate-overlay').style.display = 'flex';
    });
}

async function handleSession(session) {
    document.getElementById('gate-overlay').style.display = 'none';
    document.getElementById('user-id-input').value = session.user.email ? session.user.email.split('@')[0] : session.user.id.substring(0, 8);
    document.getElementById('btn-unlock').innerText = "訂閱、輸入邀請碼";
    
    try {
        if (supabaseClient) {
            const { data } = await supabaseClient.from('profiles').select('is_pro, pro_expires_at').eq('id', session.user.id).single();
            if (data) {
                let hasActiveSub = false;
                if (data.pro_expires_at) {
                    let expDate = new Date(data.pro_expires_at.replace("Z", "+00:00"));
                    if (new Date() < expDate) hasActiveSub = true;
                }
                if (data.is_pro || hasActiveSub) {
                    let expStr = "終身尊榮 VIP ♾️";
                    if (data.pro_expires_at) {
                        let d = new Date(data.pro_expires_at.replace("Z", "+00:00"));
                        if (d.getFullYear() < 2090) expStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    }
                    document.getElementById('txt-status').innerHTML = `👑 <b>Pro 專業會員</b><br><span style="font-size:11px; color:#FFD700;">(有效期限: ${expStr})</span>`;
                    document.getElementById('auth-status-bar').style.background = "rgba(255, 215, 0, 0.12)";
                    document.getElementById('auth-status-bar').style.border = "1px solid rgba(255, 215, 0, 0.5)";
                } else {
                    document.getElementById('txt-status').innerHTML = `<b>免費試用版</b><br><span style="font-size:11px; color:#00E5FF;">(每日 30 次額度)</span>`;
                    document.getElementById('auth-status-bar').style.background = "rgba(33, 38, 44, 1)";
                    document.getElementById('auth-status-bar').style.border = "1px solid #30363D";
                }
            }
        }
    } catch (err) {}
    fetchSavedDecks();
    if (localStorage.getItem('octoplus_tour_done') !== 'Y') setTimeout(() => { startInteractiveTour(); }, 600);
}

async function loginWithMagicLink() {
    let termsAgreed = localStorage.getItem('octoplus_terms_agreed') === 'Y';
    let privacyAgreed = localStorage.getItem('octoplus_privacy_agreed') === 'Y';
    if (!termsAgreed || !privacyAgreed) return alert("請先閱讀並同意服務條款與隱私權政策！");
    if (!supabaseClient) return alert("系統初始化失敗，請重新整理網頁");
    
    const email = (document.getElementById('magic-email-input') ? document.getElementById('magic-email-input').value.trim() : "");
    if (!email) return alert("請輸入有效的 Email 信箱");
    
    const btn = document.getElementById('send-verify-btn');
    const msgEl = document.getElementById('magic-link-msg');
    btn.innerText = "⏳ 發送中...";
    btn.disabled = true;
    msgEl.style.display = 'none';
    
    try {
        const { error } = await supabaseClient.auth.signInWithOtp({ email: email, options: { emailRedirectTo: window.location.origin } });
        if (error) {
            msgEl.style.color = "#FF5252";
            msgEl.innerText = "❌ 發送失敗：" + error.message;
            msgEl.style.display = 'block';
            btn.innerText = "✨ 發送驗證連結";
            btn.disabled = false;
        } else {
            msgEl.style.color = "#00E5FF";
            msgEl.innerText = "✅ 驗證信已成功發送！請至信箱點擊連結登入。";
            msgEl.style.display = 'block';
            let now = new Date().getTime();
            let count = parseInt(localStorage.getItem('octoplus_send_count')) || 0;
            if (now - (parseInt(localStorage.getItem('magic_link_last_send')) || 0) > 60 * 60 * 1000) count = 0;
            localStorage.setItem('octoplus_send_count', ++count);
            localStorage.setItem('magic_link_last_send', now);
            startCooldownTimer(count === 1 ? 5 : (count === 2 ? 30 : 300));
        }
    } catch (err) {
        msgEl.style.color = "#FF5252";
        msgEl.innerText = "❌ 發生例外錯誤，請重試";
        msgEl.style.display = 'block';
        btn.innerText = "✨ 發送驗證連結";
        btn.disabled = false;
    }
}

async function getFreshToken() {
    if (!supabaseClient) return null;
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
        document.getElementById('gate-overlay').style.display = 'flex';
        document.getElementById('sub-modal').style.display = 'none';
        alert("請先完成信箱驗證登入！");
        return null;
    }
    return session.access_token;
}

// ==========================================
// 5. 牌組處理與 UI 邏輯
// ==========================================
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-toggle-btn');
    if (sb.style.width === '0px') { sb.style.width = '360px'; btn.innerText = '«'; }
    else { sb.style.width = '0px'; btn.innerText = '»'; }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

function switchTutTab(tid) {
    document.querySelectorAll('#tutorial-modal .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#tutorial-modal .tut-content').forEach(c => c.style.display='none');
    document.getElementById('btn-'+tid).classList.add('active');
    document.getElementById(tid).style.display = 'flex';
}

function switchSubTutTab(subId) {
    document.querySelectorAll('.sub-tab-btn').forEach(b => { b.style.borderColor = '#30363D'; b.style.color = '#888'; });
    document.querySelectorAll('.sub-tut-content').forEach(c => c.style.display = 'none');
    let activeBtn = document.getElementById('btn-' + subId);
    activeBtn.style.borderColor = '#00E5FF';
    activeBtn.style.color = '#00E5FF';
    document.getElementById(subId).style.display = 'block';
}

function openTutorial() { startInteractiveTour(); }
function closeTutorial() { document.getElementById('tutorial-modal').style.display='none'; localStorage.setItem('tut_shown', 'true'); }

function showProgress(id) {
    let prog = document.getElementById('prog-'+id);
    let bar = document.getElementById('bar-'+id);
    let btn = id === 'link' ? document.getElementById('btn-parse-official') : document.getElementById('btn-parse-text');
    if(prog && bar) { prog.style.display = 'block'; bar.style.width = '30%'; }
    if(btn) { btn.disabled = true; btn.dataset.origText = btn.innerText; btn.innerText = "⏳ 解析中..."; }
}

function hideProgress(id) {
    let prog = document.getElementById('prog-'+id);
    let bar = document.getElementById('bar-'+id);
    let btn = id === 'link' ? document.getElementById('btn-parse-official') : document.getElementById('btn-parse-text');
    if(bar) bar.style.width = '100%';
    setTimeout(() => {
        if(prog) prog.style.display = 'none';
        if(bar) bar.style.width = '0%';
        if(btn) { btn.disabled = false; btn.innerText = btn.dataset.origText || "解析牌組"; }
    }, 400);
}

function getDeckTotal() { return Object.values(deckDict).reduce((sum, c) => sum + c.qty, 0); }
function checkBlink() {
    let el = document.getElementById('import-section');
    if(getDeckTotal() < 60) el.classList.add('blink-yellow'); else el.classList.remove('blink-yellow');
}

function updateDeckUI() {
    const container = document.getElementById('deck-list-container');
    container.innerHTML = "";
    let total = getDeckTotal();
    
    Object.keys(deckDict).forEach(key => {
        const div = document.createElement('div');
        div.className = 'deck-item';
        let safeKey = key.replace(/'/g, "\\\\'");
        div.innerHTML = `<span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:160px;" title="${deckDict[key].name.replace(/"/g, '&quot;')}">${deckDict[key].name}</span> <div style="display:flex; align-items:center; gap:4px;"> <button class="btn-secondary" style="padding:2px 8px; cursor:pointer;" onclick="modQty('${safeKey}', -1)">-</button> <span style="display:inline-block; width:20px; text-align:center;">${deckDict[key].qty}</span> <button class="btn-secondary" style="padding:2px 8px; cursor:pointer;" onclick="modQty('${safeKey}', 1)">+</button></div>`;
        container.appendChild(div);
    });
    
    document.getElementById('deck-total-count').innerText = total;
    document.getElementById('deck-total-count').style.color = (total === 60) ? '#00E5FF' : '#FF5252';
    checkBlink();
    
    if(document.getElementById('gallery-modal').style.display === 'flex' && currentModalMode === 'preview') {
        document.getElementById('gallery-title').innerText = `👁️ 牌組預覽 (${total} / 60)`;
        renderGalleryItems(Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] })));
    }
    saveLocalData();
}

function modQty(key, delta) {
    deckDict[key].qty += delta;
    if(deckDict[key].qty <= 0) delete deckDict[key];
    updateDeckUI();
}

function parseOfficial() {
    showProgress('link');
    fetch(`${API_BASE}/api/v1/parse_official`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({deck_code: document.getElementById('deck-code').value})
    }).then(r=>r.json()).then(d=>{
        if(d.success){ deckDict=d.deck; updateDeckUI(); }
        else alert(d.detail || "解析失敗。");
    }).catch(e => alert("連線失敗。")).finally(() => hideProgress('link'));
}

async function parseText() {
    let rawText = document.getElementById('deck-text').value;
    if(!rawText.trim()) return alert("請貼上牌組內容");
    
    showProgress('text');
    let lines = rawText.split('\n').map(l => l.trim()).filter(l => l);
    let localCache = JSON.parse(localStorage.getItem('octoplus_card_cache_v3') || '{}');
    let unknownText = [];
    let newDeck = {};
    
    for(let line of lines) {
        if(/^(Pokémon|Trainer|Energy|Cards|Player|Event|Deck|Format)/i.test(line) || line.length < 3) continue;
        let match = line.match(/^(\d+)\s+(.+)/);
        if(match) {
            let searchName = (match[2].trim().match(/^(.*?)(?:\s+([A-Za-z0-9\-]+)\s+(\d+[a-zA-Z]*))?$/) || [])[1] || match[2].trim();
            let finalCardKey = (match[2].trim().match(/^(.*?)(?:\s+([A-Za-z0-9\-]+)\s+(\d+[a-zA-Z]*))?$/) && match[2].trim().match(/^(.*?)(?:\s+([A-Za-z0-9\-]+)\s+(\d+[a-zA-Z]*))?$/)[2]) ? `${searchName} [${match[2].trim().match(/^(.*?)(?:\s+([A-Za-z0-9\-]+)\s+(\d+[a-zA-Z]*))?$/)[2]} ${match[2].trim().match(/^(.*?)(?:\s+([A-Za-z0-9\-]+)\s+(\d+[a-zA-Z]*))?$/)[3]}]` : searchName;
            
            if(localCache[finalCardKey]) {
                if(!newDeck[finalCardKey]) newDeck[finalCardKey] = {qty: 0, img: localCache[finalCardKey].img, name: searchName, fallback_img: localCache[finalCardKey].fallback_img};
                newDeck[finalCardKey].qty += parseInt(match[1]);
            } else {
                unknownText.push(line);
            }
        } else {
            unknownText.push(line);
        }
    }
    
    if(unknownText.length > 0) {
        try {
            let r = await fetch(`${API_BASE}/api/v1/parse_text`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({text: unknownText.join('\n')})
            });
            let d = await r.json();
            if(d.success) {
                Object.keys(d.deck).forEach(k => {
                    let c = d.deck[k];
                    localCache[k] = {img: c.img, name: c.name, fallback_img: c.fallback_img};
                    if(!newDeck[k]) newDeck[k] = {qty: 0, img: c.img, name: c.name, fallback_img: c.fallback_img};
                    newDeck[k].qty += c.qty;
                });
                localStorage.setItem('octoplus_card_cache_v3', JSON.stringify(localCache));
            }
        } catch(e) {}
    }
    deckDict = newDeck;
    updateDeckUI();
    document.getElementById('deck-text').value = "";
    hideProgress('text');
}

function addCustomCard() {
    const name = document.getElementById('custom-card-input').value;
    if(!name) return;
    if(!deckDict[name]) deckDict[name] = {qty:0, img: "default_back", name: name, fallback_img: DEFAULT_CARDBACK};
    deckDict[name].qty++;
    updateDeckUI();
    document.getElementById('custom-card-input').value = "";
}

function debounceSearch(val) {
    clearTimeout(searchTimeout);
    if(!val) { document.getElementById('search-results').style.display='none'; return; }
    searchTimeout = setTimeout(() => {
        fetch(`${API_BASE}/api/v1/search_db?q=${val}`).then(r=>r.json()).then(d=>{
            let resBox = document.getElementById('search-results');
            resBox.innerHTML = "";
            if(d.results && d.results.length > 0) {
                d.results.forEach(c => {
                    let div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.innerHTML = `<img src="${c.img}" onerror="this.onerror=null; this.src='${DEFAULT_CARDBACK}'"> <span style="font-size:13px;">${c.name}</span>`;
                    div.onclick = () => {
                        if(!deckDict[c.key]) deckDict[c.key] = {qty:0, img: c.img, name: c.name, fallback_img: DEFAULT_CARDBACK};
                        deckDict[c.key].qty++;
                        updateDeckUI();
                        document.getElementById('search-input').value = "";
                        resBox.style.display='none';
                    };
                    resBox.appendChild(div);
                });
                resBox.style.display = 'block';
            } else {
                resBox.style.display = 'none';
            }
        });
    }, 300);
}

function changeCardBack(color) {
    DEFAULT_CARDBACK = getCardBackSVG(color);
    renderBoard();
    if(document.getElementById('gallery-modal').style.display === 'flex') {
        let items = currentModalMode === 'preview' ? Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] })) : [];
        if(items.length) renderGalleryItems(items);
    }
}

// ==========================================
// 6. Modal 彈窗與卡牌圖庫
// ==========================================
function closeGalleryModal(e) {
    if(e.target.id === 'gallery-modal') document.getElementById('gallery-modal').style.display = 'none';
}

function handleCardClick(imgUrl, fallbackUrl) {
    if(!isDragging) {
        let safeImg = (imgUrl && imgUrl.startsWith('http')) ? imgUrl : DEFAULT_CARDBACK;
        let fUrl = (fallbackUrl && fallbackUrl.startsWith('http')) ? fallbackUrl : DEFAULT_CARDBACK;
        let lbImg = document.getElementById('lightbox-img');
        lbImg.src = safeImg;
        lbImg.onerror = function() { this.onerror = null; this.src = fUrl; };
        document.getElementById('lightbox-modal').style.display = 'flex';
    }
}

function openPreviewModal() {
    currentModalMode = 'preview';
    document.getElementById('gallery-title').innerText = `👁️ 牌組預覽 (${getDeckTotal()} / 60)`;
    document.getElementById('gallery-confirm-btn').style.display = 'none';
    renderGalleryItems(Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] })));
    document.getElementById('gallery-modal').style.display = 'flex';
}

function openSelector(type) {
    currentModalMode = type;
    tempSelectedKeys = type === 'direct' ? Object.keys(targetList) : [];
    document.getElementById('gallery-title').innerText = type === 'direct' ? "🔥 選取目標卡 (可多選)" : "🔄 新增連鎖牌 (單張加入)";
    document.getElementById('gallery-confirm-btn').style.display = 'block';
    renderGalleryItems(Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] })));
    document.getElementById('gallery-modal').style.display = 'flex';
}

function renderGalleryItems(items) {
    const container = document.getElementById('gallery-container');
    container.innerHTML = "";
    items.forEach(item => {
        const div = document.createElement('div');
        let isSelected = currentModalMode.startsWith('search_multi') ? (searchMultiSelection[item.key] && searchMultiSelection[item.key] > 0) : tempSelectedKeys.includes(item.key);
        div.className = 'gallery-item' + (isSelected ? ' selected' : '');
        let safeKey = item.key.replace(/'/g, "\\\\'");
        let safeImg = (item.img && item.img.startsWith('http')) ? item.img : DEFAULT_CARDBACK;
        let isDefault = safeImg === DEFAULT_CARDBACK;
        let fallback = item.fallback_img || DEFAULT_CARDBACK;
        
        let inner = `<img src="${safeImg}" onerror="this.onerror=function(){ this.onerror=null; this.src='${DEFAULT_CARDBACK}'; if(this.nextElementSibling) this.nextElementSibling.style.display='block'; }; this.src='${fallback}'; if(this.src==='${DEFAULT_CARDBACK}' && this.nextElementSibling) this.nextElementSibling.style.display='block';">`;
        inner += `<div class="card-name-overlay" style="font-size:12px; display:${isDefault ? 'block' : 'none'};">${item.name}</div>`;
        
        if(currentModalMode === 'preview') {
            inner += `<div class="qty-control" onclick="event.stopPropagation()"> <button class="qty-btn" onclick="modQty('${safeKey}', -1)">-</button> <span style="color:white; font-weight:bold; font-size:14px;">${item.qty}</span> <button class="qty-btn" onclick="modQty('${safeKey}', 1)">+</button> </div>`;
        } else if (currentModalMode.startsWith('search_multi')) {
            inner += `<div class="badge">x${item.max_qty}</div><div class="qty-control" onclick="event.stopPropagation()"> <button class="qty-btn" onclick="modifySearchQty('${safeKey}', -1, ${item.max_qty})">-</button> <span style="color:white; font-weight:bold; font-size:14px;">${searchMultiSelection[item.key] || 0}</span> <button class="qty-btn" onclick="modifySearchQty('${safeKey}', 1, ${item.max_qty})">+</button> </div>`;
            if(isSelected) inner += `<div class="check-badge" style="bottom: 30px;">✔</div>`;
        } else {
            if(item.qty) inner += `<div class="badge">x${item.qty}</div>`;
            inner += `<div class="check-badge">✔</div>`;
        }
        
        div.innerHTML = inner;
        div.onclick = () => {
            if(currentModalMode === 'preview' || currentModalMode.startsWith('search_multi')) return handleCardClick(item.img, item.fallback_img);
            if(currentModalMode === 'direct' || currentModalMode.startsWith('chain_target_')) {
                if(tempSelectedKeys.includes(item.key)) {
                    tempSelectedKeys = tempSelectedKeys.filter(k=>k!==item.key);
                    div.classList.remove('selected');
                } else {
                    tempSelectedKeys.push(item.key);
                    div.classList.add('selected');
                }
            } else {
                tempSelectedKeys = [item.key];
                document.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
            }
        };
        container.appendChild(div);
    });
}

function modifySearchQty(key, delta, maxQty) {
    if(!searchMultiSelection[key]) searchMultiSelection[key] = 0;
    searchMultiSelection[key] += delta;
    if(searchMultiSelection[key] < 0) searchMultiSelection[key] = 0;
    if(searchMultiSelection[key] > maxQty) searchMultiSelection[key] = maxQty;
    let zone = currentModalMode.split('_')[2];
    let arr = gameCards.filter(c => c.zone === zone);
    let groups = {};
    arr.forEach(c => {
        if(!groups[c.key]) groups[c.key] = {max_qty:0, img:c.img, name:c.name, key:c.key};
        groups[c.key].max_qty++;
    });
    renderGalleryItems(Object.values(groups));
}

function confirmGallerySelection() {
    if(currentModalMode === 'direct') {
        let newList = {};
        tempSelectedKeys.forEach(k => { newList[k] = targetList[k] || { name: deckDict[k].name, img: deckDict[k].img, qty: 1 }; });
        targetList = newList;
        renderTargetUI();
    } else if (currentModalMode === 'chain') {
        if(tempSelectedKeys.length > 0) {
            let k = tempSelectedKeys[0];
            if(!chainList[k]) chainList[k] = { name: deckDict[k].name, img: deckDict[k].img, type: '物品/特性 - 抽牌', val: 1, targets: {}, guaranteed: false };
            renderChainUI();
        }
    } else if (currentModalMode.startsWith('search_multi')) {
        let zone = currentModalMode.split('_')[2];
        Object.keys(searchMultiSelection).forEach(k => {
            let qtyToMove = searchMultiSelection[k];
            if(qtyToMove > 0) {
                let cardsInZone = gameCards.filter(c => c.key === k && c.zone === zone);
                for(let i=0; i<qtyToMove && i<cardsInZone.length; i++) { cardsInZone[i].zone = 'hand'; }
            }
        });
        saveState();
        renderBoard();
    } else if (currentModalMode.startsWith('chain_target_')) {
        let parentKey = currentModalMode.replace('chain_target_', '');
        let newList = {};
        tempSelectedKeys.forEach(k => { newList[k] = chainList[parentKey].targets[k] || { name: deckDict[k].name }; });
        chainList[parentKey].targets = newList;
        renderChainUI();
    }
    document.getElementById('gallery-modal').style.display = 'none';
}

function renderTargetUI() {
    const container = document.getElementById('target-display');
    container.innerHTML = "";
    let keys = Object.keys(targetList);
    if(keys.length === 0) { container.innerHTML = `<div style="color:#888; text-align:center;">未選擇任何卡片</div>`; return; }
    keys.forEach(k => {
        let c = targetList[k];
        let div = document.createElement('div');
        div.className = 'target-row';
        let safeImg = (c.img && c.img.startsWith('http')) ? c.img : DEFAULT_CARDBACK;
        div.innerHTML = `<div style="display:flex; align-items:center;"><img src="${safeImg}" onerror="this.src='${DEFAULT_CARDBACK}'" style="width:30px;height:42px;margin-right:10px;"> <span style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px;">${c.name}</span></div> <input type="number" value="${c.qty}" min="0" max="4" style="width:50px; text-align:center; padding:4px;" onchange="updateTargetQty('${k.replace(/'/g, "\\\\'")}', this.value)">`;
        container.appendChild(div);
    });
}

function updateTargetQty(k, val) {
    let v = parseInt(val);
    if(v <= 0) delete targetList[k]; else targetList[k].qty = v;
    renderTargetUI();
}

function renderChainUI() {
    const container = document.getElementById('chain-display');
    container.innerHTML = "";
    let keys = Object.keys(chainList);
    if(keys.length === 0) { container.innerHTML = `<div style="color:#888; text-align:center;">未選擇任何卡片</div>`; return; }
    keys.forEach(k => {
        let c = chainList[k];
        let div = document.createElement('div');
        div.className = 'target-row';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'stretch';
        div.style.borderLeftColor = '#FFD700';
        let isSearch = c.type.includes('檢索') || c.type.includes('Search');
        let safeImg = (c.img && c.img.startsWith('http')) ? c.img : DEFAULT_CARDBACK;
        let safeKey = k.replace(/'/g, "\\\\'");
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #30363D; padding-bottom: 6px; margin-bottom: 8px;">
                <div style="display:flex; align-items:center;"><img src="${safeImg}" onerror="this.src='${DEFAULT_CARDBACK}'" style="width:26px;height:36px;margin-right:8px; border-radius:3px;"><span style="font-weight:bold; font-size:14px; color:#FFF;">${c.name}</span></div>
                <button class="btn-secondary" style="width:22px; height:22px; padding:0; display:flex; align-items:center; justify-content:center; color:#FF5252; font-weight:bold; cursor:pointer; border-radius:50%;" onclick="removeChain('${safeKey}')">✕</button>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <select style="flex:2; font-size:12px; padding:6px; background:#0D1117; color:#FFF; border:1px solid #30363D; border-radius:4px;" onchange="chainList['${safeKey}'].type = this.value; renderChainUI();">
                    <option value="物品/特性 - 抽牌" ${c.type.includes('抽牌')?'selected':''}>物品/特性 - 抽牌</option> <option value="物品/特性 - 指定檢索" ${c.type.includes('指定檢索')?'selected':''}>物品/特性 - 指定檢索</option> <option value="支援者 - 洗回牌庫重抽" ${c.type.includes('洗回牌庫重抽')?'selected':''}>支援者 - 洗回牌庫重抽</option> <option value="支援者 - 丟棄重抽" ${c.type.includes('丟棄重抽')?'selected':''}>支援者 - 丟棄重抽</option> <option value="支援者 - 洗回牌底重抽" ${c.type.includes('支援者 - 洗回牌底重抽')?'selected':''}>支援者 - 洗回牌底重抽</option> <option value="支援者 - 指定檢索" ${c.type.includes('支援者 - 指定檢索')?'selected':''}>支援者 - 指定檢索</option>
                </select>
                <input type="number" value="${c.val}" min="1" max="15" style="width:55px; padding:5px; text-align:center; font-size:13px; background:#0D1117; color:#00E5FF; font-weight:bold; border:1px solid #30363D; border-radius:4px;" title="過牌張數/數量" onchange="chainList['${safeKey}'].val=parseInt(this.value)">
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:6px; flex-wrap:wrap;">
                <label style="font-size:12px; display:flex; align-items:center; gap:6px; color:#00E5FF; cursor:pointer; font-weight:bold; user-select:none;"><input type="checkbox" style="width:16px; height:16px; accent-color:#00E5FF; cursor:pointer;" onchange="chainList['${safeKey}'].guaranteed = this.checked" ${c.guaranteed?'checked':''}><span>已在手上/場上 (保證發動)</span></label>
                ${isSearch ? `<button class="btn-secondary" style="padding:3px 8px; font-size:11px; color:#FFD700; border-color:#FFD700; border-radius:4px; font-weight:bold;" onclick="openChainTargetSelector('${safeKey}')">🎯 ${Object.keys(c.targets).map(tk => c.targets[tk].name).join(', ') || '點擊選取目標...'}</button>` : ''}
            </div>
        `;
        container.appendChild(div);
    });
}

function removeChain(k) { delete chainList[k]; renderChainUI(); }

function openChainTargetSelector(parentKey) {
    currentModalMode = 'chain_target_' + parentKey;
    tempSelectedKeys = chainList[parentKey].targets ? Object.keys(chainList[parentKey].targets) : [];
    document.getElementById('gallery-title').innerText = "🎯 選擇檢索目標卡 (可多選)";
    document.getElementById('gallery-confirm-btn').style.display = 'block';
    renderGalleryItems(Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] })));
    document.getElementById('gallery-modal').style.display = 'flex';
}

// ==========================================
// 7. 戰局系統 (戰場、拖曳、洗牌、還原)
// ==========================================
function saveLocalData() {
    localStorage.setItem('octoplus_deck', JSON.stringify(deckDict));
    localStorage.setItem('octoplus_board', JSON.stringify(gameCards));
}

function saveState() {
    let snapshot = JSON.parse(JSON.stringify(gameCards));
    if(historyPtr < historyStates.length - 1) historyStates = historyStates.slice(0, historyPtr + 1);
    historyStates.push(snapshot);
    historyPtr++;
    document.getElementById('btn-undo').disabled = (historyPtr <= 0);
    document.getElementById('btn-redo').disabled = (historyPtr >= historyStates.length - 1);
    saveLocalData();
}

function undo() {
    if(historyPtr > 0) {
        historyPtr--;
        gameCards = JSON.parse(JSON.stringify(historyStates[historyPtr]));
        renderBoard();
    }
    document.getElementById('btn-undo').disabled = (historyPtr <= 0);
    document.getElementById('btn-redo').disabled = (historyPtr >= historyStates.length - 1);
    saveLocalData();
}

function redo() {
    if(historyPtr < historyStates.length - 1) {
        historyPtr++;
        gameCards = JSON.parse(JSON.stringify(historyStates[historyPtr]));
        renderBoard();
    }
    document.getElementById('btn-undo').disabled = (historyPtr <= 0);
    document.getElementById('btn-redo').disabled = (historyPtr >= historyStates.length - 1);
    saveLocalData();
}

function changeBenchSize(delta) {
    benchSize = Math.max(1, Math.min(8, benchSize + delta));
    document.getElementById('bench-size-label').innerText = `${benchSize} 格`;
    renderBenchSlots();
    renderBoard();
}

function renderBenchSlots() {
    let container = document.getElementById('bench-container');
    if (!container) return;
    container.innerHTML = "";
    for(let i=0; i<benchSize; i++) {
        let div = document.createElement('div');
        div.id = `zone-bench-${i}`;
        div.className = "drop-zone drop-zone-stacked";
        div.style.width = "150px";
        div.ondrop = drop;
        div.ondragover = allowDrop;
        container.appendChild(div);
    }
}

function startGame() {
    if(getDeckTotal() !== 60) return alert("⚠️ 牌組必須 60 張！");
    gameCards = [];
    prizesFaceUp = false; // 初始化獎賞卡朝下
    
    Object.keys(deckDict).forEach(k => {
        for(let i=0; i<deckDict[k].qty; i++) {
            gameCards.push({ id: 'c_'+Math.random().toString(36).substr(2,9), key: k, name: deckDict[k].name, img: deckDict[k].img, fallback_img: deckDict[k].fallback_img, zone: 'deck', damage: 0, status: [] });
        }
    });
    
    gameCards.sort(() => Math.random() - 0.5);
    for(let i=0; i<7; i++) if(gameCards[i]) gameCards[i].zone = 'hand';
    for(let i=7; i<13; i++) if(gameCards[i]) gameCards[i].zone = `prize_${i-7}`;
    
    historyStates = [];
    historyPtr = -1;
    saveState();
    renderBenchSlots();
    renderBoard();
}

function createCardEl(c, isField=false, isPrizeFaceUp=null) {
    const div = document.createElement('div');
    div.className = 'card-wrapper';
    div.id = c.id;
    div.draggable = true;
    
    div.ondragstart = (e) => {
        isDragging = true;
        e.dataTransfer.setData("text", c.id);
        setTimeout(() => div.style.opacity = '0.01', 0);
    };
    div.ondragend = (e) => {
        setTimeout(() => { isDragging = false; }, 100);
        div.style.opacity = '1';
        renderBoard();
    };
    div.onclick = () => { if(!isDragging) handleCardClick(c.img, c.fallback_img); };

    let safeImg = (c.img && c.img.startsWith('http')) ? c.img : DEFAULT_CARDBACK;
    let fallback = c.fallback_img || DEFAULT_CARDBACK;

    // 處理蓋牌狀態 (牌庫、蓋著的獎賞卡)
    if (c.zone === 'deck') {
        safeImg = DEFAULT_CARDBACK; fallback = DEFAULT_CARDBACK;
    } else if (c.zone.startsWith('prize_')) {
        if (isPrizeFaceUp !== true) { safeImg = DEFAULT_CARDBACK; fallback = DEFAULT_CARDBACK; }
    }

    let isDefault = safeImg === DEFAULT_CARDBACK;
    let inner = `<img src="${safeImg}" onerror="this.onerror=function(){ this.onerror=null; this.src='${DEFAULT_CARDBACK}'; if(this.nextElementSibling) this.nextElementSibling.style.display='block'; }; this.src='${fallback}'; if(this.src==='${DEFAULT_CARDBACK}' && this.nextElementSibling) this.nextElementSibling.style.display='block';">`;
    inner += `<div class="card-name-overlay" style="display:${isDefault ? 'block' : 'none'};">${c.name}</div>`;
    
    if(isField) {
        inner += `<div class="card-action-menu"><button class="card-btn" title="置頂" onclick="event.stopPropagation(); bringToFront('${c.id}')">🔼置頂</button></div>`;
    }
    div.innerHTML = inner;
    return div;
}

function bringToFront(cardId) {
    let idx = gameCards.findIndex(c => c.id === cardId);
    if(idx > -1) {
        gameCards.push(gameCards.splice(idx, 1)[0]);
        saveState();
        renderBoard();
    }
}

function togglePrizes() {
    prizesFaceUp = !prizesFaceUp;
    renderBoard();
}

function renderBoard() {
    if(!document.getElementById('zone-bench-0')) renderBenchSlots();
    
    let zList = ['zone-hand', 'zone-stadium', 'zone-active', 'zone-deck', 'zone-discard'];
    for(let i=0; i<8; i++) zList.push(`zone-bench-${i}`);
    for(let i=0; i<6; i++) zList.push(`zone-prize-${i}`);
    zList.forEach(id => { let el = document.getElementById(id); if(el) el.innerHTML = ""; });
    
    let zones = {};
    gameCards.forEach(c => {
        if(!zones[c.zone]) zones[c.zone]=[];
        zones[c.zone].push(c);
    });

    // 手牌渲染 (扇形)
    let handGroups = {};
    (zones['hand']||[]).forEach(c => {
        if(!handGroups[c.key]) handGroups[c.key] = { cards: [] };
        handGroups[c.key].cards.push(c);
    });
    let handGroupsKeys = Object.keys(handGroups);
    let handCenter = (handGroupsKeys.length - 1) / 2;
    handGroupsKeys.forEach((k, idx) => {
        let group = handGroups[k];
        let el = createCardEl(group.cards[0], false);
        if(group.cards.length > 1) el.innerHTML += `<div class="hand-badge">x${group.cards.length}</div>`;
        let offset = idx - handCenter;
        el.style.setProperty('--fan-rot', `${offset * 4}deg`);
        el.style.setProperty('--fan-y', `${Math.abs(offset) * Math.abs(offset) * 1.5}px`);
        document.getElementById('zone-hand').appendChild(el);
    });

    // 戰鬥區、備戰區、場地渲染 (含 Token)
    let fieldZones = ['active', 'stadium'];
    for(let i=0; i<benchSize; i++) fieldZones.push(`bench_${i}`);
    fieldZones.forEach(zName => {
        let domEl = document.getElementById('zone-' + zName.replace('_','-'));
        if(!domEl) return;
        let arr = zones[zName]||[];
        let centerOffset = (arr.length - 1) / 2;
        arr.forEach((c, idx) => {
            let el = createCardEl(c, true);
            el.style.position = 'absolute';
            el.style.top = '50%';
            el.style.left = '50%';
            el.style.transform = `translate(calc(-50% + ${(idx - centerOffset)*15}px), calc(-50% + ${(idx - centerOffset)*15}px))`;
            el.style.zIndex = idx;

            // 處理指示物
            if (c.damage > 0) {
                let dmgEl = document.createElement('div');
                dmgEl.className = 'token-dmg';
                dmgEl.innerText = c.damage;
                dmgEl.onclick = (e) => { e.stopPropagation(); c.damage = 0; saveState(); renderBoard(); };
                el.appendChild(dmgEl);
            }
            if (c.status && c.status.length > 0) {
                let stContainer = document.createElement('div');
                stContainer.className = 'token-status-container';
                c.status.forEach(s => {
                    let stEl = document.createElement('div');
                    stEl.className = 'token-status';
                    const sMap = { 'status_poison': '☠️', 'status_burn': '🔥', 'status_confusion': '💫', 'status_paralysis': '⚡', 'status_sleep': '💤' };
                    stEl.innerText = sMap[s] || s;
                    stEl.onclick = (e) => { e.stopPropagation(); c.status = c.status.filter(x => x !== s); saveState(); renderBoard(); };
                    stContainer.appendChild(stEl);
                });
                el.appendChild(stContainer);
            }
            domEl.appendChild(el);
        });
    });

    // 獎賞卡渲染
    for(let i=0; i<6; i++) {
        let arr = zones['prize_'+i]||[];
        if(arr.length > 0) document.getElementById('zone-prize-'+i).appendChild(createCardEl(arr[0], false, prizesFaceUp));
    }

    // 牌庫渲染
    let deckArr = zones['deck']||[];
    document.getElementById('deck-count').innerText = deckArr.length;
    if(deckArr.length > 0) {
        let el = document.createElement('div');
        el.className = 'card-wrapper';
        el.style.position = 'absolute';
        el.innerHTML = `<img src="${DEFAULT_CARDBACK}" style="pointer-events:none;">`;
        document.getElementById('zone-deck').appendChild(el);
    }

    // 棄牌區渲染
    let discArr = zones['discard']||[];
    document.getElementById('discard-count').innerText = discArr.length;
    if(discArr.length > 0) {
        let topC = discArr[discArr.length-1];
        let el = document.createElement('div');
        el.className = 'card-wrapper';
        el.style.position = 'absolute';
        let safeImg = (topC.img && topC.img.startsWith('http')) ? topC.img : DEFAULT_CARDBACK;
        let fallback = topC.fallback_img || DEFAULT_CARDBACK;
        let inner = `<img src="${safeImg}" onerror="this.onerror=function(){ this.onerror=null; this.src='${DEFAULT_CARDBACK}'; if(this.nextElementSibling) this.nextElementSibling.style.display='block'; }; this.src='${fallback}'; if(this.src==='${DEFAULT_CARDBACK}' && this.nextElementSibling) this.nextElementSibling.style.display='block';" style="pointer-events:none;">`;
        inner += `<div class="card-name-overlay" style="display:${safeImg === DEFAULT_CARDBACK ? 'block' : 'none'};">${topC.name}</div>`;
        el.innerHTML = inner;
        document.getElementById('zone-discard').appendChild(el);
    }
    
    document.getElementById('hand-count').innerText = (zones['hand']||[]).length;
}

function allowDrop(ev) {
    ev.preventDefault();
    ev.currentTarget.classList.add('dragover');
}

// 💡 更新：支援回血拖曳計算 (heal_)
function drop(ev) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('dragover');

    // 檢查是否為拖曳進來的「戰術指示物」
    let tokenData = ev.dataTransfer.getData("token");
    if (tokenData) {
        let targetZone = ev.currentTarget.id.replace('zone-', '').replace('-', '_');
        if (targetZone === 'active' || targetZone.startsWith('bench_')) {
            let topCard = gameCards.slice().reverse().find(c => c.zone === targetZone);
            if (topCard) {
                if (tokenData.startsWith('dmg_')) {
                    topCard.damage = (topCard.damage || 0) + parseInt(tokenData.split('_')[1]);
                } else if (tokenData.startsWith('heal_')) {
                    topCard.damage = Math.max(0, (topCard.damage || 0) - parseInt(tokenData.split('_')[1]));
                } else if (tokenData.startsWith('status_')) {
                    topCard.status = topCard.status || [];
                    if (!topCard.status.includes(tokenData)) topCard.status.push(tokenData);
                }
                saveState();
                renderBoard();
            }
        }
        return;
    }

    // 處理一般卡片拖曳
    let cardId = ev.dataTransfer.getData("text");
    if (cardId) {
        let targetZone = ev.currentTarget.id.replace('zone-', '').replace('-', '_');
        let c = gameCards.find(c => c.id === cardId);
        if(c) {
            if (targetZone !== 'active' && !targetZone.startsWith('bench_')) { c.damage = 0; c.status = []; }
            if(targetZone.startsWith('prize_')) {
                let occupier = gameCards.find(card => card.zone === targetZone);
                if(occupier) occupier.zone = c.zone;
            }
            c.zone = targetZone;
            gameCards.push(gameCards.splice(gameCards.indexOf(c), 1)[0]);
            saveState();
            setTimeout(() => renderBoard(), 10);
        }
    }
}
document.querySelectorAll('.drop-zone').forEach(z => z.addEventListener('dragleave', (e) => e.currentTarget.classList.remove('dragover')));

function shuffleDeck() {
    let deckCards = gameCards.filter(c => c.zone === 'deck');
    if (deckCards.length <= 1) return alert("⚠️ 牌庫卡片不足（0 或 1 張），無需洗牌！");
    
    deckCards.sort(() => Math.random() - 0.5);
    gameCards = gameCards.filter(c => c.zone !== 'deck').concat(deckCards);
    
    saveState();
    renderBoard();
    
    let msg = document.getElementById('marquee-text');
    if (msg) {
        msg.innerHTML = "🔀 牌庫已重新完成隨機洗牌！";
        msg.style.color = "#FFD700";
    }
}

function drawCard() {
    let dc = gameCards.filter(c => c.zone === 'deck');
    if(dc.length > 0) { dc[0].zone = 'hand'; saveState(); renderBoard(); }
}

function moveZoneTo(fromZone, toZone) {
    gameCards.filter(c => c.zone === fromZone).forEach(c => { c.zone = toZone; c.damage = 0; c.status = []; });
    if(toZone === 'deck') {
        let d = gameCards.filter(c => c.zone === 'deck').sort(() => Math.random()-0.5);
        gameCards = gameCards.filter(c => c.zone !== 'deck').concat(d);
    }
    saveState();
    renderBoard();
}

function openSearchModal(zone) {
    let arr = gameCards.filter(c => c.zone === zone);
    if(arr.length === 0) return;
    currentModalMode = 'search_multi_' + zone;
    searchMultiSelection = {};
    document.getElementById('gallery-title').innerText = `🔍 檢索${zone === 'deck' ? '牌庫' : '棄牌'} (可多選回手牌)`;
    document.getElementById('gallery-confirm-btn').style.display = 'block';
    let groups = {};
    arr.forEach(c => {
        if(!groups[c.key]) groups[c.key] = {max_qty:0, img:c.img, name:c.name, key:c.key};
        groups[c.key].max_qty++;
    });
    renderGalleryItems(Object.values(groups));
    document.getElementById('gallery-modal').style.display = 'flex';
}

// ==========================================
// 8. 萬次蒙地卡羅機率推演與分享系統
// ==========================================
function runSimulation() {
    getFreshToken().then(token => {
        if(!token) return;
        let d1 = parseInt(document.getElementById('draw1-qty').value);
        let targetRule = document.querySelector('input[name="target_rule"]:checked').value;
        let deadHand = parseInt(document.getElementById('dead-hand-qty').value) || 0;
        
        let directDict = {};
        Object.keys(targetList).forEach(k => { directDict[k] = { qty: targetList[k].qty }; });
        if(Object.keys(directDict).length === 0) return alert("請先選取直接解牌目標！");
        
        let formattedChainDict = {};
        Object.keys(chainList).forEach(k => {
            formattedChainDict[k] = {
                type: chainList[k].type,
                val: chainList[k].val,
                search_targets: Object.keys(chainList[k].targets),
                guaranteed: chainList[k].guaranteed || false
            };
        });

        let resultEl = document.getElementById('sim-result');
        resultEl.innerText = "運算中...";
        resultEl.style.color = "#FFD700";
        resultEl.style.fontSize = "32px";
        
        fetch(`${API_BASE}/api/v1/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                deck_cards: gameCards.filter(c => c.zone === 'deck').map(c => ({name: c.key})),
                direct_targets: directDict,
                chain_targets: formattedChainDict,
                draw1: d1,
                target_rule: targetRule,
                dead_hand_size: deadHand
            })
        }).then(async r => {
            if(r.status === 401) { document.getElementById('gate-overlay').style.display='flex'; throw new Error("請先登入"); }
            if(r.status === 403) {
                const d = await r.json();
                if(d.detail === "LIMIT_REACHED") { document.getElementById('sub-modal').style.display='flex'; throw new Error("額度用盡"); }
            }
            if(!r.ok) {
                const errData = await r.json().catch(() => ({}));
                throw new Error(errData.detail || `伺服器錯誤 (${r.status})`);
            }
            return r.json();
        }).then(d => {
            if(d.success) {
                lastSimResult = {
                    title: `首波 ${d1} 抽`,
                    desc: `解: ${Object.keys(targetList).map(k => `${targetList[k].name}x${targetList[k].qty}`).join(targetRule === 'AND' ? ' + ' : ' 或 ')}`,
                    prob: d.prob
                };
                resultEl.innerText = `${d.prob.toFixed(1)} %`;
                resultEl.style.color = "#00E5FF";
                resultEl.style.fontSize = "46px";
                if (!d.is_pro && d.remaining_today !== undefined) {
                    document.getElementById('txt-status').innerHTML = `<b>免費試用版</b><br><span style="font-size:11px; color:#00E5FF;">(今日剩餘: ${d.remaining_today} 次)</span>`;
                }
            } else {
                throw new Error(d.detail || "運算失敗");
            }
        }).catch(e => {
            if(e.message !== "額度用盡" && e.message !== "請先登入") {
                resultEl.innerText = "❌ " + e.message;
                resultEl.style.color = "#FF5252";
                resultEl.style.fontSize = "20px";
                setTimeout(() => {
                    resultEl.innerText = "0.0 %";
                    resultEl.style.color = "#00E5FF";
                    resultEl.style.fontSize = "46px";
                }, 4000);
            } else {
                resultEl.innerText = "0.0 %";
                resultEl.style.color = "#00E5FF";
                resultEl.style.fontSize = "46px";
            }
        });
    });
}

function saveScenario() {
    if(!lastSimResult) return;
    const b = document.getElementById('ab-board');
    let maxProb = Math.max(...Array.from(b.children).map(c => parseFloat(c.dataset.prob)||0), lastSimResult.prob);
    let div = document.createElement('div');
    div.className = 'ab-item';
    div.dataset.prob = lastSimResult.prob;
    div.style.borderTopColor = (lastSimResult.prob >= maxProb && lastSimResult.prob > 0) ? '#E53935' : '#444';
    div.innerHTML = `<div style="color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${lastSimResult.desc}">${lastSimResult.desc}</div> <div style="color:#fff; font-weight:bold; margin-top:6px;">${lastSimResult.title}</div> <div style="color:#00E5FF; font-size:24px; font-weight:bold;">${lastSimResult.prob.toFixed(1)}%</div>`;
    div.onclick = () => alert(`【對局機率詳細資訊】\n\n🎯 路線：${lastSimResult.title}\n\n📝 條件：\n${lastSimResult.desc}\n\n📊 成功率：${lastSimResult.prob.toFixed(1)}%`);
    b.appendChild(div);
}

function exportGameState() {
    if(gameCards.length === 0) return alert("尚未開局！請先點擊左下角「鎖定牌組並開局」。");
    let ruleEl = document.querySelector('input[name="target_rule"]:checked');
    fetch(`${API_BASE}/api/v1/share_game`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
            game_data: {
                cards: gameCards.map(c => ({ k: c.key, z: c.zone, i: c.img, n: c.name, f: c.fallback_img })),
                deck: deckDict,
                targets: targetList,
                chains: chainList,
                draw1: parseInt(document.getElementById('draw1-qty').value) || 7,
                rule: (ruleEl ? ruleEl.value : 'AND'),
                dead: parseInt(document.getElementById('dead-hand-qty').value) || 0
            }
        })
    }).then(r => r.json()).then(d => {
        if(d.success) {
            document.getElementById('share-code-display').value = d.share_code;
            document.getElementById('share-modal').style.display = 'flex';
        } else {
            alert("分享失敗：" + (d.detail || "未知錯誤"));
        }
    }).catch(e => alert("連線失敗，請檢查網路。"));
}

function copyShareCode() {
    let input = document.getElementById('share-code-display');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
        alert("📋 短代碼已複製！朋友在任何電腦輸入即可還原戰局與機率推演！");
        document.getElementById('share-modal').style.display = 'none';
    });
}

function importGameState() {
    let input = prompt("請貼上 6 位數對局短代碼：");
    if(!input) return;
    let code = input.trim();
    if(code.includes('share=')) code = code.split('share=')[1].split('&')[0];
    loadSharedGameByCode(code);
}

function loadSharedGameByCode(code) {
    fetch(`${API_BASE}/api/v1/get_shared_game?code=${code}`).then(r => r.json()).then(d => {
        if(d.success) {
            let raw = d.game_data;
            deckDict = {};
            if (Array.isArray(raw)) {
                gameCards = raw.map(item => {
                    let cardName = item.n || item.k.split(' [')[0];
                    let cardImg = item.i || DEFAULT_CARDBACK;
                    if(!deckDict[item.k]) deckDict[item.k] = { qty: 0, img: cardImg, name: cardName, fallback_img: DEFAULT_CARDBACK };
                    deckDict[item.k].qty++;
                    return { id: 'c_' + Math.random().toString(36).substr(2, 9), key: item.k, name: cardName, img: cardImg, zone: item.z, damage: 0, status: [] };
                });
            } else {
                if (raw.deck) deckDict = raw.deck;
                if (raw.cards) {
                    gameCards = raw.cards.map(item => ({
                        id: 'c_' + Math.random().toString(36).substr(2, 9),
                        key: item.k,
                        name: item.n || item.k.split(' [')[0],
                        img: item.i || DEFAULT_CARDBACK,
                        fallback_img: item.f || DEFAULT_CARDBACK,
                        zone: item.z,
                        damage: 0,
                        status: []
                    }));
                }
                if (raw.targets) targetList = raw.targets;
                if (raw.chains) chainList = raw.chains;
                if (raw.draw1) document.getElementById('draw1-qty').value = raw.draw1;
                if (raw.dead !== undefined) document.getElementById('dead-hand-qty').value = raw.dead;
                if (raw.rule) {
                    let radio = document.querySelector(`input[name="target_rule"][value="${raw.rule}"]`);
                    if (radio) radio.checked = true;
                }
                renderTargetUI();
                renderChainUI();
            }
            updateDeckUI();
            saveState();
            renderBenchSlots();
            renderBoard();
            alert(`✅ 成功還原對局戰場與機率連鎖分析！`);
        } else {
            alert("載入失敗: " + (d.detail || "未知錯誤"));
        }
    }).catch(e => alert("連線錯誤"));
}

async function saveDeckToDB() {
    if (!supabaseClient) return alert("系統未初始化");
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { document.getElementById('gate-overlay').style.display = 'flex'; return alert("請先登入帳號！"); }
    if (Object.keys(deckDict).length === 0) return alert("牌組是空的，無法儲存！");
    let deckName = prompt("請為這副牌組取個名字：", "我的強力牌組");
    if (!deckName) return;
    try {
        const { error } = await supabaseClient.from('user_decks').insert([{ user_id: session.user.id, deck_name: deckName, deck_data: deckDict }]);
        if (error) throw error;
        alert("💾 牌組儲存成功！");
        fetchSavedDecks();
    } catch (err) { alert("儲存失敗：" + err.message); }
}

async function fetchSavedDecks() {
    if (!supabaseClient) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    try {
        const { data, error } = await supabaseClient.from('user_decks').select('id, deck_name').order('created_at', { ascending: false });
        if (error) throw error;
        let select = document.getElementById('saved-decks-select');
        select.innerHTML = `<option value="">載入雲端牌組...</option>`;
        data.forEach(deck => {
            let opt = document.createElement('option');
            opt.value = deck.id;
            opt.innerText = deck.deck_name;
            select.appendChild(opt);
        });
    } catch (err) {}
}

async function loadDeckFromDB(deckId) {
    if (!deckId || !supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('user_decks').select('deck_data').eq('id', deckId).single();
        if (error) throw error;
        deckDict = data.deck_data;
        updateDeckUI();
        alert("📥 牌組載入成功！");
        document.getElementById('saved-decks-select').value = "";
    } catch (err) { alert("載入失敗：" + err.message); }
}

async function fetchMarquee() {
    try {
        const resp = await fetch(`${API_BASE}/api/v1/marquee`);
        const data = await resp.json();
        let text = data.text || "歡迎使用 PTCG 小章魚";
        let el = document.getElementById('marquee-text');
        el.innerHTML = text;
        el.style.animationDuration = Math.max(text.length * 0.45, 20) + 's';
    } catch (e) {
        document.getElementById('marquee-text').innerHTML = "歡迎使用 PTCG 小章魚";
    }
}

window.addEventListener('load', fetchMarquee);
