// 設計情境：掛號表單的驗證放哪裡（前端路線，畫面與互動）
export default {
  id: 'validation-placement',
  order: 32,
  group: 'screen',
  title: '掛號表單的驗證放哪裡',
  en: 'Where form validation lives',
  level: 2,
  skills: ['forms', 'form-submit', 'ts-basics', 'input-validation', 'openapi', 'openapi-types'],
  related: ['versioning'],
  week: 12,
  lab: 'ValidationPlacementScenarioLab',
  summary: '掛號表單有格式規則，也有要查資料庫才知道的規則。只寫在前端、只寫在後端、兩邊各寫一份，還是從同一份 schema 產生？',
  situation: '門診掛號表單，櫃台與病患都會用，欄位有病歷號、手機、生日、診次與備註。後端是 FastAPI，請求用 pydantic model 驗證，`/openapi.json` 由框架自動產生；前端是 Vue 3.5 + TypeScript。前端的規則是兩年前照規格書手寫的，上個月後端把備註上限從 200 字改成 100 字，前端沒有跟著改。院內的排程程式與讀卡機服務也直接呼叫同一支掛號 API。',
  constraints: [
    '使用者要在送出前就知道哪一欄錯，不要每改一欄就等一次伺服器',
    '不經過表單的呼叫（排程程式、讀卡機服務、`curl`）也不能把壞資料寫進資料庫',
    '「診次還有名額」「病歷號存在」要查資料庫，只有後端知道',
    '規則會改（字數上限、手機格式），改一次要兩邊一起生效',
    '錯誤訊息放在對應欄位旁邊，螢幕閱讀器念得出來',
  ],
  options: [
    {
      id: 'front', name: '只在前端驗證',
      summary: '規則寫在 Vue 元件或表單函式庫（VeeValidate 這類）裡，後端收到什麼就存什麼。',
      pros: ['輸入中、離開欄位就有提示，不用等網路', '只有一份規則'],
      cons: ['繞過表單的請求沒有任何檢查，壞資料直接進資料庫', '要查資料庫的規則（名額、病歷號存在）前端做不到，結果是超收或掛在不存在的病歷號上'],
    },
    {
      id: 'back', name: '只在後端驗證',
      summary: 'pydantic model 是唯一的規則；前端送出後，把 422 的 `errors` 對回各欄位。',
      pros: ['一份規則，所有呼叫端都擋得住', '規則改了，部署後端就對所有客戶端生效'],
      cons: ['每個錯都要按下送出、等一次來回才知道', '輸入中、離開欄位的即時提示做不到，長表單要來回好幾輪'],
    },
    {
      id: 'both', name: '兩邊各寫一份',
      summary: '前端照規格書手寫一份規則給即時回饋，後端的 pydantic model 才算數。',
      pros: ['即時回饋與資料正確都有', '不用共用任何工具，前後端分屬不同團隊也做得到'],
      cons: ['兩份規則會漂移：後端收緊時，前端放行、送出後才被 422 退回', '後端放寬時前端比後端嚴，合法的資料送不出去，而且沒有後端可以兜底'],
    },
    {
      id: 'shared', name: '從同一份 schema 產生',
      summary: '後端的 model 是來源，前端建置時從 `/openapi.json` 產生型別與 zod schema（Hey API、orval 這類工具）；同一份規則跑在兩邊，後端照樣驗。',
      pros: ['規則改一次，前端下一次建置就跟上', 'OpenAPI 改了欄位，產生的型別跟著變，對不上的程式在型別檢查就失敗'],
      cons: ['多一個產生步驟要放進 CI；錯誤訊息的文字與顯示時機仍是前端的事', 'OpenAPI 只描述得了格式、長度、範圍；查資料的規則與 `field_validator` 寫的自訂規則不會出現在裡面', '還沒重新整理的舊頁面用的是舊規則，後端的 422 處理不能省'],
    },
  ],
  tradeoffs: {
    axes: ['即時回饋', '繞過表單的請求', '規則改了之後', '要查資料的規則', '維護'],
    rows: [
      { option: 'front', cells: ['好：輸入中就提示', '差：沒有檢查', '一份，沒有漂移', '差：做不到，會超收', '低：一份'] },
      { option: 'back', cells: ['差：送出後才知道', '好：都擋得住', '一份，部署即生效', '好：409 回原因', '低：一份'] },
      { option: 'both', cells: ['好', '好：後端兜底', '差：兩份各改各的', '好：409 回原因', '高：兩份要同步'] },
      { option: 'shared', cells: ['好', '好：後端照驗', '好：下次建置就跟上', '好：409 回原因', '中：產生步驟放進 CI'] },
    ],
  },
  decisions: [
    { id: 'calculator', situation: '診間的「依體重換算兒童劑量」小工具：純前端計算，不送任何資料到伺服器，也不存檔。', options: ['front', 'back', 'both', 'shared'], answer: 'front',
      explain: '沒有後端，也沒有資料進系統，前端驗證就是全部：擋掉空白、負數與超出範圍的體重，避免算出錯的劑量。「只在前端驗證」的缺點都建立在有 API 收資料的前提上，這裡不成立；另外兩種做法沒有東西可以共用。' },
    { id: 'import', situation: '每晚排程把外院轉診資料匯入掛號系統，直接呼叫掛號 API，沒有任何畫面。', options: ['front', 'back', 'both', 'shared'], answer: 'back',
      explain: '沒有使用者在等即時提示，前端驗證沒有對象；規則全部在後端，錯的那幾筆回 422，寫進匯入報告。這也說明表單只做前端驗證為什麼不夠：同一支 API 還有不經過表單的呼叫端。' },
    { id: 'vendor', situation: '後端是外包廠商維護的舊系統，沒有 OpenAPI，規則只寫在一份 PDF 規格書裡；前端仍要做即時提示。', options: ['front', 'back', 'both', 'shared'], answer: 'both',
      explain: '沒有機器讀得懂的來源，就沒有東西可以產生。前端照規格書寫一份給即時回饋，後端那份才算數。降低漂移：前端只做必填與格式這類少改的檢查，上限與範圍交給後端的 422；再寫一組 E2E 測試送邊界值（剛好 100 字、101 字），兩邊規則不一致時測試會失敗。' },
    { id: 'monorepo', situation: '自家的門診掛號表單，FastAPI 後端與 Vue 前端在同一個 repo，CI 跑兩邊的測試；規則每季調整。', options: ['front', 'back', 'both', 'shared'], answer: 'shared',
      explain: '後端的 pydantic model 已經產生 OpenAPI，前端建置前產生 zod schema，規則改一次兩邊生效，產生的檔案有變動時 CI 看得到 diff。名額與病歷號存在仍只有後端驗得了，前端照樣要把 409 與 422 顯示在對的位置。' },
  ],
  switchIf: [
    { when: '後端是外包的舊系統，沒有 OpenAPI，規則只在 PDF 規格書裡', then: '改用 `both`：沒有可以產生的來源，前端照規格書手寫即時提示，後端照舊驗；兩份要定期對照。' },
    { when: '純前端計算的小工具，不送資料也不存檔', then: '改用 `front`：沒有繞過表單的請求，也沒有後端可以驗。' },
    { when: '沒有畫面，排程程式直接呼叫 API', then: '只要 `back`：沒有人需要即時回饋。' },
  ],
  alternative: { option: 'both', holdsWhen: '規則很少改、前後端分屬不同 repo 或不同團隊，而且有一組測試定期拿同樣的案例打前端與後端、差異會被發現時。' },
  challenge: {
    task: '有些錯誤只有後端在送出後才知道，而且牽涉兩個欄位，例如「生日顯示未滿 18 歲，但沒填監護人電話」或「這個診次已額滿」。設計 422 或 409 回來之後的畫面：訊息放在哪一欄旁邊、焦點移到哪裡、螢幕閱讀器念什麼、改好之後錯誤何時消失。先在本頁模擬器選「共用 schema」，載入「診次已額滿」案例按「掛號」，看錯誤出現在哪裡、是送出前還是送出後。',
    deliver: '一份錯誤呈現規格：後端回應的 JSON 範例、對應的欄位、焦點位置、`aria-describedby` 或 live region 的寫法，以及錯誤清掉的條件',
    check: [
      '跨欄位錯誤指定一個主要欄位放訊息，另一個欄位也有標示（例如 `aria-invalid`）',
      '送出後焦點移到第一個錯誤欄位或錯誤摘要，並寫出鍵盤使用者怎麼到其他錯誤',
      '寫出錯誤在什麼時候清掉（改了相關欄位、重新送出成功），不會打一個字就消失',
    ],
    twist: '「後端最近的規則變更」選「備註上限 200 → 100」。先預測四種做法裡哪幾種會讓「備註 150 字」在送出後才知道錯、哪一種會讓壞資料進資料庫，再逐一切換驗證。',
  },
  implementation: [
    { title: '規則的來源：pydantic model', lang: 'python', code: `# clinic/api/schemas.py：FastAPI 把 Field 的限制寫進 /openapi.json
from datetime import date
from pydantic import BaseModel, Field, field_validator

class AppointmentIn(BaseModel):
    chart_no: str = Field(pattern=r"^\\d{8}$", description="病歷號，8 位數字")
    phone: str = Field(pattern=r"^09\\d{8}$")
    birthday: date                        # OpenAPI：type string, format date
    session_id: int = Field(gt=0)
    note: str = Field(default="", max_length=100)

    # 寫成程式的規則不會出現在 OpenAPI：前端要自己補一份，或交給 422
    @field_validator("birthday")
    @classmethod
    def not_in_future(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("生日不能晚於今天")
        return v

# 名額、病歷號存在：在 service 層查資料庫，失敗回 409 / 422` },
    { title: '建置前產生型別與 zod schema', lang: 'ts', code: `// openapi-ts.config.ts（@hey-api/openapi-ts 仍是 0.x，官方建議釘死版本）
import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  // 後端的 CI 匯出這個檔：python -c "import json; from clinic.main import app; print(json.dumps(app.openapi()))"
  input: '../clinic-api/openapi.json',
  output: 'src/api/gen',                       // 產生 types.gen.ts、zod.gen.ts，不手改
  plugins: ['@hey-api/typescript', 'zod'],
})

// package.json
// "gen:api": "openapi-ts",
// "build": "npm run gen:api && vue-tsc --noEmit && vite build"
// CI 另外跑 gen:api 後檢查 git diff：後端改了規則、前端沒重新產生，CI 失敗` },
    { title: '表單：離開欄位驗一欄、送出驗全部、422 對回欄位', lang: 'vue', code: `<script setup lang="ts">
import { reactive, ref } from 'vue'
import { zAppointmentIn } from '@/api/gen/zod.gen'   // 產生的 schema：只有規則
import { toFormErrors } from '@/api/problem'          // 422 → 欄位訊息（表單送出與驗證錯誤那一課）

type Field = 'chart_no' | 'phone' | 'birthday' | 'note'
const MESSAGES: Record<Field, string> = {             // 訊息文字是前端的事
  chart_no: '病歷號是 8 位數字',
  phone: '手機是 09 開頭的 10 碼',
  birthday: '生日格式是 YYYY-MM-DD',
  note: '備註最多 100 字',
}
const form = reactive({ chart_no: '', phone: '', birthday: '', session_id: 7, note: '' })
const errors = reactive<Partial<Record<Field | 'form', string>>>({})
const submitting = ref(false)

function check(field: Field) {                        // @blur：只驗這一欄
  const ok = zAppointmentIn.shape[field].safeParse(form[field]).success
  if (ok) delete errors[field]
  else errors[field] = MESSAGES[field]
}

async function submit() {
  if (submitting.value) return
  const parsed = zAppointmentIn.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const f = issue.path[0] as Field
      errors[f] ??= MESSAGES[f]
    }
    return                                            // 焦點移到第一個出錯的欄位（略）
  }
  submitting.value = true
  try {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    })
    if (res.status === 422 || res.status === 409) {
      // 只有後端知道的規則（名額、病歷號存在），與舊頁面沒跟上的規則，都從這裡回來
      const { fields, form: top } = toFormErrors(await res.json(), Object.keys(MESSAGES))
      Object.assign(errors, fields)
      if (top.length) errors.form = top.join('；')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form novalidate @submit.prevent="submit">
    <p v-if="errors.form" role="alert">{{ errors.form }}</p>
    <label for="chart_no">病歷號</label>
    <input id="chart_no" v-model.trim="form.chart_no" inputmode="numeric"
           :aria-invalid="!!errors.chart_no" aria-describedby="chart_no-err"
           @blur="check('chart_no')" />
    <p id="chart_no-err">{{ errors.chart_no }}</p>
    <!-- 手機、生日、備註同樣寫法 -->
    <button :disabled="submitting">{{ submitting ? '送出中…' : '掛號' }}</button>
  </form>
</template>` },
  ],
  exercise: null,
  refs: [],
}
