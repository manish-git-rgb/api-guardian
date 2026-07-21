"""
Thin wrapper around the Gemini API (google-genai SDK — the current,
supported package; the old google-generativeai package is deprecated).

Uses the free-tier Flash-Lite model by default — fast and cheap, which
is appropriate since this task is short structured text generation
(explaining a diff), not complex multi-step reasoning.
"""
import os

from google import genai
from dotenv import load_dotenv

load_dotenv()

_API_KEY = os.getenv("GEMINI_API_KEY")
if not _API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY is not set. Add it to backend/.env "
        "(see .env.example)."
    )

_client = genai.Client(api_key=_API_KEY)

DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")


def generate_text(prompt: str, model_name: str = DEFAULT_MODEL) -> str:
    """
    Send a prompt to Gemini and return the plain-text response.
    Raises on API errors (rate limit, network, etc.) — callers
    (Celery tasks) are responsible for catching and handling/logging.
    """
    response = _client.models.generate_content(
        model=model_name,
        contents=prompt,
    )
    return (response.text or "").strip()