# Setup

`[SPLATES SETUP <step>]`, sent by the `splates server` Setup page as the first
prompt of a new conversation, asks you to walk the user through one step of
setting splates up on this machine. The steps are a roster in
splates's `setup-area-*.ts`, one file per area, each step with a check that
decides whether it is done; `splates setup` lists them by area. Setup changes the machine
(`~/.splates`, the creds store), not the repo, so it needs no task: stay in the
main tree. A code change it turns up, such as a check that is wrong, goes in
a task of its own, as Workflow says. The GitHub pushing area's steps after
`github-app` check the repository of the project setup is opened from: run
`splates setup` in its main tree, and make its last step's change to
`splates.config.ts` in a task, as the step says.

1. **Read the step first.** `splates setup <step> --json`, before you run or
   change anything else, prints its `title`, its `why`, the one thing the
   user does (`user`), what you do (`agent`), its `status`, the steps it
   comes `after`, and a `problem` when its check threw. By its status:
   - `ready`: go on.
   - `done`: say so in a line, name the next step as in step 5, and stop.
   - `waiting`: name the steps in `after` that are not done yet, and ask
     whether to start on the first of them instead; do not start it unasked.
   - `skipped`: say the user skipped it, and go on only once they say to,
     with `splates setup <step> --unskip` first.
   - A `not_found` failure: the page and this checkout disagree on the
     roster. Say so, with what `splates setup` lists, and stop.
2. **Say what it does and why**, in one line of your own words from `why`,
   before doing anything, and in a second line the `problem`, if any.
3. **Do everything you can yourself**, as `agent` says, finding out what
   you can rather than asking: whether a tool is installed, what is already
   configured. Ask the user only for what `user` says only they can do, one
   thing at a time: say what it is for, then exact instructions (where to
   go, what to pick, what to paste), and wait for them before asking the
   next.
4. **Request every secret as a cred** (see [creds.md](creds.md)), with
   `--device`, since setup is for the whole machine: never ask for it in
   chat or read it from the environment. `splates creds wait <NAME>` until
   they save it.
5. **Check the step after each thing you or the user did**: `splates setup
   <step>`. While it is not `done`, say in a line what went wrong, its
   `problem` or what you saw, and the one next thing to try, not every one
   you can think of. Once it is `done`, say in one sentence what changed
   for the user, then name the next step from `next` in `splates setup
   --json`, by its title, or that nothing is left to set up. Then stop:
   never start the next step, or run anything of it, unasked. The page
   offers it.

When the user would rather not do a step, `splates setup <step> --skip`, which
`splates setup` lists as skipped until `--unskip`, and name the next step as
above. The page has no Skip: it still asks a skipped step when the user opens
its area.
A required step (`optional: false`) can be skipped too, but say first what
stops working without it, from `why`.

When the user wants an area taken back out, its creds forgotten and what it
made removed, that is its Undo on the Setup page, which the user presses: it
asks first, listing what goes, and for a box or tunnel has its name typed.
An area left partway has it too, on the index and on each of its pages, and
it takes out steps started but not finished, those whose cred is saved,
marked `started`.
Never undo one yourself, by its routes or by hand, as with `splates server
destroy`. `splates setup <area> --undo` prints what it would remove, the creds
it forgets and keeps, and what only the user can remove after, such as the
GitHub App itself or a token in a provider's dashboard: say that in a few
lines and send them to the page. When it is `refused`, say why, from its
reason.

## Remote access

When the user asks to reach `splates server` from elsewhere, that is the Remote
access setup area, from its `cloudflare-token` step through `tunnel`, `access`
and `ports-host`: walk them through it as
the steps at the top say. Its `splates tunnel setup
<host> --email <theirs>` makes the Cloudflare tunnel, its DNS record and its
Access application with an API token kept as the cred
`SPLATES_CLOUDFLARE_API_TOKEN`, and saves them for the machine, so a bare `splates
server` comes up tunneled. Without the token it requests it, with how to make
it, and exits `requested`: say so and wait as for any cred (see [creds.md](creds.md)), then
run it again. When the account has no Zero Trust organization, it asks for
`--team <name>` to make one. Ask the user for the host, the emails and any
team name rather than guessing them. By hand, or for a tunnel other than
cloudflared, it is `splates server --tunnel <host> --access-team <team>
--access-aud <aud>`: it runs `cloudflared tunnel run` against the page and
allows that host, and it refuses to start without both Access flags, since
who may enter is wholly the Cloudflare Access policy's call (`--tunnel-name`
picks a named tunnel). Never run a tunnel by hand with `--allow-hosts` and no
Access: that host then reaches only the tasks.

## Workers

When the user asks to run more agents at once on this Mac, that is the
Workers setup area: `local-worker` (`splates worker add --local <slots>`)
and `worker-access` (through a tunnel, whether the API token may mint a
made worker's Access service token, **Account · Access: Service Tokens ·
Edit**; `splates creds request SPLATES_CLOUDFLARE_API_TOKEN --device --replace`
for one that may not). Agents run only on this Mac: another machine runs
none, so there is no step to register one for agents. Walk them through it
as the steps at the top say. Each checks `GET /api/workers` of the
`splates server` in `SPLATES_DEV`.

A tunnel of their own is a `tunnel` in the repo's `splates.config.ts`, an object
implementing `TunnelProvider` from `@stringsync/splates-server/tunnel`:
`ready()` throws, saying what to do, unless the tunnel can run, and
`run({ host, url, log })` carries `host` to `url` and returns a resource
whose `disposeAsync()` stops it. Type the config with `satisfies ConfigFile`.
`--tunnel` runs it in place of cloudflared and still needs the Access flags;
`--tunnel-name` is refused beside it. Write one only when asked, as a
separate task from whatever else is under way, and read
splates's `tunnel/provider.ts` first. A provider that is not ready is
logged and skipped, so check the `splates server` log, not the page, to see
whether it came up.
