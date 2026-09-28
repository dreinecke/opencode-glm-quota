import { describe, test, afterEach } from 'node:test'
import assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'

const PLUGIN_NAME = 'opencode-glm-quota'
const createdHomes: string[] = []

function createTempHome(): string {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-quota-installer-'))
  createdHomes.push(tempHome)
  return tempHome
}

function runInstaller(tempHome: string, args: string[] = []): ReturnType<typeof spawnSync> {
  const result = spawnSync('node', ['bin/install.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome
    }
  })

  assert.strictEqual(
    result.status,
    0,
    `Installer failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )

  return result
}

function configPath(tempHome: string): string {
  return path.join(tempHome, '.config', 'opencode', 'opencode.json')
}

function readConfig(tempHome: string): Record<string, unknown> {
  const file = configPath(tempHome)
  assert.ok(fs.existsSync(file), `Expected config file to exist: ${file}`)
  const content = fs.readFileSync(file, 'utf-8')
  return JSON.parse(content) as Record<string, unknown>
}

function writeConfig(tempHome: string, config: Record<string, unknown>): void {
  const configDir = path.join(tempHome, '.config', 'opencode')
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configPath(tempHome), JSON.stringify(config, null, 2) + '\n')
}

function createLegacyV1Files(tempHome: string): void {
  const configDir = path.join(tempHome, '.config', 'opencode')
  fs.mkdirSync(path.join(configDir, 'command'), { recursive: true })
  fs.mkdirSync(path.join(configDir, 'agents'), { recursive: true })
  fs.mkdirSync(path.join(configDir, 'skills', 'glm-quota'), { recursive: true })
  fs.writeFileSync(path.join(configDir, 'command', 'glm_quota.md'), 'v1 command')
  fs.writeFileSync(path.join(configDir, 'agents', 'glm-quota-exec.md'), 'v1 agent')
  fs.writeFileSync(path.join(configDir, 'skills', 'glm-quota', 'SKILL.md'), 'v1 skill')
}

afterEach(() => {
  while (createdHomes.length > 0) {
    const tempHome = createdHomes.pop()
    if (!tempHome) {
      continue
    }
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
})

describe('Installer config key handling (OpenCode v2)', () => {
  test('fresh install writes plugins key (not plugin)', () => {
    const tempHome = createTempHome()

    runInstaller(tempHome, [])
    const config = readConfig(tempHome)

    const pluginsArray = config.plugins
    assert.ok(Array.isArray(pluginsArray), 'Expected "plugins" to be an array')
    assert.ok(pluginsArray.includes(PLUGIN_NAME), `Expected plugins array to include ${PLUGIN_NAME}`)
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(config, 'plugin'),
      false,
      'Expected "plugin" key to be absent'
    )
  })

  test('migrates v1 plugin key into plugins key', () => {
    const tempHome = createTempHome()
    writeConfig(tempHome, { plugin: ['existing-plugin'] })

    runInstaller(tempHome, [])
    const config = readConfig(tempHome)

    const pluginsArray = config.plugins
    assert.ok(Array.isArray(pluginsArray), 'Expected "plugins" to be an array')
    assert.ok(pluginsArray.includes('existing-plugin'), 'Expected v1 plugin value to be preserved')
    assert.ok(pluginsArray.includes(PLUGIN_NAME), `Expected plugins array to include ${PLUGIN_NAME}`)
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(config, 'plugin'),
      false,
      'Expected v1 "plugin" key to be removed'
    )
  })

  test('is idempotent when the plugin is already configured', () => {
    const tempHome = createTempHome()
    writeConfig(tempHome, { plugins: [PLUGIN_NAME] })

    runInstaller(tempHome, [])
    const config = readConfig(tempHome)

    const pluginsArray = config.plugins as string[]
    assert.strictEqual(
      pluginsArray.filter((name) => name === PLUGIN_NAME).length,
      1,
      'Expected exactly one entry for the plugin'
    )
  })

  test('removes integration files written by the v1 installer', () => {
    const tempHome = createTempHome()
    createLegacyV1Files(tempHome)

    runInstaller(tempHome, [])

    const configDir = path.join(tempHome, '.config', 'opencode')
    assert.ok(!fs.existsSync(path.join(configDir, 'command', 'glm_quota.md')), 'v1 command file should be removed')
    assert.ok(!fs.existsSync(path.join(configDir, 'agents', 'glm-quota-exec.md')), 'v1 agent file should be removed')
    assert.ok(!fs.existsSync(path.join(configDir, 'skills', 'glm-quota')), 'v1 skill directory should be removed')
  })

  test('removes the plugin entry and v1 files on uninstall', () => {
    const tempHome = createTempHome()
    writeConfig(tempHome, {
      plugins: [PLUGIN_NAME, 'keep-me'],
      agent: { 'glm-quota-exec': { mode: 'subagent' } }
    })
    createLegacyV1Files(tempHome)

    // Uninstall would run `npm remove` against the real registry; stub npm
    // with a no-op script so the test only exercises config cleanup.
    const binDir = path.join(tempHome, 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'npm'), '#!/bin/sh\nexit 0\n')
    fs.chmodSync(path.join(binDir, 'npm'), 0o755)

    const result = spawnSync('node', ['bin/install.js', 'uninstall'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        PATH: `${binDir}:${process.env.PATH ?? ''}`
      }
    })
    assert.strictEqual(result.status, 0, `Uninstaller failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)

    const config = readConfig(tempHome)
    const pluginsArray = config.plugins as string[]
    assert.ok(!pluginsArray.includes(PLUGIN_NAME), 'Expected plugin entry to be removed')
    assert.ok(pluginsArray.includes('keep-me'), 'Expected unrelated plugin entries to survive')
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(config, 'agent'),
      false,
      'Expected stale v1 JSON agent config to be removed'
    )

    const configDir = path.join(tempHome, '.config', 'opencode')
    assert.ok(!fs.existsSync(path.join(configDir, 'command', 'glm_quota.md')), 'v1 command file should be removed')
    assert.ok(!fs.existsSync(path.join(configDir, 'skills', 'glm-quota')), 'v1 skill directory should be removed')
  })
})
