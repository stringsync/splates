import { beforeEach, describe, expect, it } from "bun:test";
import { followAppearance } from "./appearance";
import { Settings } from "./settings";
import "./testing";

/** A device whose color scheme the test flips. */
const device = () => {
	const media = new EventTarget() as EventTarget & { matches: boolean };
	media.matches = false;
	return {
		media: media as unknown as MediaQueryList,
		set(dark: boolean) {
			media.matches = dark;
			media.dispatchEvent(new Event("change"));
		},
	};
};

describe("followAppearance", () => {
	beforeEach(() => localStorage.clear());

	it("follows the device on System, and holds the theme set otherwise", async () => {
		const settings = new Settings(localStorage);
		const root = document.createElement("html");
		const { media, set } = device();
		followAppearance(settings, root, media);
		expect(root.classList.contains("dark")).toBe(false);

		set(true);
		expect(root.classList.contains("dark")).toBe(true);

		await settings.set("appearance.theme", "light");
		expect(root.classList.contains("dark")).toBe(false);

		await settings.set("appearance.theme", "dark");
		set(false);
		expect(root.classList.contains("dark")).toBe(true);
	});

	it("paints the browser's bar in the theme's background", async () => {
		const settings = new Settings(localStorage);
		const root = document.createElement("html");
		const meta = document.createElement("meta");
		meta.name = "theme-color";
		root.append(meta);
		const { media, set } = device();
		followAppearance(settings, root, media);
		expect(meta.content).toBe("#f3f4f7");

		set(true);
		expect(meta.content).toBe("#1d1f23");

		await settings.set("appearance.theme", "light");
		expect(meta.content).toBe("#f3f4f7");
	});

	it("draws iOS's launch image in the theme's background, once a theme", async () => {
		const settings = new Settings(localStorage);
		const root = document.createElement("html");
		const link = document.createElement("link");
		link.rel = "apple-touch-startup-image";
		root.append(link);
		const drawn: string[] = [];
		const draw = (background: string) => {
			drawn.push(background);
			return `data:image/png;${background}`;
		};
		const { media, set } = device();
		followAppearance(settings, root, media, draw);
		expect(link.getAttribute("href")).toBe("data:image/png;#f3f4f7");

		await settings.set("appearance.accent", "rose");
		set(true);
		expect(link.getAttribute("href")).toBe("data:image/png;#1d1f23");
		expect(drawn).toEqual(["#f3f4f7", "#1d1f23"]);
	});

	it("wears the accent set, and stops once told to", async () => {
		const settings = new Settings(localStorage);
		const root = document.createElement("html");
		const stop = followAppearance(settings, root, device().media);
		expect(root.dataset.accent).toBe("graphite");

		await settings.set("appearance.accent", "rose");
		expect(root.dataset.accent).toBe("rose");

		stop();
		await settings.set("appearance.accent", "violet");
		expect(root.dataset.accent).toBe("rose");
	});
});
