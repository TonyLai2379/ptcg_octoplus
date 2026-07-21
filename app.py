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

# ==========================================
# 0. 頁面初始設定
# ==========================================
st.set_page_config(layout="wide", page_title="PTCG 專業沙盤推演機 (蒙地卡羅版)")
DEFAULT_CARDBACK = "https://tcg.pokemon.com/assets/img/global/tcg-card-back-2x.jpg"

# ==========================================
# 1. 介面縮放與極限排版 CSS
# ==========================================
with st.sidebar:
    st.markdown("### 👤 玩家資料庫綁定")
    user_id = st.text_input("輸入您的玩家 ID (保留自訂卡牌)", value="guest")
    st.session_state.user_id = user_id.strip() or "guest"
    st.divider()
    
    st.markdown("### 🔍 畫面縮放控制")
    ui_scale = st.slider("調整戰場大小 (適合 1080p)", min_value=50, max_value=150, value=100, step=5)
    st.divider()

st.markdown(f"""
<style>
.block-container {{ padding-top: 1rem !important; padding-bottom: 0rem !important; padding-left: 1rem !important; padding-right: 1rem !important; max-width: 100% !important; zoom: {ui_scale / 100}; -moz-transform: scale({ui_scale / 100}); -moz-transform-origin: top center; }}
header {{ visibility: hidden; }}
div[data-testid="stVerticalBlock"] {{ gap: 0.2rem !important; }}
div[data-testid="stHorizontalBlock"] {{ gap: 0.5rem !important; }}
.drop-zone-active {{ outline: 3px dashed #00E5FF !important; outline-offset: -3px; border-radius: 8px; background-color: rgba(0, 229, 255, 0.05); }}
button[kind="secondary"] {{ padding: 0.2rem 0.5rem !important; min-height: 0 !important; }}
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. 全局黑科技：JS 引擎
# ==========================================
components.html("""
<script>
const doc = window.parent.document;
setInterval(() => {
    const inputs = Array.from(doc.querySelectorAll('input'));
    const dndInput = inputs.find(input => input.getAttribute('aria-label') === 'dnd_input_widget');
    if(dndInput) {
        const container = dndInput.closest('div[data-testid="stTextInput"]');
        if(container) { container.style.opacity = '0'; container.style.position = 'absolute'; container.style.width = '1px'; container.style.height = '1px'; container.style.overflow = 'hidden'; container.style.zIndex = '-9999'; }
    }
}, 500); 

setInterval(() => {
    const markers = doc.querySelectorAll('div[id^="marker-"]');
    markers.forEach(marker => {
        let targetZone = marker.getAttribute('data-zone');
        let dropTarget = marker.closest('div[data-testid="stColumn"]') || marker.closest('div[data-testid="stVerticalBlockBorderWrapper"]');
        if (dropTarget && dropTarget.getAttribute('data-zone') !== targetZone) {
            dropTarget.classList.add('drop-zone'); dropTarget.setAttribute('data-zone', targetZone);
        }
    });
}, 500);

if (!doc.getElementById('custom-lightbox')) {
    const lb = doc.createElement('div'); lb.id = 'custom-lightbox';
    lb.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:2147483647; justify-content:center; align-items:center; flex-direction:column; backdrop-filter: blur(5px); transition: opacity 0.2s ease; pointer-events: none;';
    lb.innerHTML = `<div id="lb-close-btn" style="position:absolute; top:30px; right:40px; font-size:20px; color:white; background:#E91E63; padding:8px 20px; border-radius:8px; cursor:pointer; font-weight:bold; pointer-events:auto; z-index:2; border: 2px solid #fff;">✖ 關閉預覽</div>
                    <img id="lightbox-img" style="max-height:85vh; max-width:90vw; border-radius:15px; box-shadow: 0 10px 50px rgba(0,0,0,0.9); pointer-events: auto; position:relative; z-index:1;">`;
    doc.body.appendChild(lb);
    const closeLb = (e) => { if(e) { e.stopPropagation(); e.preventDefault(); } lb.style.opacity = '0'; setTimeout(() => { lb.style.display = 'none'; lb.style.opacity = '1'; lb.style.pointerEvents = 'none'; }, 200); };
    lb.addEventListener('click', closeLb, true);
    doc.addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG' && e.target.classList.contains('ptcg-card')) {
            lb.style.pointerEvents = 'auto'; e.stopPropagation(); e.preventDefault(); 
            doc.getElementById('lightbox-img').src = e.target.src; lb.style.display = 'flex'; lb.style.opacity = '1';
        }
    }, true);
}

if (!doc.getElementById('custom-dnd')) {
    const dnd = doc.createElement('div'); dnd.id = 'custom-dnd'; doc.body.appendChild(dnd);
    let draggedUid = null;
    doc.addEventListener('dragstart', (e) => {
        if(e.target.tagName === 'IMG' && e.target.classList.contains('ptcg-card')) {
            draggedUid = e.target.getAttribute('data-uid');
            if(draggedUid) { e.dataTransfer.setData('text/plain', draggedUid); e.target.style.opacity = '0.4'; }
        }
    });
    doc.addEventListener('dragend', (e) => { if(e.target.tagName === 'IMG' && e.target.classList.contains('ptcg-card')) e.target.style.opacity = '1'; });
    doc.addEventListener('dragover', (e) => { let zone = e.target.closest('.drop-zone'); if(zone) { e.preventDefault(); zone.classList.add('drop-zone-active'); } });
    doc.addEventListener('dragleave', (e) => { let zone = e.target.closest('.drop-zone'); if(zone) zone.classList.remove('drop-zone-active'); });
    doc.addEventListener('drop', (e) => {
        let zone = e.target.closest('.drop-zone');
        if(zone) {
            e.preventDefault(); zone.classList.remove('drop-zone-active');
            let targetZone = zone.getAttribute('data-zone');
            if (draggedUid && targetZone) {
                const inputs = Array.from(doc.querySelectorAll('input'));
                const dndInput = inputs.find(input => input.getAttribute('aria-label') === 'dnd_input_widget');
                if(dndInput) {
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    nativeInputValueSetter.call(dndInput, draggedUid + "->" + targetZone);
                    dndInput.dispatchEvent(new Event('input', { bubbles: true })); dndInput.dispatchEvent(new Event('change', { bubbles: true })); dndInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                }
            }
        }
    });
}
</script>
""", height=0, width=0)

# ==========================================
# 3. 狀態初始化與資料庫升級
# ==========================================
for key in ['cards_pool', 'history', 'scenarios', 'db_tw_count', 'db_en_count', 'db_custom_count']:
    if key not in st.session_state: st.session_state[key] = [] if key not in ['db_tw_count', 'db_en_count', 'db_custom_count'] else 0
if 'ptr' not in st.session_state: st.session_state.ptr = -1
if 'deck_dict' not in st.session_state: st.session_state.deck_dict = {}
if 'deck_total' not in st.session_state: st.session_state.deck_total = 0

if 'direct_targets' not in st.session_state or isinstance(st.session_state.direct_targets, list): st.session_state.direct_targets = {}
if 'chain_targets' not in st.session_state or isinstance(st.session_state.chain_targets, list): st.session_state.chain_targets = {}

def save_state():
    snapshot = copy.deepcopy(st.session_state.cards_pool)
    if st.session_state.ptr < len(st.session_state.history) - 1: st.session_state.history = st.session_state.history[:st.session_state.ptr + 1]
    st.session_state.history.append(snapshot); st.session_state.ptr += 1

def process_dnd():
    val = st.session_state.get('dnd_input_widget', '')
    if val and "->" in val:
        uid_str, target_zone = val.split("->")
        save_state() 
        dragged_card = next((c for c in st.session_state.cards_pool if str(c.get('uid')) == uid_str), None)
        if dragged_card:
            if target_zone.startswith('prize_'):
                occupying_card = next((c for c in st.session_state.cards_pool if c['zone'] == target_zone and c != dragged_card), None)
                if occupying_card: occupying_card['zone'] = dragged_card['zone']
            dragged_card['zone'] = target_zone
        st.session_state.dnd_input_widget = "" 

st.text_input("dnd_input_widget", key="dnd_input_widget", label_visibility="hidden", on_change=process_dnd)

def init_dbs():
    for db_name in ['ptcg_tw.db', 'ptcg_en.db']:
        try:
            conn = sqlite3.connect(db_name); c = conn.cursor()
            try: c.execute("ALTER TABLE cards ADD COLUMN release_date TEXT DEFAULT '1999/01/01'")
            except: pass
            try: c.execute("ALTER TABLE cards ADD COLUMN set_code TEXT DEFAULT ''")
            except: pass
            try: c.execute("ALTER TABLE cards ADD COLUMN number TEXT DEFAULT ''")
            except: pass
            c.execute('''CREATE TABLE IF NOT EXISTS cards (api_id TEXT PRIMARY KEY, name TEXT, set_code TEXT, number TEXT, image_url TEXT, release_date TEXT)''')
            conn.commit(); conn.close()
        except: pass
    try:
        conn = sqlite3.connect('custom_cards.db'); c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS cards (user_id TEXT, api_id TEXT, name TEXT, image_url TEXT, PRIMARY KEY (user_id, api_id))''')
        conn.commit(); conn.close()
    except: pass

def is_valid_img(url):
    if not url: return False
    return not any(kw in url.lower() for kw in ['dummy', 'blank', 'back', 'default', 'tcg-card-back'])

def save_card_to_db(card_key, img_url, lang="tw"):
    init_dbs()
    clean_name = card_key.strip()
    set_code = ""; number = ""
    bracket_match = re.search(r'^(.*?)\s*\[(.*?)\]$', card_key)
    if bracket_match: 
        clean_name = bracket_match.group(1).strip()
        parts = bracket_match.group(2).strip().split()
        if len(parts) >= 2: set_code, number = parts[0], parts[1]
    try:
        conn = sqlite3.connect('ptcg_tw.db' if lang == "tw" else 'ptcg_en.db'); c = conn.cursor()
        c.execute("INSERT OR REPLACE INTO cards (api_id, name, set_code, number, image_url, release_date) VALUES (?, ?, ?, ?, ?, ?)", (card_key, clean_name, set_code, number, img_url, "2099/01/01")) 
        conn.commit(); conn.close()
    except: pass

def save_custom_card(user_id, card_name, img_url):
    init_dbs()
    try:
        conn = sqlite3.connect('custom_cards.db'); c = conn.cursor()
        c.execute("INSERT OR REPLACE INTO cards (user_id, api_id, name, image_url) VALUES (?, ?, ?, ?)", (user_id, card_name, card_name, img_url)) 
        conn.commit(); conn.close()
    except: pass

@st.cache_data(show_spinner=False)
def get_card_data(card_key, user_id):
    init_dbs()
    def process_img_url(url):
        if url and is_valid_img(url): return "https://asia.pokemon-card.com" + url if not url.startswith('http') else url
        return None

    try:
        conn = sqlite3.connect('custom_cards.db'); c = conn.cursor()
        c.execute("SELECT image_url FROM cards WHERE user_id=? AND api_id=? LIMIT 1", (user_id, card_key))
        res = c.fetchone()
        conn.close()
        if res: return {"name": card_key, "img": process_img_url(res[0]) or DEFAULT_CARDBACK}
    except: pass

    def search_exact(db_name):
        try:
            conn = sqlite3.connect(db_name); c = conn.cursor()
            c.execute("SELECT image_url FROM cards WHERE api_id=? LIMIT 1", (card_key,))
            res = c.fetchone()
            if res: return process_img_url(res[0])
        except: pass
        return None
    
    img = search_exact('ptcg_tw.db') or search_exact('ptcg_en.db')
    if img: return {"name": card_key, "img": img}

    name = card_key.strip()
    bracket_match = re.search(r'\[(.*?)\]', card_key)
    bracket_content = bracket_match.group(1).strip() if bracket_match else None
    if bracket_match: name = card_key.replace(f"[{bracket_content}]", "").strip()
    alt_name = name.replace("Basic ", "").strip() if name.startswith("Basic ") else name

    def search_fuzzy(db_name):
        try:
            conn = sqlite3.connect(db_name); c = conn.cursor()
            if bracket_content:
                parts = bracket_content.split()
                if len(parts) >= 2:
                    c.execute("SELECT image_url FROM cards WHERE (name=? OR name=?) AND set_code LIKE ? AND number LIKE ? LIMIT 1", (name, alt_name, f"%{parts[0]}%", f"%{parts[1]}%"))
                    res = c.fetchone()
                    if res: return process_img_url(res[0])
                    c.execute("SELECT image_url FROM cards WHERE (name=? OR name=?) AND api_id LIKE ? LIMIT 1", (name, alt_name, f"%{parts[1]}%"))
                    res = c.fetchone()
                    if res: return process_img_url(res[0])
            c.execute("SELECT image_url FROM cards WHERE name=? OR name=? ORDER BY release_date DESC LIMIT 1", (name, alt_name))
            res = c.fetchone()
            if res: return process_img_url(res[0])
        except: pass
        return None
        
    img = search_fuzzy('ptcg_tw.db') or search_fuzzy('ptcg_en.db')
    return {"name": card_key, "img": img if img else DEFAULT_CARDBACK}

def get_all_card_names(user_id):
    init_dbs()
    names = set(); tw_count = en_count = custom_count = 0
    for db in ['ptcg_tw.db', 'ptcg_en.db']:
        try:
            conn = sqlite3.connect(db); c = conn.cursor()
            c.execute("SELECT api_id, name, set_code, number FROM cards")
            rows = c.fetchall()
            for row in rows:
                api_id = row[0].strip() if row[0] else ""
                name = row[1].strip() if row[1] else ""
                set_code = row[2].strip() if row[2] else ""
                number = row[3].strip() if row[3] else ""
                if not name and not api_id: continue
                if name and set_code and number: names.add(f"{name} [{set_code} {number}]")
                elif name and api_id and "-" in api_id and not api_id.startswith("custom"): names.add(f"{name} [{api_id.replace('-', ' ')}]")
                elif name: names.add(name)
                else: names.add(api_id)
            if db == 'ptcg_tw.db': tw_count = len(rows)
            else: en_count = len(rows)
            conn.close()
        except: pass
        
    try:
        conn = sqlite3.connect('custom_cards.db'); c = conn.cursor()
        c.execute("SELECT api_id FROM cards WHERE user_id=?", (user_id,))
        rows = c.fetchall()
        for row in rows: names.add(row[0])
        custom_count = len(rows)
        conn.close()
    except: pass
    
    st.session_state.db_tw_count, st.session_state.db_en_count, st.session_state.db_custom_count = tw_count, en_count, custom_count
    return sorted(list(names))


# ==========================================
# 4. 爬蟲與 💡 萬次蒙地卡羅檢索引擎
# ==========================================
def fetch_official_deck(deck_code):
    try:
        code = re.search(r'([a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6})', deck_code)
        if not code: return None, "❌ 無效的牌組代碼格式。"
        
        my_bar = st.progress(0, text="🚀 正在連線解析官方牌組 (100% 網路直抓)...")
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(f"https://asia.pokemon-card.com/tw/deck-build/recipe/{code.group(1)}/", headers=headers, timeout=10)
        if response.status_code != 200: my_bar.empty(); return None, "❌ 無法連線至官方網站。"
            
        soup = BeautifulSoup(response.text, 'html.parser')
        new_deck = {}
        card_items = soup.find_all('li', class_='card')
        if not card_items: my_bar.empty(); return None, "⚠️ 抓取成功但沒有找到卡片。"
             
        total = len(card_items)
        for i, item in enumerate(card_items):
            name_tag = item.find('p', class_='cardName')
            qty_tag = item.find('div', class_='cardCount')
            if name_tag and qty_tag:
                name = re.sub(r'\s+', ' ', name_tag.text.strip()).strip()
                try: qty = int(re.sub(r'\D', '', qty_tag.text)) if re.sub(r'\D', '', qty_tag.text) else 1
                except: qty = 1 
                
                my_bar.progress(30 + int(70 * i / total), text=f"📥 正在配對精準卡圖...")
                img_url = ""
                a_tag = name_tag.find('a')
                if a_tag and a_tag.get('href'):
                    try:
                        detail_resp = requests.get("https://asia.pokemon-card.com" + a_tag['href'], headers=headers, timeout=5)
                        all_imgs = re.findall(r'(?:https?://|/)[^"\'\s<>\[\]]+\.(?:jpg|png|webp)', detail_resp.text.replace('\\/', '/'), re.IGNORECASE)
                        for src in all_imgs:
                            src_l = src.lower()
                            if 'card' in src_l and 'ogp' not in src_l and 'icon' not in src_l and 'logo' not in src_l:
                                img_url = src if src.startswith('http') else "https://asia.pokemon-card.com" + src
                                save_card_to_db(name, img_url, lang="tw"); break
                    except: pass
                
                if not img_url: img_url = get_card_data(name, st.session_state.user_id)['img']
                new_deck[name] = {'qty': new_deck.get(name, {}).get('qty', 0) + qty, 'img': img_url}
        
        my_bar.empty()
        if sum(info['qty'] for info in new_deck.values()) == 0: return None, "⚠️ 抓取失敗。"
        get_card_data.clear()
        return new_deck, f"✅ 成功載入！共 {sum(info['qty'] for info in new_deck.values())} 張 (已同步至本地)。"
    except Exception as e: return None, f"❌ 發生錯誤: {str(e)}"

# 💡 蒙地卡羅萬次推演引擎 (升級檢索能力)
def run_monte_carlo(deck_cards, direct_dict, chain_dict, draw1, is_dilute=False, hand_size=0, iterations=10000):
    if not deck_cards or draw1 <= 0 or not direct_dict: return 0.0
    
    base_deck = [c['name'] for c in deck_cards]
    success_count = 0
    
    for _ in range(iterations):
        deck = base_deck.copy()
        random.shuffle(deck)
        hand = deck[:draw1]
        deck = deck[draw1:]
        
        def check_success(current_hand):
            # 取出目標缺口 (相容舊資料結構)
            missing = {k: v.get('qty', 1) if isinstance(v, dict) else v for k, v in direct_dict.items()}
            search_cards = []
            
            # 1. 直接用手上有的卡抵銷缺口
            for card in current_hand:
                if card in missing and missing[card] > 0:
                    missing[card] -= 1
                elif card in chain_dict and chain_dict[card].get('type', '').startswith('檢索'):
                    search_cards.append(card)
                    
            if sum(missing.values()) <= 0: return True
            
            # 2. 如果目標沒達成，但手上有「檢索卡」，啟動抵銷
            for s_card in search_cards:
                s_data = chain_dict[s_card]
                can_fetch = s_data.get('search_targets', [])
                fetch_qty = s_data.get('val', 1)
                
                while fetch_qty > 0:
                    best_target = None
                    for t in can_fetch:
                        if t in missing and missing[t] > 0:
                            best_target = t
                            break
                    if best_target:
                        missing[best_target] -= 1
                        fetch_qty -= 1
                    else:
                        break # 這張檢索牌找不到能對應的缺口了
                        
            return sum(missing.values()) <= 0

        # 第一波驗證
        if check_success(hand):
            success_count += 1
            continue
            
        # 若失敗，啟動智能連鎖抽牌
        max_supporter = 0
        total_item = 0
        for card in hand:
            if card in chain_dict:
                c_data = chain_dict[card]
                ctype = c_data.get('type', '')
                cval = c_data.get('val', 0)
                if '支援者' in ctype: max_supporter = max(max_supporter, cval)
                elif '物品/特性' in ctype: total_item += cval
                    
        total_draw = max_supporter + total_item
        if total_draw > 0:
            if is_dilute:
                deck.extend(['blank'] * hand_size)
                random.shuffle(deck)
            hand.extend(deck[:total_draw])
            # 抽完第二波再次驗證
            if check_success(hand):
                success_count += 1

    return (success_count / iterations) * 100.0

def group_cards(cards_list):
    groups = {}
    for c in cards_list: groups.setdefault(c['name'], []).append(c)
    return groups

# --- 視覺排版函數 (修復阿嬤的內褲文字) ---
def render_single_card(name, img_url, uid=None):
    uid_attr = f'data-uid="{uid}" draggable="true"' if uid is not None else ''
    cursor = 'cursor: grab;' if uid is not None else 'cursor: pointer;'
    brightness = 'filter: brightness(0.4);' if img_url == DEFAULT_CARDBACK else ''
    name_overlay = f'<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; color: #00E5FF; text-shadow: 2px 2px 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; font-weight: bold; font-size: 13px; line-height: 1.2; z-index: 5; text-align: center; word-wrap: break-word; pointer-events: none;">{name}</div>' if img_url == DEFAULT_CARDBACK else ""

    html = '<div style="position: relative; width: 100%; max-width: 150px; margin: 0 auto 10px auto; aspect-ratio: 63/88;">'
    html += f'<img src="{img_url}" class="ptcg-card" {uid_attr} style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 5px; transition: transform 0.1s; {cursor} {brightness}" onmouseover="this.style.transform=\'scale(1.05)\'" onmouseout="this.style.transform=\'scale(1)\'">'
    html += name_overlay
    html += '</div>'
    st.markdown(html, unsafe_allow_html=True)

def render_badge_card(name, img_url, count, uid=None):
    uid_attr = f'data-uid="{uid}" draggable="true"' if uid is not None else ''
    cursor = 'cursor: grab;' if uid is not None else 'cursor: pointer;'
    brightness = 'filter: brightness(0.4);' if img_url == DEFAULT_CARDBACK else ''
    name_overlay = f'<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; color: #00E5FF; text-shadow: 2px 2px 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; font-weight: bold; font-size: 13px; line-height: 1.2; z-index: 5; text-align: center; word-wrap: break-word; pointer-events: none;">{name}</div>' if img_url == DEFAULT_CARDBACK else ""

    html = '<div style="position: relative; width: 100%; max-width: 150px; margin: 0 auto 10px auto; aspect-ratio: 63/88;">'
    html += f'<img src="{img_url}" class="ptcg-card" {uid_attr} style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 5px; transition: transform 0.1s; {cursor} {brightness}" onmouseover="this.style.transform=\'scale(1.05)\'" onmouseout="this.style.transform=\'scale(1)\'">'
    html += name_overlay
    if count > 1: html += f'<div style="position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background-color: #E91E63; color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 12px; z-index: 10; border: 1px solid #0E1117; pointer-events: none;">x{count}</div>'
    html += '</div>'
    st.markdown(html, unsafe_allow_html=True)

def render_offset_stacked(name, img_url, group):
    count = len(group)
    if count == 0: return
    if count == 1:
        render_single_card(group[0].get('name', name), img_url, group[0].get('uid', None)); return
    extra_space = (count - 1) * 15
    html = f'<div style="position: relative; width: 100%; max-width: 150px; margin: 0 auto {extra_space + 10}px auto; aspect-ratio: 63/88;">'
    for i, c in enumerate(group):
        c_name = c.get('name', name)
        c_img = c.get('img', img_url)
        uid = c.get('uid', None)
        offset_y = i * 15; offset_x = i * 5
        is_top = (i == count - 1)
        uid_attr = f'data-uid="{uid}" draggable="true"' if is_top and uid is not None else ''
        cursor = 'cursor: grab;' if is_top and uid is not None else ''
        shadow = 'box-shadow: 2px 2px 5px rgba(0,0,0,0.5);' if i > 0 else ''
        brightness = 'filter: brightness(0.4);' if c_img == DEFAULT_CARDBACK else ''
        
        html += f'<img src="{c_img}" class="ptcg-card" {uid_attr} style="position: absolute; top: {offset_y}px; left: {offset_x}px; width: calc(100% - {(count-1)*5}px); height: 100%; object-fit: contain; border-radius: 5px; z-index: {i}; {shadow} {cursor} {brightness} transition: transform 0.1s;" onmouseover="this.style.transform=\'scale(1.05)\'" onmouseout="this.style.transform=\'scale(1)\'">'
        
        if c_img == DEFAULT_CARDBACK and is_top:
            html += f'<div style="position: absolute; top: calc(50% + {offset_y}px); left: calc(50% + {offset_x - ((count-1)*2.5)}px); transform: translate(-50%, -50%); width: 90%; color: #00E5FF; text-shadow: 2px 2px 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; font-weight: bold; font-size: 13px; line-height: 1.2; z-index: {i+1}; text-align: center; word-wrap: break-word; pointer-events: none;">{c_name}</div>'
    html += '</div>'
    st.markdown(html, unsafe_allow_html=True)

@st.dialog("👁️ 牌組預覽", width="large")
def preview_readonly_dialog(deck_to_show):
    if not deck_to_show: st.info("📭 牌組目前是空的！"); return
    deck_total = sum(c['qty'] for c in deck_to_show.values())
    st.markdown(f"### 總張數: <span style='color:{'#00E5FF' if deck_total == 60 else '#FF5252'};'>{deck_total}</span> / 60", unsafe_allow_html=True)
    cols = st.columns(6)
    idx = 0
    for name, card_info in list(deck_to_show.items()):
        if card_info['qty'] > 0:
            with cols[idx % 6]: render_badge_card(name, card_info['img'], card_info['qty'])
            idx += 1

# ==========================================
# 5. 側邊欄介面設計
# ==========================================
with st.sidebar:
    st.markdown("### 🗃️ 牌組管理中心")
    all_db_names = get_all_card_names(st.session_state.user_id)
    c1, c2 = st.columns([2, 1.2])
    with c1: st.markdown(f"<div style='font-size:12px; color:#888; margin-top:5px;'>🌍 全域: {st.session_state.db_tw_count+st.session_state.db_en_count}<br>🔐 你的自訂: {st.session_state.db_custom_count}</div>", unsafe_allow_html=True)
    with c2:
        # 💡 修復 2：只清除自定義卡片
        if st.button("🗑️ 清空我的自定義卡片", help="清除所有您手動新增的未建檔卡片"):
            try:
                conn = sqlite3.connect('custom_cards.db'); c = conn.cursor()
                c.execute("DROP TABLE IF EXISTS cards")
                conn.commit(); conn.close()
            except: pass
            init_dbs(); get_card_data.clear(); st.rerun()
            
    tab_link, tab_import, tab_edit = st.tabs(["🔗 官方代碼", "📝 文字匯入", "🛠️ 編輯"])
    
    with tab_link:
        st.markdown("👉 **[前往寶可夢台灣官網](https://asia.pokemon-card.com/tw/)**") 
        deck_code_input = st.text_input("牌組編碼", placeholder="例: uCRvSM-NdxUvZ-iWAqYI")
        if st.button("🌐 解析官方牌組", use_container_width=True):
            if deck_code_input:
                parsed_deck, msg = fetch_official_deck(deck_code_input)
                if parsed_deck: st.session_state.deck_dict = parsed_deck; st.success(msg)
                else: st.error(msg)
        if st.session_state.deck_dict and st.button("👁️ 預覽解析結果", key="preview_link", use_container_width=True):
            preview_readonly_dialog(st.session_state.deck_dict)

    with tab_import:
        st.markdown("👉 **[前往 Limitless 抄牌網](https://limitlesstcg.com/decks)**")
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
                        search_name = parse_match.group(1).strip() if parse_match else raw_name
                        target_set = parse_match.group(2) if parse_match and parse_match.group(2) else None
                        target_number = parse_match.group(3) if parse_match and parse_match.group(3) else None
                        
                        final_card_key = f"{search_name} [{target_set} {target_number}]" if target_set and target_number else search_name
                        temp_deck[final_card_key] = {'qty': temp_deck.get(final_card_key, {}).get('qty', 0) + qty, 'search_name': search_name, 'target_set': target_set, 'target_number': target_number}
                
                my_bar = st.progress(0, text="🚀 正在為英文卡片抓取圖片 (100% 網路直抓中)...")
                keys_list = list(temp_deck.keys())
                total_cards = len(keys_list)
                final_deck_dict = {}
                headers = {'User-Agent': 'Mozilla/5.0'}
                
                for i, c_key in enumerate(keys_list):
                    my_bar.progress((i) / total_cards if total_cards > 0 else 1.0, text=f"正在處理 ({i+1}/{total_cards}): {c_key}")
                    data = temp_deck[c_key]
                    search_name = data['search_name']; target_set = data['target_set']; target_number = data['target_number']; qty = data['qty']
                    img_url = None

                    if target_set and target_number:
                        try:
                            ll_resp = requests.get(f"https://limitlesstcg.com/cards/{target_set}/{target_number}", headers=headers, timeout=5)
                            if ll_resp.status_code == 200:
                                ll_soup = BeautifulSoup(ll_resp.text, 'html.parser')
                                ll_img = ll_soup.select_one('.card-image-wrapper img') or ll_soup.select_one('.card-img img') or ll_soup.select_one('div.card img')
                                if ll_img and ll_img.get('src'): img_url = ll_img['src']
                                if not img_url:
                                    for img in ll_soup.find_all('img'):
                                        if target_set.lower() in img.get('src', '').lower() and target_number.lower() in img.get('src', '').lower():
                                            img_url = img['src']; break
                        except: pass
                    
                    if not img_url:
                        try:
                            safe_search = search_name.replace('"', '').strip()
                            if "Energy" in safe_search and safe_search.startswith("Basic "): safe_search = safe_search.replace("Basic ", "").strip()
                            query = f'name:"{safe_search}"'
                            if target_number: query += f' number:"{target_number}"'
                                
                            for _ in range(3):
                                time.sleep(0.5) 
                                try:
                                    resp = requests.get("https://api.pokemontcg.io/v2/cards", params={"q": query, "orderBy": "-set.releaseDate"}, headers=headers, timeout=10)
                                    if resp.status_code == 200:
                                        api_data = resp.json()
                                        if api_data and api_data.get('data'):
                                            for card in api_data['data']:
                                                if str(card.get('number', '')) == target_number:
                                                    img_url = card['images']['large']; break
                                            if not img_url: img_url = api_data['data'][0]['images']['large']
                                        break
                                except: time.sleep(1.0)
                        except: pass 

                    if img_url: 
                        save_card_to_db(c_key, img_url, lang="en")
                    else: 
                        img_url = get_card_data(c_key, st.session_state.user_id)['img']
                        
                    final_deck_dict[c_key] = {'qty': qty, 'img': img_url}
                    
                my_bar.empty()
                st.session_state.deck_dict = final_deck_dict
                st.success("✅ 解析成功！(已同步至本地)")
                get_card_data.clear()
        
        if st.session_state.deck_dict and st.button("👁️ 預覽解析結果", key="preview_import", use_container_width=True):
            preview_readonly_dialog(st.session_state.deck_dict)

    with tab_edit:
        st.session_state.deck_total = sum(card_info['qty'] for card_info in st.session_state.deck_dict.values())
        st.markdown(f"**總張數:** <span style='color:{'green' if st.session_state.deck_total == 60 else 'red'}; font-size:18px;'>{st.session_state.deck_total} / 60</span>", unsafe_allow_html=True)
        
        current_names_in_edit = list(all_db_names)
        for d_name in st.session_state.deck_dict.keys():
            if d_name not in current_names_in_edit: current_names_in_edit.append(d_name)
        current_names_in_edit = sorted(list(set(current_names_in_edit)))
        
        sel_card = st.selectbox("🔍 從資料庫新增卡片", ["請選擇..."] + current_names_in_edit, key="side_search")
        if sel_card != "請選擇...":
            c_data = get_card_data(sel_card, st.session_state.user_id)
            c1, c2 = st.columns([1, 1.5])
            with c1: render_single_card(sel_card, c_data['img'])
            with c2:
                current_qty = st.session_state.deck_dict[sel_card]['qty'] if sel_card in st.session_state.deck_dict else 0
                st.markdown(f"<div style='font-size:13px; color:#ccc; margin-bottom:10px;'>目前牌組內： <b>{current_qty}</b> 張</div>", unsafe_allow_html=True)
                if st.button("➕ 加入牌組", key=f"add_sel_{sel_card}", use_container_width=True):
                    if sel_card not in st.session_state.deck_dict: st.session_state.deck_dict[sel_card] = {'qty': 0, 'img': c_data['img']}
                    st.session_state.deck_dict[sel_card]['qty'] += 1; st.rerun()

        st.markdown("<div style='margin-top:15px;'></div>", unsafe_allow_html=True)
        custom_card = st.text_input("✍️ 強制手動輸入未建檔卡片", placeholder="輸入後將綁定您的玩家 ID")
        if st.button("➕ 建立專屬卡片", use_container_width=True) and custom_card.strip():
            c_name = custom_card.strip()
            save_custom_card(st.session_state.user_id, c_name, DEFAULT_CARDBACK)
            if c_name not in st.session_state.deck_dict: st.session_state.deck_dict[c_name] = {'qty': 0, 'img': DEFAULT_CARDBACK}
            st.session_state.deck_dict[c_name]['qty'] += 1
            st.rerun()

        st.divider()
        if st.session_state.deck_dict:
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
                    if st.button("➕", key=f"add_{card_name}"): st.session_state.deck_dict[card_name]['qty'] += 1; st.rerun()

    st.divider()
    if st.button("🎲 鎖定牌組並開局\n(洗牌+抽7+獎賞6)", use_container_width=True, type="primary"):
        if st.session_state.deck_total != 60: st.error("⚠️ 牌組必須剛好 60 張才能開局！")
        else:
            pool = []
            uid = 0
            for name, card_info in st.session_state.deck_dict.items():
                for _ in range(card_info['qty']):
                    pool.append({"uid": str(uid), "name": name, "img": card_info['img'], "zone": "deck"})
                    uid += 1
            st.session_state.cards_pool = pool
            st.session_state.history = []; st.session_state.ptr = -1
            st.session_state.direct_targets = {}; st.session_state.chain_targets = {}; st.session_state.scenarios = []
            save_state()
            random.shuffle(st.session_state.cards_pool)
            for i in range(7): st.session_state.cards_pool[i]['zone'] = 'hand'
            for i in range(7, 13): st.session_state.cards_pool[i]['zone'] = f'prize_{i-7}'
            st.rerun()

# ==========================================
# 6. 主視圖 (戰場) 
# ==========================================
if not st.session_state.cards_pool:
    st.info("👈 請在左側載入或編輯牌組，完成 60 張後點擊「鎖定牌組並開局」。\n\n💡 提示：善用左上方的「縮放控制」將戰場完美塞入一頁！")
else:
    deck_cards = [c for c in st.session_state.cards_pool if c['zone'] == 'deck']
    hand_cards = [c for c in st.session_state.cards_pool if c['zone'] == 'hand']
    discard_cards = [c for c in st.session_state.cards_pool if c['zone'] == 'discard']

    with st.expander("🎯 進階情境：機率與連鎖分析 (萬次蒙地卡羅運算)", expanded=False):
        c1, c2, c3 = st.columns([1.3, 1.4, 1.3])
        deck_groups = group_cards(deck_cards)
        
        with c1:
            st.markdown("**🔥 1. 直接解牌 (設定需要張數)**")
            with st.popover("🖼️ 開啟圖庫選取目標牌", use_container_width=True):
                d_cols = st.columns(3)
                for i, (name, group) in enumerate(deck_groups.items()):
                    c = group[0]
                    with d_cols[i % 3]:
                        render_badge_card(name, c['img'], len(group))
                        if name in st.session_state.direct_targets:
                            if st.button("❌ 取消", key=f"rm_d_{name}", use_container_width=True): del st.session_state.direct_targets[name]; st.rerun()
                        else:
                            if st.button("✅ 選擇", key=f"add_d_{name}", use_container_width=True):
                                st.session_state.direct_targets[name] = {'qty': 1}
                                if name in st.session_state.chain_targets: del st.session_state.chain_targets[name]
                                st.rerun()
            if st.session_state.direct_targets:
                st.markdown("<div style='margin-top:5px;'></div>", unsafe_allow_html=True)
                for t_name, t_data in list(st.session_state.direct_targets.items()):
                    # 相容舊版資料結構
                    if isinstance(t_data, int): t_data = {'qty': t_data}
                    
                    t_img = next((c['img'] for c in st.session_state.cards_pool if c['name'] == t_name), DEFAULT_CARDBACK)
                    tc1, tc2 = st.columns([1, 1.5])
                    with tc1: render_single_card(t_name, t_img)
                    with tc2: 
                        max_v = max(1, len([c for c in deck_cards if c['name'] == t_name]))
                        new_qty = st.number_input("需要幾張?", min_value=1, max_value=max_v, value=t_data.get('qty', 1), key=f"qty_d_{t_name}")
                        st.session_state.direct_targets[t_name] = {'qty': new_qty}
            draw1 = st.slider("第一波抽牌數:", 1, 15, 1, key="sld_d1")
            
        with c2:
            st.markdown("**🔄 2. 延續解牌 (抽牌或檢索)**")
            with st.popover("🖼️ 開啟圖庫選取連鎖牌", use_container_width=True):
                c_cols = st.columns(3)
                for i, (name, group) in enumerate(deck_groups.items()):
                    c = group[0]
                    with c_cols[i % 3]:
                        render_badge_card(name, c['img'], len(group))
                        if name in st.session_state.chain_targets:
                            if st.button("❌ 取消", key=f"rm_c_{name}", use_container_width=True): del st.session_state.chain_targets[name]; st.rerun()
                        else:
                            if st.button("✅ 選擇", key=f"add_c_{name}", use_container_width=True):
                                st.session_state.chain_targets[name] = {'type': '抽牌資源 (物品/特性)', 'val': 3, 'search_targets': []}
                                if name in st.session_state.direct_targets: del st.session_state.direct_targets[name]
                                st.rerun()
            
            if st.session_state.chain_targets:
                st.markdown("<div style='margin-top:5px;'></div>", unsafe_allow_html=True)
                for t_name, t_data in list(st.session_state.chain_targets.items()):
                    t_img = next((c['img'] for c in st.session_state.cards_pool if c['name'] == t_name), DEFAULT_CARDBACK)
                    tc1, tc2 = st.columns([1, 1.5])
                    with tc1: render_single_card(t_name, t_img)
                    with tc2: 
                        c_type_old = t_data.get('type', '抽牌資源 (物品/特性)')
                        type_idx = 1 if '支援者' in c_type_old else (2 if '檢索' in c_type_old else 0)
                        
                        c_type_new = st.selectbox("卡片類型", ["抽牌資源 (物品/特性)", "抽牌資源 (支援者)", "檢索資源 (拿目標牌)"], index=type_idx, key=f"type_c_{t_name}")
                        
                        if '檢索' in c_type_new:
                            new_val = st.number_input("能抓幾張目標?", min_value=1, max_value=10, value=t_data.get('val', 1), key=f"qty_c_{t_name}")
                            valid_targets = list(st.session_state.direct_targets.keys())
                            valid_saved = [t for t in t_data.get('search_targets', []) if t in valid_targets]
                            if not valid_targets:
                                st.warning("⚠️ 請先在左側設定直接解牌目標")
                                new_targets = []
                            else:
                                new_targets = st.multiselect("可檢索哪些目標？", valid_targets, default=valid_saved, key=f"st_{t_name}")
                            st.session_state.chain_targets[t_name] = {'type': c_type_new, 'val': new_val, 'search_targets': new_targets}
                        else:
                            new_val = st.number_input("能抽幾張?", min_value=1, max_value=15, value=t_data.get('val', 3), key=f"qty_c_{t_name}")
                            st.session_state.chain_targets[t_name] = {'type': c_type_new, 'val': new_val, 'search_targets': []}
            
            chain_effect = st.radio("若發動連鎖，牌庫處理：", ["純抽 / 不稀釋", "將無用手牌洗回牌庫"], index=0, horizontal=True)
            is_dilute = (chain_effect != "純抽 / 不稀釋")
            h_size = st.number_input("發動前手牌廢牌張數", 0, 20, 0) if is_dilute else 0
            
        with c3:
            st.markdown("**📊 分析結果 (1萬次模擬)**")
            if st.session_state.direct_targets:
                # 💡 修復 1：修正參數呼叫 is_dilute=is_dilute
                with st.spinner("正在進行 10,000 次實盤對局推演..."):
                    final_prob = run_monte_carlo(deck_cards, st.session_state.direct_targets, st.session_state.chain_targets, draw1, is_dilute=is_dilute, hand_size=h_size, iterations=10000)
                
                d_desc = " + ".join([f"{n[:4]}x{d.get('qty', 1)}" for n, d in st.session_state.direct_targets.items()])
                c_desc = " / ".join([f"{n[:4]}(抽{d.get('val', 3)})" if '抽牌' in d.get('type', '') else f"{n[:4]}(檢索)" for n, d in st.session_state.chain_targets.items()]) if st.session_state.chain_targets else "無"
                
                st.markdown(f"""
                <div style='background-color:#1E1E1E; padding:15px; border-radius:8px; border:1px solid #444;'>
                    <div style='font-size:14px; color:#bbb;'>牌庫目前剩餘: <b>{len(deck_cards)}</b> 張</div>
                    <div style='font-size:14px; color:#FFB300; margin-top:5px;'>🎯 目標: <b>{d_desc}</b></div>
                    <div style='font-size:14px; color:#4FC3F7; margin-top:2px;'>🔄 連鎖: <b>{c_desc}</b></div>
                    <div style='font-size:16px; margin-top:10px;'>第一波 <b>{draw1}</b> 抽，若失敗發動智能連鎖：</div>
                    <div style='font-size:16px;'>成功拿到解牌的總機率為：</div>
                    <div style='color:#00E5FF; font-size:36px; font-weight:bold; margin-top:5px;'>{final_prob:.1f}%</div>
                </div>
                """, unsafe_allow_html=True)
                
                if st.button("📌 紀錄此方案至比較板", use_container_width=True):
                    st.session_state.scenarios.append({
                        "title": f"首波 {draw1} 抽 ➜ 智能連鎖",
                        "desc_target": f"解: {d_desc}", "desc_chain": f"連鎖: {c_desc}", "prob": final_prob
                    })
                    st.rerun()
            else: st.info("👈 請點選並設定「直接解牌」來啟動運算。")

        if st.session_state.scenarios:
            st.divider()
            c_title, c_btn = st.columns([5, 1])
            with c_title: st.markdown("**📌 A/B 路線比較紀錄板**")
            with c_btn:
                if st.button("🗑️ 清空板子", use_container_width=True): st.session_state.scenarios = []; st.rerun()
            s_cols = st.columns(max(len(st.session_state.scenarios), 4))
            for idx, scn in enumerate(st.session_state.scenarios):
                border_color = "#FF4B4B" if scn['prob'] == max([s['prob'] for s in st.session_state.scenarios]) else "#444"
                with s_cols[idx % len(s_cols)]:
                    st.markdown(f"""
                    <div style='background-color:#262730; padding:10px; border-radius:8px; border-top:4px solid {border_color}; margin-bottom:5px;'>
                        <div style='color:#ccc; font-size:11px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;'>{scn['desc_target']}</div>
                        <div style='color:#fff; font-size:13px; font-weight:bold; margin-top:4px;'>{scn['title']}</div>
                        <div style='color:#00E5FF; font-size:24px; font-weight:bold;'>{scn['prob']:.1f}%</div>
                    </div>
                    """, unsafe_allow_html=True)

    col_l, col_m, col_r = st.columns([1.5, 5.5, 2.0])
    
    with col_l:
        st.markdown("**🏆 獎賞卡** (防呆:互換)")
        for r_idx in range(3):
            p_cols = st.columns(2)
            for c_idx in range(2):
                i = r_idx * 2 + c_idx
                with p_cols[c_idx]:
                    st.markdown(f'<div id="marker-prize_{i}" data-zone="prize_{i}" style="display:none;"></div>', unsafe_allow_html=True)
                    pc = next((c for c in st.session_state.cards_pool if c['zone'] == f'prize_{i}'), None)
                    if pc:
                        render_single_card(pc['name'], pc['img'], uid=pc['uid'])
                        p_btn1, p_btn2 = st.columns(2)
                        if p_btn1.button("手", key=f"p2h_{pc['uid']}_{i}"): save_state(); pc['zone'] = 'hand'; st.rerun()
                        if p_btn2.button("棄", key=f"p2d_{pc['uid']}_{i}"): save_state(); pc['zone'] = 'discard'; st.rerun()
                    else: 
                        st.markdown("<div style='width: 100%; max-width: 150px; margin: 0 auto 10px auto; aspect-ratio: 63/88; border:2px dashed #444; border-radius:5px; display:flex; align-items:center; justify-content:center; color:#555; pointer-events:none;'>空</div>", unsafe_allow_html=True)
                        pb1, pb2 = st.columns(2)
                        pb1.button("手", key=f"empty_h_{i}", disabled=True)
                        pb2.button("棄", key=f"empty_d_{i}", disabled=True)

    with col_m:
        st.markdown("**🔴 戰鬥場 (Active) - 錯位疊放**")
        with st.container(border=True):
            active_cards = [c for c in st.session_state.cards_pool if c['zone'] == 'active']
            a_cols = st.columns(5)
            with a_cols[2]: 
                st.markdown('<div id="marker-active" data-zone="active" style="display:none;"></div>', unsafe_allow_html=True)
                if active_cards:
                    render_offset_stacked(active_cards[0]['name'], active_cards[-1]['img'], active_cards)
                    with st.popover("⚙️ 操作", use_container_width=True):
                        for c in reversed(active_cards):
                            st.markdown(f"<div style='font-size:12px; font-weight:bold; margin-bottom:5px; color:#00E5FF;'>{c['name']}</div>", unsafe_allow_html=True)
                            if st.button("🔼 置頂", key=f"top_a_{c['uid']}", use_container_width=True): save_state(); st.session_state.cards_pool.remove(c); st.session_state.cards_pool.append(c); st.rerun()
                            st.markdown("<hr style='margin:5px 0; border-color:#444;'>", unsafe_allow_html=True)
                else: 
                    st.markdown("<div style='width: 100%; max-width: 150px; margin: 0 auto 10px auto; aspect-ratio: 63/88; border:2px dashed #444; border-radius:5px; display:flex; align-items:center; justify-content:center; color:#555; pointer-events:none;'>空置</div>", unsafe_allow_html=True)
                    st.button("⚙️ 操作", key="empty_a", disabled=True, use_container_width=True)

        st.markdown("**🔵 備戰區 (Bench) - 錯位疊放**")
        with st.container(border=True):
            b_cols = st.columns(5)
            for i in range(5):
                with b_cols[i]:
                    st.markdown(f'<div id="marker-bench_{i}" data-zone="bench_{i}" style="display:none;"></div>', unsafe_allow_html=True)
                    bench_group = [c for c in st.session_state.cards_pool if c['zone'] == f'bench_{i}']
                    if bench_group:
                        render_offset_stacked(bench_group[0]['name'], bench_group[-1]['img'], bench_group)
                        with st.popover("⚙️ 操作", use_container_width=True):
                            for c in reversed(bench_group):
                                st.markdown(f"<div style='font-size:12px; font-weight:bold; margin-bottom:5px; color:#00E5FF;'>{c['name']}</div>", unsafe_allow_html=True)
                                if st.button("🔼 置頂", key=f"top_b_{c['uid']}", use_container_width=True): save_state(); st.session_state.cards_pool.remove(c); st.session_state.cards_pool.append(c); st.rerun()
                                st.markdown("<hr style='margin:5px 0; border-color:#444;'>", unsafe_allow_html=True)
                    else: 
                        st.markdown(f"<div style='width: 100%; max-width: 150px; margin: 0 auto 10px auto; aspect-ratio: 63/88; border:2px dashed #444; border-radius:5px; display:flex; align-items:center; justify-content:center; color:#555; pointer-events:none;'>空 ({i+1})</div>", unsafe_allow_html=True)
                        st.button("⚙️ 操作", key=f"empty_b_{i}", disabled=True, use_container_width=True)

        m_col1, m_col2, m_col3, m_col4 = st.columns([2, 1, 1, 1])
        with m_col1: st.markdown(f"**🖐️ 手牌 ({len(hand_cards)}) - 支援拖放**")
        with m_col2: 
            if st.button("🔄 洗回", use_container_width=True):
                save_state()
                for c in st.session_state.cards_pool:
                    if c['zone'] == 'hand': c['zone'] = 'deck'
                random.shuffle(st.session_state.cards_pool); st.rerun()
        with m_col3:
            if st.button("⬇️ 牌底", use_container_width=True):
                save_state()
                hand_to_move = [c for c in st.session_state.cards_pool if c['zone'] == 'hand']
                st.session_state.cards_pool = [c for c in st.session_state.cards_pool if c['zone'] != 'hand']
                for c in hand_to_move: c['zone'] = 'deck'; st.session_state.cards_pool.append(c)
                st.rerun()
        with m_col4:
            if st.button("🗑️ 棄牌", use_container_width=True):
                save_state()
                for c in st.session_state.cards_pool:
                    if c['zone'] == 'hand': c['zone'] = 'discard'
                st.rerun()

        with st.container(border=True):
            st.markdown('<div id="marker-hand" data-zone="hand" style="display:none;"></div>', unsafe_allow_html=True)
            if hand_cards:
                hand_groups = group_cards(hand_cards)
                hand_groups_list = list(hand_groups.items())
                MAX_HAND_COLS = 10
                for r in range(math.ceil(len(hand_groups_list) / MAX_HAND_COLS)):
                    row_items = hand_groups_list[r * MAX_HAND_COLS : (r + 1) * MAX_HAND_COLS]
                    h_cols = st.columns(MAX_HAND_COLS)
                    for idx, (name, group) in enumerate(row_items):
                        c = group[0]; count = len(group)
                        with h_cols[idx]:
                            render_badge_card(name, c['img'], count, uid=c['uid'])
                            with st.popover("⚙️ 操作", use_container_width=True):
                                if st.button("⚔️ 戰鬥", key=f"ha_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'active'; st.rerun()
                                if st.button("🛡️ 備戰", key=f"hb_{c['uid']}", use_container_width=True):
                                    save_state()
                                    for b_idx in range(5):
                                        if not any(bc['zone'] == f'bench_{b_idx}' for bc in st.session_state.cards_pool):
                                            c['zone'] = f'bench_{b_idx}'; break
                                    st.rerun()
                                if st.button("🗑️ 棄牌", key=f"hd_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'discard'; st.rerun()
                                if st.button("🃏 回庫", key=f"hk_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'deck'; st.rerun()
            else: st.markdown("<div style='width: 100%; max-width: 150px; margin: 0 auto 10px auto; aspect-ratio: 63/88; border:2px dashed #444; border-radius:5px; display:flex; align-items:center; justify-content:center; color:#555; pointer-events:none;'>手牌空置</div>", unsafe_allow_html=True)

    with col_r:
        st.markdown(f"**🗃️ 牌庫 ({len(deck_cards)}) - 支援拖入**")
        d_col1, d_col2, d_col3 = st.columns([1, 2, 1])
        with d_col2: 
            st.markdown('<div id="marker-deck" data-zone="deck" style="display:none;"></div>', unsafe_allow_html=True)
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
                    render_badge_card(name, c['img'], len(group))
                    if st.button("上手", key=f"d2h_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'hand'; st.rerun()

        st.markdown("<div style='margin: 15px 0;'></div>", unsafe_allow_html=True) 
        
        st.markdown(f"**🪦 棄牌 ({len(discard_cards)}) - 支援拖放**")
        disc_c1, disc_c2, disc_c3 = st.columns([1, 2, 1])
        with disc_c2:
            st.markdown('<div id="marker-discard" data-zone="discard" style="display:none;"></div>', unsafe_allow_html=True)
            if discard_cards: render_single_card(discard_cards[-1]['name'], discard_cards[-1]['img'], uid=discard_cards[-1]['uid'])
            else: st.markdown("<div style='width: 100%; max-width: 150px; margin: 0 auto 10px auto; aspect-ratio: 63/88; border:2px dashed #444; display:flex; align-items:center; justify-content:center; border-radius:5px; color:#555; pointer-events:none;'>無</div>", unsafe_allow_html=True)
            
        with st.popover("🔍 檢索棄牌", use_container_width=True):
            kw2 = st.text_input("搜尋棄牌...", key="s_discard").strip().lower()
            filtered_disc = [c for c in discard_cards if kw2 in c['name'].lower()]
            disc_groups = group_cards(filtered_disc)
            dd_cols = st.columns(3)
            for i, (name, group) in enumerate(disc_groups.items()):
                c = group[0]
                with dd_cols[i % 3]:
                    render_badge_card(name, c['img'], len(group))
                    if st.button("回手", key=f"dd2h_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'hand'; st.rerun()
                    if st.button("回庫", key=f"dd2d_{c['uid']}", use_container_width=True): save_state(); c['zone'] = 'deck'; st.rerun()

        st.markdown("<div style='margin-top: 15px;'></div>", unsafe_allow_html=True) 
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
