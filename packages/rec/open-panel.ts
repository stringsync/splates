import { Duration, sleep } from "core/time";
import type { Cdp } from "./cdp";

/** Clicks rec's open page so the extension may open the side panel, then sends the tab on to the working url. */
export async function openSidePanel(
	cdp: Cdp,
	where: {
		extensionId: string;
		/** The server's origin, where the open page is served. */
		origin: string;
		openUrl: string;
		workingUrl: string;
	},
): Promise<void> {
	const { extensionId: id, origin, openUrl, workingUrl } = where;
	const targets = async () =>
		(
			await cdp.send<{
				targetInfos: { targetId: string; type: string; url: string }[];
			}>("Target.getTargets")
		).targetInfos;
	const page = (await targets()).find(
		(info) =>
			info.type === "page" && info.url.startsWith(`${origin}/__rec/open`),
	);
	if (!page) {
		throw new Error("rec's open page is not in Chrome");
	}
	const { sessionId } = await cdp.send<{ sessionId: string }>(
		"Target.attachToTarget",
		{ targetId: page.targetId, flatten: true },
	);
	// The extension loaded after this page did, so its content script needs a fresh load.
	await cdp.send("Page.enable", {}, sessionId);
	await cdp.send("Page.navigate", { url: openUrl }, sessionId);
	// A background page is not focused, and a press on it is no user gesture.
	await cdp.send("Page.bringToFront", {}, sessionId);
	await sleep(Duration.ms(500));
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp.send(
			"Input.dispatchMouseEvent",
			{
				type,
				x: 20,
				y: 20,
				button: "left",
				buttons: type === "mousePressed" ? 1 : 0,
				clickCount: 1,
			},
			sessionId,
		);
	}
	const panel = `chrome-extension://${id}/panel.html`;
	for (let tries = 0; tries < 100; tries++) {
		if ((await targets()).some((info) => info.url.startsWith(panel))) {
			await cdp.send("Page.navigate", { url: workingUrl }, sessionId);
			return;
		}
		await sleep(Duration.ms(100));
	}
	throw new Error("Chrome did not open rec's side panel");
}
