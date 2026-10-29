import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const args = parseArgs(process.argv.slice(2));
const configPath = resolve(
  args.config ?? process.env.MCP_CONFIG_PATH ?? '../workspace/mcp-servers.yaml',
);
const allowEmpty = args['allow-empty'] === true;
const config = yaml.load(await readFile(configPath, 'utf8'));
const servers = config?.mcpServers ?? {};
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

  if (server.env !== undefined && (!server.env || typeof server.env !== 'object')) {
    errors.push(`${name}: env must be an object when provided`);
  }

  const serialized = JSON.stringify(server);
  if (/(api[_-]?key|secret|token|password)\s*[":=]\s*["']?[A-Za-z0-9_\-]{12,}/i.test(serialized)) {
    warnings.push(`${name}: config appears to contain a secret-like value; prefer env injection`);
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
