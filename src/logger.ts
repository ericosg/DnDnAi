/**
 * Structured logger with configurable verbosity.
 *
 * Set LOG_LEVEL env var to: error, warn, info, debug (default: info)
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const level: Level = (() => {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (env in LEVELS) return env as Level;
  return "info";
})();

function ts(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

export const log = {
  error(msg: string, ...args: unknown[]) {
    if (LEVELS[level] >= LEVELS.error) console.error(`${ts()} [ERROR] ${msg}`, ...args);
  },

  warn(msg: string, ...args: unknown[]) {
    if (LEVELS[level] >= LEVELS.warn) console.warn(`${ts()} [WARN]  ${msg}`, ...args);
  },

  info(msg: string, ...args: unknown[]) {
    if (LEVELS[level] >= LEVELS.info) console.log(`${ts()} [INFO]  ${msg}`, ...args);
  },

  debug(msg: string, ...args: unknown[]) {
    if (LEVELS[level] >= LEVELS.debug) console.log(`${ts()} [DEBUG] ${msg}`, ...args);
  },
};
