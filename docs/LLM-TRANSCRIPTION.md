# LLM-Powered Automatic Transcription

The PageXML Viewer now supports AI-powered automatic transcription using local LLMs via Ollama.

## Features

- **Automatic Transcription**: Generate transcriptions from text line images using vision-capable LLMs
- **Correction Mode**: If a transcription already exists, the LLM will correct it instead
- **Privacy-First**: Runs completely locally using Ollama - no data sent to external APIs
- **Language Support**: Configurable language hints (currently defaults to German)
- **Vision Models**: Uses models with vision capabilities to analyze text line images

## Architecture

### Backend Components

1. **`core/ollama_client.py`**
   - Low-level client for Ollama API
   - Handles HTTP communication with Ollama server
   - Provides methods: `generate()`, `transcribe_line()`, `is_available()`, `list_models()`

2. **`api/llm.py`**
   - Flask blueprint exposing LLM endpoints
   - Routes:
     - `GET /api/llm/status` - Check if Ollama is running
     - `POST /api/llm/transcribe` - Transcribe/correct a text line
   - Handles image extraction and cropping for individual lines

3. **`app.py`**
   - Registers the LLM blueprint under `/api` prefix

### Frontend Components

1. **`templates/index.html`**
   - "Auto Transcribe" button in line popover
   - Uses Font Awesome "magic" icon

2. **`static/js/main.js`**
   - Event handler for auto-transcribe button
   - AJAX call to `/api/llm/transcribe`
   - Loading states and error handling

## Setup Instructions

**📚 For detailed setup options, see [OLLAMA-SETUP.md](OLLAMA-SETUP.md)**

### Quick Start (Development)

```bash
# 1. Install Ollama from ollama.ai/download
# 2. Run the setup script
python scripts/start_ollama.py

# 3. Start the viewer
python app.py
```

### Docker Setup (Production)

```bash
# All-in-one: Viewer + Ollama
docker compose -f docker-compose.with-ollama.yml up --build
```

See [OLLAMA-SETUP.md](OLLAMA-SETUP.md) for:
- Standalone Docker Ollama
- GPU configuration
- Different deployment options

## Usage

### Transcribing a Line

1. Open a workspace with PAGE-XML files
2. Navigate to the Viewer tab
3. Click on a TextLine (green polygon)
4. In the popup, click **"Auto Transcribe"**
5. Wait for the LLM to process (usually 5-30 seconds)
6. Review the transcription
7. Click **"Save"** to persist it to PAGE-XML

### Correcting Existing Transcription

1. Open a line that already has text
2. Click **"Auto Transcribe"**
3. The LLM will analyze the image and correct any errors
4. Save the corrected text

## Recommended Models

### For Historical Documents (German)

- **llama3.2-vision** (default, ~4GB)
  - Good balance of speed and accuracy
  - Supports multiple languages including German

- **llava:13b** (~8GB)
  - Higher accuracy for complex documents
  - Slower but better at historical handwriting

### For Modern Documents

- **llama3.2-vision** - Works well for printed text
- **bakllava** - Optimized for document understanding

### Pulling Models

```bash
ollama pull llama3.2-vision
ollama pull llava:13b
ollama pull bakllava
```

## API Reference

### GET /api/llm/status

Check LLM service availability.

**Response:**
```json
{
  "available": true,
  "models": ["llama3.2-vision", "llava:13b"],
  "base_url": "http://localhost:11434",
  "current_model": "llama3.2-vision"
}
```

### POST /api/llm/transcribe

Transcribe or correct a text line.

**Request:**
```json
{
  "workspace_id": "uuid",
  "path": "page001.xml",
  "line_id": "line_123",
  "existing_text": "optional existing transcription",
  "language": "German"
}
```

**Response:**
```json
{
  "ok": true,
  "transcription": "Corrected or transcribed text",
  "mode": "transcribe" | "correct"
}
```

## Troubleshooting

### "LLM service not available"

**Solution:**
1. Check if Ollama is running: `curl http://localhost:11434/api/tags`
2. Start Ollama: `ollama serve`
3. Verify model is installed: `ollama list`

### Transcription is slow

**Solutions:**
- Use a smaller model (e.g., `llama3.2-vision` instead of `llava:13b`)
- If you have a GPU, ensure Ollama is using it
- Close other applications to free up memory

### Transcription quality is poor

**Solutions:**
1. Try a larger model: `ollama pull llava:13b`
2. Set the model in environment: `export OLLAMA_MODEL=llava:13b`
3. Ensure the line image is clear (zoom in to check quality)
4. Use correction mode on existing rough transcriptions

### Model download fails

**Solution:**
```bash
# Check your internet connection
# Try pulling with verbose output
ollama pull llama3.2-vision --verbose

# Or download a smaller model first
ollama pull llama3.2
```

## Configuration Options

### Environment Variables

- `OLLAMA_BASE_URL` - Ollama server URL (default: `http://localhost:11434`)
- `OLLAMA_MODEL` - Model to use (default: `llama3.2-vision`)

### Code Configuration

Edit `api/llm.py` to customize:

```python
# Change default language
language = payload.get("language", "English")  # Line 77

# Adjust image padding
padding_y = (max_y - min_y) * 0.3  # More padding (Line 163)

# Change temperature (creativity)
temperature=0.0  # Even more deterministic (Line 141)
```

## Performance Tips

1. **GPU Acceleration**: Ollama automatically uses GPU if available
2. **Model Selection**: Balance size vs accuracy for your use case
3. **Batch Processing**: Process multiple lines by calling API in parallel
4. **Caching**: Ollama caches model in memory after first use

## Security & Privacy

- ✅ **Fully Local**: No data sent to external servers
- ✅ **Private**: Your historical documents stay on your machine
- ✅ **Open Source**: Ollama and models are open source
- ✅ **Offline**: Works without internet (after model download)

## Future Enhancements

Planned improvements:
- [ ] Configurable language selection in UI
- [ ] Batch transcription for all lines
- [ ] Custom prompt templates
- [ ] Support for table transcription
- [ ] Integration with other LLM backends (LocalAI, llama.cpp)
