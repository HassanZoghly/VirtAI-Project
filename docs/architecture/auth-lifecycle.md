# Authentication Lifecycle Architecture

This document describes the lifecycle of authentication in the VirtAI backend.

## 1. Login & Token Issuance

When a user logs in (or signs up, or authenticates via Google OAuth), the system issues a **Token Family**:
- **Access Token (JWT)**: Short-lived (30 minutes). Contains user identity and roles. Passed via `Authorization: Bearer <token>` or `ws.subprotocol`.
- **Refresh Token (JWT)**: Long-lived (7 days). Stored in a secure `HttpOnly` cookie.
- **Family ID**: A unique UUID grouping these tokens. Used to track token lineage and enable global revocation.

## 2. Refresh Token Rotation

To maintain security, the backend uses **Refresh Token Rotation**:
1. The client sends their current refresh token to the `/auth/refresh` endpoint.
2. The server verifies the token and checks if its JTI (JWT ID) has been consumed.
3. If consumed: A **Token Reuse Incident** is detected. The entire token family is revoked to protect against stolen tokens.
4. If valid: The token is marked as consumed, and a *new* Access/Refresh token pair is issued.

### Compensating Transactions
The rotation requires atomic updates across Postgres (token version) and Redis (consumed list). If the DB transaction commits but the Redis update fails, a compensating transaction automatically rolls back the DB version to prevent split-brain states where a user cannot refresh.

## 3. Session Revocation (Logout / Blacklist)

When a user logs out or changes their password:
- The current **Access Token JTI** is placed on the Redis blacklist for the remainder of its TTL.
- The **Refresh Token Family** is revoked in Redis.
- The user's **Refresh Token Version** in Postgres is incremented (revoking all pre-existing tokens).

Any subsequent request presenting a blacklisted access token or attempting to use a revoked refresh family will be denied with a `401 Unauthorized`.
