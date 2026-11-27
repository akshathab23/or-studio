import {
  ApiError,
  DEFAULT_REQUEST_TIMEOUT_MS,
  LONG_REQUEST_TIMEOUT_MS,
  RequestCancelledError,
  RequestTimeoutError,
  isRequestCancelledError,
  requestWithTimeout,
} from './client.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runTests(): Promise<void> {
  let passed = 0;

  // 1. Default timeout constants are sensible
  {
    assert(DEFAULT_REQUEST_TIMEOUT_MS === 30_000, 'Default timeout should be 30s');
    assert(LONG_REQUEST_TIMEOUT_MS === 90_000, 'Long timeout should be 90s');
    passed++;
  }

  // 2. Normal successful request passes through and calls fetch exactly once (no retries)
  {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ status: 'ok', value: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await requestWithTimeout<{ status: string; value: number }>(
      '/api/health',
      {},
      {},
      mockFetch
    );
    assert(calls === 1, 'Successful request must call fetch exactly once');
    assert(result.status === 'ok' && result.value === 42, 'Parsed JSON payload returned');
    passed++;
  }

  // 3. Server API failure throws ApiError with detail and never retries
  {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ detail: 'Invalid model configuration' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    let caught: unknown = null;
    try {
      await requestWithTimeout('/api/solve/multi-period', { method: 'POST' }, {}, mockFetch);
    } catch (err) {
      caught = err;
    }

    assert(calls === 1, 'Failed request must NOT be retried');
    assert(caught instanceof ApiError, 'Must throw ApiError');
    assert((caught as ApiError).status === 400, 'Status code preserved');
    assert(
      (caught as ApiError).message === 'Invalid model configuration',
      'Server detail message preserved'
    );
    passed++;
  }

  // 4. Request timeout aborts fetch and throws RequestTimeoutError without retrying
  {
    let calls = 0;
    let signalAborted = false;

    const mockFetch: typeof fetch = (_url, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          signalAborted = true;
          const abortErr = new Error('The operation was aborted.');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    };

    let caught: unknown = null;
    try {
      await requestWithTimeout(
        '/api/solve/multi-period',
        { method: 'POST' },
        { timeoutMs: 25 },
        mockFetch
      );
    } catch (err) {
      caught = err;
    }

    assert(calls === 1, 'Timed-out solver request must NOT be retried');
    assert(signalAborted, 'Fetch AbortSignal must be aborted on timeout');
    assert(caught instanceof RequestTimeoutError, 'Must throw RequestTimeoutError');
    assert(!isRequestCancelledError(caught), 'Timeout must not be misclassified as cancellation');
    assert(
      (caught as RequestTimeoutError).message.toLowerCase().includes('timed out'),
      'Timeout error message must be understandable'
    );
    passed++;
  }

  // 5. Pre-aborted external AbortSignal cancels immediately without calling fetch
  {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    };

    const controller = new AbortController();
    controller.abort();

    let caught: unknown = null;
    try {
      await requestWithTimeout(
        '/api/datasets/1',
        {},
        { signal: controller.signal, timeoutMs: 5000 },
        mockFetch
      );
    } catch (err) {
      caught = err;
    }

    assert(calls === 0, 'Pre-aborted signal must not invoke fetch');
    assert(caught instanceof RequestCancelledError, 'Must throw RequestCancelledError');
    assert(isRequestCancelledError(caught), 'isRequestCancelledError helper returns true');
    passed++;
  }

  // 6. Mid-flight external AbortSignal cancels cleanly and distinguishes from timeout
  {
    let calls = 0;
    const externalController = new AbortController();

    const mockFetch: typeof fetch = (_url, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('Aborted by caller');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
        setTimeout(() => externalController.abort(), 15);
      });
    };

    let caught: unknown = null;
    try {
      await requestWithTimeout(
        '/api/analyze/sensitivity',
        { method: 'POST' },
        { signal: externalController.signal, timeoutMs: 5000 },
        mockFetch
      );
    } catch (err) {
      caught = err;
    }

    assert(calls === 1, 'Fetch called once');
    assert(caught instanceof RequestCancelledError, 'External abort must throw RequestCancelledError');
    assert(!(caught instanceof RequestTimeoutError), 'External abort must not throw RequestTimeoutError');
    passed++;
  }

  console.log(`API client reliability unit tests passed: ${passed}/${passed}`);
}

await runTests();
