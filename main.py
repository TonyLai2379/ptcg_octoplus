from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import re
import random
import requests
import os
import datetime
import json
from bs4 import BeautifulSoup
from typing import List, Dict, Optional, Any
from supabase import create_client, Client

app = FastAPI(title="PTCG Octoplus API", version="7.1.0")

# 🔒 跨域資源共享限制
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.path.exists("tutor_pic"):
    app.mount("/tutor_pic", StaticFiles(directory="tutor_pic"), name="tutor_pic")

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://cnjajimwpuuhkdxelgwg.supabase.co")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "sb_secret_rQ9BehEwCzjbAF5oRDNzYw_l1cXhpbC")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

DEFAULT_CARDBACK = "https://asia.pokemon-card.com/tw/assets/images/card-back.png"

# ==========================================
# ⚡ 本地卡庫極速載入機制
# ==========================================
LOCAL_CARD_DB = {}

def load_local_db():
    """啟動時讀取本地 json 檔案，存入記憶體提供 0 延遲檢索"""
    global LOCAL_CARD_DB
    for db_name in ["ptcg_tw.json", "ptcg_en.json"]:
        if os.path.exists(db_name):
            try:
                with open(db_name, "r", encoding="utf-8") as f:
                    cards = json.load(f)
                    for card in cards:
                        name = card.get("name", "")
                        img = card.get("img_url", "")
                        card_id = card.get("id", "") # 例如: sv1-001
                        if name and img:
                            LOCAL_CARD_DB[name] = img
                            if card_id:
                                LOCAL_CARD_DB[f"{name} [{card_id}]"] = img
            except Exception as e:
                print(f"讀取 {db_name} 失敗: {e}")

load_local_db()

# ==========================================
# 1. 驗證權限與每日 30 次限制
# ==========================================
def verify_user_and_check_limit(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="請先登入帳號以使用推演功能")
    
    token = authorization.split(" ")[1]
    try:
        user_res = supabase.auth.get_user(token)
        if not user_res or not user_res.user:
            raise HTTPException(status_code=401, detail="無效的登入 Token，請重新登入")
        
        user_id = user_res.user.id
        today_str = str(datetime.date.today())
        
        # 1. 檢查用戶 Profile (若無則自動建立)
        profile_res = supabase.table("profiles").select("*").eq("id", user_id).execute()
        if not profile_res.data:
            supabase.table("profiles").insert({"id": user_id, "is_pro": False, "trial_used": False}).execute()
            is_pro = False
        else:
            profile = profile_res.data[0]
            is_pro = profile.get("is_pro", False)
            # 這裡可以擴充檢查 pro_expires_at 是否過期
        
        if is_pro:
            return {"user_id": user_id, "is_pro": True, "remaining_today": 9999}
            
        # 2. 普通用戶：每日限制 30 次
        sim_res = supabase.table("daily_simulations").select("count").eq("user_id", user_id).eq("usage_date", today_str).execute()
        used_today = sim_res.data[0]["count"] if sim_res.data else 0
        
        if used_today >= 30:
            # 回傳 403 觸發前端訂閱視窗
            raise HTTPException(status_code=403, detail="LIMIT_REACHED")
            
        # 用量 +1
        supabase.table("daily_simulations").upsert({
            "user_id": user_id,
            "usage_date": today_str,
            "count": used_today + 1
        }).execute()
        
        return {"user_id": user_id, "is_pro": False, "remaining_today": 30 - (used_today + 1)}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"權限驗證失敗: {str(e)}")

# ==========================================
# 2. 蒙地卡羅引擎
# ==========================================
def run_monte_carlo(deck_cards, direct_dict, chain_dict, draw1, target_rule="AND", dead_hand_size=0, iterations=10000):
    if not deck_cards or draw1 <= 0 or not direct_dict: return 0.0
    base_deck = [c['name'] for c in deck_cards]
    success_count = 0
    for _ in range(iterations):
        deck = base_deck.copy()
        random.shuffle(deck)
        hand = deck[:draw1]
        deck = deck[draw1:]
        
        for k, v in chain_dict.items():
            if v.get('guaranteed') and k not in hand: hand.append(k)

        def check_success(current_hand):
            missing = {k: v.get('qty', 1) for k, v in direct_dict.items()}
            search_cards = []
            for card in current_hand:
                if card in missing and missing[card] > 0: missing[card] -= 1
                elif card in chain_dict and '檢索' in chain_dict[card].get('type', ''): search_cards.append(card)
            
            def is_satisfied(m_dict):
                if target_rule == "AND": return sum(m_dict.values()) <= 0
                else: return any(m_dict[k] < direct_dict[k]['qty'] for k in direct_dict)
            
            if is_satisfied(missing): return True
            
            for s_card in search_cards:
                can_fetch = chain_dict[s_card].get('search_targets', [])
                fetch_qty = chain_dict[s_card].get('val', 1)
                while fetch_qty > 0:
                    best_target = None
                    for t in can_fetch:
                        if t in missing and missing[t] > 0: best_target = t; break
                    if best_target: missing[best_target] -= 1; fetch_qty -= 1
                    else: break 
            return is_satisfied(missing)

        if check_success(hand): success_count += 1; continue
            
        max_supporter = 0; total_item = 0
        for card in hand:
            if card in chain_dict:
                ctype = chain_dict[card].get('type', ''); cval = chain_dict[card].get('val', 0)
                if '支援者' in ctype: max_supporter = max(max_supporter, cval)
                elif '物品/特性' in ctype: total_item += cval
                    
        total_draw = max_supporter + total_item
        if total_draw > 0:
            if dead_hand_size > 0: deck.extend(['blank'] * dead_hand_size); random.shuffle(deck)
            hand.extend(deck[:total_draw])
            if check_success(hand): success_count += 1

    return (success_count / iterations) * 100.0

# ==========================================
# 3. Pydantic Models
# ==========================================
class ParseOfficialReq(BaseModel): deck_code: str
class ParseTextReq(BaseModel): text: str
class RedeemCodeReq(BaseModel): code: str
class SaveDeckReq(BaseModel): deck_name: str; deck_data: str
class ShareGameReq(BaseModel): game_data: List[Dict[str, Any]]
class MonteCarloReq(BaseModel):
    deck_cards: List[Dict[str, Any]]
    direct_targets: Dict[str, Any]
    chain_targets: Dict[str, Any]
    draw1: int
    target_rule: str = "AND"
    dead_hand_size: int = 0

# ==========================================
# 4. API Endpoints
# ==========================================
@app.get("/")
def serve_index():
    if os.path.exists("index.html"): return FileResponse("index.html")
    return {"message": "找不到 index.html"}

@app.get("/api/v1/marquee")
def api_get_marquee():
    file_path = "dialogue.txt"
    if not os.path.exists(file_path):
        return {"text": "💡 歡迎使用 PTCG 專業沙盤推演機！"}
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]
            if lines:
                random.shuffle(lines)
                return {"text": " &nbsp;&nbsp;&nbsp;&nbsp; | &nbsp;&nbsp;&nbsp;&nbsp; ".join(lines)}
            return {"text": "💡 歡迎使用 PTCG 專業沙盤推演機！"}
    except Exception:
        return {"text": "💡 歡迎使用 PTCG 專業沙盤推演機！"}

# 🎁 兌換碼 API
@app.post("/api/v1/redeem_code")
def api_redeem_code(req: RedeemCodeReq, auth_header: Optional[str] = Header(None)):
    if not auth_header: raise HTTPException(status_code=401, detail="請先登入帳號")
    token = auth_header.split(" ")[1]
    user_res = supabase.auth.get_user(token)
    if not user_res or not user_res.user: raise HTTPException(status_code=401, detail="登入無效")
    
    user_id = user_res.user.id
    code = req.code.strip().upper()
    
    code_res = supabase.table("promo_codes").select("*").eq("code", code).execute()
    if not code_res.data: raise HTTPException(status_code=400, detail="❌ 無效的兌換碼")
        
    promo = code_res.data[0]
    if promo["used_count"] >= promo["max_uses"]:
        raise HTTPException(status_code=400, detail="❌ 此兌換碼已被領取完畢")
        
    days = promo["days_valid"]
    
    # 確保 profile 存在
    p_res = supabase.table("profiles").select("id").eq("id", user_id).execute()
    if not p_res.data: supabase.table("profiles").insert({"id": user_id}).execute()

    # 升級 Pro
    supabase.table("profiles").update({
        "is_pro": True,
        "pro_expires_at": f"now() + interval '{days} days'"
    }).eq("id", user_id).execute()
    
    supabase.table("promo_codes").update({"used_count": promo["used_count"] + 1}).eq("code", code).execute()
    return {"success": True, "detail": f"🎉 成功兌換！已為你開通 {days} 天 Pro 專業無限推演權限。"}

# 🎁 免費體驗 7 天 API
@app.post("/api/v1/activate_trial")
def api_activate_trial(auth_header: Optional[str] = Header(None)):
    if not auth_header: raise HTTPException(status_code=401, detail="請先登入帳號")
    token = auth_header.split(" ")[1]
    user_res = supabase.auth.get_user(token)
    if not user_res or not user_res.user: raise HTTPException(status_code=401)
    
    user_id = user_res.user.id
    p_res = supabase.table("profiles").select("*").eq("id", user_id).execute()
    
    if not p_res.data:
        supabase.table("profiles").insert({"id": user_id, "trial_used": False}).execute()
        trial_used = False
    else:
        trial_used = p_res.data[0].get("trial_used", False)
        
    if trial_used:
        raise HTTPException(status_code=400, detail="您已經使用過 7 天免費體驗囉！")
        
    supabase.table("profiles").update({
        "is_pro": True,
        "trial_used": True,
        "pro_expires_at": "now() + interval '7 days'"
    }).eq("id", user_id).execute()
    
    return {"success": True, "detail": "🎉 體驗開通成功！接下來 7 天可無限制使用所有專業功能。"}

# 🌐 解析官方牌組代碼
@app.post("/api/v1/parse_official")
def api_parse_official(req: ParseOfficialReq):
    code_match = re.search(r'([a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6})', req.deck_code)
    if not code_match: return {"success": False, "detail": "❌ 無效的代碼。"}
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        worker_url = f"https://ptcgmaster.loganlai0422.workers.dev/?code={code_match.group(1)}"
        response = requests.get(worker_url, headers=headers, timeout=15)
        soup = BeautifulSoup(response.text, 'html.parser')
        new_deck = {}
        card_items = soup.find_all('li', class_='card')

        for item in card_items:
            name_tag = item.find('p', class_='cardName')
            qty_tag = item.find('div', class_='cardCount')
            if name_tag and qty_tag:
                name = re.sub(r'\s+', ' ', name_tag.text.strip()).strip()
                try: qty = int(re.sub(r'\D', '', qty_tag.text)) if re.sub(r'\D', '', qty_tag.text) else 1
                except: qty = 1

                a_tag = name_tag.find('a')
                unique_id = ""
                if a_tag and a_tag.get('href'):
                    parts = [p for p in a_tag.get('href', '').split('/') if p]
                    if parts: unique_id = parts[-1]

                card_key = f"{name} [{unique_id}]" if unique_id else name
                
                # ⚡ 第一優先：檢查本地快取字典
                img_url = LOCAL_CARD_DB.get(card_key) or LOCAL_CARD_DB.get(name)
                
                # 🐢 第二優先：官網爬蟲 (本地沒有才觸發)
                if not img_url:
                    img_url = DEFAULT_CARDBACK
                    if a_tag and a_tag.get('href'):
                        try:
                            worker_detail_url = f"https://ptcgmaster.loganlai0422.workers.dev/?path={a_tag['href']}"
                            detail_resp = requests.get(worker_detail_url, headers=headers, timeout=5)
                            all_imgs = re.findall(r'(?:https?://|/)[^"\'\s<>\[\]]+\.(?:jpg|png|webp)', detail_resp.text.replace('\\/', '/'), re.IGNORECASE)
                            for src in all_imgs:
                                src_l = src.lower()
                                if 'card' in src_l and 'ogp' not in src_l and 'icon' not in src_l and 'logo' not in src_l:
                                    img_url = src if src.startswith('http') else "https://asia.pokemon-card.com" + src
                                    break
                        except: pass

                new_deck[card_key] = {'qty': new_deck.get(card_key, {}).get('qty', 0) + qty, 'img': img_url, 'name': name}
        return {"success": True, "deck": new_deck}
    except Exception as e:
        return {"success": False, "detail": f"例外錯誤: {str(e)}"}

# (省略部分與原本相同的 parse_text, share_game...等代碼以節省空間，請保持原樣)
@app.post("/api/v1/parse_text")
def api_parse_text(req: ParseTextReq):
    lines = req.text.split('\n')
    new_deck = {}
    for line in lines:
        try:
            line = line.strip()
            if not line or any(x in line for x in ["Pokémon:", "Trainer:", "Energy:"]): continue
            match = re.search(r'^(\d+)\s+(.+)', line)
            if match:
                qty = int(match.group(1))
                raw_name = match.group(2).strip()
                parse_match = re.search(r'^(.+?)(?:\s+([a-zA-Z0-9\-]+)\s+(\d+[a-zA-Z]*))?$', raw_name)
                search_name = parse_match.group(1).strip() if parse_match else raw_name
                target_set = parse_match.group(2) if parse_match else ""
                target_number = parse_match.group(3) if parse_match else ""
                
                final_card_key = f"{search_name} [{target_set} {target_number}]" if target_set and target_number else search_name
                
                # ⚡ 優先檢查本地字典
                img_url = LOCAL_CARD_DB.get(final_card_key) or LOCAL_CARD_DB.get(search_name) or DEFAULT_CARDBACK

                new_deck[final_card_key] = {'qty': new_deck.get(final_card_key, {}).get('qty', 0) + qty, 'img': img_url, 'name': search_name}
        except: continue
    return {"success": True, "deck": new_deck}

@app.post("/api/v1/share_game")
def api_share_game(req: ShareGameReq):
    code = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k=6))
    supabase.table("game_shares").upsert({"share_code": code, "game_data": json.dumps(req.game_data)}).execute()
    return {"success": True, "share_code": code}

@app.get("/api/v1/get_shared_game")
def api_get_shared_game(code: str):
    res = supabase.table("game_shares").select("game_data").eq("share_code", code.strip().upper()).execute()
    if res.data: return {"success": True, "game_data": json.loads(res.data[0]["game_data"])}
    raise HTTPException(status_code=404)

# 🎲 蒙地卡羅運算 API
@app.post("/api/v1/simulate")
def api_simulate(req: MonteCarloReq, user_info: dict = Depends(verify_user_and_check_limit)):
    try:
        iterations = 10000 
        prob = run_monte_carlo(req.deck_cards, req.direct_targets, req.chain_targets, req.draw1, req.target_rule, req.dead_hand_size, iterations)
        return {
            "success": True, 
            "prob": prob, 
            "remaining_today": user_info["remaining_today"],
            "is_pro": user_info["is_pro"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"計算錯誤: {str(e)}")
