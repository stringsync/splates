---
description: Creds live in the OS keyring or in files only the user may read, and are read in-process through webappwiz/creds, never from the environment; agents request them on the Creds page and never see values
---

`Creds` (`packages/server/creds/creds.ts`) keeps agents' requests in
`creds.json`; the person fills them on the Creds page, and a value comes out
only to code calling `credentials.get`, never to an agent, the page or a
log. Scopes are `project` and `device`; reads check the project's store, then the device's.
The environment is never read, so a stray export is not picked up.

`systemStores` (`creds/stores.ts`) uses the OS store `wiz creds` shares
(macOS Keychain, Windows Credential Manager, a Linux secret service).
`SPLATES_SECRET_STORE=keyring` forces it, and `file` keeps both stores in
`0600` files under `~/.splates/secrets/` (`KeyFileStore`), for a Linux with no secret service; a server that cannot reach its store says so and names these. Workers hold no provider keys: every agent runs on this
machine's own worker, signed in as the person. Tests use `FakeSecretStore` from `webappwiz/creds/testing`.
