#!/usr/bin/env node

/**
 * GLM Quota Plugin Installer (OpenCode v2)
 *
 * The plugin registers its tool, /glm_quota command, and skill natively
 * through the v2 plugin API, so installation only requires adding the
 * package to the `plugins` array in the OpenCode config.
 *
 * This script also removes integration files copied by the v1 installer
 * (command, agent, and skill markdown) when upgrading.
 *
 * Usage:
 *   node bin/install.js              # Install (update plugins config)
 *   node bin/install.js uninstall    # Remove config entry and package
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { parse as parseJsonc } from 'jsonc-parser'

// ==========================================
// CONSTANTS
// ==========================================

const PLUGIN_NAME = 'opencode-glm-quota'

const CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode')

// Integration files written by the v1 installer; safe to remove on upgrade
// because the v2 plugin registers the command, agent-free flow, and skill
// natively via plugin transforms.
const LEGACY_V1_FILES = [
  path.join(CONFIG_DIR, 'command', 'glm_quota.md'),
  path.join(CONFIG_DIR, 'agents', 'glm-quota-exec.md'),
  path.join(CONFIG_DIR, 'skills', 'glm-quota', 'SKILL.md')
]
const LEGACY_V1_DIRS = [
  path.join(CONFIG_DIR, 'skills', 'glm-quota')
]

// Check which config file exists (opencode.json or opencode.jsonc)
const TARGET_CONFIG_JSON = path.join(CONFIG_DIR, 'opencode.json')
const TARGET_CONFIG_JSONC = path.join(CONFIG_DIR, 'opencode.jsonc')
let TARGET_CONFIG = null
if (fileExists(TARGET_CONFIG_JSON)) {
  TARGET_CONFIG = TARGET_CONFIG_JSON
} else if (fileExists(TARGET_CONFIG_JSONC)) {
  TARGET_CONFIG = TARGET_CONFIG_JSONC
} else {
  // Default to opencode.json if neither exists
  TARGET_CONFIG = TARGET_CONFIG_JSON
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Check if file exists
 */
function fileExists(filePath) {
  return fs.existsSync(filePath)
}

/**
 * Remove file if it exists
 */
function removeFile(filePath, label) {
  if (fileExists(filePath)) {
    fs.unlinkSync(filePath)
    console.log(`  ✓ Removed ${label}`)
  }
}

/**
 * Remove directory if it exists
 */
function removeDirectory(dirPath, label) {
  if (fileExists(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
    console.log(`  ✓ Removed ${label}`)
  }
}

/**
 * Parse JSON or JSONC file
 */
function parseConfig(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return parseJsonc(content)
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Write JSON file
 */
function writeConfig(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const json = JSON.stringify(data, null, 2) + '\n'
  fs.writeFileSync(filePath, json)
  console.log(`  ✓ Wrote ${filePath} (${json.length} bytes)`)
}

// ==========================================
// INSTALLATION FUNCTIONS
// ==========================================

/**
 * Remove integration files copied by the v1 installer
 */
function removeLegacyV1Files() {
  for (const file of LEGACY_V1_FILES) {
    removeFile(file, `v1 file ${path.relative(CONFIG_DIR, file)}`)
  }
  for (const dir of LEGACY_V1_DIRS) {
    removeDirectory(dir, `v1 directory ${path.relative(CONFIG_DIR, dir)}`)
  }
}

/**
 * Update plugin configuration:
 * - add the package to the v2 `plugins` array
 * - migrate a v1 `plugin` array to `plugins`
 * - drop a stale v1 JSON agent entry if present
 */
function updatePluginConfig() {
  // Parse existing config if it exists
  let existingConfig = {}
  if (fileExists(TARGET_CONFIG)) {
    existingConfig = parseConfig(TARGET_CONFIG)
  }

  // CLEANUP: Remove old JSON agent config if it exists (migration from v1.3.x)
  if (existingConfig.agent && existingConfig.agent['glm-quota-exec']) {
    delete existingConfig.agent['glm-quota-exec']
    if (Object.keys(existingConfig.agent).length === 0) {
      delete existingConfig.agent
    }
    console.log('  ✓ Removed old JSON agent config')
  }

  // OpenCode v2 config key is "plugins". Migrate v1 "plugin" entries.
  const plugins = Array.isArray(existingConfig.plugins) ? [...existingConfig.plugins] : []
  const legacyPlugin = Array.isArray(existingConfig.plugin) ? existingConfig.plugin : []

  if (legacyPlugin.length > 0) {
    for (const name of legacyPlugin) {
      if (typeof name === 'string' && !plugins.includes(name)) {
        plugins.push(name)
      }
    }
    delete existingConfig.plugin
    console.log('  ✓ Migrated v1 plugin array to plugins')
  }

  // Only add if not already present
  if (!plugins.includes(PLUGIN_NAME)) {
    plugins.push(PLUGIN_NAME)
    console.log(`  ✓ Added ${PLUGIN_NAME} to plugins array`)
  } else {
    console.log(`  ⊙ Plugin ${PLUGIN_NAME} already in plugins array`)
  }

  existingConfig.plugins = plugins

  // Write config back to same file (opencode.json or opencode.jsonc)
  writeConfig(TARGET_CONFIG, existingConfig)
  console.log(`  ✓ Updated ${path.basename(TARGET_CONFIG)}`)
}

/**
 * Remove plugin configuration
 */
function removeConfig() {
  if (!fileExists(TARGET_CONFIG)) {
    console.log(`  ⊙ Config not found: ${TARGET_CONFIG}`)
    return
  }

  const existingConfig = parseConfig(TARGET_CONFIG)
  let changed = false

  for (const key of ['plugins', 'plugin']) {
    if (Array.isArray(existingConfig[key])) {
      const next = existingConfig[key].filter((name) => name !== PLUGIN_NAME)
      if (next.length !== existingConfig[key].length) {
        if (next.length === 0) {
          delete existingConfig[key]
        } else {
          existingConfig[key] = next
        }
        changed = true
        console.log(`  ✓ Removed plugin from ${key} array`)
      }
    }
  }

  if (existingConfig.agent && existingConfig.agent['glm-quota-exec']) {
    delete existingConfig.agent['glm-quota-exec']
    if (Object.keys(existingConfig.agent).length === 0) {
      delete existingConfig.agent
    }
    changed = true
    console.log('  ✓ Removed glm-quota-exec agent config')
  }

  if (changed) {
    writeConfig(TARGET_CONFIG, existingConfig)
    console.log(`  ✓ Updated ${path.basename(TARGET_CONFIG)}`)
  } else {
    console.log('  ⊙ No config changes needed')
  }
}

/**
 * Remove npm package
 */
function removePackage(globalFlag) {
  const args = ['remove', PLUGIN_NAME]
  if (globalFlag) {
    args.push('--global')
  }

  const result = spawnSync('npm', args, { stdio: 'inherit' })
  if (result.status !== 0) {
    console.log('  ⊙ npm remove failed, remove manually if needed')
  }
}

/**
 * Uninstall configuration and package
 */
function uninstall(globalFlag) {
  removeLegacyV1Files()
  removeConfig()
  removePackage(globalFlag)
}

// ==========================================
// MAIN INSTALLATION FUNCTION
// ==========================================

/**
 * Main installer function
 */
function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2)
    const isUninstall = args.includes('uninstall')
    const globalFlag = args.includes('--global') || args.includes('-g')

    if (isUninstall) {
      console.log('✓ Uninstalling GLM Quota Plugin...\n')
      uninstall(globalFlag)
      console.log()
      console.log('✓ Uninstall complete!')
      return
    }

    console.log('✓ Installing GLM Quota Plugin (OpenCode v2)...\n')

    // v1 wrote command/agent/skill files that v2 no longer needs
    removeLegacyV1Files()
    updatePluginConfig()

    console.log()
    console.log('✓ Installation complete!')
    console.log('✓ Restart OpenCode, then run /glm_quota')

  } catch (error) {
    console.error(`\n✗ Installation failed: ${error instanceof Error ? error.message : String(error)}`)
    console.error('✗ Check file permissions and try again')
    process.exit(1)
  }
}

// Run installer
main()
