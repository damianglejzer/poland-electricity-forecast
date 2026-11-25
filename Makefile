COMPOSE := docker compose
CLI := $(COMPOSE) exec backend python -m pse_forecast.cli

.PHONY: help up down refresh train forecast publish test fe-check logs ps clean

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-10s %s\n", $$1, $$2}'

up: ## Build and start Postgres, MLflow, API and UI
	$(COMPOSE) up -d --build --wait
	@echo "UI: http://localhost:$${FRONTEND_PORT:-3000}  API: http://localhost:$${BACKEND_PORT:-8000}/api/docs  MLflow: http://localhost:$${MLFLOW_PORT:-5000}"

down: ## Stop all services (data volumes are kept)
	$(COMPOSE) down

refresh: ## Download new PSE demand + weather data into the local database
	$(CLI) refresh

train: ## Train, evaluate and register a new model (MLflow), then forecast with it
	$(CLI) train

forecast: ## Forecast the next day with the current model (no retraining)
	$(CLI) forecast

publish: ## Promote the current model + data to the public database (PUBLISH_DATABASE_URL)
	$(CLI) publish

test: ## Lint + backend tests (in the backend container, SQLite, no network)
	$(COMPOSE) run --rm --no-deps -e DATABASE_URL=sqlite:// backend sh -c "ruff check src tests && ruff format --check src tests && pytest -q"

fe-check: ## Type-check and build the frontend
	docker run --rm -v $(CURDIR)/frontend:/app -w /app -u $$(id -u):$$(id -g) -e HOME=/tmp node:20-alpine \
		sh -c "npm ci --no-audit --no-fund && npm run build"


logs: ## Follow service logs
	$(COMPOSE) logs -f --tail=100

ps: ## Show running services
	$(COMPOSE) ps

clean: ## Stop services and DELETE all local data volumes
	$(COMPOSE) down -v
