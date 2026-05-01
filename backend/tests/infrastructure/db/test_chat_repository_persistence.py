from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.infrastructure.db import chat_repository


class _FakeMessagesCollection:
    def __init__(self) -> None:
        self.inserted_docs: list[dict] = []

    async def insert_one(self, doc: dict):
        self.inserted_docs.append(doc)
        return SimpleNamespace(inserted_id="msg-1")


class _FakeSessionsCollection:
    def __init__(self) -> None:
        self.updates: list[tuple[dict, dict]] = []

    async def update_one(self, query: dict, update: dict):
        self.updates.append((query, update))
        return SimpleNamespace(modified_count=1)


@pytest.mark.asyncio
async def test_save_message_updates_new_chat_title_for_first_user_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_messages = _FakeMessagesCollection()
    fake_sessions = _FakeSessionsCollection()

    monkeypatch.setattr(chat_repository, "messages_col", lambda: fake_messages)
    monkeypatch.setattr(chat_repository, "chat_sessions_col", lambda: fake_sessions)

    await chat_repository.save_message(
        session_id="session-1",
        role="user",
        content="This is the very first user message in this chat session",
    )

    assert len(fake_sessions.updates) == 2

    title_query, title_update = fake_sessions.updates[0]
    assert title_query == {"_id": "session-1", "title": "New Chat"}
    assert title_update == {"$set": {"title": "This is the very first user me"}}

    counter_query, counter_update = fake_sessions.updates[1]
    assert counter_query == {"_id": "session-1"}
    assert counter_update["$inc"] == {"message_count": 1}
    assert "updated_at" in counter_update["$set"]


@pytest.mark.asyncio
async def test_save_message_for_assistant_does_not_update_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_messages = _FakeMessagesCollection()
    fake_sessions = _FakeSessionsCollection()

    monkeypatch.setattr(chat_repository, "messages_col", lambda: fake_messages)
    monkeypatch.setattr(chat_repository, "chat_sessions_col", lambda: fake_sessions)

    await chat_repository.save_message(
        session_id="session-1",
        role="assistant",
        content="Assistant response",
    )

    assert len(fake_sessions.updates) == 1
    assert fake_sessions.updates[0][0] == {"_id": "session-1"}
    assert fake_sessions.updates[0][1]["$inc"] == {"message_count": 1}

