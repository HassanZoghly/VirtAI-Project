# Redis Responsibilities & Data Structures

Redis is a critical infrastructural component for the VirtAI backend. This document outlines the distinct data domains and their lifecycle within Redis.

## 1. Authentication & Session State

Redis is the **Source of Truth** for real-time authentication revocation.

- **JWT Blacklist** (`virtai:jwt:blacklist:{jti}`): String "1". Tracks access tokens that have been explicitly logged out.
- **Refresh Token Families**: Tracks the lineage of rotating refresh tokens.
  - Active JTI: `virtai:auth:refresh:active_jti:{user_id}:{family_id}`
  - Consumed JTI: `virtai:auth:refresh:consumed_jti:{jti}`
  - Family Meta: `virtai:auth:refresh:meta:{user_id}:{family_id}` (Hash: IP, UA, Last Seen)
  - Revoked Family: `virtai:auth:refresh:revoked:{user_id}:{family_id}`
- **Rate Limiting**: Sliding windows via Sorted Sets.
  - Key: `virtai:rate:{identifier}:{window}`

*Resilience:* If Redis goes down, authentication defaults to **Fail-Closed** (denying access) to maintain strict security guarantees.

## 2. Real-Time Chat & State

- **WebSocket Connection State**: Tracks which pod holds the WS connection for a user.
- **RAG & Context Caching**: High-speed caches for LLM conversation context to reduce DB round-trips.

## 3. Background Task Queue (ARQ)

Redis powers the ARQ job queue for background workers.
- Document ingestion and vector embedding.
- Stale queue recovery mechanism ensures dropped jobs are retried.
