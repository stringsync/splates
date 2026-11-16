/** Release checks a ship test can fail before or after publishing. */
export class FakeReleaseGit {
	calls = 0;
	failAt: number | null = null;
	async sync(): Promise<string> {
		this.calls++;
		if (this.calls === this.failAt) {
			throw new Error("origin/main is ahead of this checkout");
		}
		return "origin/main verified at abc";
	}
}
