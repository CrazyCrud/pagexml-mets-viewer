# Ollama Setup Guide

This guide covers different ways to set up Ollama for AI-powered transcription.

## Choose Your Setup Method

| Method | Best For | Complexity | GPU Support |
|--------|----------|------------|-------------|
| **1. Manual Install** | Development, local testing | ⭐ Easy | ✅ Yes |
| **2. Docker Compose (All-in-One)** | Production, reproducibility | ⭐⭐ Medium | ✅ Yes (with config) |
| **3. Standalone Docker** | Viewer runs outside Docker | ⭐ Easy | ✅ Yes (with config) |

---

## Method 1: Manual Installation (Recommended for Development)

### Step 1: Install Ollama

**Windows:**
1. Download installer from [ollama.ai/download](https://ollama.ai/download)
2. Run `OllamaSetup.exe`
3. Ollama starts automatically as a Windows service
4. Look for Ollama icon in system tray (bottom-right)

**Note:** The Windows installer runs Ollama as a background service, so you don't need to manually start it.

**Linux:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

**macOS:**
```bash
brew install ollama
```

### Step 2: Test & Pull Model

**Quick test:**
```bash
# Check if Ollama is running
python scripts/test_ollama.py
```

**Full setup:**
```bash
# Automatically pull model and verify setup
python scripts/start_ollama.py
```

This will:
- ✅ Find Ollama installation (even if not in PATH)
- ✅ Verify Ollama service is running
- ✅ Pull the `llama3.2-vision` model (~4GB)
- ✅ Test the setup

**Manual alternative (if script fails):**

```bash
# On Windows: Open Command Prompt or PowerShell
# Pull model (Ollama CLI may not be in PATH on Windows)
# Instead, use the Ollama desktop app:
# 1. Right-click Ollama icon in system tray
# 2. Use the built-in model manager

# Or via PowerShell (if ollama is in PATH):
ollama pull llama3.2-vision
ollama list
```

### Step 3: Start PageXML Viewer

```bash
python app.py
```

✅ **Done!** The viewer will connect to Ollama at `http://localhost:11434`

---

## Method 2: Docker Compose (All-in-One)

Run both the viewer **and** Ollama in containers.

### Step 1: Start Everything

```bash
docker compose -f docker-compose.with-ollama.yml up --build
```

This starts:
- 📦 PageXML Viewer on `http://localhost:8000`
- 🤖 Ollama on `http://localhost:11434`
- ⬇️ Auto-pulls `llama3.2-vision` model

### Step 2: Wait for Model Download

First run takes ~5-10 minutes to download the model. Watch logs:

```bash
docker compose -f docker-compose.with-ollama.yml logs -f ollama-pull
```

Look for: `"Model pulled successfully!"`

### Step 3: Access Viewer

Open `http://localhost:8000`

✅ **Done!** Everything is containerized and connected.

### GPU Support (NVIDIA)

Uncomment these lines in `docker-compose.with-ollama.yml`:

```yaml
# Uncomment for GPU support (NVIDIA)
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

**Requirements:**
- NVIDIA GPU
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

---

## Method 3: Standalone Ollama Docker

Run Ollama in Docker, viewer runs natively (Python).

### Step 1: Start Ollama Container

```bash
docker compose -f docker/ollama-standalone.yml up -d
```

### Step 2: Pull Model

```bash
docker exec -it pagexml-ollama ollama pull llama3.2-vision
```

### Step 3: Configure Viewer

```bash
# Point viewer to Docker Ollama
export OLLAMA_BASE_URL=http://localhost:11434

# Start viewer
python app.py
```

✅ **Done!** Viewer connects to Dockerized Ollama.

---

## Verifying Setup

Check if Ollama is working:

```bash
# Check API
curl http://localhost:11434/api/tags

# Test generation
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2-vision",
  "prompt": "Hello",
  "stream": false
}'
```

Or use the viewer's status endpoint:

```bash
curl http://localhost:8000/api/llm/status
```

Expected response:
```json
{
  "available": true,
  "models": ["llama3.2-vision"],
  "base_url": "http://localhost:11434",
  "current_model": "llama3.2-vision"
}
```

---

## Model Selection

### Recommended Models

| Model | Size | Speed | Accuracy | Best For |
|-------|------|-------|----------|----------|
| `llama3.2-vision` | 4GB | ⚡⚡⚡ Fast | ⭐⭐⭐ Good | General transcription |
| `llava:13b` | 8GB | ⚡⚡ Medium | ⭐⭐⭐⭐ Better | Historical documents |
| `bakllava` | 5GB | ⚡⚡⚡ Fast | ⭐⭐⭐ Good | Modern documents |

### Pull a Different Model

**Manual:**
```bash
ollama pull llava:13b
```

**Docker:**
```bash
docker exec -it pagexml-ollama ollama pull llava:13b
```

**Configure in Viewer:**
```bash
export OLLAMA_MODEL=llava:13b
python app.py
```

Or in `docker-compose.with-ollama.yml`:
```yaml
environment:
  OLLAMA_MODEL: "llava:13b"
```

---

## Performance Tuning

### CPU Performance

Ollama uses all CPU cores by default. To limit:

```bash
# Limit to 4 threads
export OLLAMA_NUM_THREADS=4
ollama serve
```

### GPU Performance (NVIDIA)

Ollama automatically detects and uses NVIDIA GPUs.

Verify GPU usage:
```bash
nvidia-smi
```

Should show `ollama` process using GPU.

### Memory Management

Models are loaded into RAM/VRAM. To manage:

```bash
# Unload models after 10 minutes of inactivity
export OLLAMA_KEEP_ALIVE=10m
ollama serve
```

---

## Troubleshooting

### "Ollama not available"

**Check if running:**
```bash
curl http://localhost:11434/api/tags
```

**Restart Ollama:**

Manual:
```bash
pkill ollama
ollama serve
```

Docker:
```bash
docker compose -f docker-compose.with-ollama.yml restart ollama
```

### "Model not found"

**List installed models:**
```bash
ollama list
```

**Pull missing model:**
```bash
ollama pull llama3.2-vision
```

### Slow transcription

1. **Use GPU** if available (see GPU support above)
2. **Use smaller model**: `llama3.2-vision` instead of `llava:13b`
3. **Close other apps** to free RAM
4. **Check system resources**: `htop` or Task Manager

### "Out of memory"

**Reduce model size:**
```bash
# Switch to smaller model
ollama pull llama3.2  # 2GB instead of 4GB
export OLLAMA_MODEL=llama3.2
```

**Or increase Docker memory:**

In Docker Desktop: Settings → Resources → Memory → Increase to 8GB+

---

## Production Deployment

For production, use **Method 2** (Docker Compose) with:

1. **GPU support enabled** (faster)
2. **Volume persistence** (models survive restarts)
3. **Health checks** (auto-restart on failure)
4. **Resource limits**:

```yaml
ollama:
  deploy:
    resources:
      limits:
        cpus: '4'
        memory: 8G
```

---

## Updating Ollama

### Manual Installation

**Windows/macOS:**
Download latest installer from ollama.ai

**Linux:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Docker

```bash
docker compose -f docker-compose.with-ollama.yml pull
docker compose -f docker-compose.with-ollama.yml up -d
```

---

## Uninstalling

### Remove Models

```bash
# List models
ollama list

# Remove a model
ollama rm llama3.2-vision
```

### Remove Ollama

**Manual:**
- Windows: Uninstall via Control Panel
- macOS: `brew uninstall ollama`
- Linux: `sudo systemctl stop ollama && sudo rm $(which ollama)`

**Docker:**
```bash
docker compose -f docker-compose.with-ollama.yml down -v
```

The `-v` flag removes the volume with downloaded models.

---

## Next Steps

Once Ollama is running:
- See [LLM-TRANSCRIPTION.md](LLM-TRANSCRIPTION.md) for usage guide
- Try transcribing your first text line!
- Experiment with different models for best results
