/** What an agent takes to mean "carry on with this task". */
export function claimPrompt(task: string): string {
	return `Run \`arbor claim ${task}\` and carry on from its ARBOR.md.`;
}
