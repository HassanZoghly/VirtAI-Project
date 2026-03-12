"""Tests for user domain entity — pure dataclass behavior."""

from datetime import datetime, timezone

from app.domain.user.entities import UserEntity


class TestUserEntityCreation:
    def test_required_fields(self):
        user = UserEntity(id="u1", email="a@b.com", full_name="Alice")
        assert user.id == "u1"
        assert user.email == "a@b.com"
        assert user.full_name == "Alice"

    def test_defaults(self):
        user = UserEntity(id="u1", email="a@b.com", full_name="Alice")
        assert user.hashed_password is None
        assert user.provider == "local"
        assert user.google_id is None
        assert user.setup_complete is False
        assert user.is_active is True
        assert isinstance(user.created_at, datetime)
        assert isinstance(user.updated_at, datetime)

    def test_timestamps_are_utc(self):
        user = UserEntity(id="u1", email="a@b.com", full_name="Alice")
        assert user.created_at.tzinfo == timezone.utc
        assert user.updated_at.tzinfo == timezone.utc


class TestUserEntityProviders:
    def test_local_provider(self):
        user = UserEntity(
            id="u1",
            email="a@b.com",
            full_name="Alice",
            hashed_password="$2b$12$...",
            provider="local",
        )
        assert user.provider == "local"
        assert user.hashed_password is not None
        assert user.google_id is None

    def test_google_provider(self):
        user = UserEntity(
            id="u2",
            email="bob@gmail.com",
            full_name="Bob",
            provider="google",
            google_id="google-123",
        )
        assert user.provider == "google"
        assert user.google_id == "google-123"
        assert user.hashed_password is None

    def test_oauth_user_no_password(self):
        user = UserEntity(
            id="u3",
            email="c@gmail.com",
            full_name="Charlie",
            provider="google",
            google_id="g-456",
        )
        assert user.hashed_password is None


class TestUserEntityState:
    def test_setup_complete_flag(self):
        user = UserEntity(id="u1", email="a@b.com", full_name="A", setup_complete=True)
        assert user.setup_complete is True

    def test_inactive_user(self):
        user = UserEntity(id="u1", email="a@b.com", full_name="A", is_active=False)
        assert user.is_active is False

    def test_each_instance_gets_own_timestamps(self):
        u1 = UserEntity(id="u1", email="a@b.com", full_name="A")
        u2 = UserEntity(id="u2", email="b@b.com", full_name="B")
        # They may be extremely close but are separate datetime objects
        assert u1.created_at is not u2.created_at
