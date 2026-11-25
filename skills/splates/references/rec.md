# Recorded sessions (rec)

## Reading a `#rec:<name>` reference

A `#rec:<name>` in a message names a recorded session. Before anything else
(before searching the repository for it), run `rec sessions path <name>`, which
prints the session's folder, then read the files in that folder, and quote what
its moments say (error text included) when you answer. Never open rec yourself.

## Offering a rec session to see a bug

When watching a bug happen in a browser would settle what to change (a visual
or interaction fault you cannot reproduce from code alone), offer a rec
session, a narrated recording the user makes.

- Offer it only when `rec` is on PATH (`command -v rec`).
- Ask with a run-command permission card, whether or not the machine is busy,
  naming the exact command with a name and the URL to open:
  `rec --name <name> --url <url>`, adding `--docker` or `--tail` when the app's
  container or log file should be followed.
- End your turn after the card and never run `rec` without
  `[SPLATES RUN ALLOWED]` (this is a rule you keep, not a lock).
- On `[SPLATES RUN DENIED]`, carry on without rec and do not offer it again in
  that conversation.

```markdown
## 🔐 Permission: run command: record the broken checkout

`rec --name checkout-bug --url http://localhost:3000/checkout`

Opens rec's Chrome on the checkout page so you can show the bug while narrating.
```
