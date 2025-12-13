# LLM Transcription Testing Checklist

Pre-flight checklist before testing the automatic transcription feature.

## ✅ Code Review Status

**All critical issues fixed:**
- ✅ Added `requests` to requirements.txt
- ✅ Added `from __future__ import annotations` to api/llm.py
- ✅ Python syntax verified (no compilation errors)
- ✅ JavaScript syntax verified (no syntax errors)
- ✅ Blueprint registration verified
- ✅ API endpoint paths match frontend calls

## Prerequisites

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

**Expected packages:**
- flask
- gunicorn
- lxml
- ocrd
- Pillow
- **requests** ← New dependency for Ollama

### 2. Verify Ollama is Running

**Quick test:**
```bash
python scripts/test_ollama.py
```

**Expected output:**
```
✓ Ollama is running!
Installed models (1):
  - llama3.2-vision (4.xx GB)
✓ PageXML Viewer can connect to Ollama!
```

**If not running:**
- Windows: Check system tray for Ollama icon
- Linux/Mac: Run `ollama serve` in a terminal

### 3. Pull Model (if needed)

```bash
python scripts/start_ollama.py
```

**Expected output:**
```
✓ Ollama service is running
Available models:
  - llama3.2-vision
✓ Setup complete!
```

## Testing Steps

### Test 1: Backend API

**Check if LLM service is accessible:**

```bash
curl http://localhost:5000/api/llm/status
```

**Expected response:**
```json
{
  "available": true,
  "models": ["llama3.2-vision"],
  "base_url": "http://localhost:11434",
  "current_model": "llama3.2-vision"
}
```

### Test 2: Start Application

```bash
python app.py
```

**Check console output:**
```
* Running on http://127.0.0.1:5000
```

**Verify no import errors:**
- No `ModuleNotFoundError: No module named 'requests'`
- No `NameError: name 'OllamaClient' is not defined`

### Test 3: Load Workspace

1. Open browser: `http://localhost:5000`
2. Go to "Workspaces" tab
3. Load an existing workspace OR upload new PAGE-XML files
4. Navigate to "Viewer" tab

**Expected:** Image and text lines should display

### Test 4: Manual Transcription (Baseline)

1. Click on a TextLine (green polygon)
2. Popup appears with textarea
3. Type some text manually
4. Click "Save"

**Expected:** Text saves successfully (no errors)

### Test 5: Auto Transcription

1. Click on a TextLine (green polygon)
2. Click **"Auto Transcribe"** button
3. Wait 10-30 seconds

**Expected behavior:**
- Button shows loading state (spinning)
- Status message: "Calling LLM..."
- After completion: "AI transcribed the text successfully."
- Textarea fills with transcribed text

**Watch for errors:**
- ❌ "LLM service not available" → Ollama not running
- ❌ "Failed to extract line image" → Image path issue
- ❌ "LLM transcription failed" → Model or Ollama error

### Test 6: Correction Mode

1. Click a line that already has text
2. Click **"Auto Transcribe"**
3. Wait for completion

**Expected:**
- Status: "AI corrected the text successfully."
- Text is refined/corrected (may be similar to original)

## Troubleshooting Test Failures

### "Module 'requests' not found"

```bash
pip install requests
# Or reinstall all:
pip install -r requirements.txt
```

### "NameError: name 'OllamaClient' is not defined"

Check that `api/llm.py` has this as the FIRST import:
```python
from __future__ import annotations
```

### "LLM service not available"

```bash
# Test Ollama directly
curl http://localhost:11434/api/tags

# If fails, start Ollama
# Windows: Launch from Start menu
# Linux/Mac: ollama serve
```

### "Failed to extract line image"

**Common causes:**
- Image file not found in workspace
- PAGE-XML has incorrect image path
- Line has no coordinates

**Debug:**
1. Check browser console (F12) for errors
2. Check Flask logs in terminal
3. Verify image exists in workspace/images/

### Button click does nothing

**Check browser console (F12):**
- Look for JavaScript errors
- Check if button ID matches: `linePopoverAutoTranscribe`
- Verify jQuery is loaded

### Transcription is empty

**Possible causes:**
- Model not pulled: `ollama pull llama3.2-vision`
- Wrong model specified in environment
- Line image is blank or too small

**Test model directly:**
```bash
ollama run llama3.2-vision "What do you see?" < image.png
```

## Performance Benchmarks

**Expected timings:**

| Operation | Expected Time | Notes |
|-----------|--------------|-------|
| Button click → API call | < 100ms | Instant |
| Image extraction | < 500ms | Very fast |
| LLM processing (CPU) | 10-30s | Depends on CPU |
| LLM processing (GPU) | 3-10s | Much faster |
| Total (click → result) | 10-30s | First try may be slower |

**If slower than 60 seconds:**
- Check CPU/GPU usage
- Try smaller model: `llama3.2` instead of `llama3.2-vision`
- Close other applications

## Success Criteria

✅ **All tests pass if:**
1. No Python import errors on startup
2. `/api/llm/status` returns `"available": true`
3. Button appears in line popup
4. Button click triggers loading state
5. Transcription completes without errors
6. Text appears in textarea
7. Save button persists transcription to PAGE-XML

## Next Steps After Testing

Once all tests pass:
- Try different models for quality comparison
- Test on various document types
- Adjust language setting if needed
- Configure custom prompts (advanced)

## Reporting Issues

If you find bugs, please report:
1. Error message (exact text)
2. Browser console output (F12)
3. Flask terminal output
4. Steps to reproduce
5. Operating system
6. Python version: `python --version`
7. Ollama version (if accessible)
