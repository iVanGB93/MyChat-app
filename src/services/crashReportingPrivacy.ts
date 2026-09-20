import type { ErrorEvent } from '@sentry/react-native';

const SAFE_OPERATIONS = new Set(['notification-open', 'notification-open-timeout', 'diagnostic-test']);
const SAFE_STATES = new Set(['connected', 'connecting', 'disconnected', 'reconnecting', 'no-internet']);
const SAFE_BLOCKERS = new Set(['background', 'authentication', 'navigator', 'route-not-applied', 'navigation-exception']);
const safeFilename = (value: string | undefined) => value?.replace(/[?#].*$/, '').split(/[/\\]/).pop();

/** Error messages can contain server responses, chat text or private filenames. */
function safeErrorValue(value: string | undefined): string {
  if (!value) return 'Error details omitted for privacy';
  if (SAFE_OPERATIONS.has(value)) return value;
  if (/^Cannot read propert(?:y '[a-zA-Z_$][\w$]*' of (?:undefined|null)|ies of (?:undefined|null) \(reading '[a-zA-Z_$][\w$]*'\))$/.test(value)) return value;
  if (/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)* is not a function$/.test(value)) return value;
  return 'Error details omitted for privacy';
}

/** Keep debugging coordinates, never local variables, source snippets or URLs. */
export function sanitizeCrashEvent(event: ErrorEvent): ErrorEvent {
  const values = event.exception?.values?.map((exception) => ({
    type: /^[\w.$]+$/.test(exception.type || '') ? exception.type : 'Error',
    value: safeErrorValue(exception.value),
    mechanism: exception.mechanism ? {
      type: exception.mechanism.type,
      handled: exception.mechanism.handled,
    } : undefined,
    stacktrace: exception.stacktrace ? {
      frames: exception.stacktrace.frames?.map((frame) => ({
        filename: safeFilename(frame.filename),
        abs_path: safeFilename(frame.abs_path),
        function: frame.function,
        module: frame.module,
        lineno: frame.lineno,
        colno: frame.colno,
        in_app: frame.in_app,
        instruction_addr: frame.instruction_addr,
        platform: frame.platform,
      })),
    } : undefined,
  }));
  // Reconstruct rather than blacklist: new SDK fields must not silently leak data.
  return {
    type: event.type,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    dist: event.dist,
    environment: event.environment,
    sdk: event.sdk,
    // Debug-ID matching must use the same sanitized paths as stack frames.
    debug_meta: event.debug_meta ? {
      ...event.debug_meta,
      images: event.debug_meta.images?.map((image) => image.type === 'sourcemap'
        ? { ...image, code_file: safeFilename(image.code_file) ?? '' }
        : image),
    } : undefined,
    exception: values ? { values } : undefined,
    tags: {
      ...(SAFE_OPERATIONS.has(String(event.tags?.operation)) ? { operation: event.tags?.operation } : {}),
      ...(SAFE_STATES.has(String(event.tags?.axion_state)) ? { axion_state: event.tags?.axion_state } : {}),
      ...(SAFE_BLOCKERS.has(String(event.tags?.notification_blocker)) ? { notification_blocker: event.tags?.notification_blocker } : {}),
    },
    contexts: {
      ...(event.contexts?.os ? { os: { name: event.contexts.os.name, version: event.contexts.os.version } } : {}),
      ...(event.contexts?.device ? { device: {
        model: event.contexts.device.model,
        manufacturer: event.contexts.device.manufacturer,
        arch: event.contexts.device.arch,
      } } : {}),
    },
    breadcrumbs: [],
    user: undefined,
  };
}
