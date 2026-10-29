import type { SVGProps } from 'react';

/**
 * House icon set. Original line icons on a 24-unit grid; stroke uses currentColor so the
 * role accent flows in from CSS. No emoji anywhere in the UI (spec §3.3).
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Svg({ size = 24, title, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconCrosshair = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="6.5" />
    <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Svg>
);

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.5 4 5.5v6c0 4.6 3.3 8.3 8 10 4.7-1.7 8-5.4 8-10v-6z" />
    <path d="M12 7v9M8.5 9.5 12 7l3.5 2.5" />
  </Svg>
);

export const IconBolt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.5z" />
  </Svg>
);

export const IconWrench = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 3.5a5 5 0 0 0-5.3 6.6L3 16.3 7.7 21l6.2-6.2a5 5 0 0 0 6.6-5.3l-3 3-3-1-1-3z" />
  </Svg>
);

export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 2 20.5h20z" />
    <path d="M12 9.5v5M12 17v1.2" />
  </Svg>
);

export const IconSignal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20v-3M9 20v-7M14 20v-11M19 20V4" />
  </Svg>
);

export const IconPilot = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 13a7 7 0 0 1 14 0v4l-2 3H7l-2-3z" />
    <path d="M7.5 12.5h9l-1.2 3h-6.6z" />
  </Svg>
);

export const IconCore = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 2 8.7 5v10L12 22l-8.7-5V7z" />
    <circle cx="12" cy="12" r="3.2" />
  </Svg>
);

export const IconArrow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21V4M5 10.5 12 3.5l7 7" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14 14 10" />
    <path d="M8.5 11.5 6 14a3.5 3.5 0 0 0 5 5l2.5-2.5M15.5 12.5 18 10a3.5 3.5 0 0 0-5-5l-2.5 2.5" />
  </Svg>
);

export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4v16M16 4v16" />
  </Svg>
);

export const IconSpeaker = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);

export const IconMech = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 3h5v3h-5zM7 7h10l1 6H6zM4 8h2.5l-.5 6H4zM17.5 8H20v6h-2zM8 13h3v8H8zM13 13h3v8h-3z" />
  </Svg>
);
