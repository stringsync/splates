import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration, sleep } from "webappwiz/time";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { rm } from "./rm";
import { Shell } from "./shell";
import { bails, repo, testConfig } from "./testing";
import { wait } from "./wait";
import { WorktreeService } from "./worktree-service";

/** Long enough that a test only reaches it when waiting is genuinely stuck. */
const PATIENT = { timeout: Duration.secs(5), poll: Duration.ms(5) };

describe("wait", () => {
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		git: Git;
		service: WorktreeService;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const git = new Git(fixture.root, { ps: fixture.ps, fs: fixture.fs });
		const service = new WorktreeService(git, config, fixture.arborDir, {
			fs: fixture.fs,
			ps: fixture.ps,
		});
		await service.init();
		deps = {
			...fixture,
			config,
			git,
			service,
			shell: new Shell({ ps: fixture.ps }),
		};
	});

	afterEach(() => deps.cleanup());

	it("returns with the reason once a task escalates while it waits", async () => {
		await add(deps, "alpha");
		deps.log.clear();

		const waiting = wait(deps, "alpha", PATIENT);
		await sleep(Duration.ms(20));
		await (await deps.service.find("alpha")).save({
			status: "escalated",
			escalations: [{ reason: "needs a human", at: new Date().toISOString() }],
		});
		await waiting;

		expect(deps.out()).toContain("escalated");
		expect(deps.out()).toContain("needs a human");
	});

	it("returns once nothing is left of the task", async () => {
		await add(deps, "alpha");
		await rm(deps, "alpha");
		deps.log.clear();

		await wait(deps, "alpha", PATIENT);

		expect(deps.out()).toContain("removed");
	});

	it("gives up on a task that keeps working", async () => {
		await add(deps, "alpha");

		const exit = await bails(
			wait(deps, "alpha", { timeout: Duration.ms(20), poll: Duration.ms(5) }),
		);

		expect(exit.reason).toBe("timeout");
		expect(exit.data).toMatchObject({ task: "alpha", status: "working" });
	});

	it("refuses a name nothing remembers", async () => {
		expect((await bails(wait(deps, "nope", PATIENT))).reason).toBe("not_found");
	});
});
