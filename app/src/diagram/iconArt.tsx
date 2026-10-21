import type { IconId } from './shapes';

/** Drawing-only icons in a 64x64 box, in the same flat style as the device art. */
export function IconArt({ id }: { id: IconId }) {
  switch (id) {
    case 'firewall':
      return (
        <g>
          <rect x="8" y="14" width="48" height="36" rx="3" fill="#c0504d" />
          {[0, 1, 2].map((r) => (
            <g key={r}>
              <path d={`M8 ${26 + r * 12} H56`} stroke="#8e3330" strokeWidth="1.6" />
              {[0, 1, 2, 3].map((c) => (
                <path key={c} d={`M${(r % 2 ? 14 : 20) + c * 12} ${14 + r * 12} V${26 + r * 12}`} stroke="#8e3330" strokeWidth="1.6" />
              ))}
            </g>
          ))}
          <path d="M32 6 C38 14 42 16 40 24 C46 20 46 14 44 10 C52 18 52 30 44 36 C40 39 24 39 20 34 C14 27 18 18 24 14 C24 20 26 22 28 22 C26 16 28 10 32 6 Z" fill="#f2b84b" opacity="0.95" />
        </g>
      );
    case 'cloud':
      return <path d="M18 46 C9 46 6 38 10 33 C8 25 16 20 22 23 C24 14 36 11 41 19 C49 16 57 22 55 31 C61 34 59 46 50 46 Z" fill="#dce8f5" stroke="#6c8ebf" strokeWidth="2.2" strokeLinejoin="round" />;
    case 'internet':
      return (
        <g fill="none" stroke="#2f9de0" strokeWidth="2.4">
          <circle cx="32" cy="32" r="22" fill="#e6f3fc" />
          <ellipse cx="32" cy="32" rx="10" ry="22" />
          <path d="M10 32 H54 M14 20 H50 M14 44 H50" />
        </g>
      );
    case 'rack':
      return (
        <g>
          <rect x="16" y="6" width="32" height="52" rx="2.5" fill="#2f3943" />
          {[0, 1, 2, 3, 4].map((k) => (
            <g key={k}>
              <rect x="19" y={10 + k * 9.4} width="26" height="7" rx="1" fill="#4c5865" />
              <circle cx="40" cy={13.5 + k * 9.4} r="1.2" fill={k % 2 ? '#3ddc84' : '#f2b84b'} />
              <rect x="22" y={12.8 + k * 9.4} width="12" height="1.4" rx="0.7" fill="#8592a0" />
            </g>
          ))}
        </g>
      );
    case 'user':
      return (
        <g fill="#5b8def">
          <circle cx="32" cy="22" r="11" />
          <path d="M12 56 C12 42 22 36 32 36 C42 36 52 42 52 56 Z" />
        </g>
      );
    case 'users':
      return (
        <g>
          <g fill="#9cb7f3">
            <circle cx="44" cy="22" r="8.5" />
            <path d="M30 52 C30 40 37 35 44 35 C51 35 58 40 58 52 Z" />
          </g>
          <g fill="#5b8def">
            <circle cx="26" cy="24" r="10" />
            <path d="M8 56 C8 43 17 37 26 37 C35 37 44 43 44 56 Z" />
          </g>
        </g>
      );
    case 'building':
      return (
        <g>
          <rect x="14" y="10" width="36" height="46" rx="1.5" fill="#7d8a97" />
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={19 + c * 10} y={15 + r * 9} width="6" height="5" rx="0.6" fill="#dce8f5" />),
          )}
          <rect x="27" y="47" width="10" height="9" fill="#3b4653" />
        </g>
      );
    case 'database':
      return (
        <g stroke="#3a7d44" strokeWidth="2.2" fill="#d5e8d4">
          <path d="M14 16 V48 C14 54 50 54 50 48 V16" />
          <ellipse cx="32" cy="16" rx="18" ry="6" />
          <path d="M14 27 C14 33 50 33 50 27 M14 38 C14 44 50 44 50 38" fill="none" />
        </g>
      );
    case 'lock':
      return (
        <g>
          <path d="M21 28 V20 C21 13 26 9 32 9 C38 9 43 13 43 20 V28" fill="none" stroke="#34404c" strokeWidth="4" />
          <rect x="14" y="27" width="36" height="28" rx="4" fill="#d79b00" />
          <circle cx="32" cy="39" r="4" fill="#5e4300" />
          <rect x="30.5" y="40" width="3" height="8" rx="1.5" fill="#5e4300" />
        </g>
      );
    case 'tower':
      return (
        <g stroke="#34404c" strokeWidth="2.4" fill="none" strokeLinecap="round">
          <path d="M32 22 L22 58 M32 22 L42 58 M25 46 H39 M27.5 36 H36.5 M24 52 L40 40 M40 52 L24 40" />
          <circle cx="32" cy="18" r="3.5" fill="#34404c" />
          <path d="M23 11 A12 12 0 0 0 23 25 M41 11 A12 12 0 0 1 41 25 M17 6 A19 19 0 0 0 17 30 M47 6 A19 19 0 0 1 47 30" stroke="#2f9de0" />
        </g>
      );
  }
}

/** Small glyphs for the shape picker. */
export function ShapeGlyph({ kind }: { kind: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  switch (kind) {
    case 'rect':
      return <rect x="3" y="6" width="18" height="12" {...p} />;
    case 'round':
      return <rect x="3" y="6" width="18" height="12" rx="4" {...p} />;
    case 'ellipse':
      return <ellipse cx="12" cy="12" rx="9" ry="6.5" {...p} />;
    case 'diamond':
      return <path d="M12 3 L21 12 L12 21 L3 12 Z" {...p} />;
    case 'zone':
      return <rect x="2.5" y="4.5" width="19" height="15" rx="3" {...p} strokeDasharray="3 2" fill="#dae8fc" />;
    case 'text':
      return <path d="M5 6 H19 M12 6 V19" {...p} strokeWidth={2} />;
    case 'line':
      return <path d="M4 19 L20 5" {...p} />;
    case 'arrow':
      return <path d="M4 19 L19 6 M12 5.5 H19.5 V13" {...p} />;
    default:
      return null;
  }
}
