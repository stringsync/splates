---
description: No secret is ever committed, encrypted or not (no Pulumi secure: values, no sops files); secrets live in the creds store and reach code at run time
---

Nothing secret goes into a commit: no token, key or password, and no
encrypted form of one either, such as a Pulumi `secure:` value or a sops
file. Encrypting a secret only moves the trust to whoever holds the key, and
the ciphertext stays in public history for good; a value that is never
committed needs neither. Secrets live in the creds store and reach the code
that needs them at run time.
