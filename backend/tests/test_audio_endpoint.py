"""
Unit tests for audio file serving endpoint

Tests security validation and file serving functionality.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestAudioEndpoint:
    """Test suite for audio file serving endpoint"""

    def test_valid_audio_file_serving(self, tmp_path):
        """Test serving a valid audio file"""
        # Create test audio file
        storage_path = Path("backend/.data/sessions")
        session_id = "test-session-123"
        message_id = "test-message-456"

        session_dir = storage_path / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        audio_file = session_dir / f"{message_id}.mp3"
        audio_file.write_bytes(b"fake audio data")

        try:
            # Request audio file
            response = client.get(f"/api/v1/audio/{session_id}/{message_id}.mp3")

            # Verify response
            assert response.status_code == 200
            assert response.headers["content-type"] == "audio/mpeg"
            assert response.content == b"fake audio data"
        finally:
            # Cleanup
            audio_file.unlink(missing_ok=True)
            session_dir.rmdir()

    def test_file_not_found(self):
        """Test 404 when file doesn't exist"""
        response = client.get("/api/v1/audio/nonexistent-session/nonexistent-message.mp3")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_directory_traversal_prevention_dotdot(self):
        """Test prevention of directory traversal with .."""
        # Attempt directory traversal with ..
        # FastAPI URL decoding may normalize this, but our validation catches it
        response = client.get("/api/v1/audio/../../../etc/passwd/message.mp3")
        # Either caught by validation (400) or file not found (404) - both are safe
        assert response.status_code in [400, 404]

    def test_directory_traversal_prevention_absolute_path(self):
        """Test prevention of absolute path injection"""
        # Attempt absolute path
        response = client.get("/api/v1/audio//etc/passwd/message.mp3")
        # Either caught by validation (400) or file not found (404) - both are safe
        assert response.status_code in [400, 404]

    def test_invalid_session_id_with_slash(self):
        """Test rejection of session_id containing slash"""
        response = client.get("/api/v1/audio/session/with/slash/message.mp3")
        # This will be caught by FastAPI routing or our validation
        assert response.status_code in [400, 404]

    def test_invalid_message_id_with_special_chars(self):
        """Test rejection of message_id with special characters"""
        # Note: @ and # may be URL encoded by the client
        # The key is that our path resolution check prevents escaping storage dir
        response = client.get("/api/v1/audio/valid-session/message@#$.mp3")
        # Either caught by validation (400) or file not found (404) - both are safe
        assert response.status_code in [400, 404]

    def test_valid_uuid_format_session_id(self):
        """Test that valid UUID format is accepted"""
        # UUID format should be valid
        session_id = "550e8400-e29b-41d4-a716-446655440000"
        message_id = "test-message"

        response = client.get(f"/api/v1/audio/{session_id}/{message_id}.mp3")
        # Should return 404 (file not found) not 400 (invalid format)
        assert response.status_code == 404

    def test_valid_alphanumeric_with_dash_underscore(self):
        """Test that alphanumeric with dash and underscore is accepted"""
        session_id = "session-123_abc"
        message_id = "msg_456-xyz"

        response = client.get(f"/api/v1/audio/{session_id}/{message_id}.mp3")
        # Should return 404 (file not found) not 400 (invalid format)
        assert response.status_code == 404

    def test_path_resolution_security(self):
        """Test that path resolution prevents escaping storage directory"""
        # Even if validation is bypassed, path resolution should catch it
        # This is the critical security layer
        from app.api.v1.endpoints.audio import is_safe_path_component

        # Test various malicious inputs
        assert not is_safe_path_component("../etc")
        assert not is_safe_path_component("..\\windows")
        assert not is_safe_path_component("/etc/passwd")
        assert not is_safe_path_component("session/nested")
        assert not is_safe_path_component("")

        # Test valid inputs
        assert is_safe_path_component("valid-session-123")
        assert is_safe_path_component("msg_456-xyz")
        assert is_safe_path_component("550e8400-e29b-41d4-a716-446655440000")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
