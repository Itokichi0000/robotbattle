/** Original SATS WARS emblem: a split disc — thunderbolt (RAIJIN) and whirlwind (FUJIN), side by side. */
export function Emblem({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <clipPath id="sw-left">
          <polygon points="0,0 58,0 42,100 0,100" />
        </clipPath>
        <clipPath id="sw-right">
          <polygon points="58,0 100,0 100,100 42,100" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="47" fill="#0E1830" stroke="#EFF5FF" strokeWidth="3" />
      <g clipPath="url(#sw-left)">
        <circle cx="50" cy="50" r="44" fill="#F7931A" />
        <path d="M33 14 L18 52 L31 52 L22 86 L46 44 L33 44 L42 14 Z" fill="#070D1A" />
      </g>
      <g clipPath="url(#sw-right)">
        <circle cx="50" cy="50" r="44" fill="#25C8D7" />
        <path
          d="M74 50 a10 10 0 1 1 -10 -10 a16 16 0 1 1 -12 22 M78 30 a24 24 0 0 1 4 34"
          fill="none"
          stroke="#070D1A"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>
      <line x1="58" y1="3" x2="42" y2="97" stroke="#EFF5FF" strokeWidth="3" />
    </svg>
  );
}

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const emblem = size === 'lg' ? 96 : size === 'md' ? 56 : 36;
  const title = size === 'lg' ? 'text-5xl md:text-7xl' : size === 'md' ? 'text-3xl' : 'text-xl';
  const sub = size === 'lg' ? 'text-xl md:text-2xl' : size === 'md' ? 'text-sm' : 'text-xs';
  return (
    <div className="flex items-center gap-3">
      <Emblem size={emblem} />
      <div className="leading-none">
        <div className={`sw-display font-black ${title} tracking-wider`}>
          <span className="text-amber">SATS</span> <span className="text-teal">WARS</span>
        </div>
        <div className={`${sub} mt-1 font-bold tracking-[0.3em] text-off/90`}>
          EARTH DEFENSE <span className="text-amber">雷神</span>×<span className="text-teal">風神</span>
        </div>
      </div>
    </div>
  );
}
