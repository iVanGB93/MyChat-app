/** Single-flight preview acquisition with explicit transfer of track ownership. */
export function createMediaPrewarmer<T>(acquire: () => Promise<T>, release: (media: T) => void) {
  let media: T | null = null;
  let pending: Promise<T> | null = null;
  let generation = 0;
  return {
    warm(): Promise<T> {
      if (media) return Promise.resolve(media);
      if (pending) return pending;
      const started = generation;
      const work = acquire().then((result) => {
        if (started !== generation) {
          release(result);
          throw new Error('Media preview was cancelled');
        }
        media = result;
        return result;
      });
      pending = work;
      void work.finally(() => { if (pending === work) pending = null; }).catch(() => {});
      return work;
    },
    async take(): Promise<T | null> {
      if (pending) await pending;
      const result = media;
      media = null;
      return result;
    },
    discard(): void {
      generation++;
      pending = null;
      if (media) release(media);
      media = null;
    },
  };
}
