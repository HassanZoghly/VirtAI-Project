"""
Example usage of VisemeGenerator with EdgeTTSProvider
This demonstrates the complete flow: TTS generation → Viseme timeline generation
"""

import asyncio
import json
from pathlib import Path

from app.infrastructure.tts.edge_tts_provider import EdgeTTSProvider
from app.infrastructure.tts.viseme_generator import VisemeGenerator


async def example_complete_flow():
    """
    Example of complete TTS + Viseme generation flow
    This is how it would be used in the conversation pipeline
    """

    print("=" * 80)
    print("AI Avatar Chat - TTS + Viseme Generation Example")
    print("=" * 80)
    print()

    # Initialize services
    tts_provider = EdgeTTSProvider()
    viseme_generator = VisemeGenerator()

    # Simulate a conversation
    session_id = "session-demo-001"
    message_id = "msg-hello-001"
    text = "Hello! I'm your AI assistant. How can I help you today?"

    print("📝 Input:")
    print(f"   Session: {session_id}")
    print(f"   Message: {message_id}")
    print(f"   Text: {text}")
    print()

    # Step 1: Generate TTS audio
    print("🎤 Step 1: Generating TTS audio...")
    tts_result = await tts_provider.generate(text, session_id, message_id)

    print("✅ Audio generated:")
    print(f"   File: {tts_result.file_path}")
    print(
        f"   Duration: {tts_result.audio_duration_ms:.0f}ms ({tts_result.audio_duration_ms/1000:.1f}s)"
    )
    print(f"   Size: {len(tts_result.audio_bytes):,} bytes")
    print(f"   Edge TTS Visemes: {len(tts_result.visemes)}")
    print()

    # Step 2: Generate Rhubarb viseme timeline
    print("👄 Step 2: Generating Rhubarb viseme timeline...")
    mouth_cues = await viseme_generator.generate_from_audio(
        audio_path=tts_result.file_path, text=text, session_id=session_id, message_id=message_id
    )

    if mouth_cues:
        print("✅ Visemes generated:")
        print(f"   Mouth cues: {len(mouth_cues)}")
        print(f"   Timeline: {mouth_cues[0].start:.2f}s - {mouth_cues[-1].end:.2f}s")
        print()

        # Show first few cues
        print("   First 5 cues:")
        for i, cue in enumerate(mouth_cues[:5]):
            print(f"      {i+1}. {cue.start:.3f}s - {cue.end:.3f}s: {cue.value}")
        print()

        # Verify viseme JSON file was created
        viseme_json_path = Path(f"backend/.data/sessions/{session_id}/{message_id}.json")
        if viseme_json_path.exists():
            print(f"✅ Viseme JSON stored at: {viseme_json_path}")
            with open(viseme_json_path) as f:
                viseme_data = json.load(f)
                print(f"   JSON contains {len(viseme_data.get('mouthCues', []))} cues")
        print()
    else:
        print("⚠️  Rhubarb unavailable - returning empty mouthCues")
        print("   Audio playback will still work, but no lip sync")
        print()

    # Step 3: Prepare response for client
    print("📡 Step 3: Preparing WebSocket messages for client...")
    print()

    # Message 1: tts.ready
    audio_url = f"/api/v1/audio/{session_id}/{message_id}.mp3"
    tts_ready_message = {
        "type": "tts.ready",
        "data": {
            "session_id": session_id,
            "message_id": message_id,
            "audio": {
                "url": audio_url,
                "mime": "audio/mpeg",
                "duration_ms": int(tts_result.audio_duration_ms),
            },
        },
    }

    print("   Message 1: tts.ready")
    print(f"   {json.dumps(tts_ready_message, indent=6)}")
    print()

    # Message 2: visemes.ready
    visemes_ready_message = {
        "type": "visemes.ready",
        "data": {
            "session_id": session_id,
            "message_id": message_id,
            "format": "mouthCues",
            "mouthCues": [
                {"start": cue.start, "end": cue.end, "value": cue.value}
                for cue in mouth_cues[:3]  # Show first 3 for brevity
            ]
            + ([{"...": f"{len(mouth_cues) - 3} more cues"}] if len(mouth_cues) > 3 else []),
        },
    }

    print("   Message 2: visemes.ready")
    print(f"   {json.dumps(visemes_ready_message, indent=6)}")
    print()

    # Step 4: Client behavior
    print("🎬 Step 4: Client behavior:")
    print("   1. Receives tts.ready → Fetches audio from URL")
    print("   2. Receives visemes.ready → Prepares lip sync timeline")
    print("   3. Plays audio + animates avatar mouth using mouthCues")
    print("   4. Avatar lip sync matches audio perfectly!")
    print()

    # Clean up
    print("🧹 Cleaning up test files...")
    import shutil

    session_dir = Path(f"backend/.data/sessions/{session_id}")
    if session_dir.exists():
        shutil.rmtree(session_dir)
        print(f"   Removed: {session_dir}")

    print()
    print("=" * 80)
    print("✅ Example complete!")
    print("=" * 80)


async def example_fallback_behavior():
    """
    Example showing fallback behavior when Rhubarb is unavailable
    """

    print()
    print("=" * 80)
    print("Fallback Behavior Example (Rhubarb Unavailable)")
    print("=" * 80)
    print()

    # Initialize services
    tts_provider = EdgeTTSProvider()
    # Force Rhubarb unavailable by providing invalid path
    viseme_generator = VisemeGenerator(rhubarb_path="/nonexistent/rhubarb")

    session_id = "session-fallback-001"
    message_id = "msg-fallback-001"
    text = "This demonstrates fallback behavior."

    print(f"📝 Input: {text}")
    print()

    # Generate TTS audio
    print("🎤 Generating TTS audio...")
    tts_result = await tts_provider.generate(text, session_id, message_id)
    print(f"✅ Audio generated: {tts_result.file_path}")
    print()

    # Try to generate visemes (will fail gracefully)
    print("👄 Attempting viseme generation...")
    mouth_cues = await viseme_generator.generate_from_audio(
        audio_path=tts_result.file_path, text=text, session_id=session_id, message_id=message_id
    )

    print(f"⚠️  Rhubarb unavailable - returned empty mouthCues: {mouth_cues}")
    print()

    # Client still receives messages
    print("📡 Client receives:")
    print("   1. tts.ready with audio URL ✅")
    print("   2. visemes.ready with empty mouthCues [] ✅")
    print("   3. Audio plays normally (no lip sync) ✅")
    print()

    print("✅ Graceful fallback - no crash, audio still works!")
    print()

    # Clean up
    import shutil

    session_dir = Path(f"backend/.data/sessions/{session_id}")
    if session_dir.exists():
        shutil.rmtree(session_dir)

    print("=" * 80)


if __name__ == "__main__":
    # Run complete flow example
    asyncio.run(example_complete_flow())

    # Run fallback behavior example
    asyncio.run(example_fallback_behavior())
