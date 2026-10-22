---
description: The repository is assumed to be run by any user against their own accounts, so nothing checked in may belong to one person (hosts, ids, emails)
---

Assume the repository is run by any user: it is public, released to npm,
and anyone may clone it and run splates from it against their own accounts.
What is checked in must work for them as it does for its author, so one
person's accounts, hosts, ids and email addresses stay in their own state
(`~/.splates`, `.git/splates`, the creds store), never in tracked files.
