/**
 * Environment facts (spec §2.4): names and versions only. No command lines, arguments or
 * environment variables, except hook commands when the engineer passes `--include-hooks`.
 */
import { basename } from 'node:path';
import type { Home } from './home.js';
import type { Environment } from './report.js';

export interface Platform {
  platform: NodeJS.Platform;
  release: string;
  nodeVersion: string;
  /** The parts of the environment the shell is read from. Only these keys are looked at. */
  env: { SHELL?: string; PSModulePath?: string; ComSpec?: string };
}

export function osName(platform: NodeJS.Platform, release: string): string {
  const name = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;
  return `${name} ${release}`.trim();
}

/** The shell is a name, never a path: `bash`, `zsh`, `powershell`, `cmd.exe`. */
export function shellName(platform: NodeJS.Platform, env: Platform['env']): string | undefined {
  if (typeof env.SHELL === 'string' && env.SHELL.length > 0) return basename(env.SHELL.replaceAll('\\', '/'));
  if (platform === 'win32') {
    if (typeof env.PSModulePath === 'string' && env.PSModulePath.length > 0) return 'powershell';
    if (typeof env.ComSpec === 'string' && env.ComSpec.length > 0) return basename(env.ComSpec.replaceAll('\\', '/'));
  }
  return undefined;
}

export function describeEnvironment(home: Home, platform: Platform, claudeCodeVersion: string | undefined, pluginSkillCounts: ReadonlyMap<string, number>, includeHooks: boolean): Environment {
  const mcpServersByProject: Record<string, string[]> = {};
  for (const project of home.projects) if (project.mcpServers.length > 0) mcpServersByProject[project.label] = project.mcpServers;
  return {
    claudeCodeVersion,
    os: osName(platform.platform, platform.release),
    shell: shellName(platform.platform, platform.env),
    node: platform.nodeVersion,
    mcpServers: home.mcpServers,
    mcpServersByProject,
    hookEvents: home.hookEvents,
    hookCommands: includeHooks ? home.hookCommands : undefined,
    plugins: home.plugins.map((p) => ({ id: p.id, version: p.version, scope: p.scope, enabled: p.enabled, skills: pluginSkillCounts.get(p.installPath) ?? 0 })),
  };
}
