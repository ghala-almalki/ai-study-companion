"""
This file is responsible for one thing only: sending a prompt directly to
Google's Gemini API and returning the model's text answer.
"""

from google import genai
from google.genai import types

# Max time to wait for a reply the Google library  expects MILLISECONDS not seconds.
REQUEST_TIMEOUT_MS = 60_000


class GeminiLLM:

    def __init__(self, api_key: str, model: str):
        self.model = model
        self.client = None

        # We do not crash here if the key is missing this will start and 
        # the clear error is raised later when someone asks a question.
        if api_key:
            self.client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
            )

    def generate_answer(self, prompt: str) -> str:
        """Send a prompt to Gemini and return its text answer."""
        if self.client is None:
            raise ValueError("GEMINI_API_KEY is missing. Add it to your .env file.")

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
            )
        except Exception as e:
            # We raise a generic message on purpose: the original error may
            # contain private details that should not reach the end user.
            raise RuntimeError(
                "Gemini request failed. Check your API key, model name and quota."
            ) from e

        # response.text can be empty if the answer was blocked by safety filters
        if not response.text:
            raise ValueError("Gemini returned an empty answer.")

        return response.text