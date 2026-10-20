import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { OPENCODE_AREA, OPENCODE_GO_KEY } from "./area-opencode";
import { OpenCodeSetup } from "./opencode";
import { Setup, type StepStatus } from "./setup";
import { OpenCodeFixturePs } from "./testing";

const HOME = "/home/.splates";
const MODELS = {
	model: "opencode-go/Main",
	auxiliary: "opencode-go/Small",
	balanceOff: true,
};

describe("OPENCODE_AREA", () => {
	let fs: FakeFs;
	let ps: OpenCodeFixturePs;
	let device: FakeSecretStore;
	let setup: Setup;
	let opencode: OpenCodeSetup;
	let rosters: number;
	const statuses = async (): Promise<Record<string, StepStatus>> =>
		Object.fromEntries(
			((await setup.read()).areas[0]?.steps ?? []).map((step) => [
				step.id,
				step.status,
			]),
		);
	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir(HOME, { recursive: true });
		ps = new OpenCodeFixturePs();
		device = new FakeSecretStore();
		rosters = 0;
		opencode = new OpenCodeSetup({
			fs,
			ps,
			home: HOME,
			roster: async () => {
				rosters++;
			},
		});
		setup = new Setup({ fs, home: HOME, device, opencode }, [OPENCODE_AREA]);
	});

	it("reads an installed OpenCode done on a fresh read, with no Check again", async () => {
		expect((await statuses())["opencode-install"]).toBe("done");
		ps.installed = false;
		expect((await statuses())["opencode-install"]).toBe("ready");
	});

	it("installs OpenCode with npm on Next, and says so when npm fails", async () => {
		ps.installed = false;
		ps.installs = false;
		await expect(setup.submit("opencode-install", {})).rejects.toThrow(
			"npm could not install OpenCode",
		);

		ps.installs = true;
		await setup.submit("opencode-install", {});

		expect((await statuses())["opencode-install"]).toBe("done");
	});

	it("types the kept key at OpenCode's login prompt, never in argv", async () => {
		ps.connected = false;
		await device.set(OPENCODE_GO_KEY, "go-secret");

		await setup.submit("opencode-connect", {});

		expect(ps.keys).toEqual(["go-secret"]);
		expect(JSON.stringify(ps.commands)).not.toContain("go-secret");
		expect(ps.requests).toEqual(["initialize"]);
		expect((await statuses())["opencode-connect"]).toBe("done");
	});

	it("leaves OpenCode's own Go key be when it lists one", async () => {
		await device.set(OPENCODE_GO_KEY, "go-secret");

		await setup.submit("opencode-connect", {});

		expect(ps.keys).toEqual([]);
	});

	it("asks for the key until it is kept", async () => {
		await expect(setup.submit("opencode-connect", {})).rejects.toThrow(
			"Paste the OpenCode Go API key first.",
		);
		expect((await statuses())["opencode-connect"]).toBe("ready");
	});

	it("lists the Go catalog as each model's choices", async () => {
		await device.set(OPENCODE_GO_KEY, "go-secret");
		const models = (await setup.read()).areas[0]?.steps[2]?.fields;

		expect(models?.[0]).toMatchObject({
			kind: "choice",
			options: [
				{ value: "opencode-go/Main", label: "Main" },
				{ value: "opencode-go/Small", label: "Small" },
			],
		});
	});

	it("saves the models only once Use balance is said to be off", async () => {
		await device.set(OPENCODE_GO_KEY, "go-secret");
		await expect(
			setup.submit("opencode-models", { ...MODELS, balanceOff: false }),
		).rejects.toThrow("Turn Use balance off");
		expect(await fs.exists(`${HOME}/agents.json`)).toBe(false);

		await setup.submit("opencode-models", MODELS);

		expect((await statuses())["opencode-models"]).toBe("done");
		expect(rosters).toBe(1);
	});

	it("says what overrides the models when OpenCode's own config does", async () => {
		await device.set(OPENCODE_GO_KEY, "go-secret");
		ps.conflict = true;

		await expect(setup.submit("opencode-models", MODELS)).rejects.toThrow(
			"override this setup",
		);
	});

	it("reads ready once checked, and not once the roster changes", async () => {
		await device.set(OPENCODE_GO_KEY, "go-secret");
		await setup.submit("opencode-models", MODELS);
		expect((await statuses())["opencode-ready"]).toBe("ready");

		await setup.submit("opencode-ready", {});
		expect((await statuses())["opencode-ready"]).toBe("done");

		await fs.write(
			`${HOME}/agents.json`,
			`${await fs.read(`${HOME}/agents.json`)} `,
		);
		expect((await statuses())["opencode-ready"]).toBe("done");
		const roster = JSON.parse(await fs.read(`${HOME}/agents.json`));
		await fs.write(
			`${HOME}/agents.json`,
			JSON.stringify({ ...roster, extra: "changed" }),
		);
		expect((await statuses())["opencode-ready"]).toBe("ready");
	});

	it("undoes by taking OpenCode off the roster and forgetting the key, leaving the install and its login", async () => {
		await device.set(OPENCODE_GO_KEY, "go-secret");
		await setup.submit("opencode-models", MODELS);
		await setup.submit("opencode-ready", {});

		expect((await setup.undoPlan("opencode")).steps).toEqual([
			{
				id: "opencode-ready",
				title: "Check OpenCode",
				done: true,
				removes: [],
				leaves: [],
			},
			{
				id: "opencode-models",
				title: "Choose your models",
				done: true,
				removes: [
					`OpenCode on the roster in \`${HOME}/agents.json\`, running opencode-go/Main and opencode-go/Small`,
				],
				leaves: [],
			},
			{
				id: "opencode-connect",
				title: "Paste your OpenCode Go API key",
				done: true,
				removes: ["The OpenCode Go API key kept on this device"],
				leaves: [
					"OpenCode keeps its own copy of the key: run `opencode auth logout` and pick OpenCode Go to remove it.",
					"The key still works: delete it in the [OpenCode Console](https://opencode.ai/auth) if you no longer want it.",
				],
			},
			{
				id: "opencode-install",
				title: "Install OpenCode",
				done: true,
				removes: [],
				leaves: [
					"OpenCode stays installed: run `npm uninstall --global @opencode/cli` to remove it.",
				],
			},
		]);
		await setup.undo("opencode", null);

		expect(await statuses()).toEqual({
			"opencode-install": "done",
			"opencode-connect": "ready",
			"opencode-models": "waiting",
			"opencode-ready": "waiting",
		});
		expect(await device.get(OPENCODE_GO_KEY)).toBeUndefined();
		const saved = JSON.parse(await fs.read(`${HOME}/agents.json`));
		expect(
			saved.agents.some((agent: { id: string }) => agent.id === "opencode"),
		).toBe(false);
		await OPENCODE_AREA.steps[2]?.undo?.run({
			fs,
			home: HOME,
			device,
			opencode,
		});
		expect(JSON.parse(await fs.read(`${HOME}/agents.json`))).toEqual(saved);
		expect(ps.commands.map((each) => each.argv[0])).not.toContain("npm");
	});

	it("fails the check when a saved model is no longer listed", async () => {
		await device.set(OPENCODE_GO_KEY, "go-secret");
		await setup.submit("opencode-models", MODELS);
		ps.unavailable = true;

		await expect(setup.submit("opencode-ready", {})).rejects.toThrow(
			"no longer listed",
		);
	});
});
