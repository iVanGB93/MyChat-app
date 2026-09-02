/** Development-only diagnostics. Production hot paths must stay quiet. */
export function debugLog(...args: unknown[]): void {
  if (__DEV__) console.log(...args);
}

