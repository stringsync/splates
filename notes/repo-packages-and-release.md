---
description: The three packages, what each publishes, how a release is cut, and how the agent skill ships with it
---

`packages/splates` is the CLI published to npm as `@stringsync/splates`;
`packages/server` is `@stringsync/splates-server`, the HTTP server and every
backend operation, which the CLI maps flags onto and never the reverse;
`packages/web` is the page, compiled into `packages/server/web-build` so the
server ships it. `packages/splates/dev` holds `splates dev` (`fix`, `test`,
`eval`, `ship`), mounted only by `checkout.ts`, which `bin/splates` runs and
no `bin` or `exports` entry names, so it never reaches npm; `e2e.test.ts`
pins that.

`splates dev ship` releases in lockstep (`webappwiz/ship`): every workspace
`package.json` and the `version:` frontmatter of `skills/splates/SKILL.md`
take the same patch bump, in one "Release 0.0.N" commit tagged `v0.0.N`. The
skill is not on npm: `splates init` and `update` install it with `bunx skills
add stringsync/splates#v<release> --skill splates`, so the stamp says which
release a project's copy came from. Here `.agents/skills/splates` links to
`skills/splates`; `skills-lock.json` pins only third-party skills.


The release also publishes `ghcr.io/stringsync/splates-runner:<version>` and
`:latest` through the `RunnerImage` artifact, after npm publishing and before
the release tag. It runs Docker buildx for `linux/amd64` on
`docker/runner.Dockerfile`, a generic Debian base (git, curl, build-essential,
mise, a `splates` user) with no bun and no splates: a project's `prepare`
fills its toolchain, and splates arrives at boot. The machine cutting a release needs Docker buildx and a GHCR login
with package write access. The GHCR package must be public (set its visibility
to Public in GitHub package settings on first publication), so Fly needs no
registry credentials. The source label links it to this repository.
A failed image build or push leaves the existing release checkpoint for
`splates dev ship` to finish, rather than bumping another version.

No image is built or pushed for a test run. `RunnerImages.resolve` checks the
public registry for the running version; only a checkout supplying its own
build may fall back to `:latest` when that version has no image. Runtime users
need neither Docker nor flyctl.
