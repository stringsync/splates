import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "core/creds/testing";
import { APP_ID, APP_KEY } from "../merge";
import { GitHubAppManifest } from "./github-app-manifest";

const ORIGIN = "http://localhost:4000";

function setup(convert: Response = Response.json({ id: 7, pem: "PEM" })) {
	const device = new FakeSecretStore();
	const asked: string[] = [];
	const manifest = new GitHubAppManifest(device, {
		fetch: (async (url: string) => {
			asked.push(url);
			return convert.clone();
		}) as unknown as typeof fetch,
	});
	return { device, asked, manifest };
}

async function started(manifest: GitHubAppManifest) {
	const response = await manifest.start(
		new Request(`${ORIGIN}/api/setup/github-app/manifest`),
	);
	return (await response.json()) as { url: string; manifest: string };
}

describe("GitHubAppManifest", () => {
	it("asks for contents alone, returning to this server", async () => {
		const { manifest } = setup();

		const body = await started(manifest);

		expect(JSON.parse(body.manifest)).toMatchObject({
			redirect_url: `${ORIGIN}/api/setup/github-app/callback`,
			public: false,
			default_permissions: { contents: "write" },
		});
		expect(body.url).toStartWith("https://github.com/settings/apps/new?state=");
	});

	it("keeps the App GitHub hands over and returns to its step", async () => {
		const { manifest, device, asked } = setup();
		const state = new URL((await started(manifest)).url).searchParams.get(
			"state",
		);

		const response = await manifest.callback(
			new Request(`${ORIGIN}/cb?code=abc&state=${state}`),
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/#setup/github/github-app");
		expect(asked).toEqual([
			"https://api.github.com/app-manifests/abc/conversions",
		]);
		expect(await device.get(APP_ID)).toBe("7");
		expect(await device.get(APP_KEY)).toBe("PEM");
	});

	it("refuses a state it did not hand out, or hands out twice", async () => {
		const { manifest, device } = setup();
		const state = new URL((await started(manifest)).url).searchParams.get(
			"state",
		);

		const forged = await manifest.callback(
			new Request(`${ORIGIN}/cb?code=abc&state=nope`),
		);
		await manifest.callback(
			new Request(`${ORIGIN}/cb?code=abc&state=${state}`),
		);
		const again = await manifest.callback(
			new Request(`${ORIGIN}/cb?code=abc&state=${state}`),
		);

		expect(forged.status).toBe(400);
		expect(again.status).toBe(400);
		expect(await device.get(APP_ID)).toBe("7");
	});

	it("keeps nothing when GitHub will not convert the code", async () => {
		const { manifest, device } = setup(new Response("no", { status: 404 }));
		const state = new URL((await started(manifest)).url).searchParams.get(
			"state",
		);

		const response = await manifest.callback(
			new Request(`${ORIGIN}/cb?code=abc&state=${state}`),
		);

		expect(response.status).toBe(502);
		expect(await device.get(APP_ID)).toBeUndefined();
	});
});
