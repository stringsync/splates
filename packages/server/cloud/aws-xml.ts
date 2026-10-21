/** A value read from AWS's XML: text, a set of `<item>`s, or named fields. */
export type XmlValue = string | XmlValue[] | { [name: string]: XmlValue };

/**
 * Reads the XML the EC2 and STS APIs answer in, as far as they use it:
 * elements, text and entities, no mixed content. A set (its children all
 * `<item>`) becomes an array and any other element an object, so
 * `reservationSet` reads as `reservationSet[0].instancesSet[0].instanceId`.
 */
export class AwsXml {
	private at = 0;

	private constructor(private readonly text: string) {}

	/** The root element's fields, or `{}` when it has none. */
	static parse(text: string): { [name: string]: XmlValue } {
		const parser = new AwsXml(text);
		parser.skipProlog();
		const root = parser.element();
		return typeof root === "object" && !Array.isArray(root) ? root : {};
	}

	/** `value` as a list: its items, or none when AWS sent an empty element. */
	static list(value: XmlValue | undefined): XmlValue[] {
		return Array.isArray(value) ? value : [];
	}

	/** `value` as text, or "" when it is not. */
	static str(value: XmlValue | undefined): string {
		return typeof value === "string" ? value : "";
	}

	/** `value`'s field `name`, or undefined when it is not an object holding one. */
	static field(
		value: XmlValue | undefined,
		name: string,
	): XmlValue | undefined {
		return typeof value === "object" && !Array.isArray(value)
			? value[name]
			: undefined;
	}

	private match(pattern: RegExp, from: number): RegExpExecArray | null {
		pattern.lastIndex = from;
		return pattern.exec(this.text);
	}

	private skipProlog(): void {
		for (;;) {
			const next = this.text.indexOf("<", this.at);
			if (next < 0 || !/^<[?!]/.test(this.text.slice(next, next + 2))) {
				return;
			}
			this.at = this.text.indexOf(">", next) + 1;
		}
	}

	/** Reads the element at `at`, answering its content, the root's name dropped. */
	private element(): XmlValue {
		const open = this.match(/<([\w:.-]+)([^>]*?)(\/?)>/y, this.at);
		if (open === null) {
			throw new Error("AWS answered XML splates cannot read");
		}
		this.at += open[0].length;
		if (open[3] === "/") {
			return "";
		}
		const name = open[1] as string;
		const children: [string, XmlValue][] = [];
		let text = "";
		for (;;) {
			const next = this.text.indexOf("<", this.at);
			if (next < 0) {
				throw new Error(`AWS answered XML with <${name}> never closed`);
			}
			text += this.text.slice(this.at, next);
			if (this.text[next + 1] === "/") {
				this.at = this.text.indexOf(">", next) + 1;
				break;
			}
			this.at = next;
			const child = this.match(/<([\w:.-]+)/y, next);
			children.push([child?.[1] as string, this.element()]);
		}
		if (children.length === 0) {
			return decoded(text);
		}
		if (children.every(([child]) => child === "item")) {
			return children.map(([, value]) => value);
		}
		const fields: { [name: string]: XmlValue } = {};
		for (const [child, value] of children) {
			fields[child] = value;
		}
		return fields;
	}
}

function decoded(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&amp;/g, "&");
}
