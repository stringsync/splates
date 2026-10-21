import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import {
	CoordinatorMove,
	type CoordinatorMoveOptions,
	type MoveRepo,
	moveRecord,
} from "./move";

const HOME = "/Users/me/.splates";
const ROOT = "/Users/me/Projects/splates";
const DEV = "http://localhost:4310";
const HOST = "splates.example.com";
const BOX = {
	ipv4: "203.0.113.7",
	instanceId: "i-0abc",
	roleName: "splates-role",
	host: HOST,
	key: `${HOME}/coordinator/id_ed25519`,
};

describe("CoordinatorMove", () => {
	let fs: FakeFs;
	let ps: SshPs;
	let net: FakeNet;
	let repo: MoveRepo;
	let pushed: string[];
	let joined: string[];
	let kept: string[];
	let opts: CoordinatorMoveOptions;

	beforeEach(async () => {
		fs = new FakeFs();
		const write = fs.write.bind(fs);
		fs.write = async (path, data) => {
			await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
			await write(path, data);
		};
		ps = new SshPs();
		net = fakeNet();
		pushed = [];
		joined = [];
		kept = [];
		await fs.write(
			`${HOME}/projects.json`,
			JSON.stringify({ format: 1, projects: [{ root: ROOT }] }),
		);
		await fs.write(`${HOME}/slots.json`, "{}");
		await fs.write(`${ROOT}/.git/splates/format`, "3");
		repo = {
			slug: "splates",
			root: ROOT,
			remote: "origin",
			url: "git@github.com:me/splates.git",
			trunk: "main",
			worktreeRoot: `${ROOT}-splates.noindex`,
			pushTasks: async () => {
				pushed.push("fix");
				return [
					{ task: "fix", pushed: { status: "pushed", branch: "splates/fix" } },
				];
			},
		};
		opts = {
			ps,
			fs,
			log: new MemoryLogger(),
			home: HOME,
			version: "1.2.3",
			box: async () => BOX,
			repos: async () => [repo],
			here: `${ROOT}/packages`,
			dev: DEV,
			worker: "macbook",
			workersWithout: async () => ({
				ok: true,
				said: "with this machine off, the box makes workers with AWS",
			}),
			join: async (coordinator, token) => {
				joined.push(`${coordinator} ${token}`);
			},
			keepWorker: async (coordinator) => {
				kept.push(coordinator);
				return "dev.splates.worker";
			},
			fetch: net.fetch,
			pause: Duration.ms(1),
			servedWithin: Duration.ms(20),
			now: () => new Date("2026-10-18T12:00:00Z"),
		};
	});

	it("says everything it lacks at once", async () => {
		const move = new CoordinatorMove({
			...opts,
			box: async () => null,
			repos: async () => [
				{ ...repo, remote: null },
				{ ...repo, slug: "web", url: "https://github.com/me/web.git" },
			],
		});

		const refused = await move.run().catch((error: Error) => error.message);

		expect(refused).toContain("pulumi up");
		expect(refused).toContain(`unless ${ROOT}/splates.config.ts sets`);
		expect(refused).toContain("web's origin is https://github.com/me/web.git");
		expect(ps.scripts).toEqual([]);
	});

	it("stops, having changed nothing here, while the box's Parameter Store lacks creds", async () => {
		ps.needs = "/splates/device/SPLATES_TUNNEL_TOKEN\n";

		const moved = await new CoordinatorMove(opts).run();

		expect(moved).toEqual({
			status: "blocked",
			needs: ["/splates/device/SPLATES_TUNNEL_TOKEN"],
		});
		expect(ps.scripts.some((each) => each.includes("push --dry-run"))).toBe(
			false,
		);
		expect(net.posted).toEqual([]);
		expect(await fs.exists(`${ROOT}/.git/splates`)).toBe(true);
	});

	it("refuses, having changed nothing here, a project the box's deploy key cannot push", async () => {
		ps.clones = "refused splates\n";

		const refused = await new CoordinatorMove(opts)
			.run()
			.catch((error: Error) => error.message);

		expect(refused).toContain("cannot clone or push trunk of splates");
		expect(net.posted).toEqual([]);
		expect(await fs.exists(`${ROOT}/.git/splates`)).toBe(true);
	});

	it("stops before this machine's server on a dry run", async () => {
		const moved = await new CoordinatorMove(opts).run({ dryRun: true });

		expect(moved).toEqual({
			status: "ready",
			host: HOST,
			projects: ["splates"],
		});
		expect(net.posted).toEqual([]);
		expect(ps.copied).toEqual([]);
	});

	it("says, before anything changes, that nothing runs agents with this machine off", async () => {
		const log = new MemoryLogger();
		const warning =
			"with this machine off, nothing runs agents, so the box needs it up: no `workerProvider`";

		await new CoordinatorMove({
			...opts,
			log,
			workersWithout: async () => ({ ok: false, said: warning }),
		}).run({ dryRun: true });

		expect(log.entries[0]?.message).toBe(warning);
	});

	it("brings the box to this release and restarts it once the coordinator runs there", async () => {
		ps.active = true;
		// A move put this machine's projects and tunnel aside.
		opts.repos = async () => [];

		const moved = await new CoordinatorMove(opts).run();

		expect(moved).toEqual({
			status: "updated",
			ipv4: BOX.ipv4,
			version: opts.version,
		});
		expect(ps.scripts.some((each) => each.includes("bun add -g"))).toBe(true);
		expect(ps.scripts.at(-1)).toContain("systemctl restart");
		// The unit, helper script and cloudflared are refreshed before the restart.
		const refreshed = ps.scripts.findIndex((each) =>
			each.includes("systemctl daemon-reload"),
		);
		expect(refreshed).toBeGreaterThan(-1);
		expect(ps.scripts[refreshed]).toContain("cloudflared.deb");
		expect(refreshed).toBeLessThan(ps.scripts.length - 1);
		expect(net.posted).toEqual([]);
		expect(ps.copied).toEqual([]);
		expect(joined).toEqual([]);
	});

	it("changes nothing on a dry run once the coordinator runs on the box", async () => {
		ps.active = true;

		const moved = await new CoordinatorMove(opts).run({ dryRun: true });

		expect(moved).toEqual({
			status: "deployed",
			ipv4: BOX.ipv4,
			version: opts.version,
		});
		expect(ps.scripts.every((each) => each.includes("is-active"))).toBe(true);
	});

	it("checkpoints and stops this machine's server, carries it over, and joins this machine as its worker", async () => {
		const moved = await new CoordinatorMove(opts).run();

		expect(moved).toEqual({
			status: "moved",
			host: HOST,
			aside: `${HOME}/moved-2026-10-18T12-00-00-000Z`,
			worker: "dev.splates.worker",
		});
		expect(net.posted).toEqual([{ projects: ["splates"], after: "shutdown" }]);
		expect(pushed).toEqual(["fix"]);
		const place = ps.scripts.find((each) => each.includes("tar -xzf"));
		expect(place).toContain("WorkingDirectory=/home/splates/projects/splates");
		// No creds go: the box reads its own through its instance role.
		expect(ps.scripts.some((each) => each.includes("keep-creds"))).toBe(false);
		expect(ps.copied).toEqual(["/root/splates-move.tgz"]);
		expect(ps.scripts.some((each) => each.includes("enable --now"))).toBe(true);
		expect(joined).toEqual([`https://${HOST} join-token`]);
		expect(kept).toEqual([`https://${HOST}`]);
		// Its own records go aside, kept, but for what stays this machine's.
		expect(await fs.exists(`${ROOT}/.git/splates`)).toBe(false);
		expect(await fs.exists(`${ROOT}/.git/splates.moved/format`)).toBe(true);
		expect(
			await fs.exists(
				`${moved.status === "moved" ? moved.aside : ""}/projects.json`,
			),
		).toBe(true);
		expect(await fs.exists(`${HOME}/slots.json`)).toBe(true);
		expect(await fs.exists(`${HOME}/move`)).toBe(false);
		expect(await moveRecord(fs, HOME)).toEqual({
			host: HOST,
			stamp: "2026-10-18T12-00-00-000Z",
			roots: [ROOT],
			finished: true,
		});
	});

	it("passes Access with the invite's service token to find the box's server through the tunnel", async () => {
		ps.access = { clientId: "id", clientSecret: "secret" };

		await new CoordinatorMove(opts).run();

		expect(net.joins.at(-1)).toEqual({
			"cf-access-client-id": "id",
			"cf-access-client-secret": "secret",
		});
	});

	it("takes the box's server down again while the tunnel's host answers only Access's sign-in", async () => {
		net.served = false;

		const refused = await new CoordinatorMove(opts)
			.run()
			.catch((error: Error) => error.message);

		expect(refused).toContain(`${HOST} does not reach splates server`);
		expect(refused).toContain("last 302");
		expect(ps.withdrawn).toEqual([JSON.stringify({ token: "join-token" })]);
		expect(ps.scripts.at(-1)).toContain("systemctl disable --now");
		expect(await fs.exists(`${ROOT}/.git/splates/format`)).toBe(true);
		expect(await moveRecord(fs, HOME)).toBeNull();
	});

	it("mints the worker's invite before anything here goes aside, taking the box down when it cannot", async () => {
		ps.invites = false;

		const refused = await new CoordinatorMove(opts)
			.run()
			.catch((error: Error) => error.message);

		expect(refused).toContain("could not mint");
		expect(ps.withdrawn).toEqual([]);
		expect(refused).toContain("start `splates server` on this machine again");
		expect(ps.scripts.at(-1)).toContain("systemctl disable --now");
		expect(await fs.exists(`${ROOT}/.git/splates/format`)).toBe(true);
		expect(await fs.exists(`${HOME}/projects.json`)).toBe(true);
		expect(await moveRecord(fs, HOME)).toBeNull();
	});

	/** The deploy after one that failed: the box runs, this machine's projects and tunnel are aside. */
	const again = () => {
		ps.active = true;
		opts.repos = async () => [];
		return new CoordinatorMove(opts).run();
	};

	it("finishes the join on the next deploy when it failed", async () => {
		const join = opts.join;
		opts.join = async () => {
			throw new Error("the coordinator did not let this worker join");
		};
		const refused = await new CoordinatorMove(opts)
			.run()
			.catch((error: Error) => error.message);
		expect(refused).toContain("did not let this worker join");
		expect(refused).toContain(
			"`splates server deploy` again finishes the move",
		);
		expect(await fs.exists(`${ROOT}/.git/splates`)).toBe(false);
		expect((await moveRecord(fs, HOME))?.finished).toBe(false);
		opts.join = join;

		const moved = await again();

		expect(moved).toEqual({
			status: "moved",
			host: HOST,
			aside: `${HOME}/moved-2026-10-18T12-00-00-000Z`,
			worker: "dev.splates.worker",
		});
		expect(ps.scripts.some((each) => each.includes("systemctl restart"))).toBe(
			true,
		);
		expect(joined).toEqual([`https://${HOST} join-token`]);
		expect(kept).toEqual([`https://${HOST}`]);
		expect((await moveRecord(fs, HOME))?.finished).toBe(true);
	});

	it("finishes the LaunchAgent on the next deploy when it failed", async () => {
		const keepWorker = opts.keepWorker;
		opts.keepWorker = async () => {
			throw new Error("launchctl could not load it");
		};
		await new CoordinatorMove(opts).run().catch(() => {});
		opts.keepWorker = keepWorker;

		const moved = await again();

		expect(moved.status).toBe("moved");
		expect(joined).toHaveLength(2);
		expect(kept).toEqual([`https://${HOST}`]);
		expect((await moveRecord(fs, HOME))?.finished).toBe(true);
	});

	it("only updates on the deploy after one that finished", async () => {
		await new CoordinatorMove(opts).run();

		const moved = await again();

		expect(moved.status).toBe("updated");
		expect(joined).toHaveLength(1);
	});

	it("takes the box's server down again when it does not come up, leaving this machine's records", async () => {
		ps.starts = false;

		const refused = await new CoordinatorMove(opts)
			.run()
			.catch((error: Error) => error.message);

		expect(refused).toContain("start `splates server` on this machine again");
		expect(ps.scripts.at(-1)).toContain("systemctl disable --now");
		expect(await fs.exists(`${ROOT}/.git/splates/format`)).toBe(true);
		expect(await fs.exists(`${HOME}/projects.json`)).toBe(true);
		expect(joined).toEqual([]);
	});
});

/** The box over ssh and scp, and tar, remembering what each was given. */
class SshPs extends FakePs {
	readonly scripts: string[] = [];
	readonly copied: string[] = [];
	needs = "";
	clones = "ready splates\n";
	active = false;
	starts = true;
	invites = true;
	/** What each withdrawal of an invite was sent. */
	readonly withdrawn: string[] = [];
	/** The service token each invite carries, when Access stands in front. */
	access: { clientId: string; clientSecret: string } | null = null;

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
		const [bin] = argv;
		if (bin === "scp") {
			this.copied.push(argv.at(-1)?.split(":")[1] ?? "");
			return ok();
		}
		if (bin !== "ssh") {
			return ok();
		}
		const stdin = opts?.stdin ?? "";
		const script = argv.at(-2) === "-c" ? (argv.at(-1) ?? "") : stdin;
		this.scripts.push(script);
		if (script.includes("server needs")) {
			return ok(this.needs);
		}
		if (script.includes("push --dry-run")) {
			return ok(this.clones);
		}
		if (script.includes("is-active")) {
			return ok(this.active ? "active\n" : "inactive\n");
		}
		if (script.includes("-X DELETE")) {
			this.withdrawn.push(stdin);
			return ok();
		}
		if (script.includes("/api/workers/invite")) {
			if (!this.invites) {
				return {
					exitCode: 22,
					stdout: "",
					stderr: "could not mint the worker a Cloudflare Access service token",
				};
			}
			const carried =
				this.access === null
					? ""
					: `.${Buffer.from(`${this.access.clientId}\n${this.access.clientSecret}`).toString("base64url")}`;
			return ok(
				JSON.stringify({ token: `join-token${carried}`, expiresAt: 0 }),
			);
		}
		if (script.includes("enable --now") && !this.starts) {
			return { exitCode: 1, stdout: "", stderr: "did not answer" };
		}
		return ok();
	}
}

/**
 * This machine's server, up until its checkpoint stops it, and the
 * tunnel's host, which refuses an empty join once it reaches the box's
 * server and answers Access's sign-in until then.
 */
function fakeNet(): FakeNet {
	const posted: unknown[] = [];
	const joins: Record<string, string>[] = [];
	let up = true;
	const net: FakeNet = { posted, joins, served: true, fetch: fetch };
	const answer = (async (input: string | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		if (url.origin === DEV) {
			if (!up) {
				throw new Error("connection refused");
			}
			if (init?.method === "POST") {
				posted.push(JSON.parse(String(init.body)));
				up = false;
			}
			return new Response("{}");
		}
		if (net.served && url.pathname === "/api/workers/join") {
			const headers = new Headers(init?.headers);
			joins.push(
				Object.fromEntries(
					[...headers].filter(([name]) => name.startsWith("cf-access")),
				),
			);
			return Response.json(
				{ reason: "usage", message: "send the join token" },
				{ status: 400 },
			);
		}
		return new Response(null, { status: 302 });
	}) as typeof fetch;
	net.fetch = answer;
	return net;
}

interface FakeNet {
	/** The bodies posted to this machine's server. */
	posted: unknown[];
	/** The Access headers each empty join through the tunnel carried. */
	joins: Record<string, string>[];
	/** Whether the tunnel's host reaches the box's server. */
	served: boolean;
	fetch: typeof fetch;
}
