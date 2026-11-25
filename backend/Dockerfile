# syntax=docker/dockerfile:1
# Development image: full environment with dev tools and tests.

FROM python:3.12-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.5.31 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./

FROM base AS dev
RUN uv sync --frozen --no-install-project
COPY src ./src
COPY tests ./tests
RUN uv sync --frozen
EXPOSE 8000
CMD ["uvicorn", "pse_forecast.api.main:app", "--host", "0.0.0.0", "--port", "8000"]

