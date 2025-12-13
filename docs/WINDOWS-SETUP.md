# Windows Setup Guide

Quick guide for setting up AI transcription on Windows.

## Step 1: Install Ollama

1. Download: [ollama.ai/download/windows](https://ollama.ai/download/windows)
2. Run `OllamaSetup.exe`
3. Ollama will install and start automatically as a Windows service
4. Look for the Ollama icon in your system tray (📦 icon)

**Important:** The Windows version runs as a background service. You don't need to open a terminal or run any commands manually!

## Step 2: Verify Installation

Open PowerShell or Command Prompt and run:

```powershell
python scripts\test_ollama.py
```

You should see:
```
✓ Ollama is running!
```

## Step 3: Pull AI Model

Run the setup script:

```powershell
python scripts\start_ollama.py
```

This will:
- Find your Ollama installation automatically
- Pull the `llama3.2-vision` model (~4GB download)
- Verify everything works

**Expected output:**
```
✓ Ollama service is running (Windows service detected)
Pulling model 'llama3.2-vision'...
✓ Model 'llama3.2-vision' pulled successfully
✓ Setup complete!
```

## Step 4: Start PageXML Viewer

```powershell
python app.py
```

Open browser: `http://localhost:5000`

## Troubleshooting

### "Ollama is not accessible"

**Check if Ollama is running:**
1. Look for Ollama icon in system tray (bottom-right corner)
2. If not there, search "Ollama" in Start menu and launch it
3. Right-click the tray icon → Check if models are listed

**Or test via PowerShell:**
```powershell
curl http://localhost:11434/api/tags
```

Should return JSON with installed models.

### "Cannot find Ollama executable"

**This is OK on Windows!** The installer doesn't always add Ollama to PATH.

The script will still work by:
- Detecting the service is running
- Pulling models via API instead of CLI

Just make sure you see the Ollama tray icon.

### Model download is slow

Large models (4-8GB) take time to download:
- **llama3.2-vision**: ~4GB (15-30 min on average connection)
- **llava:13b**: ~8GB (30-60 min)

The download happens only once. After that, the model is cached.

### Port 11434 already in use

Another application might be using port 11434.

**Check what's using it:**
```powershell
netstat -ano | findstr :11434
```

**Kill the process** (if not Ollama):
```powershell
taskkill /PID <PID> /F
```

Then restart Ollama from Start menu.

### Want to use GPU?

Ollama automatically uses your NVIDIA GPU if:
- ✅ You have an NVIDIA GPU
- ✅ NVIDIA drivers are installed
- ✅ GPU has at least 4GB VRAM

No additional setup needed! Check GPU usage in Task Manager → Performance → GPU.

## Managing Models

### Via System Tray (Easiest)

1. Right-click Ollama tray icon
2. Select "Models"
3. Pull/delete models from the GUI

### Via PowerShell

```powershell
# List installed models
# Note: If ollama is not in PATH, this won't work
# Use the system tray method instead
ollama list

# Pull a different model
ollama pull llava:13b

# Remove a model
ollama rm llama3.2-vision
```

### Via Python Script

```powershell
# Pull a specific model
python scripts\start_ollama.py --pull-model llava:13b
```

## Uninstalling

1. Close PageXML Viewer
2. Right-click Ollama tray icon → Exit
3. Settings → Apps → Ollama → Uninstall
4. Models are stored in: `%USERPROFILE%\.ollama`
   - Delete this folder to free disk space

## Next Steps

Once Ollama is running:
1. Open PageXML Viewer: `http://localhost:5000`
2. Load a workspace with PAGE-XML
3. Click a text line (green polygon)
4. Click **"Auto Transcribe"** button
5. Wait 10-30 seconds for AI transcription
6. Save the result!

## Quick Reference

| Task | Command |
|------|---------|
| Test connection | `python scripts\test_ollama.py` |
| Full setup | `python scripts\start_ollama.py` |
| Start viewer | `python app.py` |
| Check if running | Look for Ollama tray icon 📦 |
| Model manager | Right-click tray icon → Models |

## Common Windows-Specific Issues

### PowerShell Execution Policy

If you get "script execution is disabled":

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Python not found

Make sure Python is installed and in PATH:

```powershell
python --version
```

Should show `Python 3.x.x`. If not, install from [python.org](https://python.org).

### Firewall blocking

Windows Firewall might block Ollama:
1. Windows Security → Firewall
2. Allow app through firewall
3. Find "Ollama" and check both Private and Public

## Performance Tips (Windows)

1. **Use GPU**: Ollama auto-detects NVIDIA GPUs
2. **Free RAM**: Close Chrome/browsers before transcribing (models need 4-8GB)
3. **SSD**: Install models on SSD for faster loading
4. **Power mode**: Set Windows to "High Performance" mode

## See Also

- [OLLAMA-SETUP.md](OLLAMA-SETUP.md) - Cross-platform guide
- [LLM-TRANSCRIPTION.md](LLM-TRANSCRIPTION.md) - Feature documentation
- [Ollama Windows FAQ](https://github.com/ollama/ollama/blob/main/docs/windows.md)
