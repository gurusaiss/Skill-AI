import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

function parseEnvFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sep = trimmed.indexOf('=');
    if (sep === -1) continue;

    const key = trimmed.slice(0, sep).trim();
    let value = trimmed.slice(sep + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Don't overwrite already-set env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function loadEnv(baseDir) {
  // Single .env at the project root — that's all we need
  const envPath = join(baseDir, '.env');
  if (existsSync(envPath)) {
    parseEnvFile(envPath);
    console.log(`[env] Loaded ${envPath}`);
  }
}
