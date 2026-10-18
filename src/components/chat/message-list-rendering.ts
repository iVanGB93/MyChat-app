/** Keep the initial visible batch unchanged. A seven-viewport window retains
 * three screens of overscan in each direction instead of the default ten;
 * smaller later batches avoid mounting many gesture/media trees in one turn.
 * Do not use fixed item heights: text, quotes and media have variable sizes.
 */
export const messageListRendering={initialNumToRender:10,maxToRenderPerBatch:4,windowSize:7} as const;
