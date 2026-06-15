async (page) => {
  const baseUrl = 'http://127.0.0.1:3000';
  const classroomUrl = `${baseUrl}/classroom`;
  const defaultRefreshCycles = 50;
  const defaultRetryCycles = 50;
  const defaultOutcomeTimeoutMs = 30000;

  const results = {
    refresh: [],
    retry: [],
    failuresByReason: {},
    rescueAttempts: 0,
    screenshots: 0,
  };

  function recordFailure(reason) {
    const key = reason || 'UNKNOWN';
    results.failuresByReason[key] = (results.failuresByReason[key] || 0) + 1;
  }

  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    const json = (body, headers = {}) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(body),
      });

    if (url.includes('/auth/csrf')) {
      await json({}, { 'Set-Cookie': 'csrf_token=avatar-debug; Path=/; SameSite=Lax' });
      return;
    }

    if (url.includes('/auth/refresh')) {
      await json({ access_token: 'avatar-debug-token' });
      return;
    }

    if (url.includes('/auth/me')) {
      await json({
        id: 'avatar-debug-user',
        email: 'avatar-debug@example.test',
        full_name: 'Avatar Debug',
        setupComplete: true,
        setup_complete: true,
      });
      return;
    }

    if (url.match(/\/api\/v1\/chat\/?$/) || url.includes('/api/v1/chat/')) {
      await json([]);
      return;
    }

    await json({});
  });

  page.on('pageerror', (error) => {
    console.log('[AvatarVisibilityHarnessPageError]', error.message);
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const cycleConfig = await page.evaluate(
    ({ defaultRefreshCycles, defaultRetryCycles, defaultOutcomeTimeoutMs }) => {
      const readPositiveNumber = (key, fallback) => {
        const value = Number(window.localStorage.getItem(key));
        return Number.isFinite(value) && value > 0 ? value : fallback;
      };

      return {
        refreshCycles: readPositiveNumber('avatar-debug-refresh-cycles', defaultRefreshCycles),
        retryCycles: readPositiveNumber('avatar-debug-retry-cycles', defaultRetryCycles),
        outcomeTimeoutMs: readPositiveNumber(
          'avatar-debug-outcome-timeout-ms',
          defaultOutcomeTimeoutMs
        ),
      };
    },
    { defaultRefreshCycles, defaultRetryCycles, defaultOutcomeTimeoutMs }
  );
  const { refreshCycles, retryCycles, outcomeTimeoutMs } = cycleConfig;

  await page.evaluate(() => {
    window.DEBUG_AVATAR = true;
    window.localStorage.setItem('virtai-auth-session', '1');
    window.localStorage.setItem(
      'virtai-setup',
      JSON.stringify({
        avatarId: 'omar',
        voiceId: 'guy',
        movementEnabled: false,
        savedAt: Date.now(),
      })
    );
  });

  async function waitForOutcome(kind, iteration, previousVisibilityCount = 0) {
    await page.waitForFunction(
      ({ previousVisibilityCount: count }) => {
        const debug = window.__VIRTAI_AVATAR_DEBUG__;
        const visibilityCount = debug?.visibilityTelemetry?.length || 0;
        const loaded = !!document.querySelector('.avatar-panel.loaded');
        const failed = !!document.querySelector('.avatar-error-container');
        return (loaded || failed) && visibilityCount > count;
      },
      { previousVisibilityCount },
      { timeout: outcomeTimeoutMs }
    );

    const outcome = await page.evaluate(() => {
      const debug = window.__VIRTAI_AVATAR_DEBUG__ || {};
      const visibilityTelemetry = debug.visibilityTelemetry || [];
      const lifecycleTelemetry = debug.lifecycleTelemetry || [];
      const latestVisibility = visibilityTelemetry[visibilityTelemetry.length - 1] || null;
      const latestLifecycle = lifecycleTelemetry[lifecycleTelemetry.length - 1] || null;
      const loaded = !!document.querySelector('.avatar-panel.loaded');
      const failed = !!document.querySelector('.avatar-error-container');
      const failureScreenshots = debug.failureScreenshots || [];

      return {
        loaded,
        failed,
        latestVisibility,
        latestLifecycle,
        visibilityCount: visibilityTelemetry.length,
        lifecycleCount: lifecycleTelemetry.length,
        screenshots: failureScreenshots.length,
        rescueAttempted: visibilityTelemetry.some((record) => record.rescueAttempted),
      };
    });

    const summary = {
      kind,
      iteration,
      loaded: outcome.loaded,
      failed: outcome.failed,
      failureReason: outcome.failed
        ? outcome.latestVisibility?.failureReason || 'UNKNOWN'
        : null,
      rescueAttempted: outcome.rescueAttempted,
      latestVisibility: outcome.latestVisibility,
      latestLifecycle: outcome.latestLifecycle,
      visibilityCount: outcome.visibilityCount,
      lifecycleCount: outcome.lifecycleCount,
      screenshots: outcome.screenshots,
    };

    if (summary.rescueAttempted) {
      results.rescueAttempts += 1;
    }
    if (summary.failed) {
      recordFailure(summary.failureReason);
    }
    results.screenshots += summary.screenshots;

    results[kind].push(summary);
    console.log('[AvatarVisibilityHarnessCycle]', JSON.stringify(summary));
    return summary;
  }

  for (let i = 1; i <= refreshCycles; i += 1) {
    if (i === 1) {
      await page.goto(classroomUrl, { waitUntil: 'domcontentloaded' });
    } else {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }

    await waitForOutcome('refresh', i, 0);
  }

  for (let i = 1; i <= retryCycles; i += 1) {
    const beforeVisibilityCount = await page.evaluate(
      () => window.__VIRTAI_AVATAR_DEBUG__?.visibilityTelemetry?.length || 0
    );
    await page.evaluate(() => {
      const retry = window.__VIRTAI_AVATAR_DEBUG__?.retry;
      if (typeof retry !== 'function') {
        throw new Error('Avatar debug retry hook is not installed.');
      }
      retry();
    });

    await waitForOutcome('retry', i, beforeVisibilityCount);
  }

  const refreshFailures = results.refresh.filter((item) => item.failed).length;
  const retryFailures = results.retry.filter((item) => item.failed).length;
  const summary = {
    refreshCycles,
    retryCycles,
    refreshFailures,
    retryFailures,
    refreshSuccesses: refreshCycles - refreshFailures,
    retrySuccesses: retryCycles - retryFailures,
    failuresByReason: results.failuresByReason,
    rescueAttempts: results.rescueAttempts,
    screenshots: results.screenshots,
  };

  console.log('[AvatarVisibilityHarnessSummary]', JSON.stringify(summary));
  return summary;
}
