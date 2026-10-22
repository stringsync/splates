---
description: Why AWS is the only cloud, behind the CloudProvider seam, and why the coordinator box is made by a Pulumi project the user owns, signed in over ESC and OIDC
---

Clouds went Hetzner (2026-10-17), DigitalOcean beside it (10-19), then AWS
alone (10-21): Hetzner because the user will not use it, DigitalOcean once
AWS was chosen. `CloudProvider` (`packages/server/cloud/provider.ts`) stays
the seam, with `AwsCloud` its only implementation and setup no longer
asking which cloud; a provider finds what it made by tags and keeps no
state of its own. Workers are spot instances with on-demand as the fallback,
x86, and the coordinator's box is in `us-east-1`. Budget limits are in
dollars (`splates budget`: a rate cap, a day and a month), estimated at
list price, with warnings at 80%, 90% and 100%.

Pulumi was used, dropped on 10-18 (for Hetzner a few API calls did as much),
and brought back on 10-21 because the box spans AWS, Cloudflare and GitHub,
CloudFormation cannot make a `SecureString` parameter, and Pulumi has
recipe-level constructs; CDK was weighed and rejected. The components live
in `packages/server/infra/`, Pulumi packages as optional peers kept out of
the CLI and page bundles, and `splates server infra init` writes the user's
own Pulumi project. Pulumi signs in to AWS through an ESC environment over
OIDC, never long-lived keys; the box's creds are SSM `SecureString`s.
The stack's own secrets (Cloudflare, GitHub per owner, Anthropic) the user
pastes on the Pulumi site into a second ESC environment, `splates/secrets`,
which setup fills with placeholders and checks without `--show-secrets`:
the user chose on 2026-10-21 that no secret pass through splates, after a
version that read them from the creds store and handed them to `pulumi`.

Setup writes that project into the repo it is opened from, as the package
`packages/infra` (`infra` where there is no `packages/`), not a repository of
its own. Its runtime is `bun` in `Pulumi.yaml`: Pulumi's `nodejs` runtime
compiles with a vendored ts-node that reads `ts.sys`, which TypeScript 7 no
longer has, and cannot load the workspace's extensionless TypeScript imports.
