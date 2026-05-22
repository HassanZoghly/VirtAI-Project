"""
Prometheus metrics registry for tracking business and infrastructure health.
"""

from prometheus_client import Counter, Histogram

# Auth & Session Metrics
auth_login_attempts = Counter(
    "virtai_auth_login_attempts_total",
    "Total login attempts",
    ["status", "provider"]
)

auth_login_failures = Counter(
    "virtai_auth_login_failures_total",
    "Total login failures",
    ["reason"]
)

auth_refresh_rotations = Counter(
    "virtai_auth_refresh_rotations_total",
    "Total refresh token rotations",
    ["status"]
)

auth_token_revocations = Counter(
    "virtai_auth_token_revocations_total",
    "Total tokens blacklisted or revoked",
    ["reason"]
)

# Rate Limiting
rate_limit_hits = Counter(
    "virtai_rate_limit_hits_total",
    "Total rate limit breaches",
    ["scope"]
)

# WebSocket connection health
ws_connections_active = Counter(
    "virtai_ws_connections_active_total",
    "Active websocket connections (approx)",
)

ws_connection_drops = Counter(
    "virtai_ws_connection_drops_total",
    "Total abnormal WS disconnects",
    ["reason"]
)

# Latency & Database
db_query_duration = Histogram(
    "virtai_db_query_duration_seconds",
    "Database query latency",
    ["operation"]
)

redis_operation_duration = Histogram(
    "virtai_redis_operation_duration_seconds",
    "Redis operation latency",
    ["operation"]
)
