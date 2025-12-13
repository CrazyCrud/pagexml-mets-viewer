# Quick Start: AI Transcription

Get AI-powered transcription working in 3 steps.

## Prerequisites

Choose one setup method:

### Option A: Manual Installation (Easiest)
```bash
# 1. Install Ollama from ollama.ai/download
# 2. Run setup script
python scripts/start_ollama.py
# 3. Start viewer
python app.py
```

### Option B: Docker (Production)
```bash
docker compose -f docker-compose.with-ollama.yml up --build
```

## Usage

1. Open viewer at `http://localhost:8000` (Docker) or `http://localhost:5000` (manual)
2. Load a workspace with PAGE-XML files
3. Click on a TextLine (green polygon)
4. Click **"Auto Transcribe"** button
5. Wait 5-30 seconds
6. Review and click **"Save"**

## Models

- **llama3.2-vision** (default, 4GB) - Good for most documents
- **llava:13b** (8GB) - Better for complex historical handwriting
- **bakllava** (5GB) - Good for modern printed documents

Pull different model:
```bash
ollama pull llava:13b
export OLLAMA_MODEL=llava:13b
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "LLM service not available" | Run `ollama serve` or check Docker logs |
| Slow transcription | Use GPU or smaller model |
| Poor quality | Try `llava:13b` model |

## Full Documentation

- [OLLAMA-SETUP.md](OLLAMA-SETUP.md) - Detailed setup guide
- [LLM-TRANSCRIPTION.md](LLM-TRANSCRIPTION.md) - Complete feature documentation
