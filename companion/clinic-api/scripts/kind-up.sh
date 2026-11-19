#!/usr/bin/env bash
# 在本機的 kind 叢集把 clinic-api 跑起來：
#   建叢集 → 建置映像並 kind load → kubectl apply -k k8s/overlays/kind
#   → 等 PostgreSQL、Redis → 等 migration Job 完成 → 等 Deployment 滾動更新完成 → seed
# 每一步都印出實際執行的指令（開頭是 +），和 docs/local-k8s.md 手動做的一樣。
#
# 可以重複執行：叢集已經存在就沿用；映像重建（有快取）；沒變的物件 apply 回 unchanged；
# 這個 tag 的 migration Job 已經完成就不重跑；seed 發現已經有使用者就略過。
# 改了 k8s/overlays/kind/kustomization.yaml 的 newTag 再執行，就是一次滾動更新。
#
# 用法（在 companion/clinic-api 目錄）：bash scripts/kind-up.sh
# 環境變數：
#   KIND_CLUSTER   叢集名稱，預設 clinic
#   KIND_CONFIG    kind 設定檔，預設 k8s/kind-config.yaml
#   SEED_PASSWORD  seed 帳號的密碼，預設 local-dev-only（只在本機叢集）
#   SKIP_BUILD=1   不執行 docker build，直接載入本機已經有的同名映像
set -euo pipefail

cd "$(dirname "$0")/.."

CLUSTER="${KIND_CLUSTER:-clinic}"
CONFIG="${KIND_CONFIG:-k8s/kind-config.yaml}"
SEED_PASSWORD="${SEED_PASSWORD:-local-dev-only}"
OVERLAY=k8s/overlays/kind
NS=clinic
CTX="kind-$CLUSTER"   # 每個 kubectl 都指定 context：目前的 context 是別的叢集時也不會套用錯地方

step() { printf '\n==> %s\n' "$*"; }
run() { printf '+ %s\n' "$*"; "$@"; }
k() { kubectl --context "$CTX" "$@"; }
kc() { printf '+ kubectl %s\n' "$*"; k "$@"; }   # 印出指令再執行
# Job 目前的結果：Complete、Failed，或空字串（還在跑、或不存在）
job_state() {
  local conditions
  conditions=" $(k -n "$NS" get job "$1" -o jsonpath='{range .status.conditions[?(@.status=="True")]}{.type} {end}' 2>/dev/null || true) "
  case "$conditions" in
    *" Complete "*) echo Complete ;;
    *" Failed "*) echo Failed ;;
  esac
}

for cmd in docker kind kubectl; do
  command -v "$cmd" >/dev/null || { echo "找不到 $cmd，安裝方式見 docs/local-k8s.md"; exit 1; }
done

# 映像名稱與 tag 以 overlay 的 images 為準（只有一筆）
NAME="$(awk '$1 == "newName:" { print $2; exit }' "$OVERLAY/kustomization.yaml")"
TAG="$(awk '$1 == "newTag:" { print $2; exit }' "$OVERLAY/kustomization.yaml")"
[ -n "$NAME" ] && [ -n "$TAG" ] || { echo "讀不到 $OVERLAY/kustomization.yaml 的 newName 或 newTag"; exit 1; }
IMAGE="$NAME:$TAG"
JOB="clinic-migrate-$TAG"

step "1/7 叢集 $CLUSTER"
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "已經存在，沿用"
  kubectl config get-contexts -o name | grep -qx "$CTX" || run kind export kubeconfig --name "$CLUSTER"
else
  run kind create cluster --name "$CLUSTER" --config "$CONFIG" --wait 120s
fi

step "2/7 建置映像 $IMAGE"
if [ "${SKIP_BUILD:-0}" = 1 ]; then
  echo "SKIP_BUILD=1：略過 docker build"
  docker image inspect "$IMAGE" >/dev/null || { echo "本機沒有 $IMAGE"; exit 1; }
else
  run docker build -t "$IMAGE" .
fi

step "3/7 把映像載入叢集的節點"
run kind load docker-image "$IMAGE" --name "$CLUSTER"

step "4/7 套用 $OVERLAY"
# 同一個 tag 的 migration Job 上次失敗了：Job 不能改，刪掉才能重新建立
if [ "$(job_state "$JOB")" = Failed ]; then
  echo "上次的 $JOB 失敗了，刪掉重建"
  kc -n "$NS" delete job "$JOB"
fi
kc apply -k "$OVERLAY"

step "5/7 等 PostgreSQL 與 Redis 就緒"
kc -n "$NS" rollout status statefulset/postgres --timeout=180s
kc -n "$NS" rollout status deployment/redis --timeout=120s

step "6/7 等 migration Job $JOB 完成"
# kubectl wait --for=condition=complete 在 Job 失敗時會等到逾時，所以自己看 Complete 或 Failed
printf '+ %s\n' "kubectl -n $NS wait --for=condition=complete job/$JOB（失敗就停）"
state=""
for _ in $(seq 1 150); do
  state="$(job_state "$JOB")"
  [ -n "$state" ] && break
  sleep 2
done
case "$state" in
  Complete) echo "job.batch/$JOB 完成" ;;
  Failed) echo "migration 失敗，Job 的輸出："; k -n "$NS" logs "job/$JOB" --all-containers || true; exit 1 ;;
  *) echo "等了 300 秒 $JOB 還沒完成"; k -n "$NS" describe job "$JOB"; exit 1 ;;
esac
kc -n "$NS" logs "job/$JOB" -c migrate --tail=5

step "7/7 等 clinic-api 滾動更新完成，然後 seed"
kc -n "$NS" rollout status deployment/clinic-api --timeout=180s
printf '+ %s\n' "kubectl -n $NS exec deployment/clinic-api -- env SEED_PASSWORD=*** python -m clinic.seed"
k -n "$NS" exec deployment/clinic-api -- env SEED_PASSWORD="$SEED_PASSWORD" python -m clinic.seed

cat <<EOF

完成。目前的 Pod：
$(k -n "$NS" get pods -o wide)

打 API（另開一個終端機）：
  kubectl --context $CTX -n $NS port-forward service/clinic-api 8000:80
  SEED_PASSWORD=$SEED_PASSWORD bash scripts/smoke.sh
刪掉叢集：bash scripts/kind-down.sh
EOF
