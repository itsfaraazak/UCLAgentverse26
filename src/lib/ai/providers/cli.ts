import '../server-only';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { readSetting } from '../server-only';
import {
  AiNotConfiguredError,
  AiTimeoutError,
  AiTransportError,
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_TIMEOUT_MS,
  enforceOutputCap,
  withTimeout,
  type CompleteOptions,
  type Provider,
} from '../types';

const ID = 'cli' as const;
const PREFERRED_BINARIES = ['claude', 'cursor-agent'] as const;
const execFileAsync = promisify(execFileCallback);

/** Cached PATH lookups. `undefined` values are negative hits so we do not re-stat. */
const lookupCache = new Map<string, string | undefined>();

export interface CliOptions {
  /** Overrides `SIGMAFOLD_AI_CLI` and the default binary search. */
  readonly binary?: string;
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findOnPath(binary: string): string | undefined {
  if (lookupCache.has(binary)) {
    return lookupCache.get(binary);
  }

  if (path.isAbsolute(binary)) {
    const found = isExecutableFile(binary) ? binary : undefined;
    lookupCache.set(binary, found);
    return found;
  }

  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    if (dir.length === 0) continue;
    const candidate = path.join(dir, binary);
    if (isExecutableFile(candidate)) {
      lookupCache.set(binary, candidate);
      return candidate;
    }
  }

  lookupCache.set(binary, undefined);
  return undefined;
}

function resolveBinary(override: string | undefined): string | undefined {
  if (override !== undefined) {
    return findOnPath(override);
  }
  for (const name of PREFERRED_BINARIES) {
    const found = findOnPath(name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isExecFileError(
  err: unknown,
): err is { code?: string | number | null; killed?: boolean; signal?: string | null } {
  return typeof err === 'object' && err !== null;
}

export function createCliProvider(options: CliOptions = {}): Provider {
  const override = options.binary ?? readSetting('SIGMAFOLD_AI_CLI');
  const resolved = resolveBinary(override);
  const model = resolved !== undefined ? path.basename(resolved) : (override ?? PREFERRED_BINARIES[0]);

  return {
    id: ID,
    label: `CLI (${model})`,
    model,

    available(): boolean {
      return resolveBinary(override) !== undefined;
    },

    unavailableReason(): string {
      if (resolveBinary(override) !== undefined) return '';
      if (override !== undefined) {
        return 'SIGMAFOLD_AI_CLI does not point to an executable on PATH';
      }
      return 'no supported CLI (claude, cursor-agent) found on PATH';
    },

    async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
      const binaryPath = resolveBinary(override);
      if (binaryPath === undefined) {
        throw new AiNotConfiguredError(
          ID,
          override !== undefined
            ? 'cli: SIGMAFOLD_AI_CLI does not point to an executable'
            : 'cli: no supported CLI (claude, cursor-agent) found on PATH',
        );
      }

      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxChars = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

      return withTimeout(ID, timeoutMs, opts.signal, async (signal) => {
        try {
          const { stdout } = await execFileAsync(binaryPath, ['-p', prompt], {
            timeout: timeoutMs,
            maxBuffer: maxChars,
            signal,
            encoding: 'utf8',
          });
          return enforceOutputCap(ID, stdout.trim(), maxChars);
        } catch (err) {
          if (!isExecFileError(err)) throw err;

          if (err.code === 'ENOENT') {
            throw new AiNotConfiguredError(ID, 'cli: binary is not installed');
          }
          if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            throw new AiTransportError(ID, 'cli: output exceeded the character cap');
          }
          if (err.killed === true || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
            throw new AiTimeoutError(ID, timeoutMs);
          }
          if (typeof err.code === 'number') {
            throw new AiTransportError(ID, `cli: process exited with code ${err.code}`, err.code);
          }

          throw err;
        }
      });
    },
  };
}
