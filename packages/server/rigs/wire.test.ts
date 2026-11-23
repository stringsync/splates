import { describe, expect, it } from "bun:test";
import { parseReportedUrl, rigHostLabel } from "./exposure";
import { optionValues, portEnv, startWords } from "./start";
import { DESCRIBED, RIG } from "./wire";

const rig = RIG.parse({
	name: "app",
	label: "App",
	ports: ["web", "mock-api"],
	health: { http: "/healthz", port: "mock-api" },
	options: [
		{
			name: "model",
			type: "enum",
			values: ["small", "large"],
			default: "small",
		},
		{ name: "debug", type: "boolean", default: false },
		{ name: "seed", type: "number", default: 1 },
	],
});

describe("the rig protocol", () => {
	it("fills each option the start leaves out with its default", () => {
		expect(optionValues(rig, { debug: true })).toEqual({
			model: "small",
			debug: true,
			seed: 1,
		});
	});

	it("refuses an option the rig lacks, or a value of the wrong type", () => {
		expect(() => optionValues(rig, { color: "red" })).toThrow(
			'app has no option "color"',
		);
		expect(() => optionValues(rig, { model: "huge" })).toThrow(
			"takes small | large",
		);
		expect(() => optionValues(rig, { seed: "2" })).toThrow("takes a number");
	});

	it("starts a rig with each option as a flag", () => {
		expect(startWords(rig, optionValues(rig, {}))).toEqual([
			"start",
			"app",
			"--model=small",
			"--debug=false",
			"--seed=1",
		]);
	});

	it("passes each port as PORT_<NAME>, and the first as PORT too", () => {
		expect(portEnv(rig, { web: 5173, "mock-api": 5174 })).toEqual({
			PORT: "5173",
			PORT_WEB: "5173",
			PORT_MOCK_API: "5174",
		});
	});

	it("refuses a describe naming a rig, port or option twice, or a health port it lacks", () => {
		const twice = DESCRIBED.safeParse({
			name: "x",
			rigs: [
				{ name: "a", label: "A" },
				{ name: "a", label: "A" },
			],
		});
		expect(twice.error?.issues[0]?.message).toBe('rig "a" twice');
		const port = RIG.safeParse({
			name: "a",
			label: "A",
			health: { http: "/", port: "api" },
		});
		expect(port.error?.issues[0]?.message).toContain('port "api"');
		const enumDefault = RIG.safeParse({
			name: "a",
			label: "A",
			options: [{ name: "m", type: "enum", values: ["x"], default: "y" }],
		});
		expect(enumDefault.success).toBe(false);
	});

	it("defaults exposure to tunnel and validates tunnel, none, and self", () => {
		expect(RIG.parse({ name: "a", label: "A" }).exposure).toBe("tunnel");
		expect(
			RIG.parse({ name: "a", label: "A", exposure: "none" }).exposure,
		).toBe("none");
		expect(
			RIG.parse({ name: "a", label: "A", exposure: "self" }).exposure,
		).toBe("self");
		expect(
			RIG.safeParse({ name: "a", label: "A", exposure: "other" }).success,
		).toBe(false);
	});

	it("parses splates:url stdout lines for main and named ports", () => {
		expect(
			parseReportedUrl("splates:url https://app.example.com", ["web", "api"]),
		).toEqual({ port: "web", url: "https://app.example.com" });
		expect(
			parseReportedUrl("splates:url api https://api.example.com/v1", [
				"web",
				"api",
			]),
		).toEqual({ port: "api", url: "https://api.example.com/v1" });
		expect(
			parseReportedUrl(
				"\x1b[32msplates:url https://colored.example.com\x1b[0m",
				["web"],
			),
		).toEqual({ port: "web", url: "https://colored.example.com" });
		expect(
			parseReportedUrl("splates:url unknown https://x.example.com", ["web"]),
		).toBeNull();
		expect(
			parseReportedUrl("splates:url javascript:alert(1)", ["web"]),
		).toBeNull();
		expect(
			parseReportedUrl("listening on http://localhost:3000", ["web"]),
		).toBeNull();
	});

	it("forms animal-slot subdomain labels for main and secondary ports", () => {
		expect(rigHostLabel("cat", "web", true)).toBe("cat");
		expect(rigHostLabel("cat", "mock-api", false)).toBe("cat-mock-api");
	});
});
