# Alle Aufgaben laufen in Docker. Auf dem Host braucht es nur docker, git und make.
DC    ?= docker compose
TOOLS  = $(DC) --profile tools run --rm tools
PW     = $(DC) --profile test run --rm --build playwright
# Stub-LLM immer frisch starten (sonst läuft nach Änderungen am Stub die alte Version)
STUB   = $(DC) --profile test up -d --force-recreate --wait llm-stub

.PHONY: help dev down install lint format typecheck test build test-ui test-ui-screenshots \
	llm llm-down llm-model llm-bench dev-llm \
        update-baselines ci hooks clean portrait

help: ## Zeigt alle Targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-22s %s\n", $$1, $$2}'

dev: ## Dev-Server: http://localhost:5173 (Vite + Fastify, Hot-Reload)
	$(DC) up --build dev

down: ## Stoppt alle Container
	$(DC) --profile tools --profile test down --remove-orphans

install: ## Installiert Abhängigkeiten in die Container-Volumes
	$(TOOLS) true

lint: ## ESLint + Prettier-Check
	$(TOOLS) pnpm lint

format: ## Formatiert alle Dateien mit Prettier
	$(TOOLS) pnpm format

typecheck: ## TypeScript-Typecheck aller Pakete
	$(TOOLS) pnpm typecheck

test: ## Unit- und API-Tests (Vitest)
	$(TOOLS) pnpm test

build: ## Baut das Production-Image
	$(DC) --profile test build app

test-ui: ## Playwright-Regressionstests (toHaveScreenshot), wie in der CI
	$(STUB)
	$(PW) test tests/regression

test-ui-screenshots: ## Playwright-Screenshots fürs Entwickler-Review nach artifacts/screenshots
	$(STUB)
	$(PW) test tests/review

update-baselines: ## Erzeugt Regressions-Baselines neu (nur im Container)
	$(STUB)
	$(PW) test tests/regression --update-snapshots

ci: lint typecheck test build test-ui ## Komplette Pipeline-Checkliste lokal

portrait: ## Erzeugt das ASCII-Porträt aus assets/headshot/image.png nach content/about/
	$(TOOLS) pnpm --filter @maxim-os/scripts portrait

hooks: ## Aktiviert die Git-Hooks (commit-msg, pre-push)
	git config core.hooksPath .githooks

# KI-Assistent (#72): Compose mit docker-compose.llm.yml. Variante cpu (Standard) oder gpu.
LLM_DC      = $(DC) -f docker-compose.yml -f docker-compose.llm.yml
LLM_VARIANT ?= cpu
MODEL       ?= qwen3-1.7b

llm-model: ## Lädt ein Modell mit Prüfsumme (MODEL=qwen3-4b|qwen3-1.7b|..., siehe docker/llm/models.tsv)
	$(LLM_DC) --profile llm-model run --rm llm-model $(MODEL)

llm: ## Startet den KI-Container (LLM_VARIANT=cpu|gpu, LLM_MODEL_FILE=<datei.gguf>)
	$(LLM_DC) --profile llm-$(LLM_VARIANT) up -d --wait llm-$(LLM_VARIANT)

llm-down: ## Stoppt den KI-Container
	$(LLM_DC) --profile llm-cpu --profile llm-gpu rm -sf llm-cpu llm-gpu

dev-llm: ## Dev-Server mit KI-Assistent (vorher make llm-model und make llm)
	$(LLM_DC) up --build dev

llm-bench: ## Misst das laufende LLM: 10 Testfragen, Tokens/s, Zeit bis zum ersten Token (#71)
	$(LLM_DC) --profile tools run --rm -e LLM_VARIANT=$(LLM_VARIANT) tools pnpm --filter @maxim-os/scripts llm-bench
	@echo "Speicher des KI-Containers:"
	@docker stats --no-stream --format '  {{.Name}}: {{.MemUsage}}' $$(docker ps -q --filter name=llm-$(LLM_VARIANT))
	@if [ "$(LLM_VARIANT)" = gpu ]; then echo "GPU-Speicher:"; \
	  docker exec $$(docker ps -q --filter name=llm-gpu) nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader || true; fi

clean: ## Entfernt Container und node_modules-Volumes
	$(DC) --profile tools --profile test down --volumes --remove-orphans
