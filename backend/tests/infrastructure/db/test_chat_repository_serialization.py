from datetime import datetime, timedelta, timezone

from app.infrastructure.db.chat_repository import _format_datetime, _serialise_session


def test_format_datetime_converts_non_utc_to_utc_z() -> None:
    dt = datetime(2026, 5, 1, 9, 0, 0, tzinfo=timezone(timedelta(hours=3)))

    assert _format_datetime(dt) == "2026-05-01T06:00:00Z"


def test_serialise_session_uses_utc_z_for_created_and_updated() -> None:
    doc = {
        "_id": "session-1",
        "user_id": "user-1",
        "title": "Test",
        "created_at": datetime(2026, 5, 1, 9, 0, 0),
        "updated_at": datetime(2026, 5, 1, 11, 30, 0, tzinfo=timezone(timedelta(hours=2))),
    }

    serialised = _serialise_session(doc)

    assert serialised["created_at"] == "2026-05-01T09:00:00Z"
    assert serialised["updated_at"] == "2026-05-01T09:30:00Z"

