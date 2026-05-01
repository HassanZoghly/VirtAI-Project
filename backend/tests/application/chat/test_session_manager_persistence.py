from __future__ import annotations

import pytest

from app.application.chat.session_manager import SessionManager


@pytest.mark.asyncio
async def test_create_session_reuses_persisted_session_without_creating_new_doc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created_calls = 0

    async def _get_chat_session(_session_id: str):
        return {"id": "session-1", "user_id": "user-1", "title": "Persisted"}

    async def _create_chat_session(**kwargs):
        nonlocal created_calls
        created_calls += 1
        return {"id": kwargs.get("session_id")}

    monkeypatch.setattr("app.application.chat.session_manager.get_chat_session", _get_chat_session)
    monkeypatch.setattr("app.application.chat.session_manager.create_chat_session", _create_chat_session)

    manager = SessionManager()
    session = await manager.create_session(user_id="user-1", session_id="session-1")

    assert session.session_id == "session-1"
    assert created_calls == 0


@pytest.mark.asyncio
async def test_create_session_rejects_attaching_to_other_users_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _get_chat_session(_session_id: str):
        return {"id": "session-1", "user_id": "other-user", "title": "Persisted"}

    monkeypatch.setattr("app.application.chat.session_manager.get_chat_session", _get_chat_session)

    manager = SessionManager()

    with pytest.raises(PermissionError):
        await manager.create_session(user_id="user-1", session_id="session-1")

