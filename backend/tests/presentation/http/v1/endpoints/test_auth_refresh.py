from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import Response
from starlette.requests import Request

from app.presentation.http.v1.endpoints import auth as auth_endpoint


def _build_request() -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/refresh",
        "headers": [],
        "client": ("127.0.0.1", 8080),
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_refresh_reissues_refresh_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop_rate_limit(*args, **kwargs) -> None:
        return None

    async def _not_blacklisted(*args, **kwargs) -> bool:
        return False

    async def _active_user(*args, **kwargs):
        return SimpleNamespace(id="user-1", is_active=True, refresh_token_version=0)

    async def _noop_blacklist(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(auth_endpoint, "_assert_rate_limit", _noop_rate_limit)
    monkeypatch.setattr(auth_endpoint, "verify_token", lambda *args, **kwargs: ("user-1", "jti-1", 0))
    monkeypatch.setattr(auth_endpoint, "is_blacklisted", _not_blacklisted)
    monkeypatch.setattr(auth_endpoint, "get_user_by_id", _active_user)
    monkeypatch.setattr(auth_endpoint, "blacklist_token", _noop_blacklist)
    monkeypatch.setattr(auth_endpoint, "create_access_token", lambda *_args, **_kwargs: "new-access")
    monkeypatch.setattr(auth_endpoint, "create_refresh_token", lambda *_args, **_kwargs: "new-refresh")

    class FakeRedis:
        async def get(self, key):
            return b"old-refresh-token"
        async def setex(self, *args, **kwargs):
            pass
        async def delete(self, *args, **kwargs):
            pass

    monkeypatch.setattr(auth_endpoint, "get_redis", lambda: FakeRedis())

    response = Response()
    payload = await auth_endpoint.refresh(
        request=_build_request(),
        response=response,
        refresh_token="old-refresh-token",
    )

    assert payload["access_token"] == "new-access"
    cookie_header = response.headers.get("set-cookie", "")
    assert "refresh_token=new-refresh" in cookie_header
    assert f"Max-Age={auth_endpoint._refresh_cookie_max_age()}" in cookie_header


def test_refresh_cookie_policy_uses_none_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_endpoint,
        "get_settings",
        lambda: SimpleNamespace(ENVIRONMENT="production", REFRESH_TOKEN_EXPIRE_DAYS=7),
    )
    response = Response()
    auth_endpoint._set_refresh_cookie(response, "refresh-token")
    cookie_header = response.headers.get("set-cookie", "").lower()

    assert "samesite=lax" in cookie_header
    assert "secure" in cookie_header


def test_refresh_cookie_policy_uses_lax_in_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_endpoint,
        "get_settings",
        lambda: SimpleNamespace(ENVIRONMENT="development", REFRESH_TOKEN_EXPIRE_DAYS=7),
    )
    response = Response()
    auth_endpoint._set_refresh_cookie(response, "refresh-token")
    cookie_header = response.headers.get("set-cookie", "").lower()

    assert "samesite=lax" in cookie_header
