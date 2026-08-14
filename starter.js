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

// 1. 獨立 A 區開局起站與 Mulligan 模擬 (超高速數學精算與全新階層版)
function runIndependentBasicSimulation() {
    // 取得輸入數值
    const B = parseInt(document.getElementById('st-totalBasic').value) || 0;
    const W = parseInt(document.getElementById('st-wantBasic').value) || 0;
    const U = parseInt(document.getElementById('st-unwantedBasic').value) || 0;

    // 防呆機制
    if (B > 60 || W > B || U > B || (W + U) > B) {
        alert("輸入數值有誤：基礎怪總數不可超過 60，且 Want + Unwanted 不能超過總基礎怪！");
        return { mulProb: 0, perfProb: 0, normalProb: 0, forcedProb: 0 };
    }

    // 數學組合公式 (C取K)
    function C(n, k) {
        if (k < 0 || k > n) return 0;
        if (k === 0 || k === n) return 1;
        k = Math.min(k, n - k);
        let c = 1;
        for (let i = 1; i <= k; i++) c = c * (n - i + 1) / i;
        return c;
    }

    let totalHands = C(60, 7);

    // ==========================================
    // 核心邏輯運算 (依照站長的完美定義)
    // ==========================================

    // 1. 無怪重抽率 (7張全是非基礎怪)
    let waysMulligan = C(60 - B, 7);
    let pMulligan = waysMulligan / totalHands;

    // 2. 正常開局率 (有抽到基礎怪)
    let waysValid = totalHands - waysMulligan;
    let pValid = waysValid / totalHands;

    // --- 正常開局的 3 個分支 ---
    
    // 分支 1：理想怪起站率 / 完美起站率 (抽到至少 1 張 Want)
    let waysNoWant = C(60 - W, 7);
    let waysPerfect = totalHands - waysNoWant;
    let pPerfect = waysPerfect / totalHands;

    // 分支 2：雷區怪起站 (只有雷區怪，0 Want, 0 普通基礎怪)
    // 算法：從 (非基礎怪 + 雷區怪) 中抽 7 張，並扣掉全是廢牌 (Mulligan) 的情況
    let waysUnwantedAndJunk = C(60 - B + U, 7);
    let waysForced = waysUnwantedAndJunk - waysMulligan;
    let pForced = waysForced / totalHands;

    // 分支 3：非理想、雷區基礎怪起站率 (妥協起站)
    // 算法：正常開局總數 - 完美起站數 - 雷區起站數
    let waysNormalBasic = waysValid - waysPerfect - waysForced;
    let pNormalBasic = waysNormalBasic / totalHands;

    // ==========================================
    // 換算百分比與寫入畫面
    // ==========================================
    const mulProb = pMulligan * 100;
    const validProb = pValid * 100;
    const perfProb = pPerfect * 100;
    const normProb = pNormalBasic * 100;
    const forcedProb = pForced * 100;

    // 條件機率 (佔「有開局」的比例，供小字參考)
    const condPerf = (waysPerfect / waysValid) * 100 || 0;
    const condNorm = (waysNormalBasic / waysValid) * 100 || 0;
    const condForced = (waysForced / waysValid) * 100 || 0;

    // 寫入對應的 HTML ID
    document.getElementById('st-mulliganProb').innerText = mulProb.toFixed(2) + "%";
    document.getElementById('st-validStartProb').innerText = validProb.toFixed(2) + "%";
    
    document.getElementById('st-perfectStartProb-top').innerText = perfProb.toFixed(2) + "%";
    document.getElementById('st-validStartProb-sub').innerText = "共 " + validProb.toFixed(2) + "%";
    
    document.getElementById('st-perfectStartProb-branch').innerText = perfProb.toFixed(2) + "%";
    document.getElementById('st-perfectStartCond').innerText = "佔開局的 " + condPerf.toFixed(1) + "%";
    
    document.getElementById('st-forcedStartProb').innerText = forcedProb.toFixed(2) + "%";
    document.getElementById('st-forcedStartCond').innerText = "佔開局的 " + condForced.toFixed(1) + "%";
    
    document.getElementById('st-normalStartProb').innerText = normProb.toFixed(2) + "%";
    document.getElementById('st-normalStartCond').innerText = "佔開局的 " + condNorm.toFixed(1) + "%";

    document.getElementById('st-basicResultArea').style.display = 'block';

    // 回傳給下方的小章魚戰術評分引擎
    return { mulProb, perfProb, normalProb: normProb, forcedProb };
}

// 2. 判定是否達成起手重點卡目標
function checkComboSuccess(hand, combo) {
    let staticKeyIds = hand.filter(c => c.type === 'key').map(c => c.id);
    return combo.every(id => staticKeyIds.includes(id));
}

// 💡 輔助函數：切換發動機制的 UI 文字顯示
function toggleSearchMech(selectEl) {
    const row = selectEl.closest('.st-search-row');
    const lookContainer = row.querySelector('.look-container');
    const pickLabel = row.querySelector('.pick-label');
    if (selectEl.value === 'search_deck') {
        lookContainer.style.display = 'none';
        pickLabel.innerText = '檢索張數';
    } else if (selectEl.value === 'conditional_draw') {
        lookContainer.style.display = 'none';
        pickLabel.innerText = '抽幾張';
    } else {
        lookContainer.style.display = 'flex';
        pickLabel.innerText = '選幾張';
    }
}

// 3. 全新 AI 代打模擬劇本 (動態迴圈 + 順序排程)
function runDynamicScenario(initialHand, currentDeck, combo, keyCounts, targetSupporterName) {
    let hand = [...initialHand].map(c => Object.assign({}, c));
    let deck = [...currentDeck].map(c => Object.assign({}, c));
    let costHand = [...hand]; // 用於扣除消耗條件卡
    let supporterUsed = false;

    // 起手就天胡達成，直接判定成功
    if (checkComboSuccess(hand, combo)) return true;

    let actionTriggered = true;
    while(actionTriggered) {
        actionTriggered = false;

        // 掃描手上可以發動的動作卡，並過濾掉非目標的支援者
        let availableActions = [];
        for (let i = 0; i < hand.length; i++) {
            let card = hand[i];
            if ((card.type === 'search' || card.type === 'draw') && !card.used) {
                if (card.type === 'draw' && card.supName !== targetSupporterName) continue;
                availableActions.push({ cardIdx: i, ...card });
            }
        }

        // 依照玩家設定的順序由小到大排序
        availableActions.sort((a, b) => (a.step || 1) - (b.step || 1));

        for (let action of availableActions) {
            let cardInHand = hand[action.cardIdx];
            if (cardInHand.used) continue;

            let executed = false;

            if (action.type === 'search') {
                if (action.mechanism === 'conditional_draw') {
                    // 條件組合技：檢查是否有對應標籤的代價卡 (例如：草能)
                    let costIdx = costHand.findIndex(hc => hc.type === 'key' && action.targets.includes(hc.id));
                    if (costIdx !== -1) {
                        costHand.splice(costIdx, 1); // 消耗代價卡
                        executed = true;
                        let drawn = deck.splice(0, Math.min(action.pickCount, deck.length));
                        hand.push(...drawn);
                        costHand.push(...drawn);
                    }
                } else {
                    // 一般檢索或看牌庫頂
                    let missingComboIds = combo.filter(id => !hand.some(hc => hc.type === 'key' && hc.id === id));
                    let searchPool = [];
                    let isFullDeck = (action.mechanism === 'search_deck' || action.lookCount >= deck.length);
                    
                    if (isFullDeck) { searchPool = [...deck]; } 
                    else { searchPool = deck.splice(0, Math.min(action.lookCount, deck.length)); }

                    if (searchPool.length > 0) {
                        let pickMax = action.pickCount;
                        let allowedTargets = action.targets || [];
                        let criticalPickedCount = 0;

                        // 優先抓缺少的目標卡
                        for (let i = 0; i < searchPool.length; i++) {
                            if (criticalPickedCount >= pickMax) break;
                            let c = searchPool[i];
                            if (c.type === 'key' && allowedTargets.includes(c.id) && missingComboIds.includes(c.id)) {
                                hand.push(c); costHand.push(c);
                                searchPool.splice(i, 1); i--;
                                criticalPickedCount++;
                                missingComboIds = combo.filter(id => !hand.some(hc => hc.type === 'key' && hc.id === id));
                            }
                        }

                        // 其次抓任何允許的標籤
                        for (let i = 0; i < searchPool.length; i++) {
                            if (criticalPickedCount >= pickMax) break;
                            let c = searchPool[i];
                            if (c.type === 'key' && allowedTargets.includes(c.id)) {
                                hand.push(c); costHand.push(c);
                                searchPool.splice(i, 1); i--;
                                criticalPickedCount++;
                            }
                        }

                        // 若未指定目標，無條件抽牌
                        if (allowedTargets.length === 0 || (allowedTargets.length === 1 && isNaN(allowedTargets[0]))) {
                            let freeDraw = searchPool.splice(0, Math.min(pickMax - criticalPickedCount, searchPool.length));
                            freeDraw.forEach(c => { hand.push(c); costHand.push(c); });
                        }

                        if (isFullDeck) { deck = [...searchPool]; starterShuffle(deck); } 
                        else { searchPool.forEach(c => deck.push(c)); starterShuffle(deck); }
                        executed = true;
                    }
                }
            } else if (action.type === 'draw') {
                if (!supporterUsed) {
                    supporterUsed = true;
                    executed = true;

                    if (action.mechanism === 'discard_all') {
                        hand = deck.splice(0, Math.min(action.paramCount, deck.length));
                        costHand = [...hand];
                    } else if (action.mechanism === 'shuffle_back') {
                        let tempHand = [...hand];
                        tempHand.forEach(c => deck.push(c));
                        starterShuffle(deck);
                        hand = deck.splice(0, Math.min(action.paramCount, deck.length));
                        costHand = [...hand];
                    } else if (action.mechanism === 'put_bottom') {
                        let tempHand = [...hand];
                        hand = deck.splice(0, Math.min(action.paramCount, deck.length));
                        tempHand.forEach(c => deck.push(c));
                        costHand = [...hand];
                    } else if (action.mechanism === 'search_key') {
                        let maxSearch = action.paramCount;
                        let allowedTargets = action.targets || [];
                        let missingIds = [...combo].filter(id => !hand.some(hc => hc.type === 'key' && hc.id === id) && allowedTargets.includes(id));
                        missingIds.sort((a, b) => keyCounts[a] - keyCounts[b]);
                        
                        let searchCount = 0;
                        for (let targetId of missingIds) {
                            if (searchCount >= maxSearch) break;
                            let dIdx = deck.findIndex(dc => dc.type === 'key' && dc.id === targetId);
                            if (dIdx !== -1) {
                                let drawn = deck.splice(dIdx, 1)[0];
                                hand.push(drawn); costHand.push(drawn);
                                starterShuffle(deck);
                                searchCount++;
                            }
                        }
                    }
                }
            }

            if (executed) {
                cardInHand.used = true;
                actionTriggered = true; // 觸發成功，迴圈將重新啟動掃描新牌
                if (checkComboSuccess(hand, combo)) return true; // 提早達成即結束
                break; 
            }
        }
    }
    return checkComboSuccess(hand, combo);
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
    searchRows.forEach((row, idx) => {
        const count = parseInt(row.querySelector('.st-search-count').value) || 0;
        const step = parseInt(row.querySelector('.st-search-step').value) || (idx + 1); // 💡 抓取發動順序
        
        const mechEl = row.querySelector('.st-search-mechanism');
        const mech = mechEl ? mechEl.value : 'search_deck';
        let lookVal = 60; 
        if (mech === 'look_top') { lookVal = parseInt(row.querySelector('.st-search-look').value) || 7; }
        
        const pickVal = parseInt(row.querySelector('.st-search-pick').value) || 1;
        const targetRaw = row.querySelector('.st-search-targets').value;
        let pTargets = [];
        if (targetRaw && targetRaw.trim() !== '' && targetRaw.trim() !== '-') {
            pTargets = targetRaw.split(',').map(num => parseInt(num.trim()) - 1).filter(n => !isNaN(n));
        }

        for(let j=0; j<count; j++) {
            // 💡 將 step, mechanism 加入到陣列中
            baseDeck.push({type: 'search', step: step, mechanism: mech, lookCount: lookVal, pickCount: pickVal, targets: pTargets, used: false, uid: uid++});
        }
    });
    
    let supporterNames = [];
    const drawRows = document.querySelectorAll('.st-draw-row');
    drawRows.forEach((row, idx) => {
        const name = row.querySelector('.st-draw-name').value || "未知支援者";
        const count = parseInt(row.querySelector('.st-draw-count').value) || 0;
        const step = parseInt(row.querySelector('.st-draw-step').value) || (searchRows.length + idx + 1); // 💡 抓取發動順序
        
        const mech = row.querySelector('.st-draw-mechanism').value;
        const pCount = parseInt(row.querySelector('.st-draw-count-val').value) || 0;
        const pTargetsRaw = row.querySelector('.st-draw-targets').value;
        let pTargets = [];
        if (pTargetsRaw && pTargetsRaw.trim() !== '' && pTargetsRaw.trim() !== '-') {
            pTargets = pTargetsRaw.split(',').map(num => parseInt(num.trim()) - 1).filter(n => !isNaN(n));
        }
        
        if(!supporterNames.includes(name) && count > 0) supporterNames.push(name);
        for(let j=0; j<count; j++) {
            // 💡 將 step, targets 加入陣列
            baseDeck.push({type: 'draw', supName: name, step: step, mechanism: mech, paramCount: pCount, targets: pTargets, uid: uid++});
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

            const k = combo.join(',');
            // 💡 全部改用新寫好的 runDynamicScenario 動態迴圈函數！
            if (runDynamicScenario(simHand, simDeck, combo, keyCounts, 'none')) resultsData[k]['none']++;
            supporterNames.forEach(name => {
                if (runDynamicScenario(simHand, simDeck, combo, keyCounts, name)) resultsData[k][name]++;
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

    // 💡 1. 計算無怪重抽 (Mulligan) 的扣分
    // 邏輯：10% 以內每 1% 扣 1 分；超過 10% 的部分，每 1% 扣 2 分
    let mulPenalty = 0;
    if (mulProb <= 10) {
        mulPenalty = mulProb * 1;
    } else {
        mulPenalty = 10 + ((mulProb - 10) * 2);
    }

    // 💡 2. 計算最終起手穩定度
    // 滿分 100，扣除 Mulligan 懲罰，再扣除雷區起站的懲罰 (維持原本每 1% 扣 1.5 分)，最低 0 分
    let stabilityScore = Math.max(0, Math.min(100, 100 - mulPenalty - (forcedProb * 1.5)));
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

function addSearchCardRow(name = "", qty = 2, step = 1, mech = "search_deck", look = 7, pick = 1, targets = "1,2") {
    if (!window.isUserPro) {
        const currentCount = document.querySelectorAll('.st-search-row').length;
        if (currentCount >= 1) { document.getElementById('sub-modal').style.display = 'flex'; return; }
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
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">順序</span>
            <input type="number" value="${step}" class="st-search-step" style="width:40px; text-align:center; padding:4px; background:#0D1117; color:#FFD700; border:1px solid #30363D; border-radius:4px; font-weight:bold;">
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; margin: 0 5px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">牌組投入</span>
            <input type="number" value="${qty}" class="st-search-count" style="width:40px; text-align:center; padding:4px;">
        </div>
        <div style="display:flex; flex-direction:column; flex:1; margin: 0 5px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">發動機制</span>
            <select class="st-search-mechanism" onchange="if(typeof toggleSearchMech==='function')toggleSearchMech(this);" style="padding:4px; font-size:12px;">
                <option value="search_deck" ${mech==='search_deck'?'selected':''}>指定檢索整副牌庫</option>
                <option value="look_top" ${mech==='look_top'?'selected':''}>看牌庫頂 X 張</option>
                <option value="conditional_draw" ${mech==='conditional_draw'?'selected':''}>條件組合技 (消耗標籤抽牌)</option>
            </select>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
            <div class="look-container" style="display:${mech==='search_deck'||mech==='conditional_draw'?'none':'flex'}; flex-direction:column; align-items:center;">
                <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">看幾張</span>
                <input type="number" value="${look}" class="st-search-look" style="width:40px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span class="pick-label" style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">${mech==='search_deck'?'檢索張數':(mech==='conditional_draw'?'抽幾張':'選幾張')}</span>
                <input type="number" value="${pick}" class="st-search-pick" style="width:40px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center; margin-left: 4px;">
                <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">條件/目標標籤</span>
                <input type="text" value="${targets}" placeholder="(如1,2)" class="st-search-targets" style="width:60px; text-align:center; padding:4px;">
            </div>
        </div>
        <button class="btn-secondary" style="width:24px; height:24px; padding:0; border-radius:50%; color:#FF5252; margin-left:8px;" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
}

function addDrawCardRow(name = "", qty = 2, mech = "shuffle_back", val = 5, targets = "-", step = 2) {
    if (!window.isUserPro) {
        const currentCount = document.querySelectorAll('.st-draw-row').length;
        if (currentCount >= 1) { document.getElementById('sub-modal').style.display = 'flex'; return; }
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
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">順序</span>
            <input type="number" value="${step}" class="st-draw-step" style="width:40px; text-align:center; padding:4px; background:#0D1117; color:#FFD700; border:1px solid #30363D; border-radius:4px; font-weight:bold;">
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; margin: 0 5px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">牌組投入</span>
            <input type="number" value="${qty}" class="st-draw-count" style="width:40px; text-align:center; padding:4px;">
        </div>
        <div style="display:flex; flex-direction:column; flex:1; margin: 0 5px;">
            <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">發動機制</span>
            <select class="st-draw-mechanism" onchange="this.parentElement.nextElementSibling.querySelector('.st-draw-targets').disabled = (this.value !== 'search_key')" style="padding:4px; font-size:13px;">
                <option value="shuffle_back" ${mech==='shuffle_back'?'selected':''}>洗回抽 X 張</option>
                <option value="discard_all" ${mech==='discard_all'?'selected':''}>全丟抽 X 張</option>
                <option value="put_bottom" ${mech==='put_bottom'?'selected':''}>放回抽 X 張</option>
                <option value="search_key" ${mech==='search_key'?'selected':''}>指定檢索標籤</option>
            </select>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">抽幾張</span>
                <input type="number" value="${val}" class="st-draw-count-val" style="width:40px; text-align:center; padding:4px;">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center;">
                <span style="font-size:12px; font-weight:bold; color:#58A6FF; margin-bottom:4px;">抓取標籤</span>
                <input type="text" value="${targets}" class="st-draw-targets" ${mech!=='search_key'?'disabled':''} style="width:50px; text-align:center; padding:4px;">
            </div>
        </div>
        <button class="btn-secondary" style="width:24px; height:24px; padding:0; border-radius:50%; color:#FF5252; margin-left:8px;" onclick="this.parentElement.remove()">✕</button>
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
