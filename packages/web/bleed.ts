/** Out across the pane's padding to its edges: a phone's is narrower. */
export function bleed(phone: boolean): string {
	return phone ? "-mx-1" : "-mx-4";
}
