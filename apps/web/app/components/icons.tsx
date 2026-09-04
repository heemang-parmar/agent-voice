/**
 * The four glyphs the dock needs, inline so the app takes no icon dependency.
 * Every one is decorative: the button around it always carries the label.
 */

interface IconProps {
  className?: string;
}

function svgProps(className: string | undefined) {
  return {
    className: className ?? 'icon',
    viewBox: '0 0 24 24',
    width: 20,
    height: 20,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
}

export function MicIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <rect x="9" y="2.75" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </svg>
  );
}

export function MicOffIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M9 5.75a3 3 0 0 1 6 0V9" />
      <path d="M15 12.6a3 3 0 0 1-6-1.6V8.5" />
      <path d="M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11v.4" />
      <path d="M12 17.5V21" />
      <path d="M4 3.5 20 20.5" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M4.5 12h13" />
      <path d="M11.5 6 17.5 12l-6 6" />
    </svg>
  );
}

export function EndIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function TranscriptIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M5 6.5h14" />
      <path d="M5 12h10" />
      <path d="M5 17.5h7" />
    </svg>
  );
}

export function VoiceModeIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M5 14v-4" />
      <path d="M8.5 17V7" />
      <path d="M12 19V5" />
      <path d="M15.5 16V8" />
      <path d="M19 14v-4" />
    </svg>
  );
}

export function SessionsIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </svg>
  );
}

export function NewChatIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </svg>
  );
}

export function PinIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M9 3.5h6l-.8 5.2 3 3.1H6.8l3-3.1z" />
      <path d="M12 11.8V20.5" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="12" cy="5.5" r="1.1" />
      <circle cx="12" cy="12" r="1.1" />
      <circle cx="12" cy="18.5" r="1.1" />
    </svg>
  );
}

export function GitHubIcon({ className }: IconProps) {
  return (
    <svg
      className={className ?? 'icon'}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.98a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}
