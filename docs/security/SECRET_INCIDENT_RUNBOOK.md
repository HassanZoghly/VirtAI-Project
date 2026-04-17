# Secret Exposure Incident Runbook

This runbook is for emergency response when credentials are exposed in code, logs, or chat transcripts.

## 1. Contain

1. Freeze deployments and disable automated release pipelines.
2. Identify exposed assets and impacted environments.
3. Open an incident ticket with timestamp, scope, and owners.

## 2. Rotate Credentials

1. Rotate API keys (for example Groq).
2. Rotate OAuth client secrets (for example Google).
3. Rotate database passwords (Mongo admin/user credentials).
4. Rotate JWT signing secret and force token invalidation policy.
5. Update runtime secrets in secret manager and CI/CD.

## 3. Verify Revocation

1. Confirm old keys cannot authenticate.
2. Confirm old OAuth secret fails token exchange.
3. Confirm old DB credentials are rejected.
4. Confirm JWTs signed with old secret are rejected.

## 4. Purge Git History

1. Ensure backup clone exists.
2. Run history rewrite for leaked files.
3. Force push rewritten branches.
4. Instruct all contributors to re-clone or hard reset to rewritten history.

Example command pattern:

```bash
git filter-repo --path backend/.env --invert-paths
```

## 5. Repository Guardrails

1. Keep `.env` ignored in git.
2. Add secret scanning in CI.
3. Add pre-commit checks for common key patterns.
4. Keep `.env.example` with placeholders only.

## 6. Post-Incident Validation

1. Run backend and frontend smoke tests.
2. Validate auth flows: login, refresh, logout, Google callback.
3. Validate monitoring alerts for auth failures and rate-limit anomalies.
4. Close incident with root cause and prevention actions.

## 7. Communication Checklist

1. Incident owner and technical owner assigned.
2. Security contact notified.
3. Team notified about required local reset steps.
4. Final incident summary documented.
