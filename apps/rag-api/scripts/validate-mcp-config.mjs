import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const args = parseArgs(process.argv.slice(2));
const configPath = resolve(
  args.config ??
    process.env.MCP_CONFIG_PATH ??
    fileURLToPath(
      new URL('../../../workspace/mcp-servers.yaml', import.meta.url),
    ),
);
const allowEmpty = args['allow-empty'] === true;
const config = yaml.load(await readFile(configPath, 'utf8'));
const servers = config?.mcpServers ?? {};
const toolPolicies = config?.mcpToolPolicies ?? {};
const errors = [];
const warnings = [];

if (!config || typeof config !== 'object') {
  errors.push('config must be a yaml object');
}
if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
  errors.push('mcpServers must be an object');
}
if (Object.keys(servers).length === 0 && !allowEmpty) {
  errors.push('mcpServers is empty');
}

for (const [name, server] of Object.entries(servers)) {
  validateServer(name, server);
}
if (
  !toolPolicies ||
  typeof toolPolicies !== 'object' ||
  Array.isArray(toolPolicies)
) {
  errors.push('mcpToolPolicies must be an object when provided');
} else {
  for (const [name, policy] of Object.entries(toolPolicies)) {
    validateToolPolicy(name, policy);
  }
  if (
    Object.keys(servers).length > 0 &&
    Object.keys(toolPolicies).length === 0
  ) {
    warnings.push(
      'No MCP tool policies configured; discovered tools will remain unavailable to Agent runtime.',
    );
  }
}

const report = {
  ok: errors.length === 0,
  configPath,
  serverCount: Object.keys(servers).length,
  servers: Object.keys(servers).sort(),
  warnings,
  errors,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exitCode = 1;
}

function validateServer(name, server) {
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    errors.push(`${name}: server config must be an object`);
    return;
  }

  const transport = server.transport ?? inferTransport(server);
  if (!['stdio', 'sse', 'streamable-http'].includes(transport)) {
    errors.push(`${name}: transport must be stdio, sse, or streamable-http`);
  }

  if (transport === 'stdio') {
    if (!server.command || typeof server.command !== 'string') {
      errors.push(`${name}: stdio server requires command`);
    }
    if (server.args !== undefined && !Array.isArray(server.args)) {
      errors.push(`${name}: args must be an array when provided`);
    }
  } else if (!server.url || typeof server.url !== 'string') {
    errors.push(`${name}: ${transport} server requires url`);
  }

  if (
    server.env !== undefined &&
    (!server.env || typeof server.env !== 'object')
  ) {
    errors.push(`${name}: env must be an object when provided`);
  }

  const serialized = JSON.stringify(server);
  if (
    /(api[_-]?key|secret|token|password)\s*[":=]\s*["']?[A-Za-z0-9_\-]{12,}/i.test(
      serialized,
    )
  ) {
    warnings.push(
      `${name}: config appears to contain a secret-like value; prefer env injection`,
    );
  }
}

function validateToolPolicy(name, policy) {
  if (!/^mcp__.+__.+$/.test(name)) {
    errors.push(
      `${name}: tool policy key must use the namespaced mcp__server__tool alias`,
    );
  }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    errors.push(`${name}: tool policy must be an object`);
    return;
  }
  if (!['read', 'write', 'external_read'].includes(policy.permission)) {
    errors.push(`${name}: permission must be read, write, or external_read`);
  }
  if (!['low', 'medium', 'high'].includes(policy.risk)) {
    errors.push(`${name}: risk must be low, medium, or high`);
  }
  if (!['global', 'tenant'].includes(policy.tenantScope)) {
    errors.push(`${name}: tenantScope must be explicitly global or tenant`);
  }
  if (typeof policy.requiresApproval !== 'boolean') {
    errors.push(`${name}: requiresApproval must be explicitly true or false`);
  } else if (
    (policy.permission === 'write' || policy.risk === 'high') &&
    policy.requiresApproval !== true
  ) {
    errors.push(`${name}: write or high-risk tools must require approval`);
  }
  if (
    !Array.isArray(policy.modes) ||
    policy.modes.length === 0 ||
    policy.modes.some(
      (mode) => !['simple', 'auto', 'agentic', 'production'].includes(mode),
    )
  ) {
    errors.push(`${name}: modes must list one or more supported Agent modes`);
  }
  if (
    !Number.isInteger(policy.timeoutMs) ||
    policy.timeoutMs <= 0 ||
    policy.timeoutMs > 300_000
  ) {
    errors.push(`${name}: timeoutMs must be an integer from 1 to 300000`);
  }
}

function inferTransport(server) {
  if (server.command) return 'stdio';
  if (server.url) return 'sse';
  return undefined;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--allow-empty') {
      parsed['allow-empty'] = true;
    } else if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = values[index + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        index += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}
