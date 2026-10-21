---
description: How the page calls the server: plain fetch wrappers per area under api/, every URL scoped with ?project=, and refusals thrown as ApiError(reason, message)
---

There is no typed RPC client. `packages/web/api/` holds plain async
functions, one file per area (`planning.ts`, `tasks.ts`, `workers.ts`,
`creds.ts`, `budgets.ts`, `evals.ts`, `spend.ts`, `push.ts`), re-exported
from `api/index.ts`; conversation calls live in `conversation-api.ts`. Each
uses `send` (POST by default, a `FormData` body when there are files) or
`sendJson(path, method, body)` from `api/request.ts`, with the server's types
brought in by `import type`. A non-OK response throws `ApiError(reason,
message)` read from the server's `{ reason, message }` body, and a 413 reads
as too big to send.

Every URL passes through `scoped(path, project?)`, which appends
`?project=<slug>` from the page's own query or an explicit slug unless the
path already names one; `api-scoped.test.ts` pins that. `adapters.ts` is
unrelated to HTTP: it gives the assistant-ui composer its file and dictation
adapters.
