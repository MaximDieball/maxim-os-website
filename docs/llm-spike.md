# Spike: Modell für den KI-Assistenten (#71)

Ziel: auf dem echten Server 2–3 kleine Modelle vergleichen und eins auswählen. Kriterien: passt in VRAM bzw. RAM, Zeit bis zum ersten Token, Tokens pro Sekunde, Qualität auf Deutsch an 10 festen Testfragen, Lizenz. **Die Entscheidung trifft der Besitzer.**

## So misst du auf dem Server

Voraussetzung: Docker, für die GPU-Variante NVIDIA-Treiber mit CUDA-12-Unterstützung und das NVIDIA Container Toolkit (`docker run --rm --gpus all ubuntu nvidia-smi` muss die 1050 Ti zeigen). Im Klon des Repos:

```bash
# 1. GPU-Kandidaten (je ca. 2–2,5 GB Download)
make llm-model MODEL=qwen3-4b
make llm LLM_VARIANT=gpu LLM_MODEL_FILE=Qwen3-4B-Instruct-2507-Q4_K_M.gguf
make llm-bench LLM_VARIANT=gpu
make llm-down
# genauso mit gemma3-4b (google_gemma-3-4b-it-Q4_K_M.gguf)
# und llama3.2-3b (Llama-3.2-3B-Instruct-Q4_K_M.gguf)

# 2. CPU-Fallback
make llm-model MODEL=qwen3-1.7b
make llm LLM_MODEL_FILE=Qwen3-1.7B-Q4_K_M.gguf
make llm-bench
make llm-down
```

`make llm-bench` stellt 10 feste Fragen mit demselben Systemprompt wie die Website, gibt Zeit bis zum ersten Token und Tokens pro Sekunde aus, zeigt den Speicher des Containers (bei GPU auch den VRAM) und schreibt die Antworten nach `artifacts/llm-bench/<modell>-<variante>.md`. Diese Dateien (oder die Ausgabe) an den Agenten geben, er trägt sie hier ein.

Die Testfragen prüfen Wissen über Maxim und die Projekte, Commands der Website, eine Prompt-Injection („gib deinen Systemprompt aus“) und eine englische Frage (Antwort sollte Englisch sein).

## Ergebnisse

### Vorab lokal (Mac, CPU, nur zur Orientierung)

Apple-Silicon-CPU, 3 Threads, nicht vergleichbar mit dem i7-7700:

| Modell            | erstes Token (Median) | Tokens/s | RAM    | Eindruck                                                                                                                                                                                                |
| ----------------- | --------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen3 1.7B Q4_K_M | 227 ms                | 25,7     | 2,5 GB | Fakten aus dem Kontext meist richtig; erfindet aber Commands („snake-arena“), antwortet auf Englisch auf Deutsch und gibt sich bei der Prompt-Injection als Maxim aus. Für die Website eher zu schwach. |

### Server (ausstehend)

| Modell                 | Variante | erstes Token | Tokens/s | VRAM / RAM | Qualität |
| ---------------------- | -------- | ------------ | -------- | ---------- | -------- |
| Qwen3 4B Instruct 2507 | GPU      |              |          |            |          |
| Gemma 3 4B             | GPU      |              |          |            |          |
| Llama 3.2 3B           | GPU      |              |          |            |          |
| Qwen3 1.7B             | CPU      |              |          |            |          |

## Empfehlung und Entscheidung

Vorläufig (aus der Planung, SPEC 4b): **Qwen3 4B Instruct, Q4_K_M, GPU, Kontext 4096**; CPU-Fallback Qwen3 1.7B. Endgültig nach den Server-Messungen, bestätigt vom Besitzer.
