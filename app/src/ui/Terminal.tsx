import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { Shell } from '../cli/shell';
import { markDirty } from './store';

export function Terminal({ shell, autoFocus = true }: { shell: Shell; autoFocus?: boolean }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [input, setInput] = useState('');
  const [hIdx, setHIdx] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => shell.subscribe(force), [shell]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, shell]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (shell.busy()) return;
      shell.submit(input);
      setInput('');
      setHIdx(null);
      markDirty();
      force();
    } else if (e.key === '?' && !shell.secret()) {
      e.preventDefault();
      if (shell.help) {
        shell.help(input);
        force();
      } else setInput(input + '?');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const c = shell.complete?.(input);
      if (c) setInput(c);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const h = shell.history;
      if (!h.length) return;
      const i = hIdx === null ? h.length - 1 : Math.max(0, hIdx - 1);
      setHIdx(i);
      setInput(h[i]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const h = shell.history;
      if (hIdx === null) return;
      const i = hIdx + 1;
      if (i >= h.length) {
        setHIdx(null);
        setInput('');
      } else {
        setHIdx(i);
        setInput(h[i]);
      }
    } else if ((e.ctrlKey && (e.key === 'c' || e.key === 'z')) || (e.ctrlKey && e.shiftKey && e.key === '^')) {
      e.preventDefault();
      shell.interrupt();
      setInput('');
      force();
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      shell.clear?.();
    }
  };

  const busy = shell.busy();
  const secret = shell.secret();

  return (
    <div className="terminal" onMouseUp={() => !window.getSelection()?.toString() && inputRef.current?.focus()}>
      <div className="terminal-scroll" ref={scroller}>
        <pre className="terminal-out">{shell.buffer}</pre>
        <div className="terminal-line">
          {!busy && <span className="terminal-prompt">{shell.prompt()}</span>}
          <input
            ref={inputRef}
            className="terminal-input"
            value={secret ? '' : input}
            onChange={(e) => !busy && setInput(secret ? input + e.target.value : e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label="Command line"
            style={busy ? { opacity: 0 } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
