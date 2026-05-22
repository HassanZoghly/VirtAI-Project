# Auth And Session Threat Model

Scope: FastAPI HTTP auth, JWTs, refresh sessions, Google OAuth, Redis-backed auth state,
and WebSocket reconnect/resume.

## Mitigated Threats

| Threat | Current Exposure | Mitigation Implemented | Residual Risk |
| --- | --- | --- | --- |
| Refresh replay attacks | Rotated refresh tokens could be presented again after replacement. | Refresh tokens carry `family_id` and `jti`; rotated JTIs are marked consumed in Redis. Reuse revokes all known refresh families for the user, increments `refresh_token_version`, clears auth cache, blacklists the replayed JTI, and logs a warning. | Redis loss can remove consumed-JTI evidence unless persistence is enabled. Use AOF/RDB or DB-backed incident storage for high-assurance deployments. |
| Refresh race conditions | Concurrent refreshes could both attempt rotation. | Per-user/per-family Redis lock serializes refresh rotation; DB update uses expected token version. | Lock failure returns 409; clients must retry with the latest cookie. |
| WebSocket reconnect abuse | Tokens were decoded without checking current user token version. | WebSocket auth now validates JWT before accept, checks blacklist, fetches user, and rejects stale token versions before session resume. | Very high connection volume still needs edge/network rate limiting. |
| Session fixation | A user could request resume of a session owned by another user. | Session IDs are UUID-validated and resumed sessions must belong to the authenticated user. | Requires session manager data to retain correct owner metadata. |
| CSRF bypass | Cookie-backed refresh/logout endpoints are state changing. | CSRF middleware requires matching cookie/header for state-changing endpoints except login/signup. Integration tests cover refresh CSRF. | SameSite=Lax is default; cross-site embedded clients need explicit CORS/CSRF review. |
| OAuth state mismatch | Missing or reused OAuth state can bind callbacks incorrectly. | Google callback requires Redis state and deletes it after use. | Redis outage rejects OAuth callback; this is safer than accepting untracked state. |
| Redis outages | Auth caches and replay metadata may be unavailable. | Core JWT validation remains local; cache helpers log Redis errors. Refresh rotation depends on Redis to preserve replay guarantees. | Production should monitor Redis health and use persistent Redis or DB fallback for refresh-family state. |
| Token leakage in logs | Raw tokens can appear in structured logs. | Logging redacts JWT-looking values and auth logs only include user IDs/JTI prefixes. | Upstream proxies and client logs must apply equivalent redaction. |
| Cookie misconfiguration | Refresh cookies could be sent over cleartext in production. | Production settings force `secure=True`; startup rejects ambiguous production config. | Deployments behind TLS-terminating proxies must preserve HTTPS headers. |
| Unauthorized session resume | Expired/revoked users could reconnect. | WebSocket rejects expired/malformed/revoked/stale access tokens before accept. | Existing accepted sockets should be disconnected by server-side revocation broadcasts in a future pass. |
| Malformed JWT spam | Malformed tokens could reach DB or noisy traces. | Central decode maps JWT errors to auth exceptions and validates UUID before DB access. | Rate limiting remains best-effort when Redis fails open. |
| WS connection flood | Many socket attempts could exhaust workers. | Per-IP rate limit and max active WebSocket connection cap run before accept. | Add edge rate limiting and autoscaling metrics for internet-facing deployments. |
| Brute-force refresh attempts | Attackers can repeatedly call refresh. | Refresh endpoint is rate-limited and rejects malformed/revoked/replayed tokens safely. | Consider account/IP adaptive throttling and incident counters. |
| Expired session edge cases | Lazy resume could loop or crash. | Invalid session IDs are rejected; missing expired sessions fall back to new lazy-session mode without accepting ownership bypass. | Product decision: fallback is usability-oriented; stricter clients may prefer explicit 4404. |

## Operational Requirements

- Enable Redis persistence for refresh replay metadata in production.
- Ship logs as JSON with request correlation IDs.
- Alert on `refresh_family_revoked` and refresh replay events.
- Keep `ENVIRONMENT=production` and `DEBUG=false`; legacy values such as `DEBUG=release`
  intentionally fail startup.
- Run integration tests against real PostgreSQL and Redis before release.
