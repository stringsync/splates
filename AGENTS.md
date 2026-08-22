If you change this package's API, check that the agent skill at
`packages/cli/templates/arbor.skill.md` is still in sync. That is the source;
the copies under `.agents/skills/` and `.claude/skills/` are installed from it.

`arbor` runs whichever checkout you are standing in, so working on this package
from a worktree merges with the code you are editing. Pin the main tree for the
merge itself: `WEBAPPWIZ_ROOT="$(arbor path)" arbor merge`.
