# Android received-media storage

Current implementation: [single-copy media](single-copy-media-2026-10-23.txt).
That update supersedes the permanent private-copy requirement below. Completed
verified media can use its canonical MediaStore/original URI; temporary staging
is separate. The following October 9 account is retained as historical evidence,
not instructions to reintroduce duplicate playback files.

## Active root-identity app (October 9, 2026)

The old media exporter was disconnected during the identity migration. The active app now uses `receivedMediaExport.ts` and `rootMediaExport.ts` with the existing Android `AxonicMediaStore` native module.

| Received type | Shared location |
| --- | --- |
| Photos | Pictures/Axonic |
| Videos | Movies/Axonic |
| Documents and voice messages | Download/Axonic |

Automatic saving defaults on. Profile exposes the existing auto-save preference and Finish media cleanup action. The message menu also offers Save attachment independently of that preference.

Only completed personal incoming attachments from accepted conversations are exported automatically. Pending downloads, network custody, stickers, hidden conversations and blocked senders are excluded. Work is serialized, up to ten new exports per pass, while the account is unlocked and foregrounded. Completion wakes the exporter; a 15-second scan retries failures. Delivery receipts do not wait for Gallery saving.

The native module streams and verifies exports and reuses identical completed files. The owner-scoped journal records the exact public URI and originating message. Explicit message deletion or local-history removal cleans only recorded exports. Cleanup still runs when auto-save is disabled. Android consent is never opened by background cleanup; Profile's explicit cleanup action can request consent for one item per invocation. The media menu can remove a downloaded file and its linked Axonic export while retaining the message.

### Important storage difference

Keep a private, seekable chat copy as well as the public Gallery/Downloads copy. Expo's current synchronous File adapter and file handles do not support ordinary MediaStore URIs reliably: the first live relinking test raised an Invalid URI render error. Do not delete the private copy after export or use a MediaStore URI as a transfer File handle. Chat storage sizes count the private copy and explicitly exclude the additional public copy. Deleting a Gallery copy manually does not erase the chat copy. No broad media/storage permission is requested.

Older Android and iOS automatic public-gallery saving, and rediscovery of exports after reinstall, remain unsupported by this adapter. This is not complete cross-platform parity with the retired Django media-index service. Existing Gallery files are never erased to simulate migration. Recovery phrases restore identity, not missing local chat history.

### Verification

On emulator-5554/5556, through the normal app UI:

- Sent and received a synthetic photo with a caption.
- Confirmed a Pictures/Axonic MediaStore entry.
- Confirmed the received photo renders after restart.
- Long-press opens the original action menu.
- Save attachment reports success without creating another identical export.
- Create sticker opens the original photo editor with the selected photo.
- Delete downloaded media removes the synthetic Gallery entry; its message remains and displays Removed from this device.
- Android external sharing opens the original editable review screen and delivers the captioned photo to the other emulator.
- Typing indicators and reopening unsent drafts work between the normal chat screens.

The development client was rebuilt locally and installed on both emulators, preserving identities and chats. Native shared-content staging now streams a granted content URI into a bounded private temporary file (250 MiB maximum), queues it, then removes that temporary copy. The recipient-selection modal is hidden while the review modal is open so caption input receives focus.

Unit tests cover export eligibility, retries, concurrent wakes, cleanup with auto-save disabled, pending consent, and preservation of the seekable private file. APK 75 was subsequently built locally with the matching release signature and installed on both connected phones, preserving data. Both opened to their existing chat lists. The detailed media tests above were run on the emulators; a complete release-phone media regression was not repeated.

## Other UI functionality restored in the same work

- Original multi-item media review and image editor, captions, cancellation, and durable batch staging.
- Original attachment long-press actions, link actions, sticker favorites and group forwarding.
- Text drafts restored when returning to direct or group conversations.
- Ephemeral typing indicators and online indicators for authenticated direct peers. Lack of a direct connection is not proof that a user is offline elsewhere in the network.
- Chat-list select-all and caption previews.

The familiar call, chat, profile, contact and theme components remain in use. Intentionally retired email/Django login, global display names/about and email discovery are not reintroduced. Local usernames, per-contact nicknames, cryptographic identities and the user's newer Profile QR layout remain.

Caption descriptors require updated mobile/AoN protocol readers. The shared AoN source was synchronized and its 130 tests passed. Both live AoNs now run the same 97-module runtime, SHA-256 `21eb3028ac276c9bc9e2b00d54375eccfaecdde88166c822413d9e3844e4dd06`. Their identities were verified unchanged and both reported active networks with five connected axons. SecondNeuron deployment: `e5c73d8c-d0b7-42b1-b2fe-0f8afd20f1a5`. FirstNeuron rollback: `/opt/axonic-neuron-before-caption-20261009`.
