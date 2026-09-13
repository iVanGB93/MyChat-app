# Managed media deletion

- Delete for me is local and excluded from peer state/digest responses.
- Delete for everyone queues an Axion mutation durably before updating the UI.
  Peers persist the mutation before acknowledging it. Sender identity must match
  the locally recorded author and room before accepting a remote deletion.
- Recipients need the updated app. An offline recipient applies the existing
  outbox/delta recovery when it reconnects; this is not remote device wiping.
- Physical cleanup uses only locally recorded paths. It covers private app files,
  exported assets found in the Axonic Gallery album, and exact children of the
  currently selected downloads folder. Picker originals and other saved copies
  are not removed. Files referenced by another live message are preserved.
- Cleanup runs in the foreground. Android/iOS may require confirmation for
  Gallery deletion. Denied access leaves a durable cleanup job for later retry;
  this does not prevent the chat tombstone from taking effect.
- Late transfer/export completions are queued for cleanup rather than relinked.
- Automated SQLite and cleanup tests cover scope, duplicate jobs, shared files,
  denied access, background suppression and late transfers. Actual Gallery
  confirmation behavior still needs a two-device test on the updated clients.

No native dependency or backend deployment is introduced by this change.
