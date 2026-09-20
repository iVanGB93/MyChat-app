# Android received-media storage

New Android 10+ builds use the local `AxonicMediaStore` module, registered in the existing `axonic-app-update` package. No new broad storage permissions are required for files created by this installation.

| Received type | Shared location |
| --- | --- |
| Photos | Pictures/Axonic |
| Videos | Movies/Axonic |
| Documents and voice messages | Download/Axonic |

Automatic saving remains enabled by default. Failed exports keep their private source, so receiving and opening media does not depend on a successful Gallery export. Receipt acknowledgements remain independent of export.

Exports are serialized, streamed natively in bounded chunks and SHA-256 verified. MediaStore pending rows keep unfinished files out of Gallery. SQLite records the exact content URI before the private source is removed. Matching completed exports can be reused following an interrupted relink. A complete pending row can also be verified and published after restart; an interrupted partial pending row is left to Android's pending-row expiry.

Names retain the complete encoded message ID. Ownership, exact URI, message identity and Axonic folder are checked before automatic deletion. Copies separately saved or forwarded with surviving local references are not removed. Android can require consent for older/recovered files; unattended cleanup never initiates Android consent. Profile's cleanup action attempts at most one consent-requiring item per invocation and retains incomplete jobs. A new installation cannot assume ownership of the previous installation's files.

Existing public files are not moved or erased during upgrade. Received private files migrate in batches of ten while foregrounded, with a one-minute interval when progress is made. Gallery recovery is explicit and may require permission. Recovering older Downloads after reinstall still requires a user-granted folder; filenames alone do not confer Android file access. Shared files are intended to remain after uninstall, but reinstall does not automatically restore the chat database or grant access to all old media.

Android versions below 10 and development clients without the new module retain the previous Gallery/selected-folder path. iOS storage behavior is unchanged.

## Verification

- Automated tests cover source preservation, verified relinking, concurrent export deduplication and cleanup permission handling.
- Compile `:axonic-app-update:compileDebugKotlin` to validate the native code.
- A rebuilt Android development client is required before device validation. Reloading Expo alone does not install this module.
- Before production: test photo/video/document/voice receive and opening; Gallery visibility; sender deletion; deletion after forwarding; permission denial; interrupted large export; low disk space; and reinstall recovery on a disposable test installation. Never wipe a user's test data to perform these checks.
