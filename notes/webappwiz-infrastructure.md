---
description: Which infrastructure comes from webappwiz rather than being written here; check before writing a utility or adding a dependency
---

The server's runtime dependencies are `webappwiz` (pinned to one version),
`@agentclientprotocol/sdk` and `zod`. From webappwiz: `webappwiz/system` (`Fs`/`NodeFs`,
`Ps`/`NodePs`, `FileLock`, `OpenPortProvider`), `webappwiz/log` (`Logger`, `MemoryLogger`),
`webappwiz/time` (`Duration`, `Timer`, `Clock`, `Throttler`, `Debouncer`),
`webappwiz/id` (`CounterIdProvider`, `UuidProvider`), `webappwiz/disposable`
(`Resource`), `webappwiz/events` (`Eventful`, `Dispatcher`),
`webappwiz/creds`, `webappwiz/cmd` (the CLI builder and middleware),
`webappwiz/md` (front matter), `webappwiz/push`, `webappwiz/dictate`. Each
has a `/testing` fake the tests use.

Code reaches files and processes through the injected `fs` and `ps`, not
`node:fs`, so tests swap them; durations are `Duration.mins(5)`, not bare
milliseconds. The webappwiz skill, installed under `.agents/skills`, says what
else it covers; check it before adding a dependency.
