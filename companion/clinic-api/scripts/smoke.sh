#!/usr/bin/env bash
# 對跑起來的服務走一遍掛號流程：健康檢查 → 登入 → 查診次 → 掛號（帶 Idempotency-Key）→ 同一個鍵重送 →
# 重複掛號 409 → 取消 → 報到看板 → /metrics。業務介面在 /api 底下；/healthz、/ready、/metrics 不在。
# 用法：SEED_PASSWORD=<seed 時用的密碼> scripts/smoke.sh [BASE_URL]
set -euo pipefail

BASE="${1:-http://127.0.0.1:8000}"
: "${SEED_PASSWORD:?請設定 SEED_PASSWORD（和執行 seed 時相同）}"

BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }
expect() { # expect <預期狀態碼> <說明> <curl 參數...>
  local want="$1" label="$2"; shift 2
  local got
  got="$(curl -sS -o "$BODY" -w '%{http_code}' "$@")"
  if [ "$got" != "$want" ]; then
    echo "FAIL ${label}：預期 ${want}，實際 ${got}"; cat "$BODY"; echo; exit 1
  fi
  echo "ok   ${label}（${got}）"
}

expect 200 "GET /healthz" "$BASE/healthz"
expect 200 "GET /ready" "$BASE/ready"
expect 401 "沒帶 token 查掛號" "$BASE/api/appointments"

expect 200 "patient1 登入" "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"patient1\",\"password\":\"$SEED_PASSWORD\"}"
AUTH="Authorization: Bearer $(json "['access_token']" < "$BODY")"

DAY="$(python3 -c "from datetime import datetime, timedelta, timezone; print((datetime.now(timezone(timedelta(hours=8))) + timedelta(days=7)).date())")"
expect 200 "查林醫師 $DAY 的診次" "$BASE/api/sessions?doctor_id=1&date=$DAY" -H "$AUTH"
SESSION_ID="$(json "[0]['id']" < "$BODY")"
expect 200 "查 $DAY 全部醫師的診次（不帶 doctor_id）" "$BASE/api/sessions?date=$DAY" -H "$AUTH"

KEY="smoke-$(date +%s)-$$"
BOOK=(-X POST "$BASE/api/sessions/$SESSION_ID/appointments" -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
expect 201 "掛號（Idempotency-Key: $KEY）" "${BOOK[@]}" -H "Idempotency-Key: $KEY"
APPOINTMENT_ID="$(json "['id']" < "$BODY")"
echo "     號碼 $(json "['number']" < "$BODY")，掛號 id $APPOINTMENT_ID"
expect 201 "同一個鍵重送：回第一次的結果" "${BOOK[@]}" -H "Idempotency-Key: $KEY"
[ "$(json "['id']" < "$BODY")" = "$APPOINTMENT_ID" ] || { echo "FAIL 重送拿到不同的掛號"; exit 1; }
expect 409 "不帶鍵再掛一次" "${BOOK[@]}"
[ "$(json "['type']" < "$BODY")" = "https://clinic.example/problems/already-booked" ] || { echo "FAIL type 不是 already-booked"; exit 1; }
expect 200 "讀取自己的掛號" "$BASE/api/appointments/$APPOINTMENT_ID" -H "$AUTH"
expect 200 "只列已掛號的" "$BASE/api/appointments?status=booked" -H "$AUTH"
expect 200 "取消" -X POST "$BASE/api/appointments/$APPOINTMENT_ID/cancel" -H "$AUTH"
expect 200 "報到看板（不需要登入）" "$BASE/api/board"
expect 200 "GET /metrics" "$BASE/metrics"
grep -q 'appointments_booked_total{result="ok"}' "$BODY" || { echo "FAIL /metrics 沒有 appointments_booked_total"; exit 1; }
echo "smoke test 通過"
