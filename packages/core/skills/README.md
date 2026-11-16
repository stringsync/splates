# core/skills

The agent skills a project has, under `.agents/skills`, and installing those
one repository ships from the tag of one of its releases, through the
`skills` CLI. A project's copy then always says which release it came from.

```ts
import { ProjectSkills } from "core/skills";

const skills = new ProjectSkills(root, { fs, ps, log, source: "owner/repo" });
await skills.add(["review"], "1.2.3"); // bunx skills@1 add owner/repo#v1.2.3 …
await skills.installed(); // ["review", …]
await skills.version("review"); // "1.2.3"
```

`add` skips a copy already at the release and one that is a symbolic link,
which someone keeps by hand, so running it again changes nothing and needs no
network. When the release's tag is not on the remote yet (a release that died
between publishing and tagging), `add` warns and installs from the
repository's default branch instead; the copy then carries whatever `version:`
that branch has, so a later `add` at the same release installs from the tag.
`versionOf(md)` reads the `version:` from a skill's frontmatter.
