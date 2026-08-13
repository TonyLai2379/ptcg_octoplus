// ==========================================
// PTCG 小章魚 - 功能 A：起手勝率健檢與評分引擎
// ==========================================

let starterSeed = 1;
function starterRandom() {
    let x = Math.sin(starterSeed++) * 10000;
    return x - Math.floor(x);
}

function starterShuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(starterRandom() * (i + 1));
        const t = array[i]; array[i] = array[j]; array[j] = t;
    }
    return array;
}

// 1. 獨立 A 區開局起站與 Mulligan 模擬 (超高速數學精算版)
function runIndependentBasicSimulation() {
    const B = parseInt(document.getElementById('st-totalBasic').value) || 0;
    const W = parseInt(document.getElementById('st-wantBasic').value) || 0;
    const U = parseInt(document.getElementById('st-unwantedBasic').value) || 0;

    if (B > 60 || W > B || U > B || (W + U) > B) {
        alert("輸入數值有誤：基礎怪總數不可超過 60，且 Want + Unwanted 不能超過總基礎怪！");
        return { mulProb: 0, perfProb: 0, normalProb: 0, forcedProb: 0 };
    }

    function C(n, k) {
        if (k < 0 || k > n) return 0;
        if (k === 0 || k === n) return 1;
        k = Math.min(k, n - k);
        let c = 1;
        for (let i = 1; i <= k; i++) c = c * (n - i + 1) / i;
        return c;
    }

    let totalHands = C(60, 7);

    // 1. 無基礎怪 (Mulligan)：7張全從「非基礎怪(60-B)」裡面抽
    let pMulligan = C(60 - B, 7) / totalHands;

    // 2. 完美起站 (Perfect)：至少有 1 張理想怪 (100% 扣除「連1張理想怪都沒有」的組合)
    let pPerfect = (totalHands - C(60 - W, 7)) / totalHands;

    // 3. 正常起站 (Normal)：至少有 1 張基礎怪 (100% 扣除 Mulligan)
    let pNormal = 1 - pMulligan;

    // 4. 雷區起站 (Forced Unwanted)：只有抽到雷區怪，不能有 Want 也不能有其他基礎怪
    // 算法：從 (非基礎怪 + 雷區怪) 中抽 7 張，並扣掉全是廢牌 (Mulligan) 的情況
    let pUnwanted = (C(60 - B + U, 7) - C(60 - B, 7)) / totalHands;

    const mulProb = pMulligan * 100;
    const perfProb = pPerfect * 100;
    const normalProb = pNormal * 100;
    const forcedProb = pUnwanted * 100;

    // 寫入畫面
    let elMul = document.getElementById('st-mulliganProb') || document.getElementById('res-mulligan');
    if (elMul) elMul.innerText = mulProb.toFixed(2) + "%";

    let elPerf = document.getElementById('st-perfectStartProb') || document.getElementById('res-perfect');
    if (elPerf) elPerf.innerText = perfProb.toFixed(2) + "%";

    let elNorm = document.getElementById('st-normalStartProb') || document.getElementById('res-normal');
    if (elNorm) elNorm.innerText = normalProb.toFixed(2) + "%";

    let elForced = document.getElementById('st-forcedStartProb') || document.getElementById('res-forced');
    if (elForced) elForced.innerText = forcedProb.toFixed(2) + "%";

    let resultArea = document.getElementById('st-basicResultArea');
    if (resultArea) resultArea.style.display = 'block';

    return { mulProb, perfProb, normalProb, forcedProb };
}

// 2. 看 X 張選 Y 張智慧壓牌濾牌演算法
function executeSmartItemThinning(hand, deck, combo) {
    let searched = true;
    while (searched) {
        searched = false;
        let idx = hand.findIndex(c => c.type === 'search' && !c.used);
        if (idx === -1) break;
        
        hand[idx].used = true;
        let lookCount = hand[idx].lookCount; 
        let pickMax = hand[idx].pickCount;   
        let allowedTargets = hand[idx].targets || [];

        let searchPool = [];
        let isFullDeckSearch = (lookCount >= 55); 

        if (isFullDeckSearch) {
            searchPool = [...deck];
        } else {
            searchPool = deck.splice(0, Math.min(lookCount, deck.length));
        }

        if (searchPool.length > 0) {
            let missingComboIds = combo.filter(id => !hand.some(hc => hc.type === 'key' && hc.id === id));
            let criticalPickedCount = 0;
            
            for (let i = 0; i < searchPool.length; i++) {
                if (criticalPickedCount >= pickMax) break;
                let card = searchPool[i];
                if (card.type === 'key' && allowedTargets.includes(card.id)) {
                    if (missingComboIds.includes(card.id)) {
                        hand.push(card);
                        searchPool.splice(i, 1);
                        i--;
                        criticalPickedCount++;
                        missingComboIds = combo.filter(id => !hand.some(hc => hc.type === 'key' && hc.id === id));
                    }
                }
            }

            for (let i = 0; i < searchPool.length; i++) {
                if (criticalPickedCount >= pickMax) break;
                let card = searchPool[i];
                if (card.type === 'key' && allowedTargets.includes(card.id)) {
                    hand.push(card);
                    searchPool.splice(i, 1);
                    i--;
                    criticalPickedCount++;
                }
            }

            if (allowedTargets.length === 0 || (allowedTargets.length === 1 && isNaN(allowedTargets[0]))) {
                let freeDraw = searchPool.splice(0, Math.min(pickMax, searchPool.length));
                freeDraw.forEach(c => hand.push(c));
            }

            if (isFullDeckSearch) {
                deck = [...searchPool];
                starterShuffle(deck);
            } else {
                searchPool.forEach(c => deck.push(c));
                starterShuffle(deck);
            }
            searched = true;
        }
        hand.splice(idx, 1);
    }
    return { hand, deck };
}

function checkComboSuccess(hand, combo) {
    let staticKeyIds = hand.filter(c => c.type === 'key').map(c => c.id);
    return combo.every(id => staticKeyIds.includes(id));
}

// 3. 支援者實戰模擬劇本
function simulateScenario(handBeforeDraw, currentDeck, combo, keyCounts, targetSupporterName) {
    let hand = [...handBeforeDraw].map(c => Object.assign({}, c));
    let deck = [...currentDeck].map(c => Object.assign({}, c));

    if (checkComboSuccess(hand, combo)) return true;

    let supIdx = hand.findIndex(c => c.type === 'draw' && c.supName === targetSupporterName);
    if (supIdx === -1 || targetSupporterName === 'none') {
        return checkComboSuccess(hand, combo);
    }

    let activeSup = hand.splice(supIdx, 1)[0];

    if (activeSup.mechanism === 'discard_all') {
        hand = deck.splice(0, Math.min(activeSup.paramCount, deck.length));
    } else if (activeSup.mechanism === 'shuffle_back') {
        hand.forEach(c => deck.push(c)); 
        starterShuffle(deck);
        hand = deck.splice(0, Math.min(activeSup.paramCount, deck.length));
    } else if (activeSup.mechanism === 'put_bottom') {
        let tempHand = [...hand];
        hand = deck.splice(0, Math.min(activeSup.paramCount, deck.length));
        tempHand.forEach(c => deck.push(c));
    } else if (activeSup.mechanism === 'search_key') {
        let maxSearch = activeSup.paramCount;
        let allowedTargets = activeSup.paramTargets.split(',').map(n => parseInt(n.trim()) - 1);
        let missingIds = [...combo].filter(id => !hand.some(hc => hc.type === 'key' && hc.id === id) && allowedTargets.includes(id));
        missingIds.sort((a, b) => keyCounts[a] - keyCounts[b]);
        
        let searchCount = 0;
        for (let targetId of missingIds) {
            if (searchCount >= maxSearch) break;
            let dIdx = deck.findIndex(dc => dc.type === 'key' && dc.id === targetId);
            if (dIdx !== -1) {
                hand.push(deck.splice(dIdx, 1)[0]);
                starterShuffle(deck);
                searchCount++;
            }
        }
    }

    let secondThin = executeSmartItemThinning(hand, deck, combo);
    return checkComboSuccess(secondThin.hand, combo);
}

// 4. 複合勝率矩陣模擬主控制
function runUltimateSimulation() {
    starterSeed = 1;
    const totalBasic = parseInt(document.getElementById('st-totalBasic').value) || 0;
    const wantBasic = parseInt(document.getElementById('st-wantBasic').value) || 0;
    const unwantedBasic = parseInt(document.getElementById('st-unwantedBasic').value) || 0;
    const normalBasic = Math.max(0, totalBasic - wantBasic - unwantedBasic);

    const keyNames = Array.from(document.querySelectorAll('.st-key-name')).map(el => el.value || "未命名");
    const keyCounts = Array.from(document.querySelectorAll('.st-key-count')).map(el => parseInt(el.value) || 0);
    
    let baseDeck = [];
    let uid = 0;
    
    for(let i=0; i<wantBasic; i++) baseDeck.push({type: 'want_basic', uid: uid++});
    for(let i=0; i<unwantedBasic; i++) baseDeck.push({type: 'unwanted_basic', uid: uid++});
    for(let i=0; i<normalBasic; i++) baseDeck.push({type: 'normal_basic', uid: uid++});
    
    for(let i=0; i<keyCounts.length; i++) {
        for(let j=0; j<keyCounts[i]; j++) baseDeck.push({type: 'key', id: i, uid: uid++});
    }

    const searchRows = document.querySelectorAll('.st-search-row');
    searchRows.forEach(row => {
        const count = parseInt(row.querySelector('.st-search-count').value) || 0;
        
        const mechEl = row.querySelector('.st-search-mechanism');
        const mech = mechEl ? mechEl.value : 'search_deck';
        let lookVal = 60; 
        if (mech === 'look_top') {
            lookVal = parseInt(row.querySelector('.st-search-look').value) || 7;
        }
        
        const pickVal = parseInt(row.querySelector('.st-search-pick').value) || 1;
        
        const targetRaw = row.querySelector('.st-search-targets').value;
        let pTargets = [];
        if (targetRaw && targetRaw.trim() !== '' && targetRaw.trim() !== '-') {
            pTargets = targetRaw.split(',').map(num => parseInt(num.trim()) - 1).filter(n => !isNaN(n));
        }

        for(let j=0; j<count; j++) {
            baseDeck.push({type: 'search', lookCount: lookVal, pickCount: pickVal, targets: pTargets, used: false, uid: uid++});
        }
    });
    
    let supporterNames = [];
    const drawRows = document.querySelectorAll('.st-draw-row');
    drawRows.forEach(row => {
        const name = row.querySelector('.st-draw-name').value || "未知支援者";
        const count = parseInt(row.querySelector('.st-draw-count').value) || 0;
        const mech = row.querySelector('.st-draw-mechanism').value;
        const pCount = parseInt(row.querySelector('.st-draw-count-val').value) || 0;
        const pTargets = row.querySelector('.st-draw-targets').value;
        
        if(!supporterNames.includes(name) && count > 0) supporterNames.push(name);
        for(let j=0; j<count; j++) {
            baseDeck.push({type: 'draw', supName: name, mechanism: mech, paramCount: pCount, paramTargets: pTargets, uid: uid++});
        }
    });

    while(baseDeck.length < 60) baseDeck.push({type: 'junk', uid: uid++});

    function getCombinations(arr) {
        let res = [[]];
        for (let i = 0; i < arr.length; i++) {
            let len = res.length;
            for (let j = 0; j < len; j++) res.push(res[j].concat([arr[i]]));
        }
        return res.filter(item => item.length > 0);
    }

    const indices = Array.from({length: keyNames.length}, (_, i) => i);
    const allCombos = getCombinations(indices);
    
    let resultsData = {};
    allCombos.forEach(c => {
        resultsData[c.join(',')] = { 'none': 0 };
        supporterNames.forEach(name => { resultsData[c.join(',')][name] = 0; });
    });

    const simCount = 10000;
    for (let s = 0; s < simCount; s++) {
        let currentDeck = baseDeck.map(c => Object.assign({}, c));
        starterShuffle(currentDeck);
        let initialHand = currentDeck.splice(0, 7);
        
        if (!initialHand.some(c => c.type === 'want_basic' || c.type === 'unwanted_basic' || c.type === 'normal_basic')) { 
            s--; continue; 
        }

        initialHand.push(currentDeck.splice(0, 1)[0]);
        
        allCombos.forEach(combo => {
            let simHand = initialHand.map(c => Object.assign({}, c));
            let simDeck = currentDeck.map(c => Object.assign({}, c));

            let thinRes = executeSmartItemThinning(simHand, simDeck, combo);

            const k = combo.join(',');
            if (simulateScenario(thinRes.hand, thinRes.deck, combo, keyCounts, 'none')) resultsData[k]['none']++;
            supporterNames.forEach(name => {
                if (simulateScenario(thinRes.hand, thinRes.deck, combo, keyCounts, name)) resultsData[k][name]++;
            });
        });
    }

    // 💡 渲染對比表格（支援中英雙語標頭）
    let isEn = (typeof currentLang !== 'undefined' && currentLang === 'en');
    let headerHtml = `<tr><th>${isEn ? 'Target Combo' : '目標組合'}</th>`;
    supporterNames.forEach(name => { 
        headerHtml += `<th style="background:rgba(0,229,255,0.1); color:#00E5FF;">⚡ ${isEn ? 'Use' : '發動'}【${name}】</th>`; 
    });
    headerHtml += `<th style="background:rgba(255,255,255,0.05); color:#AAA;">🪵 ${isEn ? 'No Supporter' : '完全不開支援者'}</th></tr>`;
    document.getElementById('st-tableHeader').innerHTML = headerHtml;

    let bodyHtml = "";
    let maxOverallProb = 0;
    allCombos.sort((a,b)=>a.length-b.length).forEach(combo => {
        const k = combo.join(',');
        let names = combo.map(idx => `[${keyNames[idx]}]`).join(' + ');
        bodyHtml += `<tr><td style="font-weight:bold; color:#FFD700;">${names}</td>`;
        supporterNames.forEach(name => {
            let pVal = (resultsData[k][name] / simCount) * 100;
            if (pVal > maxOverallProb) maxOverallProb = pVal;
            bodyHtml += `<td class="prob-tag" style="color:#00E5FF; font-weight:bold;">${pVal.toFixed(1)}%</td>`;
        });
        let pNone = ((resultsData[k]['none'] / simCount) * 100).toFixed(1) + "%";
        bodyHtml += `<td style="color:#888;">${pNone}</td></tr>`;
    });
    
    document.getElementById('st-combinationTableBody').innerHTML = bodyHtml;
    document.getElementById('st-analysisResults').style.display = 'block';

    generateOctoTacticalReport({
        totalBasic: totalBasic,
        unwantedBasic: unwantedBasic,
        maxProb: maxOverallProb
    });
}

// 5. 小章魚自動評分與評語生成引擎
function generateOctoTacticalReport(stats) {
    const basicRes = runIndependentBasicSimulation();
    const mulProb = basicRes.mulProb;
    const forcedProb = basicRes.forcedProb;
    const maxProb = stats.maxProb || 0;
    const isEn = (typeof currentLang !== 'undefined' && currentLang === 'en');

    let stabilityScore = Math.max(0, Math.min(100, 100 - (mulProb * 2) - (forcedProb * 1.5)));
    let consistencyScore = Math.max(0, Math.min(100, maxProb));
    let totalScore = Math.round(stabilityScore * 0.5 + consistencyScore * 0.5);

    let rankBadge = isEn ? "A Tier - Stable" : "A 級穩定隊";
    let badgeColor = "#00E5FF";
    if (totalScore >= 90) { rankBadge = isEn ? "SSS Tier - Godly" : "SSS 級神隊"; badgeColor = "#FFD700"; }
    else if (totalScore >= 80) { rankBadge = isEn ? "S Tier - Meta" : "S 級主流隊"; badgeColor = "#FF80AB"; }
    else if (totalScore < 65) { rankBadge = isEn ? "B Tier - Bricky" : "B 級事故隊"; badgeColor = "#FF5252"; }

    let comments = [];
    if (mulProb > 10) {
        comments.push(isEn 
            ? `⚠️ **High Mulligan Risk**: Mulligan rate is ${mulProb.toFixed(1)}%. Consider adding 1-2 more Basic Pokémon!`
            : `⚠️ **起手事故風險過高**：無怪重抽（Mulligan）率達 ${mulProb.toFixed(1)}%，建議增加 1~2 張基礎寶可夢！`);
    } else {
        comments.push(isEn
            ? `✅ **Solid Starter Stability**: Low Mulligan rate of ${mulProb.toFixed(1)}%. Clean opening!`
            : `✅ **起手相當穩定**：無怪重抽率低至 ${mulProb.toFixed(1)}%，開局不卡怪！`);
    }

    if (forcedProb > 15) {
        comments.push(isEn
            ? `👻 **Vulnerable Starters**: Forced start rate with support Pokémon is ${forcedProb.toFixed(1)}%. Beware of early Prize card loss!`
            : `👻 **小心鬼抓人起站**：迫出後排功能怪起站的機率高達 ${forcedProb.toFixed(1)}%，小心送出獎賞卡！`);
    }

    if (maxProb >= 80) {
        comments.push(isEn
            ? `🔥 **High Explosive Setup**: First turn execution rate exceeds ${maxProb.toFixed(1)}% with Supporter lines!`
            : `🔥 **爆發天胡率極強**：搭配支援者後首波展開成功率突破 ${maxProb.toFixed(1)}%！`);
    } else {
        comments.push(isEn
            ? `🎯 **Optimization Room**: Current max setup consistency is ${maxProb.toFixed(1)}%. Consider adding drawing or search items.`
            : `🎯 **戰術連鎖可優化**：當前極限展開率為 ${maxProb.toFixed(1)}%，可嘗試增加過牌或檢索卡。`);
    }

    document.getElementById('octo-score-number').innerText = totalScore;
    document.getElementById('octo-rank-badge').innerText = rankBadge;
    document.getElementById('octo-rank-badge').style.borderColor = badgeColor;
    document.getElementById('octo-rank-badge').style.color = badgeColor;

    document.getElementById('octo-bar-stability').style.width = stabilityScore + "%";
    document.getElementById('octo-score-stability').innerText = Math.round(stabilityScore) + (isEn ? " pts" : " 分");

    document.getElementById('octo-bar-consistency').style.width = consistencyScore + "%";
    document.getElementById('octo-score-consistency').innerText = Math.round(consistencyScore) + (isEn ? " pts" : " 分");

    let commentsContainer = document.getElementById('octo-comments-list');
    commentsContainer.innerHTML = comments.map(c => `<li style="margin-bottom:6px;">${c}</li>`).join('');

    document.getElementById('octo-report-card').style.display = 'block';
}

function exportOctoReportCard() {
    const cardEl = document.getElementById('octo-report-card');
    if (typeof html2canvas !== 'undefined') {
        html2canvas(cardEl, { backgroundColor: '#161B22', scale: 2 }).then(canvas => {
            let link = document.createElement('a');
            link.download = 'PTCG_Octoplus_Report.png';
            link.href = canvas.toDataURL();
            link.click();
        });
    } else {
        alert("截圖元件載入中，請稍後重試。");
    }
}

function addKeyCardRow(name = "", qty = 2) {
    if (!window.isUserPro) {
        const currentCount = document.querySelectorAll('.st-key-row').length;
        if (currentCount >= 1) {
            document.getElementById('sub-modal').style.display = 'flex';
            return;
        }
    }

    const container = document.getElementById('st-keyCardsContainer');
    const num = container.getElementsByClassName('st-key-row').length + 1;
    const div = document.createElement('div');
    const inputId = 'st_key_' + Date.now() + Math.floor(Math.random()*1000); 
    div.className = 'st-key-row target-row';
    div.innerHTML = `
        <span style="font-weight:bold; color:#FFD700; min-width:60px;">[標籤:${num}]</span>
        <div style="flex:0.8; display:flex; gap:4px; align-items: center; max-width: 200px;">
            <input type="text" id="${inputId}" value="${name}" placeholder="重點卡名" class="st-key-name">
            <button class="btn-secondary" style="padding:0 8px; height: 35px; font-size:12px; border-radius:4px;" title="從牌組挑選" onclick="openSelector('st_input_${inputId}')">🔍</button>
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; margin-left: 10px; flex:1;">
            <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">牌組投入</span>
            <input type="number" value="${qty}" min="1" max="4" class="st-key-count" style="width:50px; text-align:center; padding:4px;">
        </div>
        <button class="btn-secondary" style="width:28px; height:28px; padding:0; border-radius:50%; color:#FF5252; margin-left:10px;" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
}

function addSearchCardRow(name = "", qty = 2, mech = "search_deck", look = 7, pick = 1, targets = "1,2") {
    if (!window.isUserPro) {
        const currentCount = document.querySelectorAll('.st-search-row').length;
        if (currentCount >= 1) {
            document.getElementById('sub-modal').style.display = 'flex';
            return;
        }
    }

    const container = document.getElementById('st-searchCardsContainer');
    const div = document.createElement('div');
    const inputId = 'st_search_' + Date.now() + Math.floor(Math.random()*1000);
    div.className = 'st-search-row target-row';
    div.innerHTML = `
        <div style="flex:0.8; display:flex; gap:4px; align-items: center; max-width: 180px;">
            <input type="text" id="${inputId}" value="${name}" placeholder="物品卡名" class="st-search-name">
            <button class="btn-secondary" style="padding:0 8px; height: 35px; font-size:12px; border-radius:4px;" title="從牌組挑選" onclick="openSelector('st_input_${inputId}')">🔍</button>
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; margin: 0 5px;">
            <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">牌組投入</span>
            <input type="number" value="${qty}" class="st-search-count" style="width:45px; text-align:center; padding:4px;">
        </div>
        <div style="display:flex; flex-direction:column; flex:1; margin: 0 5px;">
            <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">發動機制</span>
            <select class="st-search-mechanism" onchange="toggleSearchMech(this)" style="padding:4px; font-size:13px;">
                <option value="search_deck" ${mech==='search_deck'?'selected':''}>指定檢索整副牌庫</option>
                <option value="look_top" ${mech==='look_top'?'selected':''}>看牌庫頂 X 張</option>
            </select>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
            <div class="look-container" style="display:${mech==='search_deck'?'none':'flex'}; flex-direction:column; align-items:center;">
                <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">看幾張</span>
                <input type="number" value="${look}" class="st-search-look" style="width:45px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span class="pick-label" style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">${mech==='search_deck'?'檢索張數':'選幾張'}</span>
                <input type="number" value="${pick}" class="st-search-pick" style="width:45px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center; margin-left: 4px;">
                <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">抓取標籤</span>
                <input type="text" value="${targets}" placeholder="(如1,2)" class="st-search-targets" style="width:60px; text-align:center; padding:4px;">
            </div>
        </div>
        <button class="btn-secondary" style="width:28px; height:28px; padding:0; border-radius:50%; color:#FF5252; margin-left:8px;" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
}

function addDrawCardRow(name = "", qty = 2, mech = "shuffle_back", val = 5, targets = "-") {
    if (!window.isUserPro) {
        const currentCount = document.querySelectorAll('.st-draw-row').length;
        if (currentCount >= 1) {
            document.getElementById('sub-modal').style.display = 'flex';
            return;
        }
    }

    const container = document.getElementById('st-drawCardsContainer');
    const div = document.createElement('div');
    const inputId = 'st_draw_' + Date.now() + Math.floor(Math.random()*1000);
    div.className = 'st-draw-row target-row';
    div.innerHTML = `
        <div style="flex:0.8; display:flex; gap:4px; align-items: center; max-width: 180px;">
            <input type="text" id="${inputId}" value="${name}" placeholder="支援者卡" class="st-draw-name">
            <button class="btn-secondary" style="padding:0 8px; height: 35px; font-size:12px; border-radius:4px;" title="從牌組挑選" onclick="openSelector('st_input_${inputId}')">🔍</button>
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; margin: 0 5px;">
            <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">牌組投入</span>
            <input type="number" value="${qty}" class="st-draw-count" style="width:45px; text-align:center; padding:4px;">
        </div>
        <div style="display:flex; flex-direction:column; flex:1; margin: 0 5px;">
            <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">發動機制</span>
            <select class="st-draw-mechanism" onchange="this.parentElement.nextElementSibling.querySelector('.st-draw-targets').disabled = (this.value !== 'search_key')" style="padding:4px; font-size:13px;">
                <option value="shuffle_back" ${mech==='shuffle_back'?'selected':''}>洗回抽 X 張</option>
                <option value="discard_all" ${mech==='discard_all'?'selected':''}>全丟抽 X 張</option>
                <option value="put_bottom" ${mech==='put_bottom'?'selected':''}>放回抽 X 張</option>
                <option value="search_key" ${mech==='search_key'?'selected':''}>指定檢索標籤</option>
            </select>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">抽幾張</span>
                <input type="number" value="${val}" class="st-draw-count-val" style="width:45px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span style="font-size:14px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">抓標籤</span>
                <input type="text" value="${targets}" class="st-draw-targets" ${mech!=='search_key'?'disabled':''} style="width:50px; text-align:center; padding:4px;">
            </div>
        </div>
        <button class="btn-secondary" style="width:28px; height:28px; padding:0; border-radius:50%; color:#FF5252; margin-left:8px;" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
}

function syncStarterToolFromDeck(deckDict) {
    if (!deckDict || Object.keys(deckDict).length === 0) return;

    let basicCount = 0;
    Object.keys(deckDict).forEach(k => {
        let card = deckDict[k];
        let name = card.name;
        if (name.includes('ex') || name.includes('V') || name.includes('龍') || name.includes('怪') || name.includes('蟲') || name.includes('弟')) {
            basicCount += card.qty;
        }
    });

    document.getElementById('st-totalBasic').value = Math.max(8, basicCount || 12);
}
