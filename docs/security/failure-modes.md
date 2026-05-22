# Security Failure Modes & Resilience Strategies

This document describes how the VirtAI backend handles infrastructure failures from a security perspective.

## 1. Core Philosophy: Fail-Closed Authentication

In distributed systems, availability often competes with consistency. For the Auth Layer, VirtAI chooses **Consistency and Security over Availability**. 

If the system cannot verify the revocation status of a session, it must assume the session is revoked.

### Scenario: Redis Outage
- **Blacklist Checks**: When validating an Access Token, the system queries Redis (`virtai:jwt:blacklist`). If Redis is unreachable, `is_blacklisted` returns `True`. This blocks all authenticated endpoints until Redis recovers.
- **Refresh Checks**: When attempting to refresh a token, the system queries the `consumed` and `revoked` lists in Redis. If unreachable, the refresh request is denied.
- **Why?**: A stolen token that was recently revoked must not be allowed to operate just because the cache is down.

## 2. Rate Limiting: Fail-Open

While Auth is Fail-Closed, Rate Limiting is **Fail-Open**.
- If Redis is down, the rate limiter allows the request.
- **Why?**: Rate limiting is primarily an availability protection mechanism against DDoS. Failing closed would cause a total system outage for all users, doing the attacker's job for them. By failing open, the system degrades gracefully and relies on backend scaling limits to survive.

## 3. Distributed State Consistency

### The DB-Redis Split Brain
During Refresh Token Rotation, the system must update Postgres (increment token version) and Redis (mark old token as consumed). If the database commits but the Redis update fails, the system enters a split-brain state.

**Mitigation (Compensating Transaction)**:
The backend wraps the rotation logic in a compensating block. If the Redis update throws an exception after the DB commits, the DB transaction is explicitly rolled back to its previous token version, ensuring the user can simply retry the refresh request.
