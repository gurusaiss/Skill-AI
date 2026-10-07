// Single source of truth for the JSON-file data directory.
// Default is unchanged (server/data). Set DATA_DIR to point the file-mode
// stores at another directory (used for benchmarks/tests with synthetic data
// so the real server/data is never touched).
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : join(__dirname, '..', 'data');
