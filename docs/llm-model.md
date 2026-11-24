# Modell für den KI-Assistenten

Stand: Kandidaten für den Spike (#71). Die endgültige Wahl trifft der Besitzer nach dem Benchmark auf dem Server; sie wird hier eingetragen. Das Modell liegt **nie** im Image oder Repo, sondern in einem Docker-Volume (`llm-models`).

## Kandidaten

Alle Dateien sind auf einen Commit gepinnt; `make llm-model` prüft die SHA-256-Prüfsumme und verwirft abweichende Dateien. Quelle und Prüfsummen stehen maschinenlesbar in [`docker/llm/models.tsv`](../docker/llm/models.tsv).

| ID (`MODEL=`) | Datei                              | Größe  | Lizenz                      | Variante              | SHA-256           |
| ------------- | ---------------------------------- | ------ | --------------------------- | --------------------- | ----------------- |
| `qwen3-4b`    | Qwen3-4B-Instruct-2507-Q4_K_M.gguf | 2,5 GB | Apache 2.0                  | GPU (Startempfehlung) | `3605803b…67e597` |
| `gemma3-4b`   | google_gemma-3-4b-it-Q4_K_M.gguf   | 2,5 GB | Gemma Terms of Use          | GPU                   | `49960302…d1ae94` |
| `llama3.2-3b` | Llama-3.2-3B-Instruct-Q4_K_M.gguf  | 2,0 GB | Llama 3.2 Community License | GPU                   | `6c1a2b41…c728ff` |
| `qwen3-1.7b`  | Qwen3-1.7B-Q4_K_M.gguf             | 1,1 GB | Apache 2.0                  | CPU (Fallback)        | `b139949c…181897` |
| `gemma3-1b`   | google_gemma-3-1b-it-Q4_K_M.gguf   | 0,8 GB | Gemma Terms of Use          | CPU                   | `12bf0fff…f0d29d` |

Lizenzen kurz: Apache 2.0 ist ohne Auflagen nutzbar. Gemma und Llama 3.2 erlauben die Nutzung in einer privaten Website, haben aber eigene Nutzungsbedingungen (u. a. Weitergabe nur mit Lizenztext, Verbot bestimmter Anwendungen). Für eine Website, die nur Antworten anzeigt, passt jede der drei; Apache 2.0 ist am einfachsten.

## Speicherbedarf neben Minecraft

Server: i7-7700, 11 GB RAM (ca. 6 GB frei), GTX 1050 Ti mit 4 GB VRAM.

- **GPU-Variante (4B, Q4_K_M):** Modell und KV-Cache (4096 Tokens) liegen im VRAM, ca. 3–3,5 GB. Im RAM bleiben ca. 0,5–1 GB für den Prozess. Passt neben Minecraft.
- **CPU-Variante (1.7B, Q4_K_M):** ca. 1,5–2,5 GB RAM (gemessen lokal: 2,5 GB mit 4096 Tokens Kontext). Passt neben Minecraft, aber der Minecraft-Server bekommt weniger CPU, solange eine Antwort läuft.
- Der Container hat Limits: `LLM_MEM_LIMIT` (Standard 5g) und `LLM_CPUS` (Standard 6 von 8 Threads).

## Betrieb

```bash
make llm-model MODEL=qwen3-4b          # Modell laden und prüfen
make llm LLM_VARIANT=gpu LLM_MODEL_FILE=Qwen3-4B-Instruct-2507-Q4_K_M.gguf
make llm-down
```

Einstellungen per Umgebung (oder `.env`): `LLM_MODEL_FILE`, `LLM_CTX_SIZE` (4096), `LLM_THREADS` (6), `LLM_GPU_LAYERS` (99, nur GPU), `LLM_MEM_LIMIT`, `LLM_CPUS`. Das Image ist auf einen llama.cpp-Build gepinnt: `server-b12627` (CPU) bzw. `server-cuda12-b12627` (GPU). Die GPU-Variante braucht den **CUDA-12-Build**, weil CUDA 13 Pascal-Karten wie die 1050 Ti nicht mehr unterstützt, und auf dem Host den NVIDIA-Treiber plus das NVIDIA Container Toolkit (richtet der Besitzer ein).
