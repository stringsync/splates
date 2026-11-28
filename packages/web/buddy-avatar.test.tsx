import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BuddyAvatar } from "./buddy-avatar";
import {
	cleanup,
	conversation,
	message,
	render,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("BuddyAvatar", () => {
	afterEach(cleanup);

	it("renders the stacked-plate buddy with a corner brand pin for every agent and a fallback bot mark", () => {
		const agents = [
			"claude",
			"gemini",
			"codex",
			"kimi",
			"antigravity",
			"opencode",
			"typesafe",
			"custom-agent",
		] as const;

		const rendered = agents.map((agent) => {
			const view = render(<BuddyAvatar agent={agent} name={agent} />);
			const root = view.container.querySelector('[data-slot="buddy-avatar"]');
			const pin = view.container.querySelector(
				'[data-slot="buddy-avatar-pin"]',
			);
			const result = {
				agent: root?.getAttribute("data-agent"),
				hasPinSvg: pin?.querySelector("svg") !== null,
				isBotFallback: pin?.querySelector("svg.lucide-bot") !== null,
			};
			view.unmount();
			return result;
		});

		expect(rendered).toEqual([
			{ agent: "claude", hasPinSvg: true, isBotFallback: false },
			{ agent: "gemini", hasPinSvg: true, isBotFallback: false },
			{ agent: "codex", hasPinSvg: true, isBotFallback: false },
			{ agent: "kimi", hasPinSvg: true, isBotFallback: false },
			{ agent: "antigravity", hasPinSvg: true, isBotFallback: false },
			{ agent: "opencode", hasPinSvg: true, isBotFallback: false },
			{ agent: "typesafe", hasPinSvg: true, isBotFallback: false },
			{ agent: "custom-agent", hasPinSvg: true, isBotFallback: true },
		]);
	});

	it("defaults to 32px with a proportionally scaled corner pin", () => {
		const view = render(<BuddyAvatar agent="gemini" name="Gemini" />);
		const root = view.container.querySelector(
			'[data-slot="buddy-avatar"]',
		) as HTMLElement | null;
		const pin = view.container.querySelector(
			'[data-slot="buddy-avatar-pin"]',
		) as HTMLElement | null;
		expect(root?.style.width).toBe("32px");
		expect(root?.style.height).toBe("32px");
		expect(pin?.style.width).toBe("17px");
		expect(pin?.style.height).toBe("17px");
	});

	it("switches expressive eyes and reduced-motion-safe animations across idle, working, and merged states", () => {
		const idle = render(<BuddyAvatar agent="claude" state="idle" />);
		const idleEyes = idle.container.querySelector('[data-slot="buddy-eyes"]');
		expect(idleEyes?.getAttribute("data-expression")).toBe("idle");
		expect(idleEyes?.getAttribute("class")).toContain("buddy-eyes-blink");
		expect(idleEyes?.getAttribute("class")).toContain(
			"motion-reduce:animate-none",
		);
		expect(idleEyes?.querySelectorAll("rect")).toHaveLength(2);
		idle.unmount();

		const working = render(<BuddyAvatar agent="gemini" state="working" />);
		const workingSvg = working.container.querySelector("svg");
		const workingEyes = working.container.querySelector(
			'[data-slot="buddy-eyes"]',
		);
		expect(workingSvg?.getAttribute("class")).toContain("buddy-working-bob");
		expect(workingSvg?.getAttribute("class")).toContain(
			"motion-reduce:animate-none",
		);
		expect(workingEyes?.getAttribute("data-expression")).toBe("working");
		expect(workingEyes?.getAttribute("class")).toContain("buddy-eyes-look");
		expect(workingEyes?.getAttribute("class")).toContain(
			"motion-reduce:animate-none",
		);
		working.unmount();

		const merged = render(<BuddyAvatar agent="codex" state="merged" />);
		const mergedEyes = merged.container.querySelector(
			'[data-slot="buddy-eyes"]',
		);
		expect(mergedEyes?.getAttribute("data-expression")).toBe("merged");
		expect(mergedEyes?.querySelectorAll("path")).toHaveLength(2);
		expect(mergedEyes?.querySelectorAll("rect")).toHaveLength(0);
	});
});

describe("Living Buddy in conversation threads", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("renders a single living Buddy on the latest assistant turn and keeps earlier turns clean", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Multi turn",
				agent: "gemini",
				messages: [
					message("user", "First question"),
					message("agent", "First answer."),
					message("user", "Second question"),
					message("agent", "Second answer."),
				],
			}),
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Multi turn" }),
		);
		await waitFor(() => expect(thread.textContent).toContain("Second answer."));

		const avatars = thread.querySelectorAll('[data-slot="buddy-avatar"]');
		expect(avatars).toHaveLength(1);
		expect(avatars[0]?.getAttribute("data-agent")).toBe("gemini");
		expect(avatars[0]?.getAttribute("data-state")).toBe("idle");
		expect(
			avatars[0]?.closest('[data-slot="aui_assistant-message-root"]')
				?.textContent,
		).toContain("Second answer.");
	});

	it("rides inside the active working row with the shared spinner and moves down when a new turn starts", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Live thread",
				agent: "claude",
				messages: [
					message("user", "Check the icon"),
					message("agent", "Looks clean."),
				],
			}),
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Live thread" }),
		);
		await waitFor(() => expect(thread.textContent).toContain("Looks clean."));
		expect(
			thread
				.querySelector('[data-slot="buddy-avatar"]')
				?.getAttribute("data-state"),
		).toBe("idle");

		await testing.say({
			...turn(
				[tool({ id: "t1", command: "bun test", status: "in_progress" })],
				{
					status: "running",
				},
			),
			title: "Live thread",
			agent: "claude",
		});
		await waitFor(() => within(thread).getByText(/^Working/));

		const avatars = thread.querySelectorAll('[data-slot="buddy-avatar"]');
		expect(avatars).toHaveLength(1);
		expect(avatars[0]?.getAttribute("data-state")).toBe("working");
		const workRow = thread.querySelector('[data-slot="work"]');
		expect(workRow?.contains(avatars[0] as Node)).toBe(true);
		expect(workRow?.querySelector("svg.animate-spin")).not.toBeNull();
	});

	it("shows happy squint eyes when the latest turn merged a task", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Merged turn",
				agent: "codex",
				messages: [
					message("user", "Ship the fix"),
					message(
						"agent",
						"## ✅ Merged header onto main\n\nThe header wraps cleanly now.",
					),
				],
			}),
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Merged turn" }),
		);
		await waitFor(() =>
			expect(
				thread
					.querySelector('[data-slot="buddy-avatar"]')
					?.getAttribute("data-state"),
			).toBe("merged"),
		);

		const status = thread.querySelector('[data-slot="buddy-status"]');
		expect(status?.textContent).toContain("Merged onto main");
		expect(
			thread
				.querySelector('[data-slot="buddy-eyes"]')
				?.getAttribute("data-expression"),
		).toBe("merged");
	});
});
