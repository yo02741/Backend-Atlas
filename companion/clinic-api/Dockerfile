# syntax=docker/dockerfile:1

# 建置階段：只為了把依賴裝進 /app/.venv；uv 與它的快取不進最後的映像
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv
# 安裝時先編好 .pyc；搭配 cache mount 用複製而不是硬連結；用映像裡的 Python，不另外下載
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
WORKDIR /app
# 只複製依賴描述檔：程式碼改了但依賴沒變時，這一層直接用快取
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# 執行階段：乾淨的基底 + 裝好的 venv + 程式碼
FROM python:3.12-slim
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
# 明確列出要複製的東西，不用 COPY . .；alembic 也要進映像，migration 用同一個映像跑
COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY clinic/ ./clinic/
# 用數字 UID：Kubernetes 的 runAsNonRoot 才能確認不是 root
USER 10001
EXPOSE 8000
# DATABASE_URL、JWT_SECRET 等設定在執行時由環境變數注入，不寫進映像。
# exec 形式：uvicorn 是 PID 1，直接收到 SIGTERM；存取紀錄由應用程式自己的 middleware 寫成 JSON
CMD ["uvicorn", "clinic.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
