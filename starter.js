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

// 1. 獨立 A 區開局起站與 Mulligan 模擬
function runIndependentBasicSimulation() {
    starterSeed = 42; 
    const totalBasic = parseInt(document.getElementById('st-totalBasic').value) || 0;
    const wantBasic = parseInt(document.getElementById('st-wantBasic').value) || 0;
    const unwantedBasic = parseInt(document.getElementById('st-unwantedBasic').value) || 0;
    const normalBasic = Math.max(0, totalBasic - wantBasic - unwantedBasic);

    let basicPool = [];
    for(let i=0; i<wantBasic; i++) basicPool.push('want');
    for(let i=0; i<unwantedBasic; i++) basicPool.push('unwanted');
    for(let i=0; i<normalBasic; i++) basicPool.push('normal');
    while(basicPool.length < 60) basicPool.push('other');

    const simCount = 50000;
    let mulligans = 0, perfectStarts = 0, forcedStarts = 0;

    for (let s = 0; s < simCount; s++) {
        let deck = [...basicPool];
        starterShuffle(deck);
        let initialHand = deck.slice(0, 7);

        let hasWant = initialHand.includes('want');
        let hasUnwanted = initialHand.includes('unwanted');
        let hasNormal = initialHand.includes('normal');

        if (!hasWant && !hasUnwanted && !hasNormal) {
            mulligans++;
        } else if (hasWant || hasNormal) {
            perfectStarts++;
        } else if (hasUnwanted && !hasNormal && !hasWant) {
            forcedStarts++;
        }
    }

    const mulProb = (mulligans / simCount) * 100;
    const perfProb = (perfectStarts / simCount) * 100;
    const forcedProb = (forcedStarts / simCount) * 100;

    document.getElementById('st-mulliganProb').innerText = mulProb.toFixed(2) + "%";
    document.getElementById('st-perfectStartProb').innerText = perfProb.toFixed(2) + "%";
    document.getElementById('st-forcedStartProb').innerText = forcedProb.toFixed(2) + "%";
    document.getElementById('st-basicResultArea').style.display = 'block';

    return { mulProb, perfProb, forcedProb };
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
        
        // 💡 判斷機制：如果是檢索整副牌庫，直接將 Look 強制設為 60 張 (觸發全牌庫智慧檢索)
        const mechEl = row.querySelector('.st-search-mechanism');
        const mech = mechEl ? mechEl.value : 'search_deck';
        let lookVal = 60; 
        if (mech === 'look_top') {
            lookVal = parseInt(row.querySelector('.st-search-look').value) || 7;
        }
        
        const pickVal = parseInt(row.querySelector('.st-search-pick').value) || 1;
        
        // 標籤解析防呆處理
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

    // 渲染對比表格
    let headerHtml = `<tr><th>目標組合</th>`;
    supporterNames.forEach(name => { headerHtml += `<th style="background:rgba(0,229,255,0.1); color:#00E5FF;">⚡ 發動【${name}】</th>`; });
    headerHtml += `<th style="background:rgba(255,255,255,0.05); color:#AAA;">🪵 完全不開支援者</th></tr>`;
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

    // 觸發小章魚自動評分引擎
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

    // 分數計算公式
    let stabilityScore = Math.max(0, Math.min(100, 100 - (mulProb * 2) - (forcedProb * 1.5)));
    let consistencyScore = Math.max(0, Math.min(100, maxProb));
    let totalScore = Math.round(stabilityScore * 0.5 + consistencyScore * 0.5);

    let rankBadge = "A 級穩定隊";
    let badgeColor = "#00E5FF";
    if (totalScore >= 90) { rankBadge = "SSS 級神隊"; badgeColor = "#FFD700"; }
    else if (totalScore >= 80) { rankBadge = "S 級主流隊"; badgeColor = "#FF80AB"; }
    else if (totalScore < 65) { rankBadge = "B 級事故隊"; badgeColor = "#FF5252"; }

    let comments = [];
    if (mulProb > 10) {
        comments.push(`⚠️ **起手事故風險過高**：無怪重抽（Mulligan）率達 ${mulProb.toFixed(1)}%，建議增加 1~2 張基礎寶可夢！`);
    } else {
        comments.push(`✅ **起手相當穩定**：無怪重抽率低至 ${mulProb.toFixed(1)}%，開局不卡怪！`);
    }

    if (forcedProb > 15) {
        comments.push(`👻 **小心鬼抓人起站**：迫出後排功能怪起站的機率高達 ${forcedProb.toFixed(1)}%，小心送出獎賞卡！`);
    }

    if (maxProb >= 80) {
        comments.push(`🔥 **爆發天胡率極強**：搭配支援者後首波展開成功率突破 ${maxProb.toFixed(1)}%！`);
    } else {
        comments.push(`🎯 **戰術連鎖可優化**：當前極限展開率為 ${maxProb.toFixed(1)}%，可嘗試增加過牌或檢索卡。`);
    }

    // 更新評分卡 UI
    document.getElementById('octo-score-number').innerText = totalScore;
    document.getElementById('octo-rank-badge').innerText = rankBadge;
    document.getElementById('octo-rank-badge').style.borderColor = badgeColor;
    document.getElementById('octo-rank-badge').style.color = badgeColor;

    document.getElementById('octo-bar-stability').style.width = stabilityScore + "%";
    document.getElementById('octo-score-stability').innerText = Math.round(stabilityScore) + " 分";

    document.getElementById('octo-bar-consistency').style.width = consistencyScore + "%";
    document.getElementById('octo-score-consistency').innerText = Math.round(consistencyScore) + " 分";

    let commentsContainer = document.getElementById('octo-comments-list');
    commentsContainer.innerHTML = comments.map(c => `<li style="margin-bottom:6px;">${c}</li>`).join('');

    document.getElementById('octo-report-card').style.display = 'block';
}

// 6. 截圖分享評分卡
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

// 7. 動態填入預設卡牌資料列輔助函式 (加入權限阻擋與選卡按鈕)

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
        <div style="flex:1; display:flex; gap:4px; align-items: center;">
            <input type="text" id="${inputId}" value="${name}" placeholder="重點卡名" class="st-key-name">
            <button class="btn-secondary" style="padding:0 8px; height: 35px; font-size:12px; border-radius:4px;" title="從牌組挑選" onclick="openSelector('st_input_${inputId}')">🔍</button>
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; margin-left: 10px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">牌組投入</span>
            <input type="number" value="${qty}" min="1" max="4" class="st-key-count" style="width:50px; text-align:center; padding:4px;">
        </div>
        <button class="btn-secondary" style="width:28px; height:28px; padding:0; border-radius:50%; color:#FF5252; margin-left:10px;" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
}
// 💡 控制物品卡「看X張」欄位顯示/隱藏的切換器
window.toggleSearchMech = function(selectEl) {
    const row = selectEl.closest('.st-search-row');
    const lookContainer = row.querySelector('.look-container');
    const pickLabel = row.querySelector('.pick-label');
    if (selectEl.value === 'search_deck') {
        lookContainer.style.display = 'none';
        pickLabel.innerText = '抓幾張';
    } else {
        lookContainer.style.display = 'flex';
        pickLabel.innerText = '看幾張';
    }
};
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
        <div style="flex:1; display:flex; gap:4px; align-items: center;">
            <input type="text" id="${inputId}" value="${name}" placeholder="物品卡名" class="st-search-name">
            <button class="btn-secondary" style="padding:0 8px; height: 35px; font-size:12px; border-radius:4px;" title="從牌組挑選" onclick="openSelector('st_input_${inputId}')">🔍</button>
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; margin: 0 5px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">牌組投入</span>
            <input type="number" value="${qty}" class="st-search-count" style="width:45px; text-align:center; padding:4px;">
        </div>
        <div style="display:flex; flex-direction:column; flex:1.2; margin: 0 5px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">效果機制</span>
            <select class="st-search-mechanism" onchange="toggleSearchMech(this)" style="padding:4px; font-size:12px;">
                <option value="search_deck" ${mech==='search_deck'?'selected':''}>檢索整副牌庫</option>
                <option value="look_top" ${mech==='look_top'?'selected':''}>看牌庫頂 X 張</option>
            </select>
        </div>
        <div style="display:flex; align-items:center; gap:4px;">
            <div class="look-container" style="display:${mech==='search_deck'?'none':'flex'}; flex-direction:column; align-items:center;">
                <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">看幾張</span>
                <input type="number" value="${look}" class="st-search-look" style="width:45px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span class="pick-label" style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">${mech==='search_deck'?'抓幾張':'選幾張'}</span>
                <input type="number" value="${pick}" class="st-search-pick" style="width:45px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center; margin-left: 4px;">
                <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">目標標籤</span>
                <input type="text" value="${targets}" placeholder="(如1,2)" class="st-search-targets" style="width:50px; text-align:center; padding:4px;">
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
        <div style="flex:1; display:flex; gap:4px; align-items: center;">
            <input type="text" id="${inputId}" value="${name}" placeholder="支援者卡" class="st-draw-name">
            <button class="btn-secondary" style="padding:0 8px; height: 35px; font-size:12px; border-radius:4px;" title="從牌組挑選" onclick="openSelector('st_input_${inputId}')">🔍</button>
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; margin: 0 5px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">牌組投入</span>
            <input type="number" value="${qty}" class="st-draw-count" style="width:45px; text-align:center; padding:4px;">
        </div>
        <div style="display:flex; flex-direction:column; flex:1.5; margin: 0 5px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">發動效果機制</span>
            <select class="st-draw-mechanism" onchange="this.parentElement.nextElementSibling.querySelector('.st-draw-targets').disabled = (this.value !== 'search_key')" style="padding:4px; font-size:12px;">
                <option value="shuffle_back" ${mech==='shuffle_back'?'selected':''}>洗回抽 X 張</option>
                <option value="discard_all" ${mech==='discard_all'?'selected':''}>全丟抽 X 張</option>
                <option value="put_bottom" ${mech==='put_bottom'?'selected':''}>放回抽 X 張</option>
                <option value="search_key" ${mech==='search_key'?'selected':''}>指定檢索標籤</option>
            </select>
        </div>
        <div style="display:flex; align-items:center; gap:4px;">
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">抽幾張</span>
                <input type="number" value="${val}" class="st-draw-count-val" style="width:45px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:2px;">抓標籤</span>
                <input type="text" value="${targets}" class="st-draw-targets" ${mech!=='search_key'?'disabled':''} style="width:45px; text-align:center; padding:4px;">
            </div>
        </div>
        <button class="btn-secondary" style="width:28px; height:28px; padding:0; border-radius:50%; color:#FF5252; margin-left:8px;" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
}

// 8. 品牌同步：從 app.js 的 deckDict 自動帶入基礎怪與卡片資料
function syncStarterToolFromDeck(deckDict) {
    if (!deckDict || Object.keys(deckDict).length === 0) return;

    let basicCount = 0;
    let items = [];
    let supporters = [];

    Object.keys(deckDict).forEach(k => {
        let card = deckDict[k];
        let name = card.name;
        // 簡易屬性猜測或自動帶入
        if (name.includes('ex') || name.includes('V') || name.includes('龍') || name.includes('怪') || name.includes('蟲') || name.includes('弟')) {
            basicCount += card.qty;
        }
    });

    document.getElementById('st-totalBasic').value = Math.max(8, basicCount || 12);
}
