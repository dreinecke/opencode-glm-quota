import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { loadPlugin, runQuotaTool } from '../helpers/load-plugin.js';

describe('Integration: Error Handling in src/index.ts', () => {
  test('should return Markdown error message when Date constructor throws', async () => {
    // Setup credentials to reach queryAllUsage
    process.env.ZAI_API_KEY = 'test-token';

    // Mock Date to throw
    const originalDate = global.Date;

    try {
      class ThrowingDate extends Date {
        constructor(...args: ConstructorParameters<typeof Date>) {
          super(...args);
          throw new Error('Date failure');
        }
      }

      global.Date = ThrowingDate as DateConstructor;

      const result = await runQuotaTool(await loadPlugin());

      assert.ok(result.startsWith('### ⚠️ '), 'Output should start with a Markdown error title');
      assert.ok(!result.includes('╔') && !result.includes('╚'), 'Output should not contain box borders');
      assert.ok(result.includes('Date failure'), `Output should contain error message. Got: ${result}`);
    } finally {
      // Cleanup
      global.Date = originalDate;
      delete process.env.ZAI_API_KEY;
    }
  });
});
