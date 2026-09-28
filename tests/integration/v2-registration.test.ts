import { describe, test } from 'node:test'
import * as assert from 'node:assert'
import { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:https'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { loadPlugin, getQuotaTool, getQuotaCommand } from '../helpers/load-plugin.js'

const require = createRequire(import.meta.url)
const https = require('node:https') as typeof import('node:https')
const fs = require('node:fs') as typeof import('node:fs')

type MockRequest = EventEmitter & {
  destroy: () => void
  end: () => void
  setTimeout: (_timeout: number) => MockRequest
}

function createCapturingMockRequest(
  responses: Record<string, Record<string, unknown>>,
  capturedHeaders: Array<{ path: string; authorization: string }>
) {
  return (
    options: RequestOptions,
    callback: (response: EventEmitter & { statusCode?: number }) => void
  ): MockRequest => {
    capturedHeaders.push({
      path: options.path ?? '',
      authorization: (options.headers?.Authorization as string) ?? ''
    })

    const request = new EventEmitter() as MockRequest
    const requestPath = options.path ?? ''
    const matchedKey = Object.keys(responses).find((key) => requestPath.includes(key))
    const body = matchedKey ? responses[matchedKey] : { error: 'not found' }

    request.destroy = () => {}
    request.setTimeout = () => request
    request.end = () => {
      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & { statusCode?: number }
        response.statusCode = 200
        callback(response)

        queueMicrotask(() => {
          response.emit('data', JSON.stringify(body))
          response.emit('end')
        })
      })
    }

    return request
  }
}

describe('OpenCode v2 plugin registration', () => {
  test('registers the glm_quota tool with a JSON Schema input', async () => {
    const loaded = await loadPlugin()

    const tool = getQuotaTool(loaded)
    assert.strictEqual(tool.name, 'glm_quota')
    assert.ok(tool.description.length > 0, 'Tool should carry a description')
    assert.deepStrictEqual(tool.input, {
      type: 'object',
      properties: {},
      additionalProperties: false
    })
  })

  test('registers the /glm_quota command', async () => {
    const loaded = await loadPlugin()

    const command = getQuotaCommand(loaded)
    assert.strictEqual(command.name, 'glm_quota')
    assert.ok(command.description && command.description.length > 0)
  })

  test('registers the glm-quota skill', async () => {
    const loaded = await loadPlugin()

    const skill = loaded.skills.find((candidate) => candidate.id === 'glm-quota')
    assert.ok(skill, 'glm-quota skill should be registered')
    assert.ok(skill.content.includes('glm_quota'), 'Skill content should reference the tool')
  })

  test('tool output is wrapped in a content field', async () => {
    const originalExistsSync = fs.existsSync

    fs.existsSync = (() => false) as typeof fs.existsSync
    syncBuiltinESMExports()
    delete process.env.ZAI_API_KEY
    delete process.env.ZHIPU_API_KEY
    delete process.env.ZHIPUAI_API_KEY

    try {
      const result = await getQuotaTool(await loadPlugin()).execute(
        {},
        { signal: new AbortController().signal }
      )

      assert.ok(typeof result.content === 'string', 'Tool should resolve with a content string')
      assert.ok((result.content ?? '').startsWith('### ⚠️ '), 'Credential error should surface as Markdown')
    } finally {
      fs.existsSync = originalExistsSync
      syncBuiltinESMExports()
    }
  })

  test('probes v2 integration IDs before falling back to auth.json', async () => {
    const probed: string[] = []
    const originalExistsSync = fs.existsSync

    fs.existsSync = (() => false) as typeof fs.existsSync
    syncBuiltinESMExports()
    delete process.env.ZAI_API_KEY
    delete process.env.ZHIPU_API_KEY
    delete process.env.ZHIPUAI_API_KEY

    try {
      const loaded = await loadPlugin({
        integrationConnection: {
          active: async (integrationID: string) => {
            probed.push(integrationID)
            return undefined
          },
          resolve: async () => undefined
        }
      })

      // Credential discovery runs when the tool executes, not during setup
      await getQuotaTool(loaded).execute({}, { signal: new AbortController().signal })

      assert.ok(probed.includes('zai-coding-plan'), 'Should probe the v2 zai-coding-plan integration')
      assert.ok(probed.includes('zai'), 'Should probe the v2 zai integration')
      assert.ok(probed.includes('zhipuai-coding-plan'), 'Should probe the v2 zhipuai-coding-plan integration')
      assert.ok(probed.includes('zhipuai'), 'Should probe the v2 zhipuai integration')
    } finally {
      fs.existsSync = originalExistsSync
      syncBuiltinESMExports()
    }
  })

  test('command reports usage via a synthetic session message using integration credentials', async () => {
    const originalRequest = https.request
    const originalExistsSync = fs.existsSync
    const capturedHeaders: Array<{ path: string; authorization: string }> = []

    fs.existsSync = (() => false) as typeof fs.existsSync
    https.request = createCapturingMockRequest(
      {
        '/quota/limit': { data: { limits: [] } },
        '/model-usage': { data: { totalUsage: { totalTokensUsage: 1 } } },
        '/tool-usage': { data: { totalUsage: {} } }
      },
      capturedHeaders
    ) as typeof https.request
    syncBuiltinESMExports()

    try {
      const loaded = await loadPlugin({
        integrationConnection: {
          active: async (integrationID: string) =>
            integrationID === 'zai-coding-plan' ? { type: 'credential', id: 'cred_1' } : undefined,
          resolve: async () => ({ type: 'key', key: 'integration-token' })
        }
      })

      await getQuotaCommand(loaded).execute({ sessionID: 'ses_test' })

      assert.strictEqual(loaded.syntheticMessages.length, 1, 'Command should inject one synthetic message')
      const message = loaded.syntheticMessages[0]
      assert.strictEqual(message.sessionID, 'ses_test')
      assert.ok(message.text.includes('### 📊 Z.ai GLM Coding Plan'), 'Report should be the synthetic message text')

      assert.ok(capturedHeaders.length >= 3, 'Should have queried the usage endpoints')
      for (const header of capturedHeaders) {
        assert.strictEqual(header.authorization, 'integration-token', 'Authorization header should use the integration key')
      }
    } finally {
      https.request = originalRequest
      fs.existsSync = originalExistsSync
      syncBuiltinESMExports()
    }
  })
})
