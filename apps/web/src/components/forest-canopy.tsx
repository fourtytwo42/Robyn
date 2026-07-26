import { forestCanopyClassName } from "@/lib/forest-canopy-policy";

export function ForestCanopy({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={forestCanopyClassName(compact)}
      viewBox="0 0 960 260"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="forest-canopy-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9ee37d" stopOpacity=".2" />
          <stop offset="1" stopColor="#2e8b57" stopOpacity=".04" />
        </linearGradient>
        <linearGradient id="forest-canopy-line" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4cae72" stopOpacity=".18" />
          <stop offset=".55" stopColor="#b7f58c" stopOpacity=".72" />
          <stop offset="1" stopColor="#4cae72" stopOpacity=".12" />
        </linearGradient>
      </defs>
      <path
        className="forest-canopy-hill"
        d="M0 225C120 178 210 206 318 166c119-44 200-23 300 17 107 43 203 1 342-38v115H0Z"
      />
      <path
        className="forest-canopy-ground"
        d="M0 226c120-48 211-18 319-59 118-44 199-23 299 17 107 43 203 1 342-39"
      />
      {[
        [78, 194, 34],
        [155, 172, 52],
        [252, 195, 31],
        [360, 156, 65],
        [492, 190, 38],
        [610, 163, 58],
        [731, 190, 35],
        [842, 148, 67],
        [920, 189, 39],
      ].map(([x, base, size]) => (
        <g
          className="forest-canopy-tree"
          transform={`translate(${x} ${base})`}
          key={`${x}-${base}`}
        >
          <path d={`M0 25V${-size * 0.25}`} />
          <path
            d={`M0 ${-size} ${-size * 0.58} ${size * 0.08}h${size * 1.16}Z`}
          />
          <path
            d={`M0 ${-size * 0.68} ${-size * 0.72} ${size * 0.48}h${size * 1.44}Z`}
          />
        </g>
      ))}
    </svg>
  );
}
