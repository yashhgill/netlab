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
      inputRef.current?.scrollIntoView({ block: 'nearest' });
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

  /** On-screen keys for phones and tablets, whose keyboards lack Tab, arrows and Ctrl. */
  const key = (k: 'Tab' | '?' | 'ArrowUp' | 'ArrowDown' | 'c' | 'z') => {
    const ctrl = k === 'c' || k === 'z';
    onKey({ key: k, ctrlKey: ctrl, shiftKey: false, preventDefault() {} } as unknown as React.KeyboardEvent<HTMLInputElement>);
    inputRef.current?.focus();
  };

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
            onChange={(e) => {
              if (busy) return;
              const v = e.target.value;
              // Phone keyboards often skip keydown, so a typed "?" arrives here instead.
              if (!secret && shell.help && v.endsWith('?') && v.length === input.length + 1) {
                shell.help(input);
                force();
                return;
              }
              setInput(secret ? input + v : v);
            }}
            onKeyDown={onKey}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="send"
            inputMode="text"
            aria-label="Command line"
            style={busy ? { opacity: 0 } : undefined}
          />
        </div>
      </div>
      <div className="term-keys" role="toolbar" aria-label="Terminal keys">
        <button onPointerDown={(e) => e.preventDefault()} onClick={() => key('Tab')}>Tab</button>
        <button onPointerDown={(e) => e.preventDefault()} onClick={() => key('?')}>?</button>
        <button onPointerDown={(e) => e.preventDefault()} onClick={() => key('ArrowUp')} aria-label="Previous command">↑</button>
        <button onPointerDown={(e) => e.preventDefault()} onClick={() => key('ArrowDown')} aria-label="Next command">↓</button>
        <button onPointerDown={(e) => e.preventDefault()} onClick={() => key('c')}>Ctrl+C</button>
        <button onPointerDown={(e) => e.preventDefault()} onClick={() => key('z')}>Ctrl+Z</button>
        <button
          className="enter"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            onKey({ key: 'Enter', ctrlKey: false, shiftKey: false, preventDefault() {} } as unknown as React.KeyboardEvent<HTMLInputElement>);
            inputRef.current?.focus();
          }}
        >
          Enter
        </button>
      </div>
    </div>
  );
}
