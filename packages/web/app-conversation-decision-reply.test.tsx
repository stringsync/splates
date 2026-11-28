import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { planApprovalDefaults } from "./plan-decision";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
} from "./testing";

describe("planApprovalDefaults", () => {
	it("defaults small, reversible, self-contained plans without watch-out tags to archive", () => {
		expect(planApprovalDefaults(SMALL_PLAN)).toEqual({
			reviewRequired: null,
			review: false,
			archive: true,
		});
		expect(
			planApprovalDefaults(`${SMALL_PLAN}\n- Breaking: changes API response.`),
		).toEqual({
			reviewRequired: null,
			review: false,
			archive: false,
		});
		expect(
			planApprovalDefaults(
				"**Tags:**\n- Reversible: ok.\n- Medium: several files.\n- Self-contained: isolated.",
			),
		).toEqual({
			reviewRequired: null,
			review: false,
			archive: false,
		});
	});

	it("locks review on for One-way and Invasive plans and turns archive off", () => {
		expect(planApprovalDefaults(INVASIVE_PLAN)).toEqual({
			reviewRequired: "invasive",
			review: true,
			archive: false,
		});
		expect(
			planApprovalDefaults(
				"**Tags:**\n- One-way: migrates rows.\n- Small: one script.\n- Self-contained: isolated.",
			),
		).toEqual({
			reviewRequired: "one-way",
			review: true,
			archive: false,
		});
	});
});

describe("App's plan decision replies", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const replied = (reply: string, extras?: { archiveAfterMerge?: true }) =>
		conversation({
			title: "Uploads",
			...extras,
			messages: [message("agent", PLAN), message("user", reply)],
		});

	it("shows a bare approval only as the plan card's folded line", async () => {
		const view = await testing.openConversations([
			replied("Approve: Retry uploads\nPlan from 2026-11-26T12:00:00.000Z"),
		]);
		const line = await view.findByText("Plan approved");
		const mark = line.closest("p")?.querySelector(".lucide-check-check");
		expect(mark?.getAttribute("class")).toContain("text-success");
		expect(view.queryByText(/Plan from/)).toBeNull();
		expect(view.queryByText(/Approve: Retry uploads/)).toBeNull();
	});

	it("shows archiving after merge on the folded line while armed", async () => {
		const view = await testing.openConversations([
			replied("Approve: Retry uploads\nPlan from 2026-11-26T12:00:00.000Z", {
				archiveAfterMerge: true,
			}),
		]);
		expect(
			await view.findByText("Plan approved, archiving after merge"),
		).toBeTruthy();
	});

	it("shows only the note a change request carries", async () => {
		const view = await testing.openConversations([
			replied(
				"Request changes: Retry uploads\nPlan from 2026-11-26T12:00:00.000Z\n\nRetry twice.",
			),
		]);
		await view.findByText("Retry twice.");
		const line = view.getByText("Changes requested").closest("p");
		const pencil = line?.querySelector(".lucide-pencil");
		expect(pencil).not.toBeNull();
		expect(pencil?.getAttribute("class")).not.toContain("text-");
		expect(view.queryByText(/Plan from/)).toBeNull();
		expect(view.queryByText(/Request changes: Retry uploads/)).toBeNull();
	});

	it("keeps a bare Approve typed by hand", async () => {
		const view = await testing.openConversations([replied("Approve")]);
		expect(await view.findByText("Approve")).toBeTruthy();
	});

	it("reveals nested Review and Archive checkboxes under Approve, preselecting Archive for small reversible self-contained plans", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Uploads",
				messages: [message("agent", SMALL_PLAN)],
			}),
		]);
		const approve = await view.findByRole("button", { name: "Approve" });
		// Hidden until Approve is selected.
		expect(
			view.queryByRole("checkbox", { name: "Review before merge" }),
		).toBeNull();
		expect(
			view.queryByRole("checkbox", { name: "Archive after merge" }),
		).toBeNull();

		await act(async () => fireEvent.click(approve));
		const reviewBox = view.getByRole("checkbox", {
			name: "Review before merge",
		}) as HTMLInputElement;
		const archiveBox = view.getByRole("checkbox", {
			name: "Archive after merge",
		}) as HTMLInputElement;
		expect(reviewBox.checked).toBe(false);
		expect(archiveBox.checked).toBe(true);

		// Advancing to Review & send shows Approve & archive and sends archiveAfterMerge=true.
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Next$/ })),
		);
		expect(
			view.getByRole("button", { name: /Plan decision: Approve & archive/ }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send" })),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toHaveLength(1),
		);
		const [sent] = testing.posted("/api/conversations/c1/prompt") as {
			body: { text: string; archiveAfterMerge?: string };
		}[];
		expect(sent?.body.text).toContain("Approve: Retry uploads");
		expect(sent?.body.archiveAfterMerge).toBe("true");
	});

	it("disables Archive after merge when Review before merge is checked and sends Approve & review", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Uploads",
				messages: [message("agent", SMALL_PLAN)],
			}),
		]);
		await act(async () =>
			fireEvent.click(await view.findByRole("button", { name: "Approve" })),
		);
		await act(async () =>
			fireEvent.click(
				view.getByRole("checkbox", { name: "Review before merge" }),
			),
		);
		const archiveBox = view.getByRole("checkbox", {
			name: "Archive after merge",
		}) as HTMLInputElement;
		expect(archiveBox.checked).toBe(false);
		expect(archiveBox.disabled).toBe(true);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Next$/ })),
		);
		expect(
			view.getByRole("button", { name: /Plan decision: Approve & review/ }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send" })),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toHaveLength(1),
		);
		const [sent] = testing.posted("/api/conversations/c1/prompt") as {
			body: { text: string; archiveAfterMerge?: string };
		}[];
		expect(sent?.body.text).toContain("Approve & review: Retry uploads");
		expect(sent?.body.archiveAfterMerge).toBeUndefined();
	});

	it("locks Review before merge on for Invasive plans with a badge and disables Archive", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Uploads",
				messages: [message("agent", INVASIVE_PLAN)],
			}),
		]);
		await act(async () =>
			fireEvent.click(await view.findByRole("button", { name: "Approve" })),
		);
		const reviewBox = view.getByRole("checkbox", {
			name: "Review before merge",
		}) as HTMLInputElement;
		const archiveBox = view.getByRole("checkbox", {
			name: "Archive after merge",
		}) as HTMLInputElement;
		expect(reviewBox.checked).toBe(true);
		expect(reviewBox.disabled).toBe(true);
		expect(view.getByText("Required by Invasive")).toBeTruthy();
		expect(archiveBox.checked).toBe(false);
		expect(archiveBox.disabled).toBe(true);
	});
});

const PLAN = "## 📝 Plan: Retry uploads\n\nRetry once.";

const SMALL_PLAN = [
	"## 📝 Plan: Retry uploads",
	"",
	"**Goal:** Retry transient scan failures.",
	"",
	"**Tags:**",
	"- Reversible: clean revert.",
	"- Small: bounded retry helper.",
	"- Self-contained: leaves upload flow alone.",
	"- Server: scan worker.",
].join("\n");

const INVASIVE_PLAN = [
	"## 📝 Plan: Rewrite uploads",
	"",
	"**Goal:** Rework the upload pipeline.",
	"",
	"**Tags:**",
	"- Reversible: clean revert.",
	"- Small: tight rewrite.",
	"- Invasive: touches shared pipeline.",
	"- Server: upload worker.",
].join("\n");
