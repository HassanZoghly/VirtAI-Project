"""
Viseme Timeline Generator

This module generates phoneme-to-viseme timelines for lip synchronization using Rhubarb Lip Sync.
It provides robust fallback behavior when Rhubarb is unavailable.

Key Features:
- Deterministic server-side generation using Rhubarb Lip Sync
- Robust availability check (Windows path + subprocess errors)
- Graceful fallback: returns empty mouthCues with warning if Rhubarb missing
- Applies RHUBARB_TO_RPM mapping from viseme_map.py
- Stores visemes at backend/.data/sessions/{session_id}/{message_id}.json
"""

import asyncio
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from loguru import logger

from app.schemas.ws_messages import MouthCue
from app.services.tts.viseme_map import rhubarb_to_rpm_viseme


class VisemeGenerator:
    """
    Generates viseme timeline from audio using Rhubarb Lip Sync.

    Provides robust fallback behavior when Rhubarb is unavailable:
    - Returns empty mouthCues list
    - Logs warning (no crash)
    - Audio playback still works (tts.ready sent)
    """

    def __init__(self, rhubarb_path: Optional[str] = None):
        """
        Initialize viseme generator.

        Args:
            rhubarb_path: Optional path to Rhubarb executable.
                         If None, will search in common locations.
        """
        self.rhubarb_path = rhubarb_path
        self._rhubarb_available: Optional[bool] = None

    def _find_rhubarb_executable(self) -> Optional[str]:
        """
        Find Rhubarb executable in common locations.

        Searches:
        1. Provided rhubarb_path
        2. System PATH
        3. Common installation directories (Windows, Linux, macOS)

        Returns:
            Path to Rhubarb executable if found, None otherwise
        """
        # Check provided path first
        if self.rhubarb_path:
            if os.path.isfile(self.rhubarb_path):
                return self.rhubarb_path
            logger.warning(f"Provided Rhubarb path not found: {self.rhubarb_path}")

        # Check system PATH
        rhubarb_cmd = "rhubarb.exe" if platform.system() == "Windows" else "rhubarb"
        path_executable = shutil.which(rhubarb_cmd)
        if path_executable:
            return path_executable

        # Check common installation directories
        system = platform.system()
        common_paths = []

        if system == "Windows":
            common_paths = [
                r"C:\Program Files\Rhubarb Lip Sync\rhubarb.exe",
                r"C:\Program Files (x86)\Rhubarb Lip Sync\rhubarb.exe",
                Path.home() / "rhubarb" / "rhubarb.exe",
                Path("backend") / "bin" / "rhubarb.exe",
            ]
        elif system == "Linux":
            common_paths = [
                "/usr/local/bin/rhubarb",
                "/usr/bin/rhubarb",
                Path.home() / "rhubarb" / "rhubarb",
                Path("backend") / "bin" / "rhubarb",
            ]
        elif system == "Darwin":  # macOS
            common_paths = [
                "/usr/local/bin/rhubarb",
                "/opt/homebrew/bin/rhubarb",
                Path.home() / "rhubarb" / "rhubarb",
                Path("backend") / "bin" / "rhubarb",
            ]

        for path in common_paths:
            path_str = str(path)
            if os.path.isfile(path_str):
                return path_str

        return None

    def _check_rhubarb_availability(self) -> bool:
        """
        Check if Rhubarb is available and executable.

        Performs robust availability check:
        - Finds executable path
        - Tests execution with --version
        - Handles subprocess errors gracefully

        Returns:
            True if Rhubarb is available and working, False otherwise
        """
        if self._rhubarb_available is not None:
            return self._rhubarb_available

        executable = self._find_rhubarb_executable()
        if not executable:
            logger.warning(
                "Rhubarb Lip Sync not found. "
                "Viseme generation will return empty mouthCues. "
                "Install from: https://github.com/DanielSWolf/rhubarb-lip-sync"
            )
            self._rhubarb_available = False
            return False

        # Test execution
        try:
            result = subprocess.run(
                [executable, "--version"], capture_output=True, text=True, timeout=5, check=False
            )

            if result.returncode == 0:
                version = result.stdout.strip()
                logger.info(f"Rhubarb Lip Sync found: {executable} ({version})")
                self.rhubarb_path = executable
                self._rhubarb_available = True
                return True
            else:
                logger.warning(
                    f"Rhubarb executable found but failed to run: {executable}\n"
                    f"Error: {result.stderr}"
                )
                self._rhubarb_available = False
                return False

        except subprocess.TimeoutExpired:
            logger.warning(f"Rhubarb version check timed out: {executable}")
            self._rhubarb_available = False
            return False
        except subprocess.SubprocessError as e:
            logger.warning(f"Rhubarb subprocess error: {e}")
            self._rhubarb_available = False
            return False
        except Exception as e:
            logger.warning(f"Unexpected error checking Rhubarb: {e}")
            self._rhubarb_available = False
            return False

    async def _run_rhubarb(
        self, audio_path: str, text: str, output_path: str
    ) -> Optional[dict[str, Any]]:
        """
        Run Rhubarb Lip Sync on audio file.

        Args:
            audio_path: Path to audio file (MP3)
            text: Spoken text (helps Rhubarb with recognition)
            output_path: Path to save JSON output

        Returns:
            Parsed JSON output from Rhubarb, or None if failed
        """
        if not self._check_rhubarb_availability():
            return None

        try:
            # Run Rhubarb asynchronously
            process = await asyncio.create_subprocess_exec(
                self.rhubarb_path,
                "-f",
                "json",  # JSON output format
                "-o",
                output_path,  # Output file
                "--dialogFile",
                "-",  # Read dialog from stdin
                audio_path,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Send text to stdin
            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=text.encode("utf-8")), timeout=30.0  # 30 second timeout
            )

            if process.returncode != 0:
                logger.error(
                    f"Rhubarb failed with code {process.returncode}\n"
                    f"stderr: {stderr.decode('utf-8', errors='ignore')}"
                )
                return None

            # Read output file
            with open(output_path, encoding="utf-8") as f:
                result = json.load(f)

            logger.success(
                f"Rhubarb generated visemes | "
                f"cues={len(result.get('mouthCues', []))} | "
                f"audio={audio_path}"
            )
            return result

        except asyncio.TimeoutError:
            logger.error(f"Rhubarb timed out processing: {audio_path}")
            return None
        except subprocess.SubprocessError as e:
            logger.error(f"Rhubarb subprocess error: {e}")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Rhubarb JSON output: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error running Rhubarb: {e}")
            return None

    def _parse_rhubarb_output(self, rhubarb_data: dict[str, Any]) -> list[MouthCue]:
        """
        Parse Rhubarb JSON output to MouthCue objects.

        Rhubarb output format:
        {
            "metadata": {...},
            "mouthCues": [
                {"start": 0.0, "end": 0.1, "value": "X"},
                {"start": 0.1, "end": 0.3, "value": "A"},
                ...
            ]
        }

        Args:
            rhubarb_data: Parsed JSON from Rhubarb

        Returns:
            List of MouthCue objects with RPM viseme names
        """
        mouth_cues = []

        raw_cues = rhubarb_data.get("mouthCues", [])
        if not raw_cues:
            logger.warning("Rhubarb output contains no mouthCues")
            return mouth_cues

        for cue_data in raw_cues:
            try:
                start = float(cue_data["start"])
                end = float(cue_data["end"])
                rhubarb_letter = cue_data["value"]

                # Map Rhubarb letter to RPM viseme name
                rpm_viseme = rhubarb_to_rpm_viseme(rhubarb_letter)

                mouth_cues.append(MouthCue(start=start, end=end, value=rpm_viseme))

            except (KeyError, ValueError, TypeError) as e:
                logger.warning(f"Failed to parse mouth cue: {cue_data} | {e}")
                continue

        # Ensure cues are sorted by start time
        mouth_cues.sort(key=lambda cue: cue.start)

        return mouth_cues

    def _validate_path_component(self, component: str) -> bool:
        """
        Validate path component for security (prevent directory traversal).

        Args:
            component: Path component to validate

        Returns:
            True if safe, False otherwise
        """
        if not component:
            return False
        # Check for path traversal attempts
        if ".." in component or "/" in component or "\\" in component:
            return False
        # Check for valid characters (alphanumeric, dash, underscore)
        import re

        if not re.match(r"^[a-zA-Z0-9_-]+$", component):
            return False
        return True

    async def generate_from_audio(
        self, audio_path: str, text: str, session_id: str, message_id: str
    ) -> list[MouthCue]:
        """
        Generate viseme timeline from audio file.

        This is the main entry point for viseme generation.

        Behavior:
        - If Rhubarb available: Generate visemes using Rhubarb Lip Sync
        - If Rhubarb missing: Return empty mouthCues list with warning log
        - Audio playback still works in both cases (tts.ready sent)

        Args:
            audio_path: Path to audio file (MP3)
            text: Spoken text
            session_id: Session identifier
            message_id: Message identifier

        Returns:
            List of MouthCue objects sorted by start time
            Returns empty list if Rhubarb unavailable (with warning log)
        """
        # Validate session_id and message_id
        if not self._validate_path_component(session_id):
            logger.error(f"Invalid session_id: {session_id}")
            return []
        if not self._validate_path_component(message_id):
            logger.error(f"Invalid message_id: {message_id}")
            return []

        # Check Rhubarb availability
        if not self._check_rhubarb_availability():
            logger.warning(
                f"Viseme generation skipped (Rhubarb unavailable) | "
                f"session={session_id} | message={message_id}"
            )
            return []

        # Verify audio file exists
        if not os.path.isfile(audio_path):
            logger.error(f"Audio file not found: {audio_path}")
            return []

        # Create output directory
        storage_base = Path("backend/.data/sessions")
        session_dir = storage_base / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        # Output path for viseme JSON
        viseme_json_path = session_dir / f"{message_id}.json"

        # Run Rhubarb
        logger.info(
            f"Generating visemes | "
            f"session={session_id} | message={message_id} | "
            f"audio={audio_path}"
        )

        rhubarb_output = await self._run_rhubarb(
            audio_path=audio_path, text=text, output_path=str(viseme_json_path)
        )

        if not rhubarb_output:
            logger.warning(
                f"Rhubarb failed to generate visemes | "
                f"session={session_id} | message={message_id}"
            )
            return []

        # Parse Rhubarb output to MouthCue objects
        mouth_cues = self._parse_rhubarb_output(rhubarb_output)

        logger.success(
            f"Visemes generated | "
            f"session={session_id} | message={message_id} | "
            f"cues={len(mouth_cues)} | "
            f"stored={viseme_json_path}"
        )

        return mouth_cues
