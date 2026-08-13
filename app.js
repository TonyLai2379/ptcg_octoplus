// ==========================================
// 1. 全域變數與防呆宣告
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
let prizeTargetList = {};
let tempSelectedKeys = [];
let searchMultiSelection = {};
let currentModalMode = "";
let searchTimeout = null;
let isDragging = false;
let benchSize = 5;
let historyStates = [];
let historyPtr = -1;
let prizesFaceUp = true;
let feedbackBase64 = "";
// ==========================================
// 🔥 環境熱門牌組一鍵匯入設定
// ==========================================
const POPULAR_DECKS = [
    { name: "化隱", code: "DfPGpo-EbFJRT-vzELZu" },
    { name: "魔靈多龍", code: "rAwHnZ-kLhnNT-EnmbLY" },
    { name: "袋獸列空坐", code: "TOlRYY-vAKTOT-OFdGqI" },
    { name: "更新中", code: "8Yxx8a-4VwKq8-xcxxYG" },
    { name: "更新中", code: "GcxYc8-aA0F0D-cK8a4G" }
    // 💡 你以後只要在這裡修改名稱跟代碼即可
];

function renderPopularDecks() {
    const container = document.getElementById('popular-decks-container');
    if(!container) return;
    container.innerHTML = "";
    
    POPULAR_DECKS.forEach(deck => {
        let btn = document.createElement('button');
        btn.className = "btn-secondary";
        btn.style.cssText = "padding: 8px; font-size: 13px; font-weight: bold; border-color: #FF9800; color: #FFD700; background: rgba(255, 152, 0, 0.05); transition: 0.2s; text-align: left;";
        btn.innerHTML = `<span style="display:inline-block; width:20px;">🗡️</span> ${deck.name}`;
        
        btn.onmouseover = () => { btn.style.background = "rgba(255, 152, 0, 0.2)"; btn.style.transform = "translateX(2px)"; };
        btn.onmouseout = () => { btn.style.background = "rgba(255, 152, 0, 0.05)"; btn.style.transform = "translateX(0)"; };
        
        btn.onclick = () => {
            // 自動切換到官方代碼分頁、填入數值並按下解析！
            document.getElementById('tab-btn-link').click();
            document.getElementById('deck-code').value = deck.code;
            parseOfficial();
        };
        container.appendChild(btn);
    });
}
// ==========================================
// 動畫與開場邏輯 (修復畫面卡住無法點擊)
// ==========================================

// 確保載入時執行進度條動畫
window.addEventListener('load', () => {
    runSplashAnimation();
});
var DEFAULT_CARDBACK = (function(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="100%" height="100%" fill="${color}" rx="4" /><rect x="5%" y="5%" width="90%" height="90%" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" rx="2" /><text x="50%" y="50%" font-size="28" text-anchor="middle" dominant-baseline="central">🐙</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
})("#2B579A");

// ==========================================
// 視圖切換主控 (Import / Starter / Sandbox)
// ==========================================
let currentMainView = 'import';

async function switchMainView(viewName) {
    currentMainView = viewName;
    
    // 1. 切換上方導覽列狀態 (電腦版)
    document.querySelectorAll('.nav-3d-btn').forEach(btn => btn.classList.remove('active'));
    let activeNavBtn = document.getElementById('btn-view-' + viewName);
    if (activeNavBtn) activeNavBtn.classList.add('active');

    // 2. 切換下方導覽列狀態 (手機版)
    document.querySelectorAll('.m-nav-item').forEach(btn => btn.classList.remove('active'));
    let activeMobileBtn = document.getElementById('m-nav-' + viewName);
    if (activeMobileBtn) activeMobileBtn.classList.add('active');

    // 3. 切換主視圖顯示
    document.getElementById('view-import').style.display = (viewName === 'import') ? 'block' : 'none';
    document.getElementById('view-starter').style.display = (viewName === 'starter') ? 'block' : 'none';
    document.getElementById('view-sandbox').style.display = (viewName === 'sandbox') ? 'block' : 'none';

    if (viewName === 'starter' && typeof syncStarterToolFromDeck === 'function') {
        syncStarterToolFromDeck(deckDict);
    }
    
    // 💡 4. 手機版智慧轉向：沙盤戰場「自動橫向與全螢幕」，其他畫面「直向」
    const isMobile = window.innerWidth <= 800 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
    if (isMobile) {
        if (viewName === 'sandbox') {
            try {
                // 必須先進入全螢幕，瀏覽器才允許強制轉向
                if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
                    await document.documentElement.requestFullscreen();
                }
                if (screen.orientation && screen.orientation.lock) {
                    await screen.orientation.lock('landscape');
                }
            } catch (err) { 
                console.log("自動橫向鎖定失敗或不支援:", err); 
            }
        } else {
            try {
                // 離開戰場時，解除轉向鎖定並退出全螢幕
                if (screen.orientation && screen.orientation.unlock) {
                    screen.orientation.unlock();
                }
                if (document.exitFullscreen && document.fullscreenElement) {
                    await document.exitFullscreen();
                }
            } catch (err) {}
        }
    }
    
    checkOrientation(); // 檢查並顯示/隱藏原本的轉向警告遮罩
}

// 💡 智慧偵測：只在「沙盤戰場」且「直向」時才跳出警告
function checkOrientation() {
    const warning = document.getElementById('portrait-warning');
    if (!warning) return;
    
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth <= 800;
    const isPortrait = window.innerHeight > window.innerWidth;
    
    // 只有當「身處戰場」且「手機拿直的」，且自動轉向API失效時，才亮出警告遮罩
    if (isMobile && isPortrait && currentMainView === 'sandbox') {
        warning.style.display = 'flex';
    } else {
        warning.style.display = 'none';
    }
}
window.addEventListener('resize', checkOrientation);
// ==========================================
// 智慧教學按鈕控制 (解決 openTutorial is not defined)
// ==========================================
function openTutorial() {
    // 根據當前所在的畫面，自動跳出對應的教學視窗
    if (currentMainView === 'import') {
        document.getElementById('tut-import-modal').style.display = 'flex';
    } else if (currentMainView === 'starter') {
        document.getElementById('tut-starter-modal').style.display = 'flex';
    } else if (currentMainView === 'sandbox') {
        document.getElementById('tut-sandbox-modal').style.display = 'flex';
    }
}
// ==========================================
// 2. 數學計算與 Auto Zoom
// ==========================================
function combination(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    let c = 1;
    for (let i = 1; i <= k; i++) c = c * (n - i + 1) / i;
    return c;
}

function applyAutoZoom() {
    let width = window.innerWidth;
    let targetZoom = 1;
    if (width < 1400) targetZoom = 0.9;
    if (width < 1200) targetZoom = 0.8;
    if (width < 992) targetZoom = 0.7;
    if (width < 768) targetZoom = 0.55;
    
    let mv = document.getElementById('app-viewport');
    if (mv) mv.style.zoom = targetZoom;
    
    let slider = document.getElementById('zoom-slider');
    if (slider) slider.value = targetZoom;
}
window.addEventListener('resize', applyAutoZoom);

// ==========================================
// 3. 多國語言支援 (翻譯字典)
// ==========================================
const translations = {
    zh: { 
        tutBtn: "❓ 教學", statusNotLogin: "目前狀態：未登入", btnUnlock: "訂閱、輸入邀請碼", 
        tabLink: "🔗 官方代碼", tabText: "📝 英文匯入", tabEdit: "🛠️ 搜尋編輯", 
        phDeckCode: "輸入官方牌組代碼 (例: uCRvSM...)", btnParseOfficial: "🌐 解析官方牌組", 
        phDeckText: "貼上 Limitless 內容...", btnParseText: "📥 解析文字牌組", 
        lblSearchDb: "全圖庫圖文搜尋：", phSearchInput: "輸入卡名即時搜尋...", 
        lblCustomCard: "自訂卡片 (自動套用牌背文字)：", phCustomCard: "自訂卡名稱", 
        btnAddCustom: "➕ 建立專屬卡", deckListTitle: "牌組清單", btnPreviewDeck: "👁️ 預覽卡組", 
        btnStartGame: "🎲 鎖定牌組並開始精算", btnSaveCloud: "💾 紀錄至雲端", optLoadCloud: "載入雲端牌組...", 
        disclaimer: "<b>⚠️ 免責聲明：</b><br>本工具為第三方 TCG 戰術分析數據工具，與 Nintendo / Pokémon / GAME FREAK 無關。", 
        lblZoom: "🔍 介面縮放", summaryProbTitle: "🎯 進階情境：機率與連鎖分析 (萬次蒙地卡羅運算)", 
        txtToggleBadge: "點擊展開/收合", lblStep1: "🔥 1. 直接解牌目標 (可多選)", 
        lblRuleAnd: "條件皆要有 (AND)", lblRuleOr: "任一張達成即可 (OR)", btnSelectDirect: "🖼️ 從牌組多選目標牌", 
        lblDraw1: "第一波抽牌數：", lblDeadHand: "手牌原有廢牌張數 (洗回稀釋用)：", 
        lblStep2: "🔄 2. 延續解牌 (連鎖資源 - 支援多張)", btnAddChain: "🖼️ 新增連鎖牌", 
        btnRunSim: "🎲 執行深度推演", btnSaveScenario: "📌 紀錄至比較板", btnClearBoard: "🗑️ 清空比較板", 
        titlePrize: "🏆 獎賞卡 (Prize)", titleStadium: "🟠 場地 (Stadium)", titleActive: "🔴 戰鬥場 (Active)", 
        titleBench: "🔵 備戰區 (Bench)", titleHand: "手牌", txtHandSub: "扇形展開支援自由拖放", 
        btnHandShuffle: "🔄 洗回", btnHandDiscard: "🗑️ 全棄", titleDeck: "🗃️ 牌庫", 
        btnDrawCard: "🎴 抽一張牌", titleDiscard: "🪦 棄牌", btnExportGame: "📤 分享對局", 
        btnImportGame: "📥 載入對局", btnUndo: "↩ 上一步", btnRedo: "下一步 ↪", 
        modalAuthTitle: "解鎖專業沙盤功能", btnCloseAuth: "關閉", modalShareTitle: "📤 分享對局", 
        modalShareDesc: "複製下方 6 位數代碼傳給朋友，即可在任何電腦還原戰局與機率推演！", 
        btnShareClose: "關閉", btnShareCopy: "📋 一鍵複製短代碼", btnGalleryClose: "關閉", 
        galleryConfirmBtn: "✅ 確定選取", tutMainTitle: "📖 PTCG 覆盤工具教學", btnTut1: "🛠️ 1. 編輯牌組", 
        btnTut2: "⚔️ 2. 戰場操作", btnTut3: "🎲 3. 機率運算", tut1Desc: "建立牌組有三種方式，請選擇你想了解的匯入方式：", 
        btnTut1A: "A. 官方代碼匯入", btnTut1B: "B. Limitless 英文匯入", btnTut1C: "C. 搜尋與自訂卡片", 
        tut1ADesc: "前往寶可夢繁體中文官方網站，組好牌組後複製代碼貼入即可。", 
        tut1BDesc: "複製 Limitless 等賽事網站的英文牌組表 (Export Text)，一鍵解析匯入。", 
        tut1CDesc: "若有缺卡或想直接微調，可使用搜尋庫直接加入，或是建立自己的假卡 (代牌)。", 
        tut2H4: "⚔️ 戰場沙盤互動指南：", tut2Desc: "點擊左下角「鎖定牌組並開局」自動洗牌！支援卡牌自由拖曳放置，戰鬥場與備戰區皆支援完美錯位疊放。", 
        tut3H4: "🎲 蒙地卡羅機率算力：", tut3Desc: "設定「直接解牌目標」與「連鎖資源」，點擊執行深度推演，系統將在 0.1 秒內模擬 10,000 次真實對局抽牌！", 
        btnTutReady: "我準備好了！", benchLabel: "格" ,
        navImport: "🛠️ 1. 編輯牌組",
        navStarter: "🎲 2. 起手勝率健檢",
        navSandbox: "⚔️ 3. 覆盤沙盤戰場",
        navSupport: "💬 聯絡客服",
        stMainTitle: "🎲 起手勝率健檢",
        stTutBtn: "❓ 起手勝率教學",
        stSecA: "A. 寶可夢起站怪數量配置",
        stLblTotal: "基礎怪總數：",
        stLblWant: "理想起站怪 (Want)：",
        stLblUnwanted: "雷區怪 (Unwanted)：",
        stBtnCalcBasic: "📊 獨立計算開局起站機率",
        stTxtMulligan: "無基礎怪重抽 (Mulligan) 率：",
        stTxtPerfect: "完美起站機率(基礎怪至少有一張理想怪起站)：",
        stTxtNormal: "正常起站開局率(排除無基礎怪重抽的機率)：",
        stTxtForced: "雷區怪起站率：",
        stSecB: "B. 重點卡與資源檢索設定",
        stBtnAddKey: "＋ 新增重點牌種類",
        stBtnAddSearch: "＋ 新增物品過牌卡",
        stBtnAddDraw: "＋ 新增支援者卡",
        stBtnRunSim: "⚡ 執行多支援者勝率比較模擬",
        stResTitle: "📊 各支援者獨立劇本勝率結果",
        stRepTitle: "🐙 OCTOPLUS PTCG 戰術評分報告",
        stRepScoreLbl: "綜合戰力評分",
        stRepStabLbl: "起手穩定度",
        stRepConsLbl: "T1 展開爆發力",
        stRepCommLbl: "💬 小章魚戰術評語：",
        stBtnExport: "📸 匯出小章魚戰術報告卡 (分享用)",
    },
    en: { 
        tutBtn: "❓ Guide", statusNotLogin: "Status: Guest", btnUnlock: "Subscribe / Invite Code", 
        tabLink: "🔗 Official Code", tabText: "📝 Limitless Text", tabEdit: "🛠️ Search & Edit", 
        phDeckCode: "Enter official deck code (e.g. uCRvSM...)", btnParseOfficial: "🌐 Parse Official Deck", 
        phDeckText: "Paste Limitless deck text...", btnParseText: "📥 Parse Text Deck", 
        lblSearchDb: "Database Search:", phSearchInput: "Type card name to search...", 
        lblCustomCard: "Custom Proxy Card:", phCustomCard: "Proxy Card Name", btnAddCustom: "➕ Create Proxy", 
        deckListTitle: "Deck List", btnPreviewDeck: "👁️ Preview", btnStartGame: "🎲 Lock & Start Game", 
        btnSaveCloud: "💾 Save Cloud", optLoadCloud: "Load Cloud Deck...", 
        disclaimer: "<b>⚠️ Disclaimer:</b><br>Third-party TCG tactic tool. Not affiliated with Nintendo, Pokémon, or GAME FREAK.", 
        lblZoom: "🔍 UI Zoom", summaryProbTitle: "🎯 Monte Carlo Probability & Chain Analysis (10,000 Sim)", 
        txtToggleBadge: "Click to Expand/Collapse", lblStep1: "🔥 1. Direct Target Cards (Multi-select)", 
        lblRuleAnd: "Require All (AND)", lblRuleOr: "Require Any (OR)", btnSelectDirect: "🖼️ Select Targets from Deck", 
        lblDraw1: "First Draw Count:", lblDeadHand: "Existing Dead Cards in Hand:", 
        lblStep2: "🔄 2. Chain Resources (Multi-card)", btnAddChain: "🖼️ Add Chain Card", 
        btnRunSim: "🎲 Run Deep Simulation", btnSaveScenario: "📌 Save to Comparison", btnClearBoard: "🗑️ Clear Comparison", 
        titlePrize: "🏆 Prize Cards", titleStadium: "🟠 Stadium", titleActive: "🔴 Active Spot", 
        titleBench: "🔵 Bench", titleHand: "Hand", txtHandSub: "Fan view with drag-and-drop", 
        btnHandShuffle: "🔄 Shuffle Back", btnHandDiscard: "🗑️ Discard All", titleDeck: "🗃️ Deck", 
        btnDrawCard: "🎴 Draw 1 Card", titleDiscard: "🪦 Discard Pile", btnExportGame: "📤 Share Match", 
        btnImportGame: "📥 Load Match", btnUndo: "↩ Undo", btnRedo: "Redo ↪", 
        modalAuthTitle: "Unlock Sandbox Pro", btnCloseAuth: "Close", modalShareTitle: "📤 Share Game State", 
        modalShareDesc: "Copy the 6-digit code below to share and restore this match on any device!", 
        btnShareClose: "Close", btnShareCopy: "📋 Copy Short Code", btnGalleryClose: "Close", 
        galleryConfirmBtn: "✅ Confirm Selection", tutMainTitle: "📖 PTCG Sandbox Tutorial", 
        btnTut1: "🛠️ 1. Deck Builder", btnTut2: "⚔️ 2. Battle Board", btnTut3: "🎲 3. Probabilities", 
        tut1Desc: "There are three ways to build/import a deck. Choose one to learn:", 
        btnTut1A: "A. Official Code", btnTut1B: "B. Limitless Export", btnTut1C: "C. Search & Custom", 
        tut1ADesc: "Go to official Pokémon TCG site, build a deck, and copy the deck code.", 
        tut1BDesc: "Copy text list from Limitless TCG and paste to parse in one click.", 
        tut1CDesc: "Search database for missing cards, or create proxy cards on the fly.", 
        tut2H4: "⚔️ Battle Board Guide:", tut2Desc: "Click 'Lock & Start Game' to shuffle! Supports drag-and-drop card movement and stacked cards on fields.", 
        tut3H4: "🎲 Monte Carlo Engine:", tut3Desc: "Set your target cards and chain resources, then click Run Simulation to simulate 10,000 real draws in 0.1s!", 
        btnTutReady: "I'm Ready!", benchLabel: "Slots" ,
        navImport: "🛠️ 1. Deck Builder",
        navStarter: "🎲 2. Starter Checkup",
        navSandbox: "⚔️ 3. Sandbox Board",
        navSupport: "💬 Support",
        stMainTitle: "🎲 Opening Hand Consistency Checkup",
        stTutBtn: "❓ Checkup Guide",
        stSecA: "A. Basic Pokémon Starter Configuration",
        stLblTotal: "Total Basic PKMN:",
        stLblWant: "Ideal Starters (Want):",
        stLblUnwanted: "Risky Starters (Unwanted):",
        stBtnCalcBasic: "📊 Calculate Independent Starter Probabilities",
        stTxtMulligan: "Mulligan Rate (No Basic PKMN):",
        stTxtPerfect: "Perfect Starter Probability(At least 1 Ideal PKMN):",
        stTxtNormal: "Normal Starter Rate(Excluding Mulligans):",
        stTxtForced: "Risky Starter Rate:",
        stSecB: "B. Key Cards & Resource Retrieval",
        stBtnAddKey: "＋ Add Key Card Type",
        stBtnAddSearch: "＋ Add Item Searching Card",
        stBtnAddDraw: "＋ Add Supporter Draw Card",
        stBtnRunSim: "⚡ Run Multi-Supporter Comparison Simulation",
        stResTitle: "📊 Independent Supporter Win Rate Results",
        stRepTitle: "🐙 OCTOPLUS PTCG Tactical Evaluation",
        stRepScoreLbl: "Overall Score",
        stRepStabLbl: "Opening Stability",
        stRepConsLbl: "T1 Explosive Potential",
        stRepCommLbl: "💬 Octo's Tactical Remarks:",
        stBtnExport: "📸 Export Octo Report Card (Share)",
    }
};

function setTxt(id, val, isHTML=false) { 
    let el = document.getElementById(id); 
    if(el) { 
        if(isHTML) el.innerHTML = val; 
        else el.innerText = val; 
    } 
}

// 💡 檢查是否有未完成的動作
function checkPendingAction() {
    const action = localStorage.getItem('octoplus_pending_action');
    if (!action) return;

    supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (session) {
            localStorage.removeItem('octoplus_pending_action');

            setTimeout(() => {
                if (action === 'free_trial') {
                    console.log("偵測到未完成的免費體驗，自動執行...");
                    activateTrial(); 
                } 
                else if (action.startsWith('subscribe_')) {
                    const planType = action.replace('subscribe_', '');
                    console.log(`偵測到未完成的付款，自動執行 ${planType} 方案...`);
                    // 💡 關鍵修復：呼叫正確的綠界付款函數
                    buyPlan(planType); 
                }
            }, 500);
        }
    });
}

function changeLanguage(lang) {
    currentLang = lang; 
    localStorage.setItem('app_lang', lang); 
    document.getElementById('lang-select').value = lang; 
    let t = translations[lang];
    
    setTxt('tut-btn', t.tutBtn); 
    const statusEl = document.getElementById('txt-status');
    if (statusEl && statusEl.innerText.includes("未登入")) setTxt('txt-status', t.statusNotLogin); 
    
    setTxt('btn-unlock', t.btnUnlock); 
    setTxt('tab-btn-link', t.tabLink); 
    setTxt('tab-btn-text', t.tabText); 
    setTxt('tab-btn-edit', t.tabEdit);
    
    let dc = document.getElementById('deck-code'); 
    if(dc) dc.placeholder = t.phDeckCode;
    setTxt('btn-parse-official', t.btnParseOfficial);
    
    let dt = document.getElementById('deck-text'); 
    if(dt) dt.placeholder = t.phDeckText;
    setTxt('btn-parse-text', t.btnParseText); 
    setTxt('lbl-search-db', t.lblSearchDb);
    
    let si = document.getElementById('search-input'); 
    if(si) si.placeholder = t.phSearchInput;
    setTxt('lbl-custom-card', t.lblCustomCard);
    
    let ci = document.getElementById('custom-card-input'); 
    if(ci) ci.placeholder = t.phCustomCard;
    setTxt('btn-add-custom', t.btnAddCustom); 
    
    setTxt('txt-deck-list-title', t.deckListTitle); 
    setTxt('btn-preview-deck', t.btnPreviewDeck); 
    setTxt('btn-start-game', t.btnStartGame); 
    setTxt('btn-save-cloud', t.btnSaveCloud); 
    setTxt('opt-load-cloud', t.optLoadCloud); 
    setTxt('txt-disclaimer', t.disclaimer, true); 
    setTxt('lbl-zoom', t.lblZoom); 
    setTxt('summary-prob-title', t.summaryProbTitle); 
    setTxt('txt-toggle-badge', t.txtToggleBadge); 
    setTxt('lbl-step1', t.lblStep1); 
    setTxt('lbl-rule-and', t.lblRuleAnd); 
    setTxt('lbl-rule-or', t.lblRuleOr); 
    setTxt('btn-select-direct', t.btnSelectDirect); 
    setTxt('lbl-draw1', t.lblDraw1); 
    setTxt('lbl-dead-hand', t.lblDeadHand); 
    setTxt('lbl-step2', t.lblStep2); 
    setTxt('btn-add-chain', t.btnAddChain); 
    setTxt('btn-run-sim', t.btnRunSim); 
    setTxt('btn-save-scenario', t.btnSaveScenario); 
    setTxt('btn-clear-board', t.btnClearBoard); 
    setTxt('title-prize-text', t.titlePrize);
    setTxt('title-stadium', t.titleStadium); 
    setTxt('title-active', t.titleActive); 
    setTxt('title-bench', t.titleBench); 
    setTxt('title-hand', t.titleHand); 
    setTxt('txt-hand-sub', t.txtHandSub); 
    setTxt('btn-hand-shuffle', t.btnHandShuffle); 
    setTxt('btn-hand-discard', t.btnHandDiscard); 
    setTxt('title-deck', t.titleDeck); 
    setTxt('btn-draw-card', t.btnDrawCard); 
    setTxt('title-discard', t.titleDiscard); 
    setTxt('btn-export-game', t.btnExportGame); 
    setTxt('btn-import-game', t.btnImportGame); 
    setTxt('btn-undo', t.btnUndo); 
    setTxt('btn-redo', t.btnRedo); 
    setTxt('modal-auth-title', t.modalAuthTitle); 
    setTxt('btnCloseAuth', t.btnCloseAuth); 
    setTxt('modal-share-title', t.modalShareTitle); 
    setTxt('modal-share-desc', t.modalShareDesc); 
    setTxt('btn-share-close', t.btnShareClose); 
    setTxt('btn-share-copy', t.btnShareCopy); 
    setTxt('btn-gallery-close', t.btnGalleryClose); 
    setTxt('gallery-confirm-btn', t.galleryConfirmBtn); 
    setTxt('tut-main-title', t.tutMainTitle); 
    setTxt('btn-tut1', t.btnTut1); 
    setTxt('btn-tut2', t.btnTut2); 
    setTxt('btn-tut3', t.btnTut3); 
    setTxt('tut1-desc', t.tut1Desc); 
    setTxt('btn-tut1-a', t.btnTut1A); 
    setTxt('btn-tut1-b', t.btnTut1B); 
    setTxt('btn-tut1-c', t.btnTut1C); 
    setTxt('tut1-a-desc', t.tut1ADesc); 
    setTxt('tut1-b-desc', t.tut1BDesc); 
    setTxt('tut1-c-desc', t.tut1CDesc); 
    setTxt('tut2-h4', t.tut2H4); 
    setTxt('tut2-desc', t.tut2Desc); 
    setTxt('tut3-h4', t.tut3H4); 
    setTxt('tut3-desc', t.tut3Desc); 
    setTxt('btn-tut-ready', t.btnTutReady); 
    setTxt('bench-size-label', `${benchSize} ${t.benchLabel}`);
    
    renderTargetUI(); 
    renderChainUI(); 
    renderBoard();
    setTxt('btn-view-import', t.navImport);
    setTxt('btn-view-starter', t.navStarter);
    setTxt('btn-view-sandbox', t.navSandbox);
    setTxt('btn-support', t.navSupport);
    setTxt('st-main-title', t.stMainTitle);
    setTxt('st-tut-btn', t.stTutBtn);
    setTxt('st-sec-a-title', t.stSecA);
    setTxt('st-lbl-total', t.stLblTotal);
    setTxt('st-lbl-want', t.stLblWant);
    setTxt('st-lbl-unwanted', t.stLblUnwanted);
    setTxt('st-btn-calc-basic', t.stBtnCalcBasic);
    setTxt('st-txt-mulligan', t.stTxtMulligan);
    setTxt('st-txt-perfect', t.stTxtPerfect);
    setTxt('st-txt-normal', t.stTxtNormal);
    setTxt('st-txt-forced', t.stTxtForced);
    setTxt('st-sec-b-title', t.stSecB);
    setTxt('st-btn-add-key', t.stBtnAddKey);
    setTxt('st-btn-add-search', t.stBtnAddSearch);
    setTxt('st-btn-add-draw', t.stBtnAddDraw);
    setTxt('st-btn-run-sim', t.stBtnRunSim);
    setTxt('st-res-title', t.stResTitle);
    setTxt('st-rep-title', t.stRepTitle);
    setTxt('st-rep-score-lbl', t.stRepScoreLbl);
    setTxt('st-rep-stab-lbl', t.stRepStabLbl);
    setTxt('st-rep-cons-lbl', t.stRepConsLbl);
    setTxt('st-rep-comm-lbl', t.stRepCommLbl);
    setTxt('st-btn-export', t.stBtnExport);
}

// ==========================================
// 4. 動畫、教學導覽與戰術工具
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
    { id: 'import-section', title: '💡 步驟 1/3：編輯牌組', desc: '牌組匯入，還可以手動編輯呦！支援繁中官方代碼與 Limitless 英文代碼。' },
    { id: 'prob-panel', title: '🎯 步驟 2/3：起手健檢', desc: '複雜機率運算、情境分析沒煩惱！一鍵精算極限對局起手勝率。' },
    { id: 'battle-board-area', title: '⚔️ 步驟 3/3：覆盤戰場', desc: '設定覆盤戰場，卡片可以自動拖曳呦！支援完美疊放與錯位排列。' }
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
// 💡 跑馬燈資訊框拖曳邏輯
function startInfoDrag(e) {
    const infoBox = document.getElementById('draggable-info-box');
    if (!infoBox) return;
    
    let startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    let startY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    let rect = infoBox.getBoundingClientRect();
    let offsetX = startX - rect.left;
    let offsetY = startY - rect.top;

    function onMove(moveEvent) {
        let clientX = moveEvent.type.includes('mouse') ? moveEvent.clientX : moveEvent.touches[0].clientX;
        let clientY = moveEvent.type.includes('mouse') ? moveEvent.clientY : moveEvent.touches[0].clientY;
        
        let newLeft = clientX - offsetX;
        let newTop = clientY - offsetY;
        
        // 邊界防呆 (不會被拖出螢幕外)
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - rect.width));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - rect.height));

        infoBox.style.left = newLeft + 'px';
        infoBox.style.top = newTop + 'px';
        infoBox.style.bottom = 'auto'; // 解除 bottom 綁定，改用 top 定位
        infoBox.style.right = 'auto';
    }

    function onEnd() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, {passive: false});
    document.addEventListener('touchend', onEnd);
}
// ==========================================
// 5. 客服、登入、會員與表單機制
// ==========================================
function closeSupportModal() {
    let modal = document.getElementById('support-modal');
    if (modal) modal.style.display = 'none';
    
    let msgInput = document.getElementById('feedback-msg-input');
    if (msgInput) msgInput.value = "";
    
    let imgInput = document.getElementById('feedback-img-input');
    if (imgInput) imgInput.value = "";
    
    let imgPreview = document.getElementById('feedback-img-preview');
    if (imgPreview) imgPreview.style.display = 'none';
    
    let statusMsg = document.getElementById('feedback-status-msg');
    if (statusMsg) statusMsg.style.display = 'none';
    
    feedbackBase64 = "";
}

function checkAgreements() {
    let termsAgreed = localStorage.getItem('octoplus_terms_agreed') === 'Y';
    let privacyAgreed = localStorage.getItem('octoplus_privacy_agreed') === 'Y';
    let tStatus = document.getElementById('terms-status');
    let pStatus = document.getElementById('privacy-status');
    let btn = document.getElementById('send-verify-btn');
    let rem = document.getElementById('read-reminder');
    
    if (tStatus) { tStatus.innerHTML = termsAgreed ? '✅ 已同意' : '❌ 尚未同意'; tStatus.style.color = termsAgreed ? '#34A853' : '#FF5252'; }
    if (pStatus) { pStatus.innerHTML = privacyAgreed ? '✅ 已同意' : '❌ 尚未同意'; pStatus.style.color = privacyAgreed ? '#34A853' : '#FF5252'; }
    
    // 💡 關鍵修正：把原本的 if (btn && rem) 改為 if (btn)，不再因為找不到提示字串就卡死按鈕
    if (btn) {
        let lastSend = localStorage.getItem('magic_link_last_send');
        let count = parseInt(localStorage.getItem('octoplus_send_count')) || 0;
        let inCooldown = false;
        
        if (lastSend) {
            let diff = Math.floor((new Date().getTime() - parseInt(lastSend)) / 1000);
            let targetCooldown = count === 1 ? 5 : (count === 2 ? 30 : 300);
            if (diff < targetCooldown) inCooldown = true;
        }
        
        if (termsAgreed && privacyAgreed) {
            if (rem) { rem.style.color = '#34A853'; rem.innerText = '✅ 條款皆已同意，可以發送驗證連結了！'; }
            if (!inCooldown) btn.disabled = false; // 條件滿足，解鎖按鈕！
        } else {
            btn.disabled = true;
            if (rem) { rem.style.color = '#FF5252'; rem.innerText = '⚠️ 請先點擊閱讀並同意上述兩項條款，方可發送'; }
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
    applyAutoZoom();
    
    renderPopularDecks(); // 💡 新增這行：載入網頁時生成熱門牌組按鈕
    
    changeLanguage(currentLang);
    
    try {
        let savedDeck = localStorage.getItem('octoplus_deck');
        if (savedDeck) { deckDict = JSON.parse(savedDeck); updateDeckUI(); }
        let savedBoard = localStorage.getItem('octoplus_board');
        if (savedBoard) gameCards = JSON.parse(savedBoard);
    } catch(e) {}
    
    switchMainView('import');
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
        if (session) {
            handleSession(session);
            // 💡 關鍵修復：登入後立刻翻開小本本檢查意圖！
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                checkPendingAction();
            }
        }
    });
}

// 新增全域變數供 starter.js 判斷權限
window.isUserPro = false; 

async function handleSession(session) {
    document.getElementById('gate-overlay').style.display = 'none';
    let uIdInput = document.getElementById('user-id-input');
    if(uIdInput) uIdInput.value = session.user.email ? session.user.email.split('@')[0] : session.user.id.substring(0, 8);
    
    let btnUnlock = document.getElementById('btn-unlock');
    if(btnUnlock) btnUnlock.innerHTML = "👑 升級 / 延長訂閱"; // 微調文字長度適應導覽列
    
    try {
        if (supabaseClient) {
            const { data } = await supabaseClient.from('profiles').select('is_pro, pro_expires_at').eq('id', session.user.id).single();
            if (data) {
                let hasActiveSub = false;
                if (data.pro_expires_at) {
                    let expDate = new Date(data.pro_expires_at.replace("Z", "+00:00"));
                    if (new Date() < expDate) hasActiveSub = true;
                }
                
                window.isUserPro = data.is_pro || hasActiveSub; 

                let statusTxt = document.getElementById('txt-status');
                let statusSub = document.getElementById('txt-status-sub');
                
                if (window.isUserPro) {
                    let expStr = "終身尊榮 VIP ♾️";
                    if (data.pro_expires_at) {
                        let d = new Date(data.pro_expires_at.replace("Z", "+00:00"));
                        if (d.getFullYear() < 2090) expStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    }
                    if(statusTxt) statusTxt.innerHTML = `<span style="color:#FFD700;">👑 Pro 專業會員</span>`;
                    if(statusSub) statusSub.innerHTML = `(期限: ${expStr})`;
                } else {
                    if(statusTxt) statusTxt.innerHTML = `免費會員 (Free)`;
                    if(statusSub) statusSub.innerHTML = `(升級解鎖全戰術矩陣)`;
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

async function checkLoginStatus() {
    if (!supabaseClient) return false;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        document.getElementById('gate-overlay').style.display = 'flex';
        return false;
    }
    return session.access_token;
}

// ==========================================
// 6. 牌組處理與 UI 邏輯
// ==========================================
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
        if(d.success){ 
            deckDict = d.deck; 
            updateDeckUI(); 
            if (d.fallback_cards && d.fallback_cards.length > 0) {
                let msgList = d.fallback_cards.map(item => "• " + item).join("\n");
                alert("⚠️ 以下卡牌未能在官網取得精確專屬卡圖：\n\n" + msgList + "\n\n已自動套用替代方案顯示！");
            }
        }
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="100%" height="100%" fill="${color}" rx="4" /><rect x="5%" y="5%" width="90%" height="90%" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" rx="2" /><text x="50%" y="50%" font-size="28" text-anchor="middle" dominant-baseline="central">🐙</text></svg>`;
    DEFAULT_CARDBACK = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    
    renderBoard();
    if(document.getElementById('gallery-modal').style.display === 'flex') {
        let items = currentModalMode === 'preview' ? Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] })) : [];
        if(items.length) renderGalleryItems(items);
    }
}

// ==========================================
// 7. Modal 彈窗與卡牌圖庫
// ==========================================
function closeGalleryModal(e) {
    if(e.target.id === 'gallery-modal') document.getElementById('gallery-modal').style.display = 'none';
}

function openPrizeProbModal() {
    document.getElementById('prize-prob-modal').style.display = 'flex';
    renderPrizeTargetUI();
    document.getElementById('prize-prob-result').innerText = '0.0 %';
    document.getElementById('prize-prob-result').style.color = '#FFD700';
}

function renderPrizeTargetUI() {
    const container = document.getElementById('prize-target-display');
    container.innerHTML = "";
    let keys = Object.keys(prizeTargetList);
    if(keys.length === 0) { container.innerHTML = `<div style="color:#888; text-align:center;">未選擇任何卡片</div>`; return; }
    keys.forEach(k => {
        let c = prizeTargetList[k];
        let div = document.createElement('div');
        div.className = 'target-row';
        let safeImg = (c.img && c.img.startsWith('http')) ? c.img : DEFAULT_CARDBACK;
        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                <img src="${safeImg}" onerror="this.src='${DEFAULT_CARDBACK}'" style="width:30px;height:42px;margin-right:10px;">
                <span style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;">${c.name}</span>
            </div> 
            <button class="btn-secondary" style="width:28px; height:28px; padding:0; border-radius:50%; color:#FF5252; display:flex; justify-content:center; align-items:center;" onclick="removePrizeTarget('${k.replace(/'/g, "\\\\'")}')">✕</button>
        `;
        container.appendChild(div);
    });
}

function removePrizeTarget(k) {
    delete prizeTargetList[k];
    renderPrizeTargetUI();
}
function handleCardClick(imgUrl, fallbackUrl) {
    isDragging = false; 
    let safeImg = (imgUrl && imgUrl.startsWith('http')) ? imgUrl : DEFAULT_CARDBACK;
    let fUrl = (fallbackUrl && fallbackUrl.startsWith('http')) ? fallbackUrl : DEFAULT_CARDBACK;
    let lbImg = document.getElementById('lightbox-img');
    lbImg.src = safeImg;
    lbImg.onerror = function() { this.onerror = null; this.src = fUrl; };
    
    let modal = document.getElementById('lightbox-modal');
    modal.style.display = 'flex';
    modal.style.zIndex = "30000"; 
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
    let itemsToRender = []; 
    
    if (type === 'direct') {
        tempSelectedKeys = Object.keys(targetList);
        itemsToRender = Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] }));
    } else if (type === 'prize_target') {
        tempSelectedKeys = Object.keys(prizeTargetList);
        let prizeCards = gameCards.filter(c => c.zone.startsWith('prize_'));
        let prizeGroups = {};
        prizeCards.forEach(c => {
            if (!prizeGroups[c.key]) prizeGroups[c.key] = { key: c.key, name: c.name, img: c.img, fallback_img: c.fallback_img, qty: 0 };
            prizeGroups[c.key].qty++;
        });
        itemsToRender = Object.values(prizeGroups);
        
        if (itemsToRender.length === 0) {
            alert("⚠️ 獎賞卡區已經沒有卡片囉！");
            return;
        }
    } else if (type.startsWith('chain_target_')) {
        let parentKey = type.replace('chain_target_', '');
        tempSelectedKeys = chainList[parentKey].targets ? Object.keys(chainList[parentKey].targets) : [];
        itemsToRender = Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] }));
    } else {
        tempSelectedKeys = [];
        itemsToRender = Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] }));
    }
    
    let title = "🔍 選取卡片";
    if (type === 'direct') title = "🔥 選取目標卡 (可多選)";
    else if (type === 'chain') title = "🔄 新增連鎖牌 (單張加入)";
    else if (type === 'prize_target') title = "🏆 選擇想抽到的獎賞卡目標 (可多選)";
    else if (type.startsWith('chain_target_')) title = "🎯 選擇檢索目標卡 (可多選)";
    
    document.getElementById('gallery-title').innerText = title;
    document.getElementById('gallery-confirm-btn').style.display = 'block';
    renderGalleryItems(itemsToRender); 
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
            
            if(currentModalMode === 'direct' || currentModalMode.startsWith('chain_target_') || currentModalMode === 'prize_target') {
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
    } else if (currentModalMode === 'prize_target') {
        let newList = {};
        tempSelectedKeys.forEach(k => { newList[k] = prizeTargetList[k] || { name: deckDict[k].name, img: deckDict[k].img }; });
        prizeTargetList = newList;
        renderPrizeTargetUI();
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
    } else if (currentModalMode.startsWith('st_input_')) {
        // 💡 串接 Starter Tool 的輸入框回填 (並自動填入正確張數)
        let targetInputId = currentModalMode.replace('st_input_', '');
        let targetInput = document.getElementById(targetInputId);
        
        if (targetInput && tempSelectedKeys.length > 0) {
            let k = tempSelectedKeys[0];
            
            // 1. 填入卡片名稱，去掉後面的 [代碼]
            targetInput.value = deckDict[k] ? deckDict[k].name : k.split(' [')[0];
            
            // 2. 自動抓取當前牌組中的數量，並填入旁邊的「牌組投入」數字框
            if (deckDict[k]) {
                let row = targetInput.closest('.target-row'); // 抓取當前這行
                if (row) {
                    // 尋找對應的數量輸入框
                    let qtyInput = row.querySelector('.st-key-count, .st-search-count, .st-draw-count');
                    if (qtyInput) {
                        qtyInput.value = deckDict[k].qty; // 自動寫入真實張數
                    }
                }
            }
        }
    }
    
    // 確保這裡只有「一個」關閉 Modal 的動作
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

function removeChain(k) {
    delete chainList[k];
    renderChainUI();
}

function openChainTargetSelector(parentKey) {
    currentModalMode = 'chain_target_' + parentKey;
    tempSelectedKeys = chainList[parentKey].targets ? Object.keys(chainList[parentKey].targets) : [];
    document.getElementById('gallery-title').innerText = "🎯 選擇檢索目標卡 (可多選)";
    document.getElementById('gallery-confirm-btn').style.display = 'block';
    renderGalleryItems(Object.keys(deckDict).map(k => ({ key: k, ...deckDict[k] })));
    document.getElementById('gallery-modal').style.display = 'flex';
}

// ==========================================
// 8. 戰局系統 (戰場、群組拖曳、洗牌、還原)
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
    if (delta < 0) {
        let benchedCards = gameCards.filter(c => c.zone.startsWith('bench_'));
        let newSize = benchSize - 1;
        let occupiedSlots = new Set(benchedCards.map(c => c.zone));
        
        if (occupiedSlots.size > newSize) {
            showBenchShrinkModal(benchedCards, newSize);
            return; 
        }
    }
    
    benchSize = Math.max(1, Math.min(8, benchSize + delta));
    document.getElementById('bench-size-label').innerText = `${benchSize} 格`;
    renderBenchSlots();
    renderBoard();
}

function showBenchShrinkModal(benchedCards, newSize) {
    let container = document.getElementById('bench-shrink-options');
    container.innerHTML = '';
    
    let zones = {};
    benchedCards.forEach(c => {
        if(!zones[c.zone]) zones[c.zone] = [];
        zones[c.zone].push(c);
    });

    Object.keys(zones).forEach(zName => {
        let stack = zones[zName];
        let topCard = stack[stack.length - 1]; 
        
        let div = document.createElement('div');
        div.style = "cursor: pointer; transition: 0.2s; border: 2px solid transparent; border-radius: 6px; padding: 2px;";
        div.onmouseover = () => div.style.borderColor = "#FF5252";
        div.onmouseout = () => div.style.borderColor = "transparent";
        
        let safeImg = (topCard.img && topCard.img.startsWith('http')) ? topCard.img : DEFAULT_CARDBACK;
        div.innerHTML = `<img src="${safeImg}" style="width: 80px; border-radius: 4px; pointer-events:none;">`;
        
        div.onclick = () => {
            stack.forEach(c => {
                c.zone = 'discard';
                c.damage = 0;
                c.status = [];
            });
            
            document.getElementById('bench-shrink-modal').style.display = 'none';
            
            let remainingBenched = gameCards.filter(c => c.zone.startsWith('bench_'));
            let currentZones = [...new Set(remainingBenched.map(c => c.zone))].sort();
            currentZones.forEach((oldZone, idx) => {
                let newZone = `bench_${idx}`;
                if (oldZone !== newZone) {
                    gameCards.filter(c => c.zone === oldZone).forEach(c => c.zone = newZone);
                }
            });

            benchSize = newSize;
            document.getElementById('bench-size-label').innerText = `${benchSize} 格`;
            saveState();
            renderBenchSlots();
            renderBoard();
        };
        
        container.appendChild(div);
    });
    
    document.getElementById('bench-shrink-modal').style.display = 'flex';
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
    prizesFaceUp = true;
    
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

    // 鎖定完成後自動切換至功能 A 進行測試
    switchMainView('starter');
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
    div.onclick = () => { handleCardClick(c.img, c.fallback_img); };

    let safeImg = (c.img && c.img.startsWith('http')) ? c.img : DEFAULT_CARDBACK;
    let fallback = c.fallback_img || DEFAULT_CARDBACK;

    if (c.zone === 'deck') {
        safeImg = DEFAULT_CARDBACK; fallback = DEFAULT_CARDBACK;
    } else if (c.zone.startsWith('prize_')) {
        if (isPrizeFaceUp !== true) { safeImg = DEFAULT_CARDBACK; fallback = DEFAULT_CARDBACK; }
    }

    let isDefault = safeImg === DEFAULT_CARDBACK;
    let inner = `<img src="${safeImg}" onerror="this.onerror=function(){ this.onerror=null; this.src='${DEFAULT_CARDBACK}'; if(this.nextElementSibling) this.nextElementSibling.style.display='block'; }; this.src='${fallback}'; if(this.src==='${DEFAULT_CARDBACK}' && this.nextElementSibling) this.nextElementSibling.style.display='block';">`;
    inner += `<div class="card-name-overlay" style="display:${isDefault ? 'block' : 'none'};">${c.name}</div>`;
    
    if(isField) {
        inner += `<div class="bring-front-btn" title="移到最上層" onclick="event.stopPropagation(); bringToFront('${c.id}')">🔼置頂</div>`;
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

        if (arr.length > 1) {
            let dragHandle = document.createElement('div');
            dragHandle.className = 'stack-drag-handle';
            dragHandle.draggable = true;
            dragHandle.innerHTML = '🔗 整疊拖曳';
            dragHandle.ondragstart = (e) => {
                isDragging = true;
                e.dataTransfer.setData("stack_zone", zName);
                setTimeout(() => { domEl.style.opacity = '0.3'; }, 0);
            };
            dragHandle.ondragend = () => {
                isDragging = false;
                domEl.style.opacity = '1';
                renderBoard();
            };
            domEl.appendChild(dragHandle);
        }
    });

    for(let i=0; i<6; i++) {
        let arr = zones['prize_'+i]||[];
        if(arr.length > 0) document.getElementById('zone-prize-'+i).appendChild(createCardEl(arr[0], false, prizesFaceUp));
    }

    let deckArr = zones['deck']||[];
    document.getElementById('deck-count').innerText = deckArr.length;
    if(deckArr.length > 0) {
        let el = document.createElement('div');
        el.className = 'card-wrapper';
        el.style.position = 'absolute';
        el.innerHTML = `<img src="${DEFAULT_CARDBACK}" style="pointer-events:none;">`;
        document.getElementById('zone-deck').appendChild(el);
    }

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

function drop(ev) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('dragover');

    let targetZone = ev.currentTarget.id.replace('zone-', '').replace('-', '_');

    let stackZone = ev.dataTransfer.getData("stack_zone");
    if (stackZone) {
        if (stackZone !== targetZone) {
            gameCards.filter(c => c.zone === stackZone).forEach(c => {
                c.zone = targetZone;
                if (targetZone !== 'active' && !targetZone.startsWith('bench_')) { c.damage = 0; c.status = []; }
                gameCards.push(gameCards.splice(gameCards.indexOf(c), 1)[0]);
            });
            saveState();
            setTimeout(() => renderBoard(), 10);
        }
        return;
    }

    let tokenData = ev.dataTransfer.getData("token");
    if (tokenData) {
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

    let cardId = ev.dataTransfer.getData("text");
    if (cardId) {
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

function drawRandomPrize() {
    let prizeCards = gameCards.filter(c => c.zone.startsWith('prize_'));
    if (prizeCards.length === 0) return alert("⚠️ 獎賞卡已經全部抽完囉！");
    let randomIndex = Math.floor(Math.random() * prizeCards.length);
    let drawnCard = prizeCards[randomIndex];
    drawnCard.zone = 'hand';
    saveState();
    renderBoard();
    let msg = document.getElementById('marquee-text');
    if (msg) {
        msg.innerHTML = `🎁 盲抽獎賞卡：【${drawnCard.name}】 已進入手牌！`;
        msg.style.color = "#00C9FF";
    }
}

function calcPrizeProb() {
    let prizeCards = gameCards.filter(c => c.zone.startsWith('prize_'));
    let N = prizeCards.length;
    if (N === 0) return alert("⚠️ 獎賞卡已為空！");
    
    let targetKeys = Object.keys(prizeTargetList);
    if (targetKeys.length === 0) return alert("⚠️ 請先選擇至少一張目標卡！");
    
    let draws = parseInt(document.getElementById('prize-draw-qty').value) || 1;
    if (draws > N) draws = N;

    let rule = document.querySelector('input[name="prize_rule"]:checked').value;
    let simCount = 10000; 
    let success = 0;
    
    let prizePool = prizeCards.map(c => c.key);
    
    for (let i = 0; i < simCount; i++) {
        let shuffled = [...prizePool];
        for (let j = shuffled.length - 1; j > 0; j--) {
            let r = Math.floor(Math.random() * (j + 1));
            let tmp = shuffled[j];
            shuffled[j] = shuffled[r];
            shuffled[r] = tmp;
        }
        
        let drawnCards = shuffled.slice(0, draws);
        
        if (rule === 'AND') {
            let pass = true;
            for (let key of targetKeys) {
                if (!drawnCards.includes(key)) { pass = false; break; }
            }
            if (pass) success++;
        } else {
            let pass = false;
            for (let key of targetKeys) {
                if (drawnCards.includes(key)) { pass = true; break; }
            }
            if (pass) success++;
        }
    }
    
    let prob = (success / simCount) * 100;
    
    let resEl = document.getElementById('prize-prob-result');
    resEl.innerText = `${prob.toFixed(1)} %`;
    resEl.style.color = prob > 0 ? '#00E5FF' : '#FF5252';
    resEl.classList.remove('bounce-in');
    void resEl.offsetWidth;
    resEl.classList.add('bounce-in');
}

function runMonteCarloClient(deckCards, directDict, chainDict, draw1, targetRule = "AND", deadHandSize = 0, iterations = 10000) {
    if (!deckCards || deckCards.length === 0 || draw1 <= 0 || Object.keys(directDict).length === 0) return 0.0;
    
    const baseDeck = deckCards.map(c => c.name);
    let successCount = 0;

    for (let iter = 0; iter < iterations; iter++) {
        let deck = [...baseDeck];
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        let hand = deck.slice(0, draw1);
        let remDeck = deck.slice(draw1);

        Object.keys(chainDict).forEach(k => {
            if (chainDict[k].guaranteed && !hand.includes(k)) hand.push(k);
        });

        const checkSuccess = (currentHand) => {
            let missing = {};
            Object.keys(directDict).forEach(k => { missing[k] = directDict[k].qty || 1; });

            let searchCards = [];
            for (let card of currentHand) {
                if (missing[card] !== undefined && missing[card] > 0) {
                    missing[card]--;
                } else if (chainDict[card] && chainDict[card].type && chainDict[card].type.includes('檢索')) {
                    searchCards.push(card);
                }
            }

            const isSatisfied = (m) => {
                if (targetRule === "AND") {
                    return Object.values(m).reduce((a, b) => a + b, 0) <= 0;
                } else {
                    return Object.keys(m).some(k => m[k] < (directDict[k].qty || 1));
                }
            };

            if (isSatisfied(missing)) return true;

            for (let sCard of searchCards) {
                let canFetch = chainDict[sCard].search_targets || [];
                let fetchQty = chainDict[sCard].val || 1;
                while (fetchQty > 0) {
                    let bestTarget = canFetch.find(t => missing[t] !== undefined && missing[t] > 0);
                    if (bestTarget) {
                        missing[bestTarget]--;
                        fetchQty--;
                    } else {
                        break;
                    }
                }
            }
            return isSatisfied(missing);
        };

        if (checkSuccess(hand)) {
            successCount++;
            continue;
        }

        let maxSupporter = 0;
        let totalItem = 0;
        for (let card of hand) {
            if (chainDict[card]) {
                let ctype = chainDict[card].type || '';
                let cval = chainDict[card].val || 0;
                if (ctype.includes('支援者')) maxSupporter = Math.max(maxSupporter, cval);
                else if (ctype.includes('物品/特性')) totalItem += cval;
            }
        }

        let totalDraw = maxSupporter + totalItem;
        if (totalDraw > 0) {
            if (deadHandSize > 0) {
                for (let d = 0; d < deadHandSize; d++) remDeck.push('blank');
                for (let i = remDeck.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [remDeck[i], remDeck[j]] = [remDeck[j], remDeck[i]];
                }
            }
            hand.push(...remDeck.slice(0, totalDraw));
            if (checkSuccess(hand)) successCount++;
        }
    }
    return (successCount / iterations) * 100.0;
}

// ==========================================
// 💡 共用防線：強制引導訪客進行 E-mail 與條款驗證
// ==========================================
async function requireAuthForAction() {
    let token = await checkLoginStatus();
    if (!token) {
        // 關閉訂閱視窗，彈出 E-mail 驗證與條款視窗
        document.getElementById('sub-modal').style.display = 'none';
        document.getElementById('gate-overlay').style.display = 'flex';
        alert("⚠️ 請先在此輸入 E-mail 並同意會員條款，接收驗證信後即可解鎖權限！");
        return null;
    }
    return token;
}

// ==========================================
// 💡 1. 綠界金流購買觸發器
// ==========================================
async function buyPlan(planType) {
    // 💡 修正變數名稱：使用 planType
    localStorage.setItem('octoplus_pending_action', 'subscribe_' + planType);

    let token = await requireAuthForAction();
    if (!token) return;

    // 💡 清除意圖，並刪除重複的 let token 宣告
    localStorage.removeItem('octoplus_pending_action');
    
    let btnText = "處理中...";
    try {
        const resp = await fetch(`${API_BASE}/api/v1/create_ecpay_order`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                plan_type: planType,
                return_url: window.location.href
            })
        });
        const data = await resp.json();
        if (data.success) {
            let w = window.open("", "_self");
            w.document.write(data.html);
        } else {
            alert("❌ 建立訂單失敗：" + (data.detail || "未知錯誤"));
        }
    } catch (e) {
        alert("❌ 連線至金流伺服器失敗，請稍後重試。");
    }
}

// ==========================================
// 💡 2. 邀請碼兌換 (無反白提示)
// ==========================================
async function redeemInviteCode() {
    let token = await requireAuthForAction();
    if (!token) return;
    
    let input = prompt("請輸入您的尊榮會員邀請碼：", "");
    if (!input || !input.trim()) return;
    
    try {
        const resp = await fetch(`${API_BASE}/api/v1/redeem_code`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ code: input.trim() })
        });
        const data = await resp.json();
        if (data.success) {
            alert(data.detail);
            location.reload();
        } else {
            alert(data.detail || "兌換碼無效！");
        }
    } catch (e) {
        alert("連線失敗，請稍後重試。");
    }
}

// ==========================================
// 💡 2.5 補上：免費 7 日體驗開通功能
// ==========================================
async function activateTrial() {
    localStorage.setItem('octoplus_pending_action', 'free_trial');

    let token = await requireAuthForAction();
    if (!token) return;

    // 💡 刪除重複的 let token 宣告
    localStorage.removeItem('octoplus_pending_action');

    try {
        const resp = await fetch(`${API_BASE}/api/v1/activate_trial`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        const data = await resp.json();
        if (data.success) {
            alert(data.detail);
            location.reload(); 
        } else {
            alert("❌ 失敗：" + (data.detail || "無法開通體驗"));
        }
    } catch (e) {
        alert("連線失敗，請稍後重試。");
    }
}
function runSimulation() {
    // 🚧 1. 額度與權限檢查：非 Pro 會員每日限制 30 次
    if (!window.isUserPro) {
        let today = new Date().toDateString();
        let lastDate = localStorage.getItem('octoplus_sim_date');
        let simCount = parseInt(localStorage.getItem('octoplus_sim_count')) || 0;

        // 跨日自動重置額度
        if (lastDate !== today) {
            simCount = 0;
            localStorage.setItem('octoplus_sim_date', today);
        }

        // 檢查額度是否用盡
        if (simCount >= 30) {
            document.getElementById('sub-modal').style.display = 'flex';
            alert("⚠️ 您今日的 30 次免費試玩額度已用盡！\n👉 請登入點擊【免費試用 7 天】或升級 Pro 會員解鎖無限算力！");
            return; // 強制中斷運算
        }

        // 扣除額度並存檔
        simCount++;
        localStorage.setItem('octoplus_sim_count', simCount);
        
        // 💡 UX 優化：動態更新右上角的文字顯示剩餘次數
        let statusSub = document.getElementById('txt-status-sub');
        if (statusSub) {
            statusSub.innerText = `(今日剩餘: ${30 - simCount} 次)`;
            statusSub.style.color = (30 - simCount <= 5) ? '#FF5252' : '#FFF'; // 最後 5 次變紅色警告
        }
    }

    // 既有的防呆檢查與運算邏輯
    let deckForSim = gameCards.filter(c => c.zone === 'deck').map(c => ({ name: c.key }));
    if (deckForSim.length === 0) {
        return alert("⚠️ 牌庫中沒有卡片！請先點擊「鎖定牌組並開局」。");
    }

    let d1 = parseInt(document.getElementById('draw1-qty').value) || 7;
    let targetRule = document.querySelector('input[name="target_rule"]:checked').value;
    let deadHand = parseInt(document.getElementById('dead-hand-qty').value) || 0;
    
    let directDict = {};
    Object.keys(targetList).forEach(k => { directDict[k] = { qty: targetList[k].qty }; });
    if (Object.keys(directDict).length === 0) {
        return alert("請先選取直接解牌目標！");
    }
    
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

    setTimeout(() => {
        try {
            let prob = runMonteCarloClient(deckForSim, directDict, formattedChainDict, d1, targetRule, deadHand, 10000);

            lastSimResult = {
                title: `首波 ${d1} 抽`,
                desc: `解: ${Object.keys(targetList).map(k => `${targetList[k].name}x${targetList[k].qty}`).join(targetRule === 'AND' ? ' + ' : ' 或 ')}`,
                prob: prob
            };

            resultEl.innerText = `${prob.toFixed(1)} %`;
            resultEl.style.color = "#00E5FF";
            resultEl.style.fontSize = "46px";
        } catch (err) {
            resultEl.innerText = "❌ 運算發生錯誤";
            resultEl.style.color = "#FF5252";
            resultEl.style.fontSize = "20px";
        }
    }, 20);
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
    let token = await checkLoginStatus();
    if (!token) return;

    if (Object.keys(deckDict).length === 0) return alert("牌組是空的，無法儲存！");
    let deckName = prompt("請為這副牌組取個名字：", "我的強力牌組");
    if (!deckName) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
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
        if (el) {
            el.innerHTML = text;
            // 💡 動態均速演算法：每字約 0.35 秒，最少 20 秒，長話慢走、短話不拖！
            el.style.animationDuration = Math.max(text.length * 0.35, 20) + 's';
        }
    } catch (e) {
        let el = document.getElementById('marquee-text');
        if (el) el.innerHTML = "歡迎使用 PTCG 小章魚";
    }
}

window.addEventListener('load', fetchMarquee);
