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
