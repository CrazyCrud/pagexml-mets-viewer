"""
Ollama LLM Client

Handles communication with a local Ollama instance for OCR transcription
and correction tasks.
"""

import requests
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class OllamaClient:
    """Client for interacting with Ollama API."""

    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3.2-vision"):
        """
        Initialize Ollama client.

        Args:
            base_url: Base URL of Ollama API (default: http://localhost:11434)
            model: Model name to use (default: llama3.2-vision for OCR tasks)
        """
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = 120  # seconds

    def is_available(self) -> bool:
        """
        Check if Ollama is running and accessible.

        Returns:
            True if Ollama is available, False otherwise
        """
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=5)
            return response.status_code == 200
        except Exception as e:
            logger.debug(f"Ollama not available: {e}")
            return False

    def list_models(self) -> list[str]:
        """
        List available models in Ollama.

        Returns:
            List of model names
        """
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=5)
            response.raise_for_status()
            data = response.json()
            return [m.get("name", "") for m in data.get("models", [])]
        except Exception as e:
            logger.error(f"Failed to list models: {e}")
            return []

    def generate(self, prompt: str, system_prompt: Optional[str] = None,
                 image_base64: Optional[str] = None, **kwargs) -> Optional[str]:
        """
        Generate text using Ollama.

        Args:
            prompt: User prompt
            system_prompt: Optional system prompt
            image_base64: Optional base64-encoded image for vision models
            **kwargs: Additional parameters (temperature, top_p, etc.)

        Returns:
            Generated text or None if failed
        """
        payload: Dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False
        }

        if system_prompt:
            payload["system"] = system_prompt

        if image_base64:
            payload["images"] = [image_base64]

        # Add optional parameters
        options = {}
        if "temperature" in kwargs:
            options["temperature"] = kwargs["temperature"]
        if "top_p" in kwargs:
            options["top_p"] = kwargs["top_p"]
        if options:
            payload["options"] = options

        try:
            response = requests.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=self.timeout
            )
            response.raise_for_status()
            result = response.json()
            return result.get("response", "").strip()
        except requests.exceptions.Timeout:
            logger.error("Ollama request timed out")
            return None
        except Exception as e:
            logger.error(f"Ollama generation failed: {e}")
            return None

    def transcribe_line(self, image_base64: str, existing_text: Optional[str] = None,
                       language: str = "German") -> Optional[str]:
        """
        Transcribe or correct a text line from an image.

        Args:
            image_base64: Base64-encoded image of the text line
            existing_text: Optional existing transcription to correct
            language: Language of the text (default: German)

        Returns:
            Transcribed/corrected text or None if failed
        """
        if existing_text:
            # Correction mode
            prompt = f"""You are an expert historical document transcription corrector.

The current transcription is:
"{existing_text}"

Please review the image and correct any transcription errors.
Output ONLY the corrected text, nothing else. Keep the original text if it's already correct.
The text is in {language}."""
        else:
            # Transcription mode
            prompt = f"""You are an expert historical document transcription specialist.

Please transcribe the text shown in this image exactly as it appears.
Output ONLY the transcribed text, nothing else. No explanations or commentary.
The text is in {language}."""

        return self.generate(
            prompt=prompt,
            image_base64=image_base64,
            temperature=0.1  # Low temperature for accuracy
        )
