/** Shared call switch for development and the regular production release. */
export const neuronCallsEnabled = () => process.env.EXPO_PUBLIC_AXONIC_CALL_CONTROL === '1';
