# core/abort

Ways of bringing an `AbortSignal` to bear on work that does not take one.
`AbortController` and `AbortSignal` are globals in Node, Bun, Deno, workers and
browsers alike, and this package depends on nothing else.

```ts
import { aborts } from "core/abort";

const body = await aborts.race(signal, response.json());
```

The work is not cancelled, because a promise cannot be: `race` decides how long
the caller waits for it. Whatever the promise was doing carries on, so a signal
is not a way to stop paying for something, only a way to stop waiting.

For a deadline rather than a signal, `timeouts.race` in
[core/time](../time) is the same idea measured in `Duration`.
