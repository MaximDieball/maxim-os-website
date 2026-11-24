# Alle Aufgaben laufen in Docker. Auf dem Host braucht es nur docker, git und make.
DC    ?= docker compose
TOOLS  = $(DC) --profile tools run --rm tools
PW     = $(DC) --profile test run --rm --build playwright
# Stub-LLM immer frisch starten (sonst läuft nach Änderungen am Stub die alte Version)
STUB   = $(DC) --profile test up -d --force-recreate --wait llm-stub

.PHONY: help dev down install lint format typecheck test build test-ui test-ui-screenshots \
	llm llm-down llm-model llm-bench dev-llm prod prod-down prod-logs prod-check \
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

ci: lint typecheck test build prod-check test-ui ## Komplette Pipeline-Checkliste lokal

portrait: ## Erzeugt das ASCII-Porträt aus assets/headshot/image.png nach content/about/
	$(TOOLS) pnpm --filter @maxim-os/scripts portrait

hooks: ## Aktiviert die Git-Hooks (commit-msg, pre-push)
	git config core.hooksPath .githooks

# Production (#38): nur die Website, Konfiguration aus .env
PROD_DC = docker compose -f docker-compose.prod.yml

prod: ## Production bauen und starten (Commit in /api/health), Port aus .env
	GIT_COMMIT=$$(git rev-parse --short HEAD) $(PROD_DC) up -d --build --wait

prod-down: ## Production stoppen
	$(PROD_DC) down

prod-logs: ## Logs der Production-Website
	$(PROD_DC) logs -f --tail 100

# Startet das schon gebaute Image (make build) wie in Production und prüft Health und Härtung.
PROD_CHECK = APP_IMAGE=maxim-os-app:local APP_PORT=18080 $(PROD_DC) -p maxim-os-prodcheck

prod-check: ## Prüft das Production-Setup: Health, Nicht-Root, read-only, keine Paketmanager (#37)
	@docker network inspect maxim-os_llm-net >/dev/null 2>&1 || docker network create --internal maxim-os_llm-net >/dev/null
	$(PROD_CHECK) up -d --no-build --wait
	@c=$$(docker ps -q --filter name=maxim-os-prodcheck-website); ok=1; \
	  [ "$$(docker inspect $$c --format '{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.CapDrop}}')" = "node|true|[ALL]" ] \
	    || { echo "FEHLER: Härtung fehlt"; ok=0; }; \
	  docker exec $$c node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1))" \
	    || { echo "FEHLER: Health nicht ok"; ok=0; }; \
	  if docker exec $$c sh -c 'command -v npm || command -v npx || command -v corepack'; then echo "FEHLER: Paketmanager im Image"; ok=0; fi; \
	  if docker exec $$c sh -c 'touch /app/x || touch /content/x' 2>/dev/null; then echo "FEHLER: Dateisystem beschreibbar"; ok=0; fi; \
	  $(PROD_CHECK) down >/dev/null 2>&1; \
	  [ $$ok = 1 ] && echo "prod-check ok: Health, Nicht-Root, read-only, keine Capabilities, keine Paketmanager"

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
