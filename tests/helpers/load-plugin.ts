import GlmQuotaPlugin from '../../src/index.js'
import type { Plugin } from '@opencode/plugin'

export type RegisteredTool = {
  name: string
  description: string
  input: unknown
  execute: (
    input: unknown,
    context: { signal: AbortSignal }
  ) => Promise<{ content?: string }>
}

export type RegisteredCommand = {
  name: string
  description?: string
  execute: (input: { sessionID: string }) => Promise<void>
}

export type RegisteredSkill = {
  id: string
  name: string
  description?: string
  path: string
  content: string
}

export type SyntheticMessage = { sessionID: string; text: string }

export type IntegrationConnectionOverride = {
  active: (integrationID: string) => Promise<unknown>
  resolve: (connection: unknown) => Promise<unknown>
}

export interface LoadedPlugin {
  plugin: Plugin
  tools: RegisteredTool[]
  commands: RegisteredCommand[]
  skills: RegisteredSkill[]
  syntheticMessages: SyntheticMessage[]
}

/**
 * Load the plugin with a fake v2 context and capture every registration.
 * Credential discovery falls through to auth.json / environment variables
 * unless an integration connection override is provided.
 */
export async function loadPlugin(options: {
  integrationConnection?: IntegrationConnectionOverride
} = {}): Promise<LoadedPlugin> {
  const tools: RegisteredTool[] = []
  const commands: RegisteredCommand[] = []
  const skills: RegisteredSkill[] = []
  const syntheticMessages: SyntheticMessage[] = []

  const connection = options.integrationConnection ?? {
    active: async () => undefined,
    resolve: async () => undefined
  }

  const ctx = {
    integration: { connection },
    tool: {
      transform: async (callback: (editor: { add: (tool: RegisteredTool) => void }) => void) => {
        callback({ add: (tool) => tools.push(tool) })
      }
    },
    command: {
      transform: async (callback: (editor: { add: (command: RegisteredCommand) => void }) => void) => {
        callback({ add: (command) => commands.push(command) })
      }
    },
    skill: {
      transform: async (callback: (editor: { add: (skill: RegisteredSkill) => void }) => void) => {
        callback({ add: (skill) => skills.push(skill) })
      }
    },
    session: {
      synthetic: async (input: SyntheticMessage) => {
        syntheticMessages.push(input)
      }
    }
  }

  await GlmQuotaPlugin.setup(ctx as never)

  return { plugin: GlmQuotaPlugin, tools, commands, skills, syntheticMessages }
}

/**
 * Get the registered glm_quota tool or fail the test.
 */
export function getQuotaTool(loaded: LoadedPlugin): RegisteredTool {
  const tool = loaded.tools.find((candidate) => candidate.name === 'glm_quota')
  if (!tool) {
    throw new Error('glm_quota tool was not registered')
  }
  return tool
}

/**
 * Get the registered glm_quota command or fail the test.
 */
export function getQuotaCommand(loaded: LoadedPlugin): RegisteredCommand {
  const command = loaded.commands.find((candidate) => candidate.name === 'glm_quota')
  if (!command) {
    throw new Error('glm_quota command was not registered')
  }
  return command
}

/**
 * Execute the registered glm_quota tool and return its Markdown content.
 */
export async function runQuotaTool(loaded: LoadedPlugin): Promise<string> {
  const result = await getQuotaTool(loaded).execute({}, { signal: new AbortController().signal })
  return result.content ?? ''
}
