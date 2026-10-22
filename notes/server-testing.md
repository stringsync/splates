---
description: How server tests are set up: Testing makes a real throwaway git repo with every dependency wired, with fakes for processes, logs, ids and secrets, and each module's fakes in its testing.ts
---

`Testing` (`packages/server/testing.ts`) is an `AsyncDisposable` holding a
real temporary git repo with one commit on `main` and every dependency a
command takes, wired to it; a command takes the whole object as its deps
(`await add(t, "alpha")`). The seed repo is made once per test file and
copied per test, since its six git spawns dominated suite time. Git,
`NodeFs` and the storage are real; `FakeProcess` stands in for exits and
signals, `MemoryLogger` for output, `CounterIdProvider` so ids count from 0,
`FakeSecretStore`s for creds, and `splatesHome` sits under the test's own
directory, never the user's. The config is valid but arbitrary, with
`preMerge: "true"` so the gate passes unless a test changes it; a test
changes only the config it is about.

`fixtures.ts` builds records and conversations (`todo`, `conversation`,
`message`, `turn`, `second(n)` for fixed timestamps). Each module's fakes
live in its `testing.ts`: `MemoryStorage`, `FakeAgent`,
`FakeCloudflare`, `WorkerSocketPair` and `FaultProxy`,
`FakePicker`. Tests use the real built page assets, since the server is
tested by serving a page and fetching it.
