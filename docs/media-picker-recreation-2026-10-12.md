# Android media picker after activity recreation

The reported Profile error was `Attempting to launch an unregistered ActivityResultLauncher` from `ExponentImagePicker.launchImageLibraryAsync`.

Expo Modules Core 55.0.26 unregisters a launcher's request code on its original Activity owner's `ON_DESTROY`. A retained React runtime/module can subsequently reuse that launcher. Restarting the process recreates the module and masks the problem.

`scripts/patch-activity-result.cjs` restores a missing registration against the current, non-destroyed/non-finishing Activity before launch. Existing registrations take the unchanged path. Suspended launches run registration and launch on the main dispatcher, serializing them with Android lifecycle callbacks. There is no automatic retry of an already-started picker and no change to selection, cropping, encryption, or transfer handling.

The patch covers the shared launcher used by profile photos, chat attachments, and stickers (including camera/crop contracts). Source hashes reject dependency drift. Both install hooks apply it, and `expo-modules-core` is explicitly built from source so precompiled artifacts cannot bypass it.

Validation:

- `npm run check`: 950 passed, 3 skipped; type checking and dependency/module/consolidation checks passed.
- `node scripts/test-native-activity-result.cjs`: native Kotlin compilation and Robolectric lifecycle test. It selects successfully, destroys the original lifecycle owner, reuses the same launcher with the current Activity, receives cancellation, and selects again successfully.
- ADB detected no connected devices during this fix. Real phone verification and Dev installation remain pending. No production build or official app update was performed.

This fixes a retained-runtime launcher after its old Activity is destroyed. It does not claim to restore a JS promise after the entire Android process is killed; Expo's separate pending-result mechanism remains unchanged.

Release gate: rebuild Axonic Dev, test Profile photo selection/crop, chat media and sticker selection after activity recreation and background/foreground cycles. The installed Play Store version requires a future native release containing this fix; Metro alone cannot update its native code. Ask for explicit approval before that production build.
