# Alle Aufgaben laufen in Docker. Auf dem Host braucht es nur docker, git und make.
DC    ?= docker compose
TOOLS  = $(DC) --profile tools run --rm tools
PW     = $(DC) --profile test run --rm --build playwright

.PHONY: help dev down install lint format typecheck test build test-ui test-ui-screenshots \
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
	$(PW) test tests/regression

test-ui-screenshots: ## Playwright-Screenshots fürs Entwickler-Review nach artifacts/screenshots
	$(PW) test tests/review

update-baselines: ## Erzeugt Regressions-Baselines neu (nur im Container)
	$(PW) test tests/regression --update-snapshots

ci: lint typecheck test build test-ui ## Komplette Pipeline-Checkliste lokal

portrait: ## Erzeugt das ASCII-Porträt aus assets/headshot/image.png nach content/about/
	$(TOOLS) pnpm --filter @maxim-os/scripts portrait

hooks: ## Aktiviert die Git-Hooks (commit-msg, pre-push)
	git config core.hooksPath .githooks

clean: ## Entfernt Container und node_modules-Volumes
	$(DC) --profile tools --profile test down --volumes --remove-orphans
