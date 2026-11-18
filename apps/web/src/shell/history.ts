/** Command-History mit Navigation per Pfeil hoch/runter. */
export class History {
  private items: string[] = [];
  private index = 0;
  private draft = '';

  private readonly max: number;

  constructor(max = 100) {
    this.max = max;
  }

  push(entry: string): void {
    const value = entry.trim();
    if (value && this.items.at(-1) !== value) {
      this.items.push(value);
      if (this.items.length > this.max) this.items.shift();
    }
    this.index = this.items.length;
    this.draft = '';
  }

  /** Einen Eintrag zurück. `current` ist die aktuelle (noch nicht abgeschickte) Eingabe. */
  prev(current: string): string {
    if (this.index === this.items.length) this.draft = current;
    if (this.index > 0) this.index--;
    return this.items[this.index] ?? current;
  }

  /** Einen Eintrag vor. Am Ende kommt die ursprüngliche Eingabe zurück. */
  next(): string {
    if (this.index < this.items.length) this.index++;
    return this.index === this.items.length ? this.draft : (this.items[this.index] ?? '');
  }

  entries(): readonly string[] {
    return this.items;
  }
}
