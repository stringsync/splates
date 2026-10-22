---
description: Creds live in the OS keyring or AWS Parameter Store and are read in-process through webappwiz/creds, never from the environment; agents request them on the Creds page and never see values
---

`Creds` (`packages/server/creds/creds.ts`) keeps agents' requests in
`creds.json`; the person fills them on the Creds page, and a value comes out
only to code calling `credentials.get`, never to an agent, the page or a
log. Scopes are `project` and `device`; reads check Parameter Store (when it
is a provider and reachable), then the project's store, then the device's.
The environment is never read, so a stray export is not picked up.

`systemStores` (`creds/stores.ts`) uses the OS store `wiz creds` shares
(macOS Keychain, Windows Credential Manager, a Linux secret service). A
Linux box under an EC2 instance role uses `SsmSecretStore` instead:
`SecureString` parameters under `/splates/device/` and
`/splates/projects/<project>/`, signed through IMDSv2;
`SPLATES_SECRET_STORE=ssm|keyring` forces the choice, and `file` keeps
both stores in `0600` files under `~/.splates/secrets/` (`KeyFileStore`, as
a worker's `--key-file`), for a Linux with neither a secret service nor an
instance role; a server that cannot reach its store says so and names these. A hosted secrets
manager was rejected for workers since it would put a second standing
credential on each. Remote workers get provider keys in memory only, from
`KeyDelivery`, served to agents through a loopback credential proxy by an
undumpable process; the local worker gets none, its agents running signed
in as the person. Tests use `FakeSecretStore` from `webappwiz/creds/testing`.
