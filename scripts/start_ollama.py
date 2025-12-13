#!/usr/bin/env python3
"""
Ollama Startup Helper

This script helps you start and configure Ollama for use with the PageXML Viewer.
It can:
- Check if Ollama is installed
- Start Ollama server
- Pull required models
- Verify the setup

Usage:
    python scripts/start_ollama.py [--pull-model MODEL_NAME]

Examples:
    python scripts/start_ollama.py
    python scripts/start_ollama.py --pull-model llama3.2-vision
"""

import subprocess
import sys
import time
import requests
import argparse
from pathlib import Path


DEFAULT_MODEL = "llama3.2-vision"
OLLAMA_BASE_URL = "http://localhost:11434"

# Global variable to store Ollama executable path
OLLAMA_CMD = "ollama"


def find_ollama_executable():
    """Find Ollama executable, checking common Windows installation paths."""
    import platform

    # Try PATH first
    try:
        result = subprocess.run(
            ["ollama", "--version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            return "ollama"
    except (FileNotFoundError, Exception):
        pass

    # Windows-specific paths
    if platform.system() == "Windows":
        possible_paths = [
            Path.home() / "AppData" / "Local" / "Programs" / "Ollama" / "ollama.exe",
            Path.home() / "AppData" / "Local" / "Ollama" / "ollama.exe",
            Path("C:\\Program Files\\Ollama\\ollama.exe"),
            Path("C:\\Program Files (x86)\\Ollama\\ollama.exe"),
        ]

        for path in possible_paths:
            if path.exists():
                try:
                    result = subprocess.run(
                        [str(path), "--version"],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    if result.returncode == 0:
                        return str(path)
                except Exception:
                    continue

    return None


def check_ollama_installed():
    """Check if Ollama is installed and available in PATH."""
    global OLLAMA_CMD

    OLLAMA_CMD = find_ollama_executable()

    if OLLAMA_CMD:
        try:
            result = subprocess.run(
                [OLLAMA_CMD, "--version"],
                capture_output=True,
                text=True,
                timeout=5
            )
            print(f"✓ Ollama is installed: {result.stdout.strip()}")
            print(f"  Location: {OLLAMA_CMD}")
            return True
        except Exception as e:
            print(f"✗ Error checking Ollama: {e}")
            return False
    else:
        print("✗ Ollama is not installed or not found")
        print("\nPlease install Ollama from: https://ollama.ai/download")
        print("\nIf already installed, Ollama may be running as a Windows service.")
        print("Try checking if it's accessible at: http://localhost:11434")
        return False


def is_ollama_running():
    """Check if Ollama server is running."""
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
        return response.status_code == 200
    except Exception:
        return False


def start_ollama_server():
    """Start Ollama server in the background."""
    print("\nStarting Ollama server...")
    print("Note: On Windows, Ollama usually runs as a service and starts automatically.")
    print("Checking if server is already running...")

    try:
        # Start Ollama serve in background
        subprocess.Popen(
            [OLLAMA_CMD, "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        # Wait for server to be ready
        for i in range(10):
            time.sleep(1)
            if is_ollama_running():
                print("✓ Ollama server started successfully")
                return True
            print(f"  Waiting for server... ({i+1}/10)")

        print("✗ Ollama server failed to start")
        return False
    except Exception as e:
        print(f"✗ Failed to start Ollama: {e}")
        print("\nOn Windows, Ollama runs as a background service.")
        print("Try restarting the Ollama application from your Start menu.")
        return False


def list_models():
    """List available models in Ollama."""
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
        response.raise_for_status()
        data = response.json()
        models = [m.get("name", "") for m in data.get("models", [])]
        return models
    except Exception as e:
        print(f"✗ Failed to list models: {e}")
        return []


def pull_model(model_name):
    """Pull a model from Ollama registry."""
    print(f"\nPulling model '{model_name}'...")
    print("This may take several minutes depending on model size...")

    # Try CLI first if available
    if OLLAMA_CMD and OLLAMA_CMD != "ollama":
        try:
            result = subprocess.run(
                [OLLAMA_CMD, "pull", model_name],
                capture_output=False,  # Show progress
                text=True
            )

            if result.returncode == 0:
                print(f"✓ Model '{model_name}' pulled successfully")
                return True
        except Exception as e:
            print(f"⚠ CLI pull failed: {e}")
            print("Trying API method...")

    # Fallback to API method (works even without CLI access)
    try:
        import json
        print("Pulling via API (this may take a while, please wait)...")

        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/pull",
            json={"name": model_name},
            stream=True,
            timeout=3600  # 1 hour for large models
        )

        if response.status_code == 200:
            # Stream the response to show progress
            for line in response.iter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        if "status" in data:
                            print(f"  {data['status']}", end="\r")
                    except json.JSONDecodeError:
                        pass

            print(f"\n✓ Model '{model_name}' pulled successfully")
            return True
        else:
            print(f"✗ Failed to pull model: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Error pulling model: {e}")
        return False


def verify_setup(model_name):
    """Verify that the setup is working."""
    print(f"\nVerifying setup with model '{model_name}'...")

    try:
        # Simple test request
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": model_name,
                "prompt": "Test",
                "stream": False
            },
            timeout=30
        )

        if response.status_code == 200:
            print(f"✓ Model '{model_name}' is working correctly")
            return True
        else:
            print(f"✗ Model test failed: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Verification failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Start and configure Ollama for PageXML Viewer"
    )
    parser.add_argument(
        "--pull-model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"Model to pull (default: {DEFAULT_MODEL})"
    )
    parser.add_argument(
        "--skip-pull",
        action="store_true",
        help="Skip pulling the model (use if already downloaded)"
    )

    args = parser.parse_args()

    print("=" * 60)
    print("Ollama Setup for PageXML Viewer")
    print("=" * 60)

    # Step 1: Check if Ollama is installed (or running)
    ollama_found = check_ollama_installed()

    # Step 2: Check if server is running (most important for Windows)
    if is_ollama_running():
        print("✓ Ollama server is already running")
    elif ollama_found:
        # Try to start it
        if not start_ollama_server():
            print("\n⚠ Could not start Ollama server automatically.")
            print("Please start it manually:")
            print("  - Windows: Search for 'Ollama' in Start menu and launch it")
            print("  - Linux/Mac: Run 'ollama serve' in a terminal")
            sys.exit(1)
    else:
        # Ollama not found but might be running as service on Windows
        print("\n⚠ Ollama executable not found, but checking if service is running...")
        if not is_ollama_running():
            print("\n✗ Ollama is not accessible.")
            print("\nPlease ensure Ollama is installed and running.")
            print("Download from: https://ollama.ai/download")
            sys.exit(1)
        else:
            print("✓ Ollama service is running (Windows service detected)")
            # Continue even if we can't find the executable

    # Step 3: List available models
    print("\nAvailable models:")
    models = list_models()
    if models:
        for model in models:
            print(f"  - {model}")
    else:
        print("  (no models installed yet)")

    # Step 4: Pull model if requested
    if not args.skip_pull:
        if args.pull_model in models:
            print(f"\n✓ Model '{args.pull_model}' is already installed")
        else:
            if not pull_model(args.pull_model):
                print("\n⚠ Failed to pull model. You can try manually:")
                print(f"   ollama pull {args.pull_model}")
                sys.exit(1)

    # Step 5: Verify setup
    if verify_setup(args.pull_model):
        print("\n" + "=" * 60)
        print("✓ Setup complete! Ollama is ready to use.")
        print("=" * 60)
        print(f"\nYou can now use the 'Auto Transcribe' button in the PageXML Viewer.")
        print(f"\nConfiguration:")
        print(f"  - Base URL: {OLLAMA_BASE_URL}")
        print(f"  - Model: {args.pull_model}")
        print("\nTo use a different model, set environment variable:")
        print(f"  export OLLAMA_MODEL={args.pull_model}")
    else:
        print("\n⚠ Setup verification failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
