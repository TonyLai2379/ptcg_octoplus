from fastapi import FastAPI, Depends, HTTPException, Header, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import re
import random
import requests
import os
import datetime
import json
import traceback
import base64
import uuid
from bs4 import BeautifulSoup
from typing import List, Dict, Optional, Any
from supabase import create_client, Client
import hashlib
import urllib.parse

# ==========================================
# 1. 宣告 FastAPI 應用程式 (必須在所有 @app.post 之前)
# ==========================================
app = FastAPI(title="PTCG Octoplus API", version="29.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.path.exists("tutor_pic"):
    app.mount("/tutor_pic", StaticFiles(directory="tutor_pic"), name="tutor_pic")

# ==========================================
# 2. 資料庫與金流環境變數設定
# ==========================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://cnjajimwpuuhkdxelgwg.supabase.co")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "sb_secret_rQ9BehEwCzjbAF5oRDNzYw_l1cXhpbC")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

ECPAY_MERCHANT_ID = os.getenv("ECPAY_MERCHANT_ID", "2000132")
ECPAY_HASH_KEY = os.getenv("ECPAY_HASH_KEY", "5294y06JbISpM5x9")
ECPAY_HASH_IV = os.getenv("ECPAY_HASH_IV", "v77hoKGq4kWxNNIS")
ECPAY_ACTION_URL = os.getenv("ECPAY_ACTION_URL", "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5")

PLAN_PRICES = {
    "1m": {"amount": 120, "name": "PTCG 小章魚 Pro - 1 個月訂閱", "days": 30},
    "3m": {"amount": 299, "name": "PTCG 小章魚 Pro - 3 個月訂閱", "days": 90},
    "1y": {"amount": 999, "name": "PTCG 小章魚 Pro - 1 年期尊榮訂閱", "days": 365}
}

DEFAULT_CARDBACK = "https://asia.pokemon-card.com/tw/assets/images/card-back.png"

MEMORY_GAME_SHARES = {}

LL_TO_OFFICIAL = {
    "SVI": "sv1", "PAL": "sv2", "OBF": "sv3", "MEW": "sv3pt5",
    "PAR": "sv4", "PAF": "sv4pt5", "TEF": "sv5", "TWM": "sv6",
    "SFA": "sv6pt5", "SCR": "sv7", "SSP": "sv8", "PRE": "sv8pt5",
    "POR": "por", "DRI": "dri", "JTG": "jtg", "MEG": "meg",
    "SSH": "swsh1", "RCL": "swsh2", "DAA": "swsh3", "CPA": "swsh3pt5",
    "VIV": "swsh4", "SHF": "swsh4pt5", "BST": "swsh5", "CRE": "swsh6",
    "EVS": "swsh7", "CEL": "swsh7pt5", "FST": "swsh8", "BRS": "swsh9",
    "ASR": "swsh10", "PGO": "pgo", "LOR": "swsh11", "SIT": "swsh12",
    "CRZ": "swsh12pt5", "SVE": "sve", "PR-SV": "svp", "PR-SW": "swshp"
}

LOCAL_CARD_DB = {}
GLOBAL_CARDS_LIST = [] 
BEST_FALLBACK_CACHE = {} 

# ==========================================
# 3. 系統共用 Helper 函數
# ==========================================
def generate_ecpay_checkmac(params: dict, hash_key: str, hash_iv: str) -> str:
    """依照綠界官方規範生成 CheckMacValue"""
    sorted_keys = sorted(params.keys())
    raw_str = f"HashKey={hash_key}&" + "&".join([f"{k}={params[k]}" for k in sorted_keys]) + f"&HashIV={hash_iv}"
    encoded_str = urllib.parse.quote_plus(raw_str).lower()
    encoded_str = encoded_str.replace('%2d', '-').replace('%5f', '_').replace('%2e', '.').replace('%21', '!')
    encoded_str = encoded_str.replace('%2a', '*').replace('%28', '(').replace('%29', ')')
    return hashlib.sha256(encoded_str.encode('utf-8')).hexdigest().upper()

def is_valid_url(url):
    return isinstance(url, str) and url.startswith("http")

def load_global_cards_to_cache():
    global LOCAL_CARD_DB, GLOBAL_CARDS_LIST, BEST_FALLBACK_CACHE
    print("⏳ 正在從 Supabase 載入全卡庫...")
    try:
        page = 0; page_size = 1000; total_loaded = 0
        while True:
            res = supabase.table("global_cards").select("card_key, name, img_url").range(page * page_size, (page + 1) * page_size - 1).execute()
            if not res.data: break
            for row in res.data:
                c_key = row.get('card_key'); c_name = row.get('name'); c_img = row.get('img_url')
                if is_valid_url(c_img):
                    clean_name = c_key.split(" [")[0] if c_key and " [" in c_key else (c_name or "")
                    GLOBAL_CARDS_LIST.append({"key": c_key or "", "name": clean_name, "img": c_img})
                    if c_key: LOCAL_CARD_DB[c_key.lower()] = c_img
                    if c_name and c_name.lower() not in LOCAL_CARD_DB: LOCAL_CARD_DB[c_name.lower()] = c_img
            total_loaded += len(res.data)
            if len(res.data) < page_size: break
            page += 1
        print(f"✅ 成功載入 {total_loaded} 筆卡片資料！")
        
        name_groups = {}
        for c in GLOBAL_CARDS_LIST:
            name = c['name'].lower()
            if name not in name_groups: name_groups[name] = []
            name_groups[name].append(c)
            
        def set_weight(card):
            key = card['key'].lower()
            if key.startswith('sv'): return 8
            if key.startswith('swsh'): return 7
            if key.startswith('sm'): return 6
            if key.startswith('xy'): return 5
            if key.startswith('bw'): return 4
            return 0
            
        for name, cards in name_groups.items():
            cards.sort(key=set_weight, reverse=True)
            BEST_FALLBACK_CACHE[name] = cards[0]['img']
        print("✅ 世代智慧篩選快取建立完成！")
            
    except Exception as e: print(f"❌ 快取失敗: {e}")

load_global_cards_to_cache()

def auto_save_new_cards_to_db(cards_to_upsert: list):
    """當使用者匯入資料庫沒有的新卡時，自動寫入 Supabase 全卡庫擴充"""
    if not cards_to_upsert:
        return
        
    for card in cards_to_upsert:
        c_key = card["card_key"]
        c_img = card["img_url"]
        c_name = card["name"]
        LOCAL_CARD_DB[c_key.lower()] = c_img
        if c_name.lower() not in LOCAL_CARD_DB:
            LOCAL_CARD_DB[c_name.lower()] = c_img
        
        if not any(c['key'] == c_key for c in GLOBAL_CARDS_LIST):
            GLOBAL_CARDS_LIST.append({"key": c_key, "name": c_name, "img": c_img})
            
    try:
        supabase.table("global_cards").upsert(cards_to_upsert).execute()
        print(f"🎉 [自動擴充卡庫] 成功新增 {len(cards_to_upsert)} 張卡牌至 Supabase！")
    except Exception as e:
        print(f"⚠️ [自動擴充資料庫失敗，但已暫存於記憶體]: {e}")

def get_user_and_email_from_token(auth_header: str):
    if not auth_header or not auth_header.startswith("Bearer "): 
        raise HTTPException(status_code=401, detail="請先登入帳號")
    token = auth_header.split(" ")[1]
    
    try:
        user_res = supabase.auth.get_user(token)
        if user_res and user_res.user:
            return user_res.user.id, user_res.user.email
    except Exception:
        pass

    try:
        parts = token.split('.')
        if len(parts) == 3:
            payload_b64 = parts[1]
            padded = payload_b64 + '=' * (-len(payload_b64) % 4)
            payload_json = json.loads(base64.b64decode(padded).decode('utf-8'))
            
            exp = payload_json.get('exp')
            if exp and datetime.datetime.now(datetime.timezone.utc).timestamp() > exp:
                raise HTTPException(status_code=401, detail="登入憑證已過期，請重新發送驗證連結登入")
            
            user_id = payload_json.get('sub')
            user_email = payload_json.get('email')
            if user_id:
                return user_id, user_email
    except HTTPException:
        raise
    except Exception as e:
        print(f"JWT Decode log: {e}")

    raise HTTPException(status_code=401, detail="登入憑證無效，請重新登入")

def verify_user_and_check_limit(authorization: Optional[str] = Header(None)):
    user_id, user_email = get_user_and_email_from_token(authorization)
    try:
        today_str = str(datetime.date.today())
        profile_res = supabase.table("profiles").select("*").eq("id", user_id).execute()
        
        if not profile_res.data:
            supabase.table("profiles").insert({"id": user_id, "email": user_email, "is_pro": False, "trial_used": False}).execute()
            is_pro = False; expires_at = None
        else:
            profile = profile_res.data[0]
            if not profile.get("email") and user_email:
                supabase.table("profiles").update({"email": user_email}).eq("id", user_id).execute()
            is_pro = profile.get("is_pro", False); expires_at = profile.get("pro_expires_at")
        
        has_active_sub = False
        if expires_at:
            exp_str = expires_at.replace("Z", "+00:00")
            exp_date = datetime.datetime.fromisoformat(exp_str)
            if datetime.datetime.now(datetime.timezone.utc) < exp_date: has_active_sub = True

        if not has_active_sub: raise HTTPException(status_code=403, detail="LIMIT_REACHED")
        if is_pro: return {"user_id": user_id, "is_pro": True, "remaining_today": 9999}
            
        sim_res = supabase.table("daily_simulations").select("count").eq("user_id", user_id).eq("usage_date", today_str).execute()
        used_today = sim_res.data[0]["count"] if sim_res.data else 0
        if used_today >= 30: raise HTTPException(status_code=403, detail="LIMIT_REACHED")
        try: supabase.table("daily_simulations").upsert({"user_id": user_id, "usage_date": today_str, "count": used_today + 1}).execute()
        except: pass 
        return {"user_id": user_id, "is_pro": False, "remaining_today": 30 - (used_today + 1)}
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=f"權限驗證失敗: {str(e)}")

def run_monte_carlo(deck_cards, direct_dict, chain_dict, draw1, target_rule="AND", dead_hand_size=0, iterations=10000):
    if not deck_cards or draw1 <= 0 or not direct_dict: return 0.0
    base_deck = [c['name'] for c in deck_cards]
    success_count = 0
    for _ in range(iterations):
        deck = base_deck.copy(); random.shuffle(deck)
        hand = deck[:draw1]; deck = deck[draw1:]
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
# 4. Pydantic 模型定義
# ==========================================
class CreateOrderReq(BaseModel):
    plan_type: str
    return_url: str

class ParseOfficialReq(BaseModel): deck_code: str
class ParseTextReq(BaseModel): text: str
class RedeemCodeReq(BaseModel): code: str
class ShareGameReq(BaseModel): game_data: Any 
class UpsertCardReq(BaseModel): card_key: str; name: str; img_url: str
class FeedbackReq(BaseModel): user_email: Optional[str] = None; message: str; image_base64: Optional[str] = None
class MonteCarloReq(BaseModel):
    deck_cards: List[Dict[str, Any]]; direct_targets: Dict[str, Any]; chain_targets: Dict[str, Any]; draw1: int; target_rule: str = "AND"; dead_hand_size: int = 0

# ==========================================
# 5. API 路由設定 (Routes)
# ==========================================
@app.post("/api/v1/create_ecpay_order")
def create_ecpay_order(req: CreateOrderReq, authorization: Optional[str] = Header(None)):
    user_id, user_email = get_user_and_email_from_token(authorization)
    if req.plan_type not in PLAN_PRICES:
        raise HTTPException(status_code=400, detail="無效的訂閱方案")
    
    plan = PLAN_PRICES[req.plan_type]
    trade_no = f"OCTO{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}{random.randint(100,999)}"
    trade_date = datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")
    
    params = {
        "MerchantID": ECPAY_MERCHANT_ID,
        "MerchantTradeNo": trade_no,
        "MerchantTradeDate": trade_date,
        "PaymentType": "aio",
        "TotalAmount": str(plan["amount"]),
        "TradeDesc": urllib.parse.quote_plus("PTCG Octoplus Pro Subscription"),
        "ItemName": plan["name"],
        "ReturnURL": f"https://ptcg-octoplus-api.onrender.com/api/v1/ecpay_callback", # 綠界幕後通知後址
        "ClientBackURL": req.return_url, # 付款完成導回網址
        "ChoosePayment": "ALL",
        "EncryptType": "1",
        "CustomField1": user_id,       # 把 User ID 放在自訂欄位帶給綠界
        "CustomField2": str(plan["days"]) # 把訂閱天數帶給綠界
    }
    params["CheckMacValue"] = generate_ecpay_checkmac(params, ECPAY_HASH_KEY, ECPAY_HASH_IV)
    
    # 產生自動提交表單 HTML 給前端
    form_inputs = "".join([f'<input type="hidden" name="{k}" value="{v}">' for k, v in params.items()])
    html_form = f"""
    <form id="ecpay-form" action="{ECPAY_ACTION_URL}" method="POST">{form_inputs}</form>
    <script>document.getElementById('ecpay-form').submit();</script>
    """
    return {"success": True, "html": html_form}

@app.post("/api/v1/ecpay_callback")
def ecpay_callback(
    MerchantID: str = Form(...),
    MerchantTradeNo: str = Form(...),
    RtnCode: str = Form(...),
    RtnMsg: str = Form(...),
    TradeAmt: str = Form(...),
    CustomField1: str = Form(None), # user_id
    CustomField2: str = Form(None), # days
    CheckMacValue: str = Form(...)
):
    """綠界付款成功幕後回傳更新會員權限"""
    # 這裡驗證 RtnCode == '1' 且檢查碼通過即可寫入
    if RtnCode == "1" and CustomField1 and CustomField2:
        try:
            days = int(CustomField2)
            user_id = CustomField1
            now = datetime.datetime.now(datetime.timezone.utc)
            
            # 查詢原有過期時間，若尚未過期則展延，過期則從現在起算
            p_res = supabase.table("profiles").select("pro_expires_at").eq("id", user_id).execute()
            base_time = now
            if p_res.data and p_res.data[0].get("pro_expires_at"):
                old_exp = datetime.datetime.fromisoformat(p_res.data[0]["pro_expires_at"].replace("Z", "+00:00"))
                if old_exp > now:
                    base_time = old_exp
                    
            new_exp = (base_time + datetime.timedelta(days=days)).isoformat()
            supabase.table("profiles").update({"is_pro": True, "pro_expires_at": new_exp}).eq("id", user_id).execute()
        except Exception as e:
            print(f"綠界 Callback 處理失敗: {e}")
            return "0|Error"
    return "1|OK"

@app.get("/")
def serve_index():
    if os.path.exists("index.html"): return FileResponse("index.html")
    return {"message": "找不到 index.html"}

@app.get("/api/v1/marquee")
def api_get_marquee():
    file_path = "dialogue.txt"
    if not os.path.exists(file_path): return {"text": "💡 歡迎使用 PTCG 專業沙盤推演機！"}
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]
            if lines:
                random.shuffle(lines)
                return {"text": " &nbsp;&nbsp;&nbsp;&nbsp; | &nbsp;&nbsp;&nbsp;&nbsp; ".join(lines)}
            return {"text": "💡 歡迎使用 PTCG 專業沙盤推演機！"}
    except Exception: return {"text": "💡 歡迎使用 PTCG 專業沙盤推演機！"}

@app.get("/api/v1/search_db")
def api_search_db(q: str = ""):
    results = []
    if not q: return {"results": results}
    q_lower = q.lower().replace('é', 'e').strip()
    seen_imgs = set()
    for card in GLOBAL_CARDS_LIST:
        if q_lower in card['name'].lower().replace('é', 'e') or q_lower in card['key'].lower():
            if card['img'] not in seen_imgs:
                seen_imgs.add(card['img'])
                results.append(card)
                if len(results) >= 50: break
    return {"results": results}

@app.post("/api/v1/support_feedback")
def api_support_feedback(req: FeedbackReq):
    try:
        if not req.message.strip():
            raise HTTPException(status_code=400, detail="請填寫回報訊息內容")
        
        final_img_url = ""
        if req.image_base64 and "base64," in req.image_base64:
            try:
                header, encoded = req.image_base64.split("base64,")
                img_bytes = base64.b64decode(encoded)
                ext = "png"
                if "jpeg" in header or "jpg" in header: ext = "jpg"
                file_name = f"feedback_{uuid.uuid4().hex[:8]}.{ext}"
                supabase.storage.from_("feedback-images").upload(
                    path=file_name, file=img_bytes, file_options={"content-type": f"image/{ext}"}
                )
                final_img_url = supabase.storage.from_("feedback-images").get_public_url(file_name)
            except Exception as img_err:
                print(f"⚠️ Storage 上傳失敗: {img_err}")
                final_img_url = req.image_base64[:100] + "..."

        supabase.table("feedbacks").insert({
            "user_email": req.user_email or "anonymous",
            "message": req.message,
            "image_data": final_img_url,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }).execute()
        
        return {"success": True, "detail": "🎉 小章魚已收到您的回報！我們將會儘快處理。"}
    except Exception as e:
        return {"success": True, "detail": "🎉 小章魚已收到您的回報！感謝您的反饋。"}

@app.post("/api/v1/upsert_card")
def api_upsert_card(req: UpsertCardReq):
    try:
        c_key = req.card_key.lower().strip()
        if is_valid_url(req.img_url) and c_key not in LOCAL_CARD_DB:
            LOCAL_CARD_DB[c_key] = req.img_url
            GLOBAL_CARDS_LIST.append({"key": req.card_key, "name": req.name, "img": req.img_url})
            supabase.table("global_cards").upsert({
                "card_key": req.card_key, "name": req.name, "img_url": req.img_url, "metadata": {"source": "user-client-auto"}
            }).execute()
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}

@app.post("/api/v1/redeem_code")
def api_redeem_code(req: RedeemCodeReq, authorization: Optional[str] = Header(None)):
    user_id, user_email = get_user_and_email_from_token(authorization)
    code = req.code.strip().upper()
    code_res = supabase.table("promo_codes").select("*").eq("code", code).execute()
    if not code_res.data: 
        raise HTTPException(status_code=400, detail="❌ 無效的兌換碼，請確認代碼是否正確")
    
    promo = code_res.data[0]
    if promo["used_count"] >= promo["max_uses"]: 
        raise HTTPException(status_code=400, detail="❌ 此兌換碼已被領取完畢")
    
    days = promo["days_valid"]
    p_res = supabase.table("profiles").select("id").eq("id", user_id).execute()
    if not p_res.data: 
        supabase.table("profiles").insert({"id": user_id, "email": user_email}).execute()
    
    exp_time = (datetime.datetime.now(datetime.timezone.utc) + timedelta(days=days)).isoformat()
    supabase.table("profiles").update({"is_pro": True, "pro_expires_at": exp_time, "email": user_email}).eq("id", user_id).execute()
    supabase.table("promo_codes").update({"used_count": promo["used_count"] + 1}).eq("code", code).execute()
    
    return {"success": True, "detail": f"🎉 成功兌換！已為你開通 {days} 天 Pro 專業無限推演權限。"}

@app.post("/api/v1/activate_trial")
def api_activate_trial(authorization: Optional[str] = Header(None)):
    user_id, user_email = get_user_and_email_from_token(authorization)
    p_res = supabase.table("profiles").select("*").eq("id", user_id).execute()
    if not p_res.data:
        supabase.table("profiles").insert({"id": user_id, "email": user_email, "trial_used": False}).execute()
        trial_used = False
    else:
        trial_used = p_res.data[0].get("trial_used", False)
    if trial_used: raise HTTPException(status_code=400, detail="您已經使用過 7 天免費體驗囉！")
    exp_time = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)).isoformat()
    supabase.table("profiles").update({"is_pro": False, "trial_used": True, "pro_expires_at": exp_time, "email": user_email}).eq("id", user_id).execute()
    return {"success": True, "detail": "🎉 體驗開通成功！接下來 7 天每日可使用 30 次深度推演。"}

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
        cards_to_db = []
        fallback_cards = []

        for item in soup.find_all('li', class_='card'):
            name_tag = item.find('p', class_='cardName'); qty_tag = item.find('div', class_='cardCount')
            if name_tag and qty_tag:
                name = re.sub(r'\s+', ' ', name_tag.text.strip()).strip()
                try: qty = int(re.sub(r'\D', '', qty_tag.text)) if re.sub(r'\D', '', qty_tag.text) else 1
                except: qty = 1
                a_tag = name_tag.find('a'); unique_id = ""
                card_href = ""
                if a_tag and a_tag.get('href'):
                    card_href = a_tag.get('href', '')
                    parts = [p for p in card_href.split('/') if p]
                    if parts: unique_id = parts[-1]
                
                card_key = f"{name} [{unique_id}]" if unique_id else name
                
                is_new_card = False
                img_url = None

                if card_key.lower() in LOCAL_CARD_DB and is_valid_url(LOCAL_CARD_DB[card_key.lower()]):
                    img_url = LOCAL_CARD_DB[card_key.lower()]

                if not is_valid_url(img_url) and card_href:
                    try:
                        worker_detail_url = f"https://ptcgmaster.loganlai0422.workers.dev/?path={card_href}"
                        detail_resp = requests.get(worker_detail_url, headers=headers, timeout=8)
                        all_imgs = re.findall(r'(?:https?://|/)[^"\'\s<>\[\]]+\.(?:jpg|png|webp)', detail_resp.text.replace('\\/', '/'), re.IGNORECASE)
                        for src in all_imgs:
                            src_l = src.lower()
                            if 'card' in src_l and 'ogp' not in src_l and 'icon' not in src_l and 'logo' not in src_l:
                                found_url = src if src.startswith('http') else "https://asia.pokemon-card.com" + src
                                if is_valid_url(found_url):
                                    img_url = found_url
                                    is_new_card = True
                                    break
                    except Exception as req_err:
                        print(f"⚠️ 抓取官網單卡頁面失敗 ({card_key}): {req_err}")

                if not is_valid_url(img_url):
                    fallback_img = LOCAL_CARD_DB.get(name.lower())
                    if is_valid_url(fallback_img):
                        img_url = fallback_img
                        fallback_cards.append(f"{card_key}（改用同名卡圖代替）")
                    else:
                        img_url = DEFAULT_CARDBACK
                        fallback_cards.append(f"{card_key}（改用預設卡背代替）")

                new_deck[card_key] = {
                    'qty': new_deck.get(card_key, {}).get('qty', 0) + qty,
                    'img': img_url,
                    'name': name,
                    'fallback_img': DEFAULT_CARDBACK
                }

                if is_new_card and is_valid_url(img_url) and img_url != DEFAULT_CARDBACK:
                    cards_to_db.append({
                        "card_key": card_key,
                        "name": name,
                        "img_url": img_url,
                        "metadata": {"source": "official_import_auto"}
                    })

        if cards_to_db:
            auto_save_new_cards_to_db(cards_to_db)

        return {
            "success": True, 
            "deck": new_deck, 
            "fallback_cards": list(set(fallback_cards))
        }
    except Exception as e: return {"success": False, "detail": f"例外錯誤: {str(e)}"}

@app.post("/api/v1/parse_text")
def api_parse_text(req: ParseTextReq):
    lines = req.text.split('\n'); new_deck = {}
    cards_to_db = []
    
    for line in lines:
        try:
            line = line.strip()
            if not line or re.match(r'^(Pokémon|Trainer|Energy|Cards|Player|Event|Deck|Format)', line, re.IGNORECASE): continue
            
            match = re.search(r'^(\d+)\s+(.+)', line)
            if match:
                qty = int(match.group(1)); raw_name = match.group(2).strip()
                parse_match = re.search(r'^(.*?)(?:\s+([A-Za-z0-9\-]+)\s+(\d+[a-zA-Z]*))?$', raw_name)
                
                search_name = parse_match.group(1).strip() if parse_match and parse_match.group(1) else raw_name
                search_name_clean = search_name.replace('é', 'e').replace('É', 'E')
                
                target_set = parse_match.group(2) if parse_match and parse_match.group(2) else None
                target_number = parse_match.group(3) if parse_match and parse_match.group(3) else None
                
                final_card_key = f"{search_name} [{target_set} {target_number}]" if target_set and target_number else search_name
                
                img_url = None
                fallback_url = DEFAULT_CARDBACK
                is_new_discovery = False
                
                if target_set and target_number:
                    clean_num = str(int(target_number)) if target_number.isdigit() else target_number
                    set_up = target_set.upper()
                    set_low = target_set.lower()
                    official_set = LL_TO_OFFICIAL.get(set_up, set_low)
                    
                    exact_keys = [f"{official_set}-{clean_num}", f"{set_low}-{clean_num}"]
                    for ek in exact_keys:
                        if ek in LOCAL_CARD_DB and is_valid_url(LOCAL_CARD_DB[ek]):
                            img_url = LOCAL_CARD_DB[ek]
                            break
                    
                    if not is_valid_url(img_url):
                        num_suffix = f"-{clean_num}"
                        for c in GLOBAL_CARDS_LIST:
                            if c['name'].lower() == search_name_clean.lower() and c['key'].lower().endswith(num_suffix):
                                img_url = c['img']
                                break

                    if not is_valid_url(img_url):
                        img_url = f"https://limitlesstcg.s3.us-east-2.amazonaws.com/pokemon/pictures/eng/{set_low}/{clean_num}.png"
                        is_new_discovery = True
                        
                    fallback_url = BEST_FALLBACK_CACHE.get(search_name_clean.lower(), DEFAULT_CARDBACK)
                else:
                    img_url = BEST_FALLBACK_CACHE.get(search_name_clean.lower(), DEFAULT_CARDBACK)

                if not is_valid_url(img_url): img_url = DEFAULT_CARDBACK

                new_deck[final_card_key] = {
                    'qty': new_deck.get(final_card_key, {}).get('qty', 0) + qty, 
                    'img': img_url, 
                    'name': search_name,
                    'fallback_img': fallback_url
                }

                if is_new_discovery and is_valid_url(img_url) and img_url != DEFAULT_CARDBACK:
                    cards_to_db.append({
                        "card_key": final_card_key,
                        "name": search_name,
                        "img_url": img_url,
                        "metadata": {"source": "limitless_import_auto"}
                    })
        except: continue
        
    if cards_to_db:
        auto_save_new_cards_to_db(cards_to_db)

    if sum(info['qty'] for info in new_deck.values()) == 0: return {"success": False, "detail": "無法解析任何卡片，請檢查格式。"}
    return {"success": True, "deck": new_deck}

@app.post("/api/v1/share_game")
def api_share_game(req: ShareGameReq):
    try:
        code = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k=6))
        json_data = json.dumps(req.game_data)
        
        MEMORY_GAME_SHARES[code] = json_data
        
        try:
            supabase.table("game_shares").upsert({"share_code": code, "game_data": json_data}).execute()
        except Exception as db_err:
            print(f"⚠️ Supabase game_shares 寫入跳過: {db_err}")
            
        return {"success": True, "share_code": code}
    except Exception as e:
        print(f"Share error: {e}")
        return {"success": False, "detail": f"分享處理失敗: {str(e)}"}

@app.get("/api/v1/get_shared_game")
def api_get_shared_game(code: str):
    clean_code = code.strip().upper()
    
    if clean_code in MEMORY_GAME_SHARES:
        return {"success": True, "game_data": json.loads(MEMORY_GAME_SHARES[clean_code])}
        
    try:
        res = supabase.table("game_shares").select("game_data").eq("share_code", clean_code).execute()
        if res.data:
            return {"success": True, "game_data": json.loads(res.data[0]["game_data"])}
    except Exception as e:
        print(f"DB Fetch Error: {e}")

    raise HTTPException(status_code=404, detail="找不到該對局代碼，請確認代碼是否正確。")

@app.post("/api/v1/simulate")
def api_simulate(req: MonteCarloReq, user_info: dict = Depends(verify_user_and_check_limit)):
    iterations = 10000 
    prob = run_monte_carlo(req.deck_cards, req.direct_targets, req.chain_targets, req.draw1, req.target_rule, req.dead_hand_size, iterations)
    return {"success": True, "prob": prob, "iterations": iterations, "remaining_today": user_info["remaining_today"], "is_pro": user_info["is_pro"]}
