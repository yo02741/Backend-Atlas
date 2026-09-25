// 題庫：驗證與授權
export default [
  {
    skill: 'authn-basics',
    questions: [
      {
        q: 'session 與無狀態 JWT 在「撤銷」上的核心差異是什麼？',
        options: [
          '兩者都能即時撤銷，JWT 只是要多查一次資料庫',
          'session 刪掉伺服器端那筆紀錄就立刻失效；無狀態 JWT 發出後到 exp 前無法收回，只能靠短效期 + refresh token 或黑名單補救',
          'JWT 可以即時撤銷、session 不行，因為 session 存在瀏覽器',
          '兩者都無法主動撤銷，只能等到期',
        ],
        answer: 1,
        explain: 'session 的真相在伺服器（Redis / DB），客戶端只有號碼牌，刪掉紀錄那一刻所有請求就失效——登出、改密碼、封鎖帳號都能立即生效。JWT 的真相寫在 token 裡並由簽章保證，伺服器不查表就驗得過，也因此發出去就收不回。實務補法：access token 15 分鐘內過期、refresh token 可撤銷；或維護一份黑名單（但那就又變成有狀態了）。',
      },
      {
        q: '這是登入成功的回應。之後瀏覽器每次請求，伺服器是怎麼知道使用者是誰的？',
        code: `HTTP/1.1 200 OK
Set-Cookie: sid=9f2c7e1a4b; HttpOnly; Secure; SameSite=Lax; Path=/`,
        lang: 'http',
        options: [
          '瀏覽器自動在後續請求帶上 sid cookie，伺服器用 sid 到 Redis / DB 查回對應的使用者',
          'sid 是 base64 編碼的使用者 id 與角色，伺服器解碼就知道',
          '伺服器靠 TCP 連線本身記住使用者，cookie 只是備援',
          '前端 JS 把 sid 讀出來放進 `Authorization: Bearer` 標頭',
        ],
        answer: 0,
        explain: 'HTTP 無狀態，「登入過」是每次請求靠 cookie 重建的：瀏覽器對同站請求自動帶 cookie（這也是為什麼要 SameSite 防 CSRF），伺服器以 sid 為 key 查出 session 資料。sid 應該是不可預測的隨機字串、不含任何資訊——若能解碼出 id 與角色就是可偽造的。HttpOnly 讓 JS 讀不到 sid，所以選項四做不到也不該做；連線與使用者無關，keep-alive 或經過 proxy 的一條連線會混著多個使用者的請求。',
      },
      {
        q: '你要為「一個 Web 前端 + 一台 API 伺服器」的小產品做登入，近期沒有行動 App 或第三方呼叫需求。最合理的選擇？',
        options: [
          '無狀態 JWT 放 localStorage，因為最容易水平擴展',
          'OAuth 2.0 client credentials，因為它是業界標準',
          '伺服器端 session + HttpOnly / Secure / SameSite cookie：實作最簡單、可即時撤銷、JS 碰不到憑證',
          '每次請求都送帳號密碼（HTTP Basic），省去狀態管理',
        ],
        answer: 2,
        explain: '單一伺服器加一個前端，session 最簡單也最安全：撤銷即時、cookie 由瀏覽器管理、HttpOnly 讓 XSS 偷不到。JWT 放 localStorage 是把長效憑證放在任何 XSS 都讀得到的地方，且撤銷困難——它的優勢（跨服務、無狀態）在這個場景用不到。client credentials 是給「服務對服務」沒有使用者的情境；每次送密碼等於把最高價值的祕密暴露在每個請求裡。',
      },
    ],
  },
  {
    skill: 'jwt',
    questions: [
      {
        q: '下列哪些資料適合放進 JWT 的 payload？',
        options: [
          '使用者密碼的雜湊值，方便各服務直接驗證',
          '使用者 id、角色、exp 等非敏感聲明——因為 payload 只是 base64url 編碼，任何拿到 token 的人都能讀',
          '信用卡末四碼與完整身分證字號，簽章會保護它們',
          '什麼都可以，JWT 本身就是加密的',
        ],
        answer: 1,
        explain: '把 JWT 貼到任何 base64 解碼器就能看到 payload 全文，簽章只保證「沒被改」不保證「沒被看」（加密是 JWE 的事，一般 JWS 不加密）。所以放進去的東西要當成公開資訊：sub、role、exp、iss、aud。密碼雜湊放進去等於送出去給人離線破解；個資放進去會在每個 log、每個 proxy 留下副本。',
      },
      {
        q: '這段驗證程式碼中，`algorithms=["RS256"]` 的用意是？',
        code: `payload = jwt.decode(
    token,
    key=PUBLIC_KEY,
    algorithms=["RS256"],
    audience="orders-api",
    issuer="auth.example.com",
)`,
        lang: 'python',
        options: [
          '加速驗證，讓函式庫不用逐一嘗試其他演算法',
          '只是說明用途，函式庫仍以 token header 裡的 alg 為準',
          '告訴函式庫這個 token 是用公鑰簽的',
          '由伺服器鎖定允許的演算法、不信任 token header 的 alg，防止 alg=none 與「拿 RS256 公鑰當 HS256 secret」的混淆攻擊',
        ],
        answer: 3,
        explain: '如果函式庫依 header 的 alg 決定怎麼驗，攻擊者可以把 alg 改成 none（不驗簽章）或改成 HS256——這時函式庫會把你的 RSA 公鑰當成 HMAC 的 secret，而公鑰是公開的，攻擊者就能自己簽出合法 token。鎖定 algorithms 讓 header 說什麼都沒用。這段也檢查了 aud 與 iss（exp 預設會檢查），簽章、alg、exp、iss、aud 五件事缺一不可。RS256 是私鑰簽、公鑰驗，選項三說反了。',
      },
      {
        q: '你設計 access token 15 分鐘、refresh token 7 天。refresh token 該怎麼放、怎麼用最安全？',
        options: [
          '放 HttpOnly + Secure cookie（Path 限定 refresh endpoint）；每次換新 access token 時同時換發新 refresh token（rotation），舊的立即失效，舊 token 若再被使用即可判定遭盜用',
          '與 access token 一起放 localStorage，方便前端隨時取用',
          '放進 access token 的 payload 裡，換 token 時少一次請求',
          '把 refresh token 效期也設成 15 分鐘，就不需要額外保護',
        ],
        answer: 0,
        explain: 'refresh token 是長效憑證、價值最高，所以要放 JS 讀不到的地方（HttpOnly cookie）、只在換 token 時送出（Path 限定）。rotation 讓每個 refresh token 只能用一次：若攻擊者偷走並用了，合法使用者下次用舊的就會失敗，伺服器偵測到「同一家族被重複使用」即可整批撤銷。localStorage 是 XSS 的提款機；塞進 access token 等於把長效憑證也變成到處送；效期縮到 15 分鐘就失去 refresh token 的意義（使用者每 15 分鐘要重登）。',
      },
    ],
  },
  {
    skill: 'oauth-oidc',
    questions: [
      {
        q: '「用 Google 登入」完成後，你的 App 拿到 `id_token` 與 `access_token`。兩者差在哪？',
        options: [
          '兩者都是 JWT、內容相同，只是名稱不同',
          'access_token 給前端用、id_token 給後端用',
          'id_token 是 OIDC 加上的 JWT，告訴你的 App「這個人是誰」；access_token 是 OAuth 給你呼叫 Google API 用的憑證，不該被當成登入證明',
          'id_token 是給 Google 內部用的，你的 App 只需要 access_token',
        ],
        answer: 2,
        explain: 'OAuth 2.0 只解決「授權存取資源」，回的 access_token 是給 Resource Server（Google API）看的、格式不保證、aud 也不是你；拿它當登入證明有混淆代理人問題（別的 App 拿到的 token 也能登進你的系統）。OIDC 在 OAuth 上加了 id_token：一個 aud 是你的 client_id、含 sub / email / nonce 的 JWT，驗過簽章與 aud 後就能確認身分。「用 Google 登入」用的是 OIDC，要看的是 id_token。',
      },
      {
        q: '這段 OAuth callback 少了哪一步、會造成什麼風險？',
        code: `@app.get("/auth/callback")
async def callback(code: str, state: str, request: Request):
    verifier = request.session.pop("pkce_verifier")
    tokens = await exchange_code(code, code_verifier=verifier)
    claims = verify_id_token(tokens["id_token"])
    request.session["user_id"] = claims["sub"]
    return RedirectResponse("/")`,
        lang: 'python',
        options: [
          '少了 PKCE，攔截到 code 的人可以拿去換 token',
          '沒把回傳的 state 與導向前存下的值比對；攻擊者可以誘導受害者的瀏覽器帶著攻擊者的 code 進來，把受害者的 session 綁到攻擊者的帳號（login CSRF）',
          '少了 client_secret，公開型 client 無法換 token',
          '應該用 access_token 打 userinfo endpoint，而不是驗 id_token',
        ],
        answer: 1,
        explain: 'state 是導向前產生、存在 session 的隨機值，回來時必須比對，否則任何人都能構造一個 callback URL 讓受害者點——受害者的瀏覽器就會用攻擊者的 code 完成登入，之後受害者在你系統裡的操作（綁卡、上傳）全落在攻擊者帳號下。這段程式 PKCE 有做（verifier）；驗 id_token 取 sub 是 OIDC 標準做法，不必再打 userinfo；client_secret 與 PKCE 可以擇一或並用，不是這裡的漏洞。',
      },
      {
        q: '你要為一個純前端 SPA 實作第三方登入，SPA 無法安全保存 client_secret。應該用哪種流程？',
        options: [
          'Implicit flow，token 直接從網址 fragment 回來，最適合沒有後端的 SPA',
          'Client Credentials flow，只用 client_id 即可',
          'Resource Owner Password flow，讓使用者在你的頁面輸入 Google 帳密',
          'Authorization Code + PKCE：用 code_verifier / code_challenge 取代 client_secret 證明「換 token 的人就是發起請求的人」，token 不出現在網址列',
        ],
        answer: 3,
        explain: 'PKCE 讓公開型 client（SPA、手機 App）也能走授權碼流程：發起時送 challenge、換 token 時送 verifier，攔到 code 的人沒有 verifier 換不到 token。Implicit 把 token 放在 URL fragment，會留在瀏覽器歷史、被 referer 帶走，OAuth 2.1 已移除；Client Credentials 是服務對服務、沒有使用者；Password flow 要使用者把 Google 密碼交給你，正是 OAuth 要避免的事，也已被棄用。',
      },
    ],
  },
  {
    skill: 'rbac-abac',
    questions: [
      {
        q: '「使用者只能編輯自己建立的草稿」這個需求，純 RBAC 會遇到什麼問題、實務上怎麼補？',
        options: [
          'RBAC 完全做得到，新增一個「草稿編輯者」角色即可',
          '角色是靜態的、與特定資源無關，硬用角色表達「自己的」會讓角色數量爆炸；實務上角色決定大方向，資源層再加擁有權與狀態檢查',
          '應該整套改成 ABAC，RBAC 已經過時',
          '在前端隱藏別人草稿的編輯按鈕就夠了',
        ],
        answer: 1,
        explain: 'RBAC 回答的是「這類人能做這類事」，回答不了「這個人與這個資源的關係」——每份草稿一個角色顯然不可行。所以混搭：role 決定能不能進「編輯草稿」這個功能，再在 service 層查 `draft.owner_id == user.id and draft.status == "draft"`。全面 ABAC 彈性高但規則多了很難回答「誰能看這份文件」，多數系統用 RBAC + 擁有權檢查就夠；前端隱藏按鈕不是授權，API 照樣打得到。',
      },
      {
        q: 'editor 小美嘗試編輯一份自己建立、狀態為 published 的文件。依這份政策，結果是？',
        code: `policies:
  - effect: allow
    role: editor
    action: document.edit
    condition: resource.owner == user.id
  - effect: deny
    action: document.edit
    condition: resource.status == "published"
default: deny`,
        lang: 'yaml',
        options: [
          '允許，第一條 allow 規則先被比對到',
          '允許，她是擁有者，擁有權高於狀態限制',
          '錯誤，兩條規則衝突時系統應拋出例外',
          '拒絕：有一條 deny 規則命中，拒絕優先於允許',
        ],
        answer: 3,
        explain: '授權引擎的基本原則是「預設拒絕、拒絕優先」：沒有規則明確允許就拒絕，多條規則衝突時 deny 勝出。這份政策的意圖很清楚——已發布的文件誰都不能直接編輯（要先撤回），擁有權只在草稿階段給你權限。規則順序不代表優先權，衝突也不是錯誤而是預期會發生的情況，所以引擎必須有明確的合併策略。',
      },
      {
        q: '「訂單退款」可以從 REST API、夜間批次作業、內部 admin 工具三個地方觸發。授權檢查應該放在哪？',
        options: [
          '放在執行退款的 service 函式裡，所有進入路徑都經過同一個檢查；router 層可以再加一層，但不能只靠它',
          '放在 REST API 的 router 就好，批次與 admin 工具是內部的可以信任',
          '放在前端與 admin 工具的 UI，把沒權限的按鈕隱藏起來',
          '放在資料庫 trigger 裡，其他層都不用管',
        ],
        answer: 0,
        explain: '同一個操作會從多條路徑進來，只擋其中一條就等於沒擋——admin 工具帳號被拿到、批次作業參數被誤設，退款就出去了。service 層是所有路徑的匯合點，檢查放這裡才一致、也好測（直接呼叫函式給不同身分）。UI 隱藏按鈕是體驗不是安全；DB trigger 看不到「目前使用者是誰」這個應用層概念，也很難表達商業規則。',
      },
    ],
  },
  {
    skill: 'auth-in-practice',
    questions: [
      {
        q: '已登入的一般會員呼叫 `DELETE /admin/users/7`，但他不是 admin。應該回什麼？',
        options: [
          '401 Unauthorized，因為他沒有被授權',
          '403 Forbidden：伺服器知道他是誰，但不允許這個操作；401 是「不知道你是誰或憑證無效」',
          '400 Bad Request，這個請求不合理',
          '500，因為權限檢查失敗屬於伺服器端錯誤',
        ],
        answer: 1,
        explain: '401 的名字是歷史誤導，它的語意是「需要驗證、或你給的憑證不對」，客戶端該做的是重新登入；403 是「驗證過了，但這個身分不能做這件事」，重新登入也沒用。以角色守門的 admin 路徑回 403 最直白。（另一種情境：一般使用者存取「別人的訂單」時常回 404，是為了不洩漏該資源存在——那是資源層的擁有權檢查。）400 是請求格式問題；權限不足是預期結果，不是伺服器錯誤。',
      },
      {
        q: '一個沒帶任何 token 的請求打到 `DELETE /admin/users/7`，會得到什麼回應？',
        code: `def get_current_user(token: str | None = Depends(bearer_token)) -> User:
    if token is None:
        raise HTTPException(status_code=401)
    return verify_and_load_user(token)   # token 無效也丟 401

def require_role(role: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if role not in user.roles:
            raise HTTPException(status_code=403)
        return user
    return checker

@app.delete("/admin/users/{user_id}")
def delete_user(user_id: int, admin: User = Depends(require_role("admin"))): ...`,
        lang: 'python',
        options: [
          '403，因為 checker 裡的角色檢查失敗',
          '500，因為 user 是 None 導致 `user.roles` 出錯',
          '401，get_current_user 這個依賴會先執行，token 缺失時就丟 401，根本走不到角色檢查',
          '200，`require_role("admin")` 在啟動時就已執行完，不會再檢查',
        ],
        answer: 2,
        explain: '依賴是一棵樹：解析 `require_role("admin")` 回傳的 checker 時，框架先解析它的依賴 get_current_user，這裡就因為沒 token 丟 401，checker 的本體不會執行，所以不會有 403 也不會有 None。`require_role("admin")` 在啟動時執行的只是「工廠」那一層（產生 checker 函式），checker 本身每個請求都會跑。這正是依賴工廠好用的地方：一行 `Depends(require_role("admin"))` 同時處理了 401 與 403。',
      },
      {
        q: '實作登入 endpoint 時，下列哪個做法正確？',
        options: [
          '先查帳號，不存在就回「帳號不存在」，存在再比對密碼回「密碼錯誤」，讓使用者知道錯在哪',
          '把使用者輸入雜湊後與資料庫的雜湊用 `==` 比較，雜湊值長度固定所以沒問題',
          '不論成功或失敗都回 200，只用 body 區分，避免被列舉',
          '用密碼雜湊函式庫內建的 verify（常數時間比對），且帳號不存在與密碼錯誤都回同一則「帳號或密碼錯誤」',
        ],
        answer: 3,
        explain: '區分「帳號不存在」與「密碼錯誤」等於提供帳號列舉服務，攻擊者可以先確認哪些 email 有註冊。`==` 比較會在第一個不同的位元組就返回，理論上可以從時間差推測雜湊內容，且 bcrypt / argon2 的 verify 還會處理 salt 與參數解析，自己比對是重造輪子。狀態碼要正確（失敗回 401），「都回 200」是把語意藏進 body，防列舉靠的是訊息一致，不是狀態碼。',
      },
    ],
  },
  {
    skill: 'api-keys-mfa',
    questions: [
      {
        q: '設計 API key 機制時，資料庫應該存什麼？',
        options: [
          '存 key 的明文，客戶忘記時可以再顯示給他',
          '用可逆加密存 key，需要時解密比對',
          '存 key 的雜湊（像密碼一樣），明文只在建立時顯示一次；另存名稱、scope、到期日、最後使用時間，方便管理、輪替與撤銷',
          '不用存，每次用 client_id 重新推導即可',
        ],
        answer: 2,
        explain: 'API key 就是密碼，資料庫外洩時明文或可解密的 key 會直接讓所有客戶的存取被接管；存雜湊（key 隨機且夠長，所以用 SHA-256 即可，不需要 bcrypt）就算外洩也用不了。忘記就重新產生一把，這也是為什麼要支援多把 key 與不停機輪替（新舊並存一段時間再撤舊的）。scope 與到期日限縮爆炸半徑，最後使用時間讓你敢撤銷閒置的 key。',
      },
      {
        q: '這是哪種 OAuth 流程、適合什麼場景？',
        code: `POST /oauth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=client_credentials&scope=orders:read`,
        lang: 'http',
        options: [
          'Authorization Code：使用者在瀏覽器登入後，由後端拿 code 換 token',
          'Client Credentials：服務用自己的 client_id / secret 直接換 token，適合排程、服務對服務呼叫等沒有使用者參與的場景',
          'Device Code：給沒有瀏覽器的裝置（電視、CLI）',
          'Refresh Token：用舊 token 換一個新的 access token',
        ],
        answer: 1,
        explain: '`grant_type=client_credentials` 沒有 code、沒有導向、沒有使用者同意畫面，是 Client 以自己的身分向授權伺服器要 token，token 代表的是「這個服務」而不是某個人。與授權碼流程的差別就在這：授權碼流程的 token 代表某位使用者授權你的 App 存取他的資料。不要讓服務共用某個人類帳號——離職、改密碼就會讓排程掛掉，也無法審計。',
      },
      {
        q: '你的產品要加 MFA，並要求「提款」這類高風險操作再驗一次。哪個方案最合理？',
        options: [
          '提供 TOTP（Authenticator App）與 WebAuthn / passkey，passkey 綁定網域可防釣魚故優先推薦；高風險操作觸發 step-up 再驗一次，而非只在登入時驗',
          '只用簡訊 OTP 當第二因素，因為所有使用者都有手機',
          '登入時驗過 MFA 後，整個 session 內所有操作都不需要再驗',
          '用「母親的姓氏」這類安全問題當第二因素，最不影響體驗',
        ],
        answer: 0,
        explain: 'TOTP 普及度最高，但 code 可以被釣魚網站即時轉送；passkey 的簽章綁定 origin，釣魚網站拿到的簽章對真站無效，所以是目前最強的因素。簡訊 OTP 有 SIM swap 與攔截問題，只適合當備援；安全問題根本不是「你擁有的東西」，答案常可從社群媒體查到。step-up 的意義是 session 被劫持時，攻擊者仍做不了提款這種不可逆的動作。',
      },
    ],
  },
]
