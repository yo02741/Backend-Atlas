#!/usr/bin/env bash
# 刪掉 scripts/kind-up.sh 建的 kind 叢集，裡面的 PostgreSQL 資料一起刪除。
# 可以重複執行：叢集不存在就什麼都不做。本機的 clinic-api 映像不會刪（docker image rm clinic-api:<tag>）。
# 用法：bash scripts/kind-down.sh；環境變數 KIND_CLUSTER 預設 clinic
set -euo pipefail

CLUSTER="${KIND_CLUSTER:-clinic}"

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  printf '+ %s\n' "kind delete cluster --name $CLUSTER"
  kind delete cluster --name "$CLUSTER"
else
  echo "沒有名為 $CLUSTER 的 kind 叢集，不需要刪除"
fi
