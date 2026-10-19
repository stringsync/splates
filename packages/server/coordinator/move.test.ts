import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import {
	CoordinatorMove,
	type CoordinatorMoveOptions,
	type MoveRepo,
} from "./move";

const HOME = "/Users/me/.splates";
const ROOT = "/Users/me/Projects/splates";
const DEV = "http://localhost:4310";
const HOST = "splates.example.com";
const BOX = {
	ipv4: "203.0.113.7",
	serverId: "42",
	serverType: "cpx21",
	location: "ash",
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
			stores: {
				device: new FakeSecretStore({
					SPLATES_TUNNEL_TOKEN: "tunnel",
				}),
				project: async () => new FakeSecretStore(),
			},
			version: "1.2.3",
			box: async () => BOX,
			tunnelHost: async () => HOST,
			repos: async () => [repo],
			here: `${ROOT}/packages`,
			dev: DEV,
			worker: "macbook",
			join: async (coordinator, token) => {
				joined.push(`${coordinator} ${token}`);
			},
			keepWorker: async (coordinator) => {
				kept.push(coordinator);
				return "dev.splates.worker";
			},
			fetch: net.fetch,
			pause: Duration.ms(1),
			now: () => new Date("2026-10-18T12:00:00Z"),
		};
	});

	it("says everything it lacks at once", async () => {
		const move = new CoordinatorMove({
			...opts,
			box: async () => null,
			tunnelHost: async () => null,
			repos: async () => [
				{ ...repo, remote: null },
				{ ...repo, slug: "web", url: "https://github.com/me/web.git" },
			],
		});

		const refused = await move.run().catch((error: Error) => error.message);

		expect(refused).toContain("splates server deploy");
		expect(refused).toContain("splates tunnel setup");
		expect(refused).toContain(
			`add \`remote: "origin"\` to ${ROOT}/splates.config.ts`,
		);
		expect(refused).toContain("web's origin is https://github.com/me/web.git");
		expect(ps.scripts).toEqual([]);
	});

	it("stops at the deploy keys GitHub does not let push yet, having changed nothing here", async () => {
		ps.clones = "key splates ssh-ed25519 AAAA splates-coordinator splates\n";

		const moved = await new CoordinatorMove(opts).run();

		expect(moved).toEqual({
			status: "keys",
			keys: [
				{
					slug: "splates",
					key: "ssh-ed25519 AAAA splates-coordinator splates",
					add: "https://github.com/me/splates/settings/keys/new",
				},
			],
		});
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

	it("brings the box to this release and restarts it once the coordinator runs there", async () => {
		ps.active = true;
		// A move put this machine's projects and tunnel aside.
		opts.repos = async () => [];
		opts.tunnelHost = async () => null;

		const moved = await new CoordinatorMove(opts).run();

		expect(moved).toEqual({
			status: "updated",
			ipv4: BOX.ipv4,
			version: opts.version,
		});
		expect(ps.scripts.some((each) => each.includes("bun add -g"))).toBe(true);
		expect(ps.scripts.at(-1)).toContain("systemctl restart");
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
		expect(ps.copied).toEqual(["/root/splates-move.tgz"]);
		const place = ps.scripts.find((each) => each.includes("tar -xzf"));
		expect(place).toContain("WorkingDirectory=/home/splates/projects/splates");
		expect(JSON.parse(ps.creds ?? "")).toEqual({
			device: { SPLATES_TUNNEL_TOKEN: "tunnel" },
			projects: {},
		});
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
	creds: string | undefined;
	clones = "ready splates\n";
	active = false;
	starts = true;

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
		if (script !== stdin) {
			this.creds = stdin;
		}
		this.scripts.push(script);
		if (script.includes("push --dry-run")) {
			return ok(this.clones);
		}
		if (script.includes("is-active")) {
			return ok(this.active ? "active\n" : "inactive\n");
		}
		if (script.includes("/api/workers/invite")) {
			return ok(JSON.stringify({ token: "join-token", expiresAt: 0 }));
		}
		if (script.includes("enable --now") && !this.starts) {
			return { exitCode: 1, stdout: "", stderr: "did not answer" };
		}
		return ok();
	}
}

/** This machine's server, up until its checkpoint stops it, and the tunnel's host. */
function fakeNet(): FakeNet {
	const posted: unknown[] = [];
	let up = true;
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
		return new Response(null, { status: 302 });
	}) as typeof fetch;
	return { posted, fetch: answer };
}

interface FakeNet {
	/** The bodies posted to this machine's server. */
	posted: unknown[];
	fetch: typeof fetch;
}
