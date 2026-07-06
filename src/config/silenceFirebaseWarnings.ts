/* ------------------------------------------------------------------ */
/*  Silence React Native Firebase namespaced-API deprecation warnings.  */
/*                                                                      */
/*  We use the modular Firebase API (getMessaging/getToken/… ) where     */
/*  practical, but some "This method is deprecated … use getApp()"       */
/*  warnings still fire from RN Firebase's own internal namespaced       */
/*  calls. This is the officially documented escape hatch and MUST run   */
/*  before any Firebase module is used — hence it's imported first in    */
/*  index.ts.                                                            */
/* ------------------------------------------------------------------ */

(globalThis as unknown as { RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS?: boolean })
  .RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

export {};
