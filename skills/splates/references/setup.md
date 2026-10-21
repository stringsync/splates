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

When the user asks to run agents on this Mac with more slots, or on another
machine, that is the Workers setup area: `local-worker` (`splates worker add
--local <slots>`), `worker-access` (through a tunnel, whether the API token
may mint a worker's Access service token, **Account · Access: Service Tokens ·
Edit**; `splates creds request SPLATES_CLOUDFLARE_API_TOKEN --device --replace`
for one that may not) and `remote-worker` (`splates worker add`, then `splates
worker run --server <url> --join <token>` on the other machine),
`windows-worker` (the Windows command `splates worker add` prints, run in
PowerShell as an administrator there: the worker in a WSL2 distro of its own,
started at each boot, shown as `linux (wsl2)`) and `wake-on-lan` (Wake-on-LAN
on in its BIOS and adapter, so splates wakes it when agents queue, before
making a worker; `splates worker wake <id>` wakes one by hand). Workers
in their own AWS account start with `cloud-provider`
(a task adding the `cloud` the step shows, `new AwsCloud()`, from `@stringsync/splates-server/cloud`, to
`splates.config.ts`) and
`worker-snapshot` (builds the snapshot workers boot from); and, only when
`splates.config.ts` names a `cloud` or a `workerProvider`, `worker-budget` (what made
workers may cost: `splates budget set <hour|day|month> <dollars>`; any set counts
as the user having seen it). Walk them
through it as the steps at the top say. Each checks
`GET /api/workers` of the `splates server` in `SPLATES_DEV`.

When the user asks for an always-on server, that is the Cloud server setup
area, the AWS path, each step checked from real state: `coordinator-pulumi`
(Pulumi installed and logged in to Pulumi Cloud or an S3 backend of the
user's own; done when `pulumi whoami` answers), `coordinator-access` (how
`pulumi up` and splates sign in to AWS with no long-lived key: the user pastes
the page's line into AWS CloudShell, which makes the role `splates-pulumi`
and prints the account id, then gives the page the id, whose Next makes the
Pulumi ESC environment `<org>/splates/aws` and has the infra stack import it;
an AWS profile the fallback; done when either signs in, and then the user
deletes any root access keys),
`coordinator-infra` (`splates server infra init <dir>` has written the project,
filled from the projects, tunnel and creds splates keeps, requesting any cred
not kept, and `~/.splates/coordinator/infra.json` names it), `coordinator-remotes`,
`coordinator-up` (the page shows `pulumi preview` and the monthly cost, and Next runs `pulumi up --yes`; done when `pulumi stack output
--json` gives the instance id and tunnel host) and `coordinator-creds`, then
`coordinator-move`. Undoing the AWS steps guides the user through `pulumi
destroy`; splates never destroys the stack itself. The box is an EC2
instance with daily backups, SSH alone open, its key under `~/.splates/coordinator`.
The move needs
`remote` set in every project's `splates.config.ts` and an SSH origin (the
`coordinator-remotes` step): the box reads a deploy key per project from its Parameter
Store, and until each is set and GitHub lets it push trunk the deploy exits `blocked`,
naming each cred the box lacks; show the user those with their `pulumi config set
--secret` line, and run it again once set (`coordinator-creds`'s Next runs `pulumi up` itself
after a blocked dry run). `--dry-run` stops there, the
box ready. Run for real (`coordinator-move`), it checkpoints every agent and
stops this machine's `splates server`, carries the records over,
starts the server on the box under systemd on a host of its own (`infra init`
defaults it to `box.` before the saved tunnel's host), then takes the saved
tunnel's host over: it deletes this Mac's DNS record and Access application
there (a gap of minutes), sets the stack's `splates:host` to it and runs
`pulumi up`, and has the box serve it, so the user's URL stays the same. This
machine then joins there as a worker kept up by a LaunchAgent, where each task
carries on in its worktree; this machine's records go aside, kept, and its old
tunnel is left in Cloudflare for the user to delete. It touches the user's
live server and tunnel: ask before running it for real, and run it from a
terminal outside `splates server`, which it stops, or leave it to the step's
Next on the page, which runs it apart from the server and follows it onto the
box's host. Once the server runs on the box, `splates server deploy` again
brings the box's splates to the running release and restarts it there, the
way to update it; this machine's worker updates itself. `splates server status` says where the server runs and the box's
address, `splates server ssh` opens a shell on the box, and `splates server
destroy` destroys it and its backups.

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
