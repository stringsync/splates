# Setup

`[SPLATES SETUP <step>]`, the first prompt of a conversation the `splates
server` Setup page opens, asks you to walk the user through one step of setting
splates up on this machine. `splates setup` lists the steps by area, each with
a check that decides whether it is done. Setup changes the machine
(`~/.splates`, the creds store), not the repo, so it needs no task: stay in the
main tree. A code change it turns up, such as a wrong check, is a task of its
own.

1. **Read the step first.** `splates setup <step> --json`, before anything
   else, prints its `title`, `why`, what the user does (`user`), what you do
   (`agent`), its `status`, the steps it comes `after`, and any `problem` its
   check threw. By status:
   - `ready`: go on.
   - `done`: say so in a line, name the next step as in step 5, and stop.
   - `waiting`: name the steps in `after` not done yet and ask whether to
     start the first; do not start it unasked.
   - `skipped`: say the user skipped it; go on only when they say to, with
     `splates setup <step> --unskip` first.
   - `not_found`: the page and this checkout disagree on the roster. Say so,
     with what `splates setup` lists, and stop.
2. **Say what it does and why** in one line from `why`, and the `problem` in a
   second line, if any, before doing anything.
3. **Do everything you can yourself**, as `agent` says, finding out rather
   than asking (whether a tool is installed, what is configured). Ask the user
   only for what `user` says only they can do, one thing at a time: what it is
   for, then exact instructions, and wait before asking the next.
4. **Request every secret as a cred** with `--device` ([creds.md](creds.md)),
   never in chat or from the environment, and wait on its `cred.saved`
   signal.
5. **Check the step after each action**: `splates setup <step>`. While it is
   not `done`, say in a line what went wrong and the one next thing to try.
   Once `done`, say in one sentence what changed for the user and name the
   next step by title from `next` in `splates setup --json`, or that nothing
   is left. Then stop: the page offers the next step, so never start it
   unasked.

When the user would rather not do a step, `splates setup <step> --skip`, and
name the next step as above. Before skipping a required step (`optional:
false`), say what stops working without it, from `why`.

Undoing an area (forgetting its creds and removing what it made) is the Undo
button on the Setup page, which only the user presses. Never undo one
yourself, by its routes or by hand (`splates server destroy`). When asked,
`splates setup <area> --undo` prints what it would remove, the creds it forgets
and keeps, and what only the user can remove after (a provider's token): say
that in a few lines and send them to the page, or why it was `refused`.

## Remote access

Reaching `splates server` from elsewhere is the Remote access area
(`cloudflare-token`, `tunnel`, `access`, `ports-host`); walk it as above. Ask
the user for the host, the emails and any team name rather than guessing.
`splates tunnel setup <host> --email <theirs>` makes the Cloudflare tunnel, its
DNS record and its Access application, keeping the API token as the cred
`SPLATES_CLOUDFLARE_API_TOKEN`, so a bare `splates server` comes up tunneled.
Without the token it requests it and exits `requested`: wait as for any cred,
then run it again. With no Zero Trust organization, it asks for `--team
<name>`.

By hand, `splates server --tunnel <host> --access-team <team> --access-aud
<aud>` runs `cloudflared tunnel run` and refuses to start without both Access
flags. Never run a tunnel with `--allow-hosts` and no Access. A tunnel other
than cloudflared is a `tunnel` in `splates.config.ts` implementing
`TunnelProvider` from `@stringsync/splates/config`; write one only when asked,
as its own task, reading splates's `tunnel/provider.ts` first, and check the
`splates server` log to see whether it came up.

## Workers

Agents run only on this machine, with no cap on how many: merges take turns on
the premerge lock, and agents ask before heavy work when the machine is busy.
When agents do not start at all, run `splates worker drain local --undo`; the
user can also pause or resume the queue at the top of the page's Queue tab.

## Ships

The Ships journey sets up a project rather than the machine. Its step checks the
project's `splates.config.ts`, so run `splates setup` in its main tree, make
the change in a task (`setup-ships-command`), then ask the user to restart
`splates server`.

- **Ships** (`ships-command`): list the commands that ship the project under
  `ships` (`["bin/<project> ship"]`), finding its existing release script
  before writing one. Only the user ships, so never run the ship command.
