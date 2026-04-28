from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.presentation.http.v1 import router as v1_router


class _FakeWebSocket:
    def __init__(self) -> None:
        self.client = SimpleNamespace(host="127.0.0.1")
        self.accepted = False
        self.closed = False

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int | None = None, reason: str | None = None) -> None:
        self.closed = True


class _FakeSessionManager:
    def __init__(self) -> None:
        self.create_session_calls = 0
        self.disconnect_calls: list[str] = []

    async def connect_existing_session(self, session_id: str):
        return None

    async def create_session(self, **kwargs):
        self.create_session_calls += 1
        return SimpleNamespace(session_id="created-session", avatar_id="avatar1")

    def disconnect_session(self, session_id: str) -> None:
        self.disconnect_calls.append(session_id)


class _FakeConnectionManager:
    def __init__(self) -> None:
        self.unregister_calls: list[str] = []

    async def unregister(self, session_id: str, websocket) -> None:
        self.unregister_calls.append(session_id)


@pytest.mark.asyncio
async def test_ws_does_not_create_session_on_connect_when_not_resuming(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_ws = _FakeWebSocket()
    fake_sm = _FakeSessionManager()
    fake_cm = _FakeConnectionManager()
    created_handler = {}

    async def _allow_rate_limit(**kwargs) -> bool:
        return True

    def _mock_verify_token(token: str, expected_type: str = "access"):
        return ("mock-user", "mock-jti")

    class FakeHandler:
        def __init__(self, **kwargs):
            created_handler["session"] = kwargs["session"]
            self.session = kwargs["session"] or SimpleNamespace(session_id="")

        async def run(self):
            return None

    monkeypatch.setattr(v1_router, "check_rate_limit", _allow_rate_limit)
    monkeypatch.setattr(v1_router, "verify_token", _mock_verify_token)
    monkeypatch.setattr(v1_router, "WebSocketHandler", FakeHandler)

    await v1_router.websocket_endpoint(
        websocket=fake_ws,
        avatar_id="avatar1",
        token="valid.mock.token",
        voice="en-US-AriaNeural",
        session_id=None,
        resume=False,
        last_seq=0,
        session_manager=fake_sm,
        connection_manager=fake_cm,  # type: ignore
    )

    assert fake_ws.accepted is True
    assert created_handler["session"] is None
    assert fake_sm.create_session_calls == 0
    assert fake_cm.unregister_calls == []
    assert fake_sm.disconnect_calls == []


@pytest.mark.asyncio
async def test_ws_resume_uses_existing_session(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_ws = _FakeWebSocket()
    fake_sm = _FakeSessionManager()
    fake_cm = _FakeConnectionManager()
    resumed_session = SimpleNamespace(session_id="resume-123", avatar_id="avatar1", user_id="mock-user")
    created_handler = {}

    async def _allow_rate_limit(**kwargs) -> bool:
        return True

    def _mock_verify_token(token: str, expected_type: str = "access"):
        return ("mock-user", "mock-jti")

    monkeypatch.setattr(v1_router, "verify_token", _mock_verify_token)

    async def _connect_existing(session_id: str):
        return resumed_session if session_id == "resume-123" else None

    class FakeHandler:
        def __init__(self, **kwargs):
            created_handler["session"] = kwargs["session"]
            self.session = kwargs["session"] or SimpleNamespace(session_id="")

        async def run(self):
            return None

    monkeypatch.setattr(v1_router, "check_rate_limit", _allow_rate_limit)
    monkeypatch.setattr(v1_router, "WebSocketHandler", FakeHandler)
    monkeypatch.setattr(fake_sm, "connect_existing_session", _connect_existing)

    await v1_router.websocket_endpoint(
        websocket=fake_ws,
        avatar_id="avatar1",
        token="valid.mock.token",
        voice="en-US-AriaNeural",
        session_id="resume-123",
        resume=True,
        last_seq=2,
        session_manager=fake_sm,
        connection_manager=fake_cm,  # type: ignore
    )

    assert fake_ws.accepted is True
    assert created_handler["session"] is resumed_session
    assert fake_sm.create_session_calls == 0
    assert fake_cm.unregister_calls == ["resume-123"]
    assert fake_sm.disconnect_calls == ["resume-123"]
