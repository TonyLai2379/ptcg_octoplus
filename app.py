import streamlit as st
import sqlite3
import re
import copy
import math
import random
import requests
import time
from bs4 import BeautifulSoup
import streamlit.components.v1 as components

st.set_page_config(layout="wide", page_title="PTCG 專業模擬器")
DEFAULT_CARDBACK = "https://tcg.pokemon.com/assets/img/global/tcg-card-back-2x.jpg"

# ==========================================
# 🌟 全局黑科技：注入卡片點擊放大鏡
# ==========================================
components.html("""
<script>
const doc = window.parent.document;
if (!doc.getElementById('custom-lightbox')) {
    const lb = doc.createElement('div');
    lb.id = 'custom-lightbox';
    lb.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:2147483647; justify-content:center; align-items:center; flex-direction:column; backdrop-filter: blur(5px); transition: opacity 0.2s ease; pointer-events: none;';
    
    lb.innerHTML = `
        <div id="lb-close-btn" style="position:absolute; top:30px; right:40px; font-size:20px; color:white; background:#E91E63; padding:8px 20px; border-radius:8px; cursor:pointer; font-weight:bold; box-shadow:0 4px 15px rgba(0,0,0,0.6); pointer-events:auto; z-index:2; border: 2px solid #fff; letter-spacing: 2px;">✖ 關閉預覽</div>
        <img id="lightbox-img" style="max-height:85vh; max-width:90vw; border-radius:15px; box-shadow: 0 10px 50px rgba(0,0,0,0.9); pointer-events: auto; position:relative; z-index:1;">
    `;
    doc.body.appendChild(lb);
    
    const stopEvent = (e) => { e.stopPropagation(); e.preventDefault(); };
    const closeLb = (e) => { 
        if(e) { e.stopPropagation(); e.preventDefault(); }
        lb.style.opacity = '0';
        setTimeout(() => {
            lb.style.display = 'none';
            lb.style.opacity = '1';
            lb.style.pointerEvents = 'none';
        }, 200);
    };

    lb.addEventListener('mousedown', stopEvent, true);
    lb.addEventListener('mouseup', stopEvent, true);
    lb.addEventListener('touchstart', stopEvent, {passive: false, capture: true});
    lb.addEventListener('touchend', stopEvent, {passive: false, capture: true});
    lb.addEventListener('click', closeLb, true);

    doc.addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG' && e.target.classList.contains('ptcg-card')) {
            lb.style.pointerEvents = 'auto'; 
            e.stopPropagation(); 
            e.preventDefault(); 
            doc.getElementById('lightbox-img').src = e.target.src; 
            lb.style.display = 'flex'; 
            lb.style.opacity = '1';
        }
    }, true);
}
</script>
""", height=0, width=0)

for key in ['cards_pool', 'history', 'direct_targets', 'chain_targets', 'scenarios', 'db_tw_count', 'db_en_count']:
    if key not in st.session_state: st.session_state[key] = [] if key not in ['db_tw_count', 'db_en_count'] else 0
if 'ptr' not in st.session_state: st.session_state.ptr = -1
if 'deck_dict' not in st.session_state: st.session_state.deck_dict = {}
if 'deck_total' not in st.session_state: st.session_state.deck_total = 0
if 'tutorial_shown' not in st.session_state: st.session_state.tutorial_shown = False

# ==========================================
# 🎓 新手教學彈出視窗
# ==========================================
@st.dialog("🎓 歡迎來到 PTCG 專業模擬器！", width="large")
def show_tutorial():
    st.markdown("<p style='color:#ccc; font-size:14px;'>花 1 分鐘了解系統操作，讓你迅速上手！</p>", unsafe_allow_html=True)
    t1, t2, t3, t4, t5, t6 = st.tabs(["1. 認識環境", "2. 官方匯入", "3. Limitless", "4. 編輯預覽", "5. 鎖定開局", "6. 機率故事線"])
    with t1:
        st.markdown("### 🗃️ 牌組管理中心\n左側邊欄是你的大腦樞紐！你可以在這裡匯入牌組、手動微調卡片，並確認 60 張卡牌的組成。")
    with t2:
        st.markdown("### 🔗 官方代碼匯入\n直接貼上寶可夢官方網站的「牌組短網址」或「代碼」，系統會即時解析並自動幫你把卡圖補齊！")
    with t3:
        st.markdown("### 📝 Limitless 文字匯入\n想抄國外頂尖玩家的上位牌組？去 Limitless 網站點擊 **Copy to Clipboard**，接著到左側「文字匯入」分頁貼上就搞定。")
    with t4:
        st.markdown("### 🛠️ 編輯與預覽\n匯入完成後，你可以在「編輯」分頁微調張數、搜尋並替換卡片。上方會有明確的張數指示，達到 60 張就會亮綠燈。")
    with t5:
        st.markdown("### 🎲 鎖定開局\n確認牌組 60 張無誤後，點擊左下方亮藍色的 **「鎖定牌組並開局」** 按鈕。系統會自動幫你洗牌、抽出起始 7 張手牌，並放置好 6 張獎賞卡！")
    with t6:
        st.markdown("### 🎯 機率分析與 A/B 故事線\n開局後，展開上方的 **「進階情境：機率與連鎖分析」**面板。\n你可以點選**直接解牌**與**延續抽濾牌**，一鍵算出抽中關鍵卡的機率，並點擊 **「紀錄此方案至比較板」**，打造你的戰術故事線，比較不同操作路線的勝率！")

if not st.session_state.tutorial_shown:
    st.session_state.tutorial_shown = True
    show_tutorial()

# ==========================================
def init_dbs():
    for db_name in ['ptcg_tw.db', 'ptcg_en.db']:
        try:
            conn = sqlite3.connect(db_name)
            c = conn.cursor()
            try: c.execute("ALTER TABLE cards ADD COLUMN release_date TEXT DEFAULT '1999/01/01'")
            except: pass
            c.execute('''CREATE TABLE IF NOT EXISTS cards (api_id TEXT PRIMARY KEY, name TEXT, set_code TEXT, number TEXT, image_url TEXT, release_date TEXT)''')
            conn.commit()
            conn.close()
        except: pass

def is_valid_img(url):
    if not url: return False
    url_lower = url.lower()
    invalid_keywords = ['dummy', 'blank', 'back', 'default', 'tcg-card-back']
    return not any(kw in url_lower for kw in invalid_keywords)

@st.cache_data(show_spinner=False)
def get_card_data(card_key):
    init_dbs()
    name = card_key.strip()
    bracket_content = None
    
    bracket_match = re.search(r'\[(.*?)\]', card_key)
    if bracket_match:
        bracket_content = bracket_match.group(1).strip()
        name = card_key.replace(f"[{bracket_content}]", "").strip()

    alt_name = name.replace("Basic ", "").strip() if name.startswith("Basic ") else name

    # 🛡️ 處理相對路徑與無效圖片
    def process_img_url(url):
        if url and is_valid_img(url):
            if not url.startswith('http'):
                return "https://asia.pokemon-card.com" + url
            return url
        return None

    def search_db(db_name):
        try:
            conn = sqlite3.connect(db_name)
            c = conn.cursor()
            
            if bracket_content:
                if bracket_content.startswith("Variant "):
                    vid = bracket_content.replace("Variant ", "")
                    c.execute("SELECT image_url FROM cards WHERE (name=? OR name=?) AND api_id LIKE ? LIMIT 1", (name, alt_name, f"%{vid}"))
                    res = c.fetchone()
                    if res: return process_img_url(res[0])
                else:
                    parts = bracket_content.split()
                    if len(parts) >= 2:
                        set_code, number = parts[0], parts[1]
                        # 🛡️ 將 number=? 改為 LIKE 解決 064 vs G 064/071 的問題
                        c.execute("SELECT image_url FROM cards WHERE (name=? OR name=?) AND set_code LIKE ? AND number LIKE ? LIMIT 1", (name, alt_name, f"%{set_code}%", f"%{number}%"))
                        res = c.fetchone()
                        if res: 
                            img = process_img_url(res[0])
                            if img: return img
                        
                        c.execute("SELECT image_url FROM cards WHERE (name=? OR name=?) AND number LIKE ? LIMIT 1", (name, alt_name, f"%{number}%"))
                        res = c.fetchone()
                        if res: 
                            img = process_img_url(res[0])
                            if img: return img
            
            c.execute("SELECT image_url FROM cards WHERE name=? OR name=? ORDER BY release_date DESC LIMIT 1", (name, alt_name))
            res = c.fetchone()
            if res: 
                img = process_img_url(res[0])
                if img: return img
            
            # 🛡️ 終極模糊搜救：拔掉所有奇怪括號
            clean_name = re.sub(r'[<>＜＞\[\]]', '', name).strip()
            fuzzy_name = clean_name.replace("'", "").replace("é", "e").split()[0]
            c.execute("SELECT image_url FROM cards WHERE name LIKE ? ORDER BY release_date DESC LIMIT 1", (f"%{fuzzy_name}%",))
            res = c.fetchone()
            if res: 
                img = process_img_url(res[0])
                if img: return img
        except: pass
        return None
    
    img = search_db('ptcg_tw.db')
    if img: return {"name": card_key, "img": img}
    img = search_db('ptcg_en.db')
    if img: return {"name": card_key, "img": img}
    return {"name": card_key, "img": DEFAULT_CARDBACK}

def save_card_to_db(name, img_url, lang="tw"):
    init_dbs()
    db_name = 'ptcg_tw.db' if lang == "tw" else 'ptcg_en.db'
    api_id = f"custom_{name}_{int(time.time())}"
    try:
        conn = sqlite3.connect(db_name)
        c = conn.cursor()
        c.execute("INSERT OR REPLACE INTO cards (api_id, name, set_code, number, image_url, release_date) VALUES (?, ?, ?, ?, ?, ?)", 
                  (api_id, name, "", "", img_url, "2099/01/01")) 
        conn.commit()
        conn.close()
    except: pass

def get_all_card_names():
    init_dbs()
    names = set()
    tw_count = en_count = 0
    try:
        conn = sqlite3.connect('ptcg_tw.db')
        c = conn.cursor()
        c.execute("SELECT name, set_code, number, api_id FROM cards")
        rows = c.fetchall()
        tw_count = len(rows)
        for row in rows:
            if row[0]:
                name = row[0].strip()
                if row[1] and row[2]: names.add(f"{name} [{row[1]} {row[2]}]")
                else: names.add(f"{name} [Variant {row[3][-4:] if row[3] else '000'}]")
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect('ptcg_en.db')
        c = conn.cursor()
        c.execute("SELECT name, set_code, number, api_id FROM cards")
        rows = c.fetchall()
        en_count = len(rows)
        for row in rows:
            if row[0]:
                name = row[0].strip()
                if row[1] and row[2]: names.add(f"{name} [{row[1]} {row[2]}]")
                else: names.add(f"{name} [Variant {row[3][-4:] if row[3] else '000'}]")
        conn.close()
    except: pass
    
    st.session_state.db_tw_count = tw_count
    st.session_state.db_en_count = en_count
    return sorted(list(names))

def save_state():
    snapshot = copy.deepcopy(st.session_state.cards_pool)
    if st.session_state.ptr < len(st.session_state.history) - 1:
        st.session_state.history = st.session_state.history[:st.session_state.ptr + 1]
    st.session_state.history.append(snapshot)
    st.session_state.ptr += 1

def fetch_official_deck(deck_code):
    try:
        code = re.search(r'([a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6})', deck_code)
        if not code: return None, "❌ 無效的牌組代碼格式。"
        
        my_bar = st.progress(0, text="🚀 正在連線解析官方牌組...")
        url = f"https://asia.pokemon-card.com/tw/deck-build/recipe/{code.group(1)}/"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code != 200: 
            my_bar.empty()
            return None, "❌ 無法連線至官方網站。"
            
        my_bar.progress(30, text="🔍 正在解析卡表...")
        soup = BeautifulSoup(response.text, 'html.parser')
        new_deck = {}
        card_items = soup.find_all('li', class_='card')
        if not card_items: 
            my_bar.empty()
            return None, "⚠️ 抓取成功但沒有找到卡片。"
             
        total = len(card_items)
        for i, item in enumerate(card_items):
            qty_tag = item.find('div', class_='cardCount')
            if not qty_tag: continue
                
            try: 
                qty = int(re.sub(r'\D', '', qty_tag.text)) if re.sub(r'\D', '', qty_tag.text) else 1
            except: qty = 1 
                
            my_bar.progress(30 + int(70 * i / total), text=f"📥 正在配對精準卡圖...")
            
            name = ""
            name_tag = item.find('p', class_='cardName')
            if name_tag: name = name_tag.text.strip()
            
            img_tag = item.find('img')
            if (not name or name.lower() == 'unknown') and img_tag and img_tag.get('alt'):
                name = img_tag['alt'].strip()
                
            if not name: continue
            name = re.sub(r'\s+', ' ', name).strip()
            
            set_info = ""
            card_num_tag = item.find('p', class_='cardNumber') or item.find('span', class_='cardNumber') or item.find(class_=re.compile('(?i)number'))
            if card_num_tag:
                m = re.search(r'([A-Za-z0-9\-]+)\s+(\d+[a-zA-Z]*)', card_num_tag.text.strip())
                if m: set_info = f" [{m.group(1)} {m.group(2)}]"
            
            final_card_key = name + set_info
            
            # 🚀 終極提速與防禦：優先提取 data-original 擊破 Lazy Loading！
            img_url = ""
            if img_tag:
                src = img_tag.get('data-original') or img_tag.get('data-src') or img_tag.get('src', '')
                if src:
                    if not src.startswith('http'):
                        src = "https://asia.pokemon-card.com" + src
                    img_url = src
                
            new_deck[final_card_key] = new_deck.get(final_card_key, 0) + qty
            
            current_data = get_card_data(final_card_key)
            if current_data['img'] == DEFAULT_CARDBACK and img_url:
                if is_valid_img(img_url):
                    save_card_to_db(final_card_key, img_url, lang="tw")
                    get_card_data.clear()
        
        final_deck = {k: {'qty': v, 'img': get_card_data(k)['img']} for k, v in new_deck.items()}
            
        my_bar.progress(100, text="✅ 解析完成！")
        time.sleep(0.5)
        my_bar.empty()
        
        if sum(info['qty'] for info in final_deck.values()) == 0: return None, "⚠️ 抓取失敗。"
        return final_deck, f"✅ 成功載入官方牌組！共 {sum(info['qty'] for info in final_deck.values())} 張。"
    except Exception as e: 
        return None, f"❌ 發生錯誤: {str(e)}"

def calc_chain_prob(deck_size, direct_k, chain_k, draw1, draw2, is_dilution=False, hand_size=0):
    if direct_k == 0 or deck_size == 0 or draw1 == 0: return 0.0
    if draw1 >= deck_size: return 100.0
    if (deck_size - direct_k) < draw1: return 100.0
    non_outs = deck_size - direct_k - chain_k
    if non_outs < 0: non_outs = 0
    total_combs = math.comb(deck_size, draw1)
    fail1 = math.comb(non_outs, draw1) / total_combs if non_outs >= draw1 else 0.0
    no_direct_combs = math.comb(deck_size - direct_k, draw1) if (deck_size - direct_k) >= draw1 else 0
    hit_chain_combs = no_direct_combs - (math.comb(non_outs, draw1) if non_outs >= draw1 else 0)
    p_hit_chain_no_direct = hit_chain_combs / total_combs
    deck_remaining = deck_size - draw1 + (hand_size if is_dilution else 0)
    if deck_remaining <= 0 or (deck_remaining - direct_k) < draw2: fail2 = 0.0
    else: fail2 = p_hit_chain_no_direct * (math.comb(deck_remaining - direct_k, draw2) / math.comb(deck_remaining, draw2))
    return (1.0 - (fail1 + fail2)) * 100.0

def group_cards(cards_list):
    groups = {}
    for c in cards_list:
        if c['name'] not in groups: groups[c['name']] = []
        groups[c['name']].append(c)
    return groups

def render_single_card(name, img_url):
    name_overlay = f'<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; color: #00E5FF; text-shadow: 2px 2px 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; font-weight: bold; font-size: 13px; line-height: 1.2; z-index: 5; text-align: center; word-wrap: break-word; pointer-events: none;">{name}</div>' if img_url == DEFAULT_CARDBACK else ""
    brightness = 'filter: brightness(0.4);' if img_url == DEFAULT_CARDBACK else ''
    html = f'<div style="position: relative; text-align: center; margin-bottom: 0px;"><img src="{img_url}" class="ptcg-card" style="width: 100%; border-radius: 5px; cursor: pointer; transition: transform 0.1s; {brightness}" onmouseover="this.style.transform=\'scale(1.05)\'" onmouseout="this.style.transform=\'scale(1)\'">{name_overlay}</div>'
    st.markdown(html, unsafe_allow_html=True)

def render_stacked_card(name, img_url, count):
    name_overlay = f'<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; color: #00E5FF; text-shadow: 2px 2px 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; font-weight: bold; font-size: 13px; line-height: 1.2; z-index: 5; text-align: center; word-wrap: break-word; pointer-events: none;">{name}</div>' if img_url == DEFAULT_CARDBACK else ""
    badge = f'<div style="position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background-color: #E91E63; color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.5); z-index: 10; border: 1px solid #0E1117; pointer-events: none;">x{count}</div>' if count > 1 else ""
    brightness = 'filter: brightness(0.4);' if img_url == DEFAULT_CARDBACK else ''
    html = f'<div style="position: relative; text-align: center; margin-bottom: 0px;"><img src="{img_url}" class="ptcg-card" style="width: 100%; border-radius: 5px; cursor: pointer; transition: transform 0.1s; {brightness}" onmouseover="this.style.transform=\'scale(1.05)\'" onmouseout="this.style.transform=\'scale(1)\'">{name_overlay}{badge}</div>'
    st.markdown(html, unsafe_allow_html=True)

@st.dialog("👁️ 牌組預覽", width="large")
def preview_readonly_dialog(deck_to_show):
    if not deck_to_show:
        st.info("📭 牌組目前是空的！")
        return
        
    deck_total = sum(c['qty'] for c in deck_to_show.values())
    color = "#00E5FF" if deck_total == 60 else "#FF5252"
    st.markdown(f"### 總張數: <span style='color:{color};'>{deck_total}</span> / 60", unsafe_allow_html=True)
    
    cols = st.columns(6)
    idx = 0
    for name, card_info in list(deck_to_show.items()):
        if card_info['qty'] > 0:
            with cols[idx % 6]:
                render_stacked_card(name, card_info['img'], card_info['qty'])
            idx += 1

# ==========================================
# --- 側邊欄介面 ---
# ==========================================
with st.sidebar:
    c_title, c_btn = st.columns([3, 1])
    with c_title: st.markdown("### 🗃️ 牌組管理中心")
    with c_btn: 
        if st.button("❓ 教學"): show_tutorial()
    
    all_db_names = get_all_card_names()
    c1, c2 = st.columns([2, 1.2])
    with c1:
        st.markdown(f"<div style='font-size:12px; color:#888; margin-top:5px;'>📊 系統資料庫:<br>TW ({st.session_state.db_tw_count}) / EN ({st.session_state.db_en_count})</div>", unsafe_allow_html=True)
    with c2:
        if st.button("🧹 清理異常"):
            for db_name in ['ptcg_tw.db', 'ptcg_en.db']:
                try:
                    conn = sqlite3.connect(db_name)
                    cursor = conn.cursor()
                    cursor.execute("DELETE FROM cards WHERE name LIKE '%Unknown%' OR name = '' OR name IS NULL")
                    conn.commit()
                    conn.close()
                except: pass
            get_card_data.clear()
            st.rerun()
            
    st.markdown("<div style='margin-bottom:10px;'></div>", unsafe_allow_html=True)
    
    tab_link, tab_import, tab_edit = st.tabs(["🔗 官方代碼", "📝 文字匯入", "🛠️ 編輯"])
    
    with tab_link:
        st.markdown("<p style='font-size:13px; color:#aaa;'>💡 貼上官網牌組短網址或代碼，系統將即時解析。</p>", unsafe_allow_html=True)
        deck_code_input = st.text_input("牌組編碼", placeholder="例: uCRvSM-NdxUvZ-iWAqYI")
        if st.button("🌐 解析官方牌組", use_container_width=True):
            if deck_code_input:
                parsed_deck, msg = fetch_official_deck(deck_code_input)
                if parsed_deck:
                    st.session_state.deck_dict = parsed_deck
                    st.success(msg)
                else: st.error(msg)
            else: st.warning("請先輸入代碼！")
            
        if st.session_state.deck_dict:
            if st.button("👁️ 預覽解析結果", key="preview_link", use_container_width=True):
                preview_readonly_dialog(st.session_state.deck_dict)

    with tab_import:
        deck_input = st.text_area("貼上 Limitless 牌組內容...", height=150)
        if st.button("📥 解析文字牌組", use_container_width=True):
            if deck_input.strip():
                lines = deck_input.split('\n')
                temp_deck = {}
                for line in lines:
                    line = line.strip()
                    if not line or any(x in line for x in ["Pokémon:", "Trainer:", "Energy:"]): continue
                    match = re.search(r'^(\d+)\s+(.+)', line)
                    if match:
                        qty, raw_name = int(match.group(1)), match.group(2).strip()
                        parse_match = re.search(r'^(.+?)(?:\s+([a-zA-Z0-9\-]+)\s+(\d+[a-zA-Z]*))?$', raw_name)
                        if parse_match and parse_match.group(2):
                            card_key = f"{parse_match.group(1).strip()} [{parse_match.group(2).strip()} {parse_match.group(3).strip()}]"
                        else: card_key = raw_name
                        temp_deck[card_key] = temp_deck.get(card_key, 0) + qty
                
                my_bar = st.progress(0, text="🚀 正在為英文卡片抓取精準圖片...")
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                keys_list = list(temp_deck.keys())
                total_cards = len(keys_list)
                final_deck_dict = {}
                
                for i, c_name in enumerate(keys_list):
                    my_bar.progress((i) / total_cards, text=f"正在處理 ({i+1}/{total_cards}): {c_name}")
                    c_data = get_card_data(c_name)
                    
                    if c_data['img'] == DEFAULT_CARDBACK:
                        try:
                            parse_match = re.search(r'^(.+?)(?:\s+\[([a-zA-Z0-9\-]+)\s+(\d+[a-zA-Z]*)\])?$', c_name)
                            search_name = parse_match.group(1).strip() if parse_match else c_name
                            target_set = parse_match.group(2) if parse_match and parse_match.group(2) else None
                            target_number = str(parse_match.group(3)) if parse_match and parse_match.group(3) else None

                            safe_search = search_name.replace('"', '').strip()
                            if "Energy" in safe_search and safe_search.startswith("Basic "):
                                safe_search = safe_search.replace("Basic ", "").strip()

                            api_url = "https://api.pokemontcg.io/v2/cards"
                            params = {"q": f'name:"{safe_search}"', "orderBy": "-set.releaseDate"}
                            
                            api_data = None
                            for attempt in range(3):
                                time.sleep(0.5) 
                                try:
                                    resp = requests.get(api_url, params=params, headers=headers, timeout=10)
                                    if resp.status_code == 200:
                                        api_data = resp.json(); break
                                    elif resp.status_code == 429: time.sleep(3.0) 
                                except: time.sleep(1.0)

                            if api_data and api_data.get('data'):
                                img_url = None
                                if target_number and target_set:
                                    for card in api_data['data']:
                                        c_num = str(card.get('number', ''))
                                        c_set = card.get('set', {}).get('ptcgoCode', '').upper()
                                        c_id = card.get('set', {}).get('id', '').upper()
                                        if c_num == target_number and (target_set.upper() in c_set or c_set in target_set.upper() or target_set.upper() in c_id or c_id in target_set.upper()):
                                            img_url = card['images']['large']; break
                                if not img_url and target_number:
                                    for card in api_data['data']:
                                        if str(card.get('number', '')) == target_number:
                                            img_url = card['images']['large']; break
                                if not img_url: img_url = api_data['data'][0]['images']['large']
                                
                                if img_url:
                                    save_card_to_db(c_name, img_url, lang="en") 
                                    c_data['img'] = img_url
                            else:
                                fuzzy_term = safe_search.split()[0].replace("'", "").replace("é", "e")
                                params_f = {"q": f'name:*{fuzzy_term}*', "orderBy": "-set.releaseDate"}
                                time.sleep(0.5)
                                resp_f = requests.get(api_url, params=params_f, headers=headers, timeout=10)
                                if resp_f.status_code == 200 and resp_f.json().get('data'):
                                    img_url = resp_f.json()['data'][0]['images']['large']
                                    save_card_to_db(c_name, img_url, lang="en") 
                                    c_data['img'] = img_url
                        except: pass 
                            
                    final_deck_dict[c_name] = {'qty': temp_deck[c_name], 'img': c_data['img']}
                            
                my_bar.empty()
                st.session_state.deck_dict = final_deck_dict
                st.success("✅ 解析成功！已為您抓取精準版本的英文卡圖。")
            else: st.warning("請先貼上牌組內容！")
                
        if st.session_state.deck_dict:
            if st.button("👁️ 預覽解析結果", key="preview_import", use_container_width=True):
                preview_readonly_dialog(st.session_state.deck_dict)

    with tab_edit:
        st.session_state.deck_total = sum(card_info['qty'] for card_info in st.session_state.deck_dict.values())
        color = "green" if st.session_state.deck_total == 60 else "red"
        st.markdown(f"**總張數:** <span style='color:{color}; font-size:18px;'>{st.session_state.deck_total} / 60</span>", unsafe_allow_html=True)
        
        current_names_in_edit = list(all_db_names)
        for d_name in st.session_state.deck_dict.keys():
            if d_name not in current_names_in_edit: current_names_in_edit.append(d_name)
        current_names_in_edit = sorted(list(set(current_names_in_edit)))
        
        st.markdown("**1. 搜尋已知卡片**")
        sel_card = st.selectbox("🔍 點擊下拉或打字過濾", ["請選擇..."] + current_names_in_edit, key="side_search")
        if sel_card != "請選擇...":
            c_data = get_card_data(sel_card)
            c1, c2 = st.columns([1, 1.5])
            with c1: render_single_card(sel_card, c_data['img'])
            with c2:
                current_qty = st.session_state.deck_dict[sel_card]['qty'] if sel_card in st.session_state.deck_dict else 0
                st.markdown(f"<div style='font-size:13px; color:#ccc; margin-bottom:10px;'>目前牌組內： <b>{current_qty}</b> 張</div>", unsafe_allow_html=True)
                if st.button("➕ 加入牌組", key=f"add_sel_{sel_card}", use_container_width=True):
                    if sel_card not in st.session_state.deck_dict: st.session_state.deck_dict[sel_card] = {'qty': 0, 'img': c_data['img']}
                    st.session_state.deck_dict[sel_card]['qty'] += 1
                    st.rerun()

        st.markdown("<div style='margin-top:15px;'></div>", unsafe_allow_html=True)
        st.markdown("**2. 新增未建檔卡片**")
        custom_card = st.text_input("✍️ 若搜不到，請手動輸入卡名", placeholder="例如: 未發售的測試卡")
        if st.button("➕ 強制加入此卡", use_container_width=True) and custom_card.strip():
            c_name = custom_card.strip()
            if c_name not in st.session_state.deck_dict: st.session_state.deck_dict[c_name] = {'qty': 0, 'img': DEFAULT_CARDBACK}
            st.session_state.deck_dict[c_name]['qty'] += 1
            st.rerun()

        st.divider()
        if st.button("👁️ 預覽牌組", key="preview_edit", use_container_width=True):
            preview_readonly_dialog(st.session_state.deck_dict)
            
        if st.session_state.deck_dict:
            st.markdown("<p style='font-size:14px; margin-top:15px;'><b>當前牌組清單：</b></p>", unsafe_allow_html=True)
            for card_name, card_info in list(st.session_state.deck_dict.items()):
                c1, c2, c3, c4 = st.columns([4, 1, 1, 1])
                with c1: st.write(f"{card_name[:15]}...") 
                with c2:
                    if st.button("➖", key=f"sub_{card_name}"):
                        if st.session_state.deck_dict[card_name]['qty'] > 1: st.session_state.deck_dict[card_name]['qty'] -= 1
                        else: del st.session_state.deck_dict[card_name]
                        st.rerun()
                with c3: st.markdown(f"<div style='text-align:center; padding-top:5px;'><b>{card_info['qty']}</b></div>", unsafe_allow_html=True)
                with c4:
                    if st.button("➕", key=f"add_{card_name}"):
                        st.session_state.deck_dict[card_name]['qty'] += 1
                        st.rerun()

    st.divider()
    if st.button("🎲 鎖定牌組並開局\n(洗牌+抽7+獎賞6)", use_container_width=True, type="primary"):
        if st.session_state.deck_total != 60: st.error("⚠️ 牌組必須剛好 60 張才能開局！")
        else:
            pool = []
            uid = 0
            for name, card_info in st.session_state.deck_dict.items():
                for _ in range(card_info['qty']):
                    pool.append({"uid": uid, "name": name, "img": card_info['img'], "zone": "deck"})
                    uid += 1
            
            st.session_state.cards_pool = pool
            st.session_state.history = []
            st.session_state.ptr = -1
            st.session_state.direct_targets = []
            st.session_state.chain_targets = []
            st.session_state.scenarios = []
            save_state()
            random.shuffle(st.session_state.cards_pool)
            for i in range(7): st.session_state.cards_pool[i]['zone'] = 'hand'
            for i in range(7, 13): st.session_state.cards_pool[i]['zone'] = f'prize_{i-7}'
            st.rerun()

# ==========================================
# --- 主視圖 (戰場與機率面板) ---
# ==========================================
if not st.session_state.cards_pool:
    st.info("👈 請在左側載入或編輯牌組，完成 60 張後點擊「鎖定牌組並開局」。")
else:
    deck_cards = [c for c in st.session_state.cards_pool if c['zone'] == 'deck']
    hand_cards = [c for c in st.session_state.cards_pool if c['zone'] == 'hand']
    discard_cards = [c for c in st.session_state.cards_pool if c['zone'] == 'discard']

    with st.expander("🎯 進階情境：機率與連鎖分析 (戰術故事線)", expanded=False):
        c1, c2, c3 = st.columns([1.2, 1.3, 1.5])
        deck_groups = group_cards(deck_cards)
        
        with c1:
            st.markdown("**🔥 1. 直接解牌 (抽到即成功)**")
            with st.popover("🖼️ 點我開啟圖庫選取", use_container_width=True):
                d_cols = st.columns(3)
                for i, (name, group) in enumerate(deck_groups.items()):
                    c = group[0]
                    with d_cols[i % 3]:
                        render_stacked_card(name, c['img'], len(group))
                        if name in st.session_state.direct_targets:
                            if st.button("❌ 取消", key=f"rm_d_{name}", use_container_width=True):
                                st.session_state.direct_targets.remove(name); st.rerun()
                        else:
                            if st.button("✅ 選擇", key=f"add_d_{name}", use_container_width=True):
                                st.session_state.direct_targets.append(name)
                                if name in st.session_state.chain_targets: st.session_state.chain_targets.remove(name)
                                st.rerun()
            
            if st.session_state.direct_targets:
                st.markdown("<div style='margin-top:10px; font-size:13px; color:#FFB300;'>已選取目標：</div>", unsafe_allow_html=True)
                sel_d_cols = st.columns(5)
                for idx, t_name in enumerate(st.session_state.direct_targets):
                    t_img = next((c['img'] for c in st.session_state.cards_pool if c['name'] == t_name), DEFAULT_CARDBACK)
                    with sel_d_cols[idx % 5]: render_single_card(t_name, t_img)
            
            st.markdown("<div style='margin-top:15px;'></div>", unsafe_allow_html=True)
            draw1 = st.slider("第一波抽牌數:", min_value=1, max_value=10, value=1, key="sld_d1")
            
        with c2:
            st.markdown("**🔄 2. 延續解牌 (抽到可多抽)**")
            with st.popover("🖼️ 點我開啟圖庫選取", use_container_width=True):
                c_cols = st.columns(3)
                for i, (name, group) in enumerate(deck_groups.items()):
                    c = group[0]
                    with c_cols[i % 3]:
                        render_stacked_card(name, c['img'], len(group))
                        if name in st.session_state.chain_targets:
                            if st.button("❌ 取消", key=f"rm_c_{name}", use_container_width=True):
                                st.session_state.chain_targets.remove(name); st.rerun()
                        else:
                            if st.button("✅ 選擇", key=f"add_c_{name}", use_container_width=True):
                                st.session_state.chain_targets.append(name)
                                if name in st.session_state.direct_targets: st.session_state.direct_targets.remove(name)
                                st.rerun()
            
            if st.session_state.chain_targets:
                st.markdown("<div style='margin-top:10px; font-size:13px; color:#4FC3F7;'>已選取目標：</div>", unsafe_allow_html=True)
                sel_c_cols = st.columns(5)
                for idx, t_name in enumerate(st.session_state.chain_targets):
                    t_img = next((c['img'] for c in st.session_state.cards_pool if c['name'] == t_name), DEFAULT_CARDBACK)
                    with sel_c_cols[idx % 5]: render_single_card(t_name, t_img)

            st.markdown("<div style='margin-top:15px;'></div>", unsafe_allow_html=True)
            chain_effect = st.radio("連鎖發動類型：", ["純抽 / 不稀釋", "洗回牌庫抽"], index=0)
            is_dilute = (chain_effect == "洗回牌庫抽")
            h_size = st.number_input("手牌張數", min_value=0, max_value=20, value=0) if is_dilute else 0
            draw2 = st.slider("第二波抽牌數:", min_value=0, max_value=10, value=0, key="sld_d2")
            
        with c3:
            st.markdown("**📊 分析結果**")
            direct_count = sum(1 for c in deck_cards if c['name'] in st.session_state.direct_targets)
            chain_count = sum(1 for c in deck_cards if c['name'] in st.session_state.chain_targets)
            
            if direct_count > 0:
                final_prob = calc_chain_prob(len(deck_cards), direct_count, chain_count, draw1, draw2, is_dilution=is_dilute, hand_size=h_size)
                
                st.markdown(f"""
                <div style='background-color:#1E1E1E; padding:15px; border-radius:8px; border:1px solid #444; height: 100%; display: flex; flex-direction: column; justify-content: center;'>
                    <div style='font-size:14px; color:#bbb;'>牌庫目前剩餘: <b>{len(deck_cards)}</b> 張</div>
                    <div style='font-size:14px; color:#bbb; margin-bottom:10px;'>包含 👉 直接解牌: <span style='color:#FFB300;'>{direct_count}</span> 張 | 延續解牌: <span style='color:#4FC3F7;'>{chain_count}</span> 張</div>
                    <div style='font-size:16px;'>經過 <b>{draw1}</b> 抽 + 連鎖 <b>{draw2}</b> 抽後</div>
                    <div style='font-size:16px;'>成功拿到解牌的總機率為：</div>
                    <div style='color:#00E5FF; font-size:36px; font-weight:bold; margin-top:5px; text-shadow: 0px 0px 10px rgba(0, 229, 255, 0.4);'>{final_prob:.1f}%</div>
                </div>
                """, unsafe_allow_html=True)
                
                if st.button("📌 紀錄此方案至比較板", use_container_width=True):
                    d_names = "、".join([n[:4] for n in st.session_state.direct_targets])
                    c_names = "、".join([n[:4] for n in st.session_state.chain_targets]) if st.session_state.chain_targets else "無"
                    st.session_state.scenarios.append({
                        "title": f"首波 {draw1} 抽 ➜ 延續 {draw2} 抽",
                        "desc_target": f"解: {d_names}",
                        "desc_chain": f"連鎖: {c_names}",
                        "prob": final_prob
                    })
                    st.rerun()
            else: st.info("👈 請點選「直接解牌」來進行計算。")

        if st.session_state.scenarios:
            st.divider()
            c_title, c_btn = st.columns([5, 1])
            with c_title: st.markdown("**📌 A/B 路線比較紀錄板** (觀察各戰術路線的故事線與機率差異)")
            with c_btn:
                if st.button("🗑️ 清空板子", use_container_width=True):
                    st.session_state.scenarios = []
                    st.rerun()

            s_cols = st.columns(max(len(st.session_state.scenarios), 4))
            for idx, scn in enumerate(st.session_state.scenarios):
                is_max = (scn['prob'] == max([s['prob'] for s in st.session_state.scenarios]))
                border_color = "#FF4B4B" if is_max else "#444"
                with s_cols[idx % len(s_cols)]:
                    st.markdown(f"""
                    <div style='background-color:#262730; padding:12px; border-radius:8px; border-top:4px solid {border_color}; margin-bottom:10px;'>
                        <div style='color:#ccc; font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;'>{scn['desc_target']}</div>
                        <div style='color:#999; font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;'>{scn['desc_chain']}</div>
                        <div style='color:#fff; font-size:15px; font-weight:bold; margin-top:6px;'>{scn['title']}</div>
                        <div style='color:#00E5FF; font-size:28px; font-weight:bold; margin-top:2px;'>{scn['prob']:.1f}%</div>
                    </div>
                    """, unsafe_allow_html=True)

    col_l, col_m, col_r = st.columns([1.5, 5.5, 2.0])
    
    with col_l:
        st.markdown("**🏆 獎賞卡**")
        p_cols = st.columns(2)
        for i in range(6):
            col_idx = i % 2
            with p_cols[col_idx]:
                pc = next((c for c in st.session_state.cards_pool if c['zone'] == f'prize_{i}'), None)
                if pc:
                    render_single_card(pc['name'], pc['img'])
                    p_btn1, p_btn2 = st.columns(2)
                    if p_btn1.button("手", key=f"p2h_{pc['uid']}_{i}", use_container_width=True): save_state(); pc['zone'] = 'hand'; st.rerun()
                    if p_btn2.button("棄", key=f"p2d_{pc['uid']}_{i}", use_container_width=True):
                        save_state(); pc['zone'] = 'discard'
                        st.session_state.cards_pool.remove(pc); st.session_state.cards_pool.append(pc)
                        st.rerun()
                else: st.markdown("<div style='height:110px; border:2px dashed #444; border-radius:5px; margin-bottom:10px; display:flex; align-items:center; justify-content:center; color:#555;'>空</div>", unsafe_allow_html=True)

    with col_m:
        st.markdown("**🔴 戰鬥場 (Active)**")
        with st.container(border=True):
            active_cards = [c for c in st.session_state.cards_pool if c['zone'] == 'active']
            a_cols = st.columns(5)
            with a_cols[2]: 
                if active_cards:
                    c = active_cards[0]
                    render_single_card(c['name'], c['img'])
                    if st.button("回手", key=f"ret_a_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'hand'; st.rerun()
                else: st.markdown("<div style='height:110px; border:2px dashed #444; border-radius:5px; display:flex; align-items:center; justify-content:center; color:#555;'>戰鬥場空置</div>", unsafe_allow_html=True)

        st.markdown("**🔵 備戰區 (Bench)**")
        with st.container(border=True):
            b_cols = st.columns(5)
            for i in range(5):
                with b_cols[i]:
                    bc = next((c for c in st.session_state.cards_pool if c['zone'] == f'bench_{i}'), None)
                    if bc:
                        render_single_card(bc['name'], bc['img'])
                        if st.button("回手", key=f"ret_b_{bc['uid']}", use_container_width=True): save_state(); bc['zone'] = 'hand'; st.rerun()
                    else: st.markdown(f"<div style='height:110px; border:2px dashed #444; border-radius:5px; display:flex; align-items:center; justify-content:center; color:#555;'>空 ({i+1})</div>", unsafe_allow_html=True)

        st.markdown(f"**🖐️ 手牌 ({len(hand_cards)} 張)**")
        with st.expander("🛠️ 手牌批次操作", expanded=False):
            m_col1, m_col2, m_col3 = st.columns(3)
            if m_col1.button("🔄 洗回牌庫", use_container_width=True):
                save_state()
                for c in st.session_state.cards_pool:
                    if c['zone'] == 'hand': c['zone'] = 'deck'
                random.shuffle(st.session_state.cards_pool)
                st.rerun()
            if m_col2.button("⬇️ 放回牌底", use_container_width=True):
                save_state()
                hand_to_move = [c for c in st.session_state.cards_pool if c['zone'] == 'hand']
                st.session_state.cards_pool = [c for c in st.session_state.cards_pool if c['zone'] != 'hand']
                for c in hand_to_move:
                    c['zone'] = 'deck'
                    st.session_state.cards_pool.append(c)
                st.rerun()
            if m_col3.button("🗑️ 全手牌丟棄", use_container_width=True):
                save_state()
                for c in st.session_state.cards_pool:
                    if c['zone'] == 'hand': c['zone'] = 'discard'
                st.rerun()

        with st.container(border=True):
            if hand_cards:
                hand_groups = group_cards(hand_cards)
                hand_groups_list = list(hand_groups.items())
                MAX_HAND_COLS = 10
                num_hand_rows = math.ceil(len(hand_groups_list) / MAX_HAND_COLS)
                
                for r in range(num_hand_rows):
                    row_items = hand_groups_list[r * MAX_HAND_COLS : (r + 1) * MAX_HAND_COLS]
                    h_cols = st.columns(MAX_HAND_COLS)
                    for idx, (name, group) in enumerate(row_items):
                        c = group[0]; count = len(group)
                        with h_cols[idx]:
                            render_stacked_card(name, c['img'], count)
                            with st.popover("🎯 操作", use_container_width=True):
                                if st.button("⚔️ 移至戰場", key=f"ha_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'active'; st.rerun()
                                if st.button("🛡️ 移至備戰", key=f"hb_{c['uid']}", use_container_width=True):
                                    save_state()
                                    for b_idx in range(5):
                                        if not any(bc['zone'] == f'bench_{b_idx}' for bc in st.session_state.cards_pool):
                                            c['zone'] = f'bench_{b_idx}'; break
                                    st.rerun()
                                if st.button("🗑️ 放入棄牌", key=f"hd_{c['uid']}", use_container_width=True):
                                    save_state(); c['zone'] = 'discard'
                                    st.session_state.cards_pool.remove(c); st.session_state.cards_pool.append(c)
                                    st.rerun()
                                if st.button("🃏 放回牌庫", key=f"hk_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'deck'; st.rerun()
            else: st.markdown("<div style='height:110px; border:2px dashed #444; border-radius:5px; display:flex; align-items:center; justify-content:center; color:#555;'>手牌空置</div>", unsafe_allow_html=True)

    with col_r:
        r_space1, r_content1 = st.columns([1.2, 2.8])
        with r_content1:
            st.markdown(f"**🗃️ 牌庫 ({len(deck_cards)})**")
            st.image(DEFAULT_CARDBACK, use_container_width=True)
            if st.button("🎴 抽牌", use_container_width=True):
                if deck_cards: save_state(); deck_cards[0]['zone'] = 'hand'; st.rerun()
            with st.popover("🔍 檢索牌庫", use_container_width=True):
                kw = st.text_input("搜尋牌庫...", key="s_deck").strip().lower()
                filtered_deck = [c for c in deck_cards if kw in c['name'].lower()]
                deck_groups = group_cards(filtered_deck)
                d_cols = st.columns(3)
                for i, (name, group) in enumerate(deck_groups.items()):
                    c = group[0]
                    with d_cols[i % 3]:
                        render_stacked_card(name, c['img'], len(group))
                        if st.button("上手", key=f"d2h_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'hand'; st.rerun()

        st.markdown("<div style='margin: 20px 0;'></div>", unsafe_allow_html=True) 
        
        r_space2, r_content2 = st.columns([1.2, 2.8])
        with r_content2:
            st.markdown(f"**🪦 棄牌 ({len(discard_cards)})**")
            if discard_cards: render_single_card(discard_cards[-1]['name'], discard_cards[-1]['img'])
            else: st.markdown("<div style='height:115px; border:2px dashed #444; display:flex; align-items:center; justify-content:center; border-radius:5px; color:#555;'>無</div>", unsafe_allow_html=True)
                
            with st.popover("🔍 檢索棄牌", use_container_width=True):
                kw2 = st.text_input("搜尋棄牌...", key="s_discard").strip().lower()
                filtered_disc = [c for c in discard_cards if kw2 in c['name'].lower()]
                disc_groups = group_cards(filtered_disc)
                dd_cols = st.columns(3)
                for i, (name, group) in enumerate(disc_groups.items()):
                    c = group[0]
                    with dd_cols[i % 3]:
                        render_stacked_card(name, c['img'], len(group))
                        if st.button("回手", key=f"dd2h_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'hand'; st.rerun()
                        if st.button("回庫", key=f"dd2d_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'deck'; st.rerun()

        st.markdown("<div style='margin-top: 30px;'></div>", unsafe_allow_html=True) 
        
        r_space3, r_content3 = st.columns([1.2, 2.8])
        with r_content3:
            u_col, r_col = st.columns(2)
            if u_col.button("⬅️ 復原", use_container_width=True):
                if st.session_state.ptr > 0:
                    st.session_state.ptr -= 1
                    st.session_state.cards_pool = copy.deepcopy(st.session_state.history[st.session_state.ptr])
                    st.rerun()
            if r_col.button("重做 ➡️", use_container_width=True):
                if st.session_state.ptr < len(st.session_state.history) - 1:
                    st.session_state.ptr += 1
                    st.session_state.cards_pool = copy.deepcopy(st.session_state.history[st.session_state.ptr])
                    st.rerun()
