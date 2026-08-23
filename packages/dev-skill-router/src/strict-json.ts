class StrictJsonParser {
  private index = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.input.length) this.fail("unexpected trailing input");
    return value;
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    const character = this.input[this.index];
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    if (character === "-" || (character !== undefined && /[0-9]/.test(character))) return this.parseNumber();
    this.fail("expected a JSON value");
  }

  private parseObject(): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.input[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      this.skipWhitespace();
      if (this.input[this.index] !== '"') this.fail("expected an object key");
      const key = this.parseString();
      if (keys.has(key)) this.fail(`duplicate key ${JSON.stringify(key)}`);
      if (key === "__proto__" || key === "prototype" || key === "constructor") this.fail(`unsafe key ${JSON.stringify(key)}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.input[this.index] !== ":") this.fail("expected ':' after object key");
      this.index += 1;
      result[key] = this.parseValue();
      this.skipWhitespace();
      const character = this.input[this.index];
      if (character === "}") {
        this.index += 1;
        return result;
      }
      if (character !== ",") this.fail("expected ',' or '}'");
      this.index += 1;
    }
  }

  private parseArray(): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.input[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      const character = this.input[this.index];
      if (character === "]") {
        this.index += 1;
        return result;
      }
      if (character !== ",") this.fail("expected ',' or ']'");
      this.index += 1;
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.input.length) {
      const character = this.input[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.input.slice(start, this.index)) as string;
        } catch {
          this.fail("invalid JSON string");
        }
      }
      if (character === "\\") {
        this.index += 2;
        continue;
      }
      if (character !== undefined && character.charCodeAt(0) < 0x20) this.fail("control character in string");
      this.index += 1;
    }
    this.fail("unterminated string");
  }

  private parseNumber(): number {
    const remainder = this.input.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remainder);
    if (!match) this.fail("invalid number");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("non-finite number");
    return value;
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (!this.input.startsWith(literal, this.index)) this.fail(`expected ${literal}`);
    this.index += literal.length;
    return value;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.index] ?? "")) this.index += 1;
  }

  private fail(message: string): never {
    throw new Error(`Invalid strict JSON at offset ${this.index}: ${message}`);
  }
}

export function parseStrictJson(input: string): unknown {
  return new StrictJsonParser(input).parse();
}
