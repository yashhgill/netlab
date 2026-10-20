/** Common interface the terminal UI talks to (IOS console or PC command prompt). */
export interface Shell {
  buffer: string;
  history: string[];
  prompt(): string;
  /** true when typed characters must be hidden (password prompts). */
  secret(): boolean;
  busy(): boolean;
  submit(line: string): void;
  help?(lineBeforeQuestionMark: string): void;
  complete?(line: string): string | null;
  interrupt(): void;
  clear?(): void;
  subscribe(fn: () => void): () => void;
}

export class ShellBase {
  buffer = '';
  history: string[] = [];
  private subs = new Set<() => void>();

  write(t: string) {
    this.buffer += t;
    if (this.buffer.length > 200_000) this.buffer = this.buffer.slice(-150_000);
    for (const s of this.subs) s();
  }

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  pushHistory(line: string) {
    if (line.trim() && this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > 100) this.history.shift();
  }
}
