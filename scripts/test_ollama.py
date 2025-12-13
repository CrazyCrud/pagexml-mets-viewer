#!/usr/bin/env python3
"""
Quick Ollama Connection Test

Simple script to test if Ollama is accessible.
"""

import requests
import sys

OLLAMA_URL = "http://localhost:11434"

print("Testing Ollama connection...")
print(f"URL: {OLLAMA_URL}")
print("-" * 40)

try:
    # Test basic connectivity
    response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)

    if response.status_code == 200:
        data = response.json()
        models = data.get("models", [])

        print("✓ Ollama is running!")
        print(f"\nInstalled models ({len(models)}):")

        if models:
            for model in models:
                name = model.get("name", "unknown")
                size = model.get("size", 0)
                size_gb = size / (1024**3)
                print(f"  - {name} ({size_gb:.2f} GB)")
        else:
            print("  (no models installed)")
            print("\nTo pull a model, run:")
            print("  python scripts/start_ollama.py --pull-model llama3.2-vision")

        print("\n✓ PageXML Viewer can connect to Ollama!")
        sys.exit(0)
    else:
        print(f"✗ Unexpected response: HTTP {response.status_code}")
        sys.exit(1)

except requests.exceptions.ConnectionError:
    print("✗ Cannot connect to Ollama")
    print("\nPossible solutions:")
    print("  1. Start Ollama:")
    print("     - Windows: Search 'Ollama' in Start menu")
    print("     - Linux/Mac: Run 'ollama serve' in terminal")
    print("  2. Check if port 11434 is blocked by firewall")
    print("  3. Verify Ollama is installed from ollama.ai/download")
    sys.exit(1)

except Exception as e:
    print(f"✗ Error: {e}")
    sys.exit(1)
