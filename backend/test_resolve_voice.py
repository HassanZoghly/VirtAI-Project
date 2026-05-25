import sys
import os

sys.path.append(os.path.abspath("backend"))

from app.infrastructure.tts.openai_tts_provider import OpenAITTSProvider

print(f"resolve_voice('guy') = {OpenAITTSProvider.resolve_voice('guy')}")
print(f"resolve_voice('aria') = {OpenAITTSProvider.resolve_voice('aria')}")
print(f"resolve_voice('nova') = {OpenAITTSProvider.resolve_voice('nova')}")
print(f"resolve_voice('') = {OpenAITTSProvider.resolve_voice('')}")
print(f"resolve_voice(None) = {OpenAITTSProvider.resolve_voice(None)}")
