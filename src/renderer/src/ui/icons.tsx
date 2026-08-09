import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/**
 * One icon family, drawn on a 16px grid at 1.5px stroke. Consistency here does
 * more for how considered the app feels than any individual glyph.
 */
function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 13.5 13.5" />
  </Icon>
)

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </Icon>
)

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" />
    <path d="M2.25 6.5h11.5M5.5 2v2.5M10.5 2v2.5" />
  </Icon>
)

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 8.4 3.2 3.1L13 4.8" />
  </Icon>
)

export const IconTasks = (p: IconProps) => (
  <Icon {...p}>
    <path d="m2.25 4.75 1.6 1.6 2.9-3.1M2.25 11.4l1.6 1.6 2.9-3.1M8.75 5h5M8.75 11.6h5" />
  </Icon>
)

export const IconNote = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.25 2.75h6.4l3.1 3.1v7.4a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z" />
    <path d="M9.4 2.9V6h3.1" />
  </Icon>
)

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.9" />
    <path d="M8 1.4v1.3M8 13.3v1.3M14.6 8h-1.3M2.7 8H1.4M12.7 3.3l-.9.9M4.2 11.8l-.9.9M12.7 12.7l-.9-.9M4.2 4.2l-.9-.9" />
  </Icon>
)

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
  </Icon>
)

/* Sliders, not a gear — a gear at 16px is indistinguishable from the sun glyph. */
export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4.5h4M9.5 4.5h4M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="8" cy="4.5" r="1.7" />
    <circle cx="5.8" cy="11.5" r="1.7" />
  </Icon>
)

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.75 3.5 5.25 8l4.5 4.5" />
  </Icon>
)

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.25 3.5 10.75 8l-4.5 4.5" />
  </Icon>
)

export const IconX = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
)

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 4.75V8l2.2 1.5" />
  </Icon>
)

export const IconPin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 14s4.6-4.05 4.6-7.4A4.6 4.6 0 0 0 3.4 6.6C3.4 9.95 8 14 8 14Z" />
    <circle cx="8" cy="6.5" r="1.6" />
  </Icon>
)

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 4.25h10.5M6 4V2.9a.9.9 0 0 1 .9-.9h2.2a.9.9 0 0 1 .9.9v1.1M12.2 4.25l-.5 8.4a1 1 0 0 1-1 .95H5.3a1 1 0 0 1-1-.95l-.5-8.4" />
  </Icon>
)

export const IconLink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.28l1.9-1.9a2.6 2.6 0 0 0-3.68-3.68l-1.1 1.09" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.28l-1.9 1.9a2.6 2.6 0 0 0 3.68 3.68l1.09-1.09" />
  </Icon>
)

export const IconHash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.2 2.5 4.9 13.5M11.1 2.5 9.8 13.5M2.6 5.9h11M2.2 10.1h11" />
  </Icon>
)

export const IconLayers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.9 14 5 8 8.1 2 5l6-3.1Z" />
    <path d="m2 8.4 6 3.1 6-3.1M2 11.6l6 3.1 6-3.1" />
  </Icon>
)

export const IconCloud = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.6 12.5a3.1 3.1 0 0 1-.35-6.18 4.05 4.05 0 0 1 7.8.9 2.65 2.65 0 0 1-.35 5.28H4.6Z" />
  </Icon>
)

export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.4 6.7A5.6 5.6 0 0 0 3.6 4.4L2.4 5.6" />
    <path d="M2.6 9.3a5.6 5.6 0 0 0 9.8 2.3l1.2-1.2" />
    <path d="M2.2 2.6v3h3M13.8 13.4v-3h-3" />
  </Icon>
)

export const IconFolder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.9 4.1a1 1 0 0 1 1-1h3l1.5 1.8h6.7a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1V4.1Z" />
  </Icon>
)

export const IconSmile = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.1" />
    <path d="M5.6 9.4a2.9 2.9 0 0 0 4.8 0" />
    <path d="M6 6.2v.6M10 6.2v.6" strokeWidth={1.8} />
  </Icon>
)

export const IconImage = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.1" y="3.1" width="11.8" height="9.8" rx="1.8" />
    <circle cx="5.9" cy="6.4" r="1" />
    <path d="m2.6 11.2 3.1-3 2.3 2.2 2.3-2.3 3.1 3" />
  </Icon>
)

export const IconGraph = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="3.6" cy="4.2" r="1.9" />
    <circle cx="12.4" cy="3.4" r="1.6" />
    <circle cx="11.6" cy="12" r="1.9" />
    <circle cx="4" cy="11.4" r="1.5" />
    <path d="M5.2 5.4 10.3 11M5.5 4 10.8 3.6M4.3 9.9 5 6.1M5.5 11.6h4.2" />
  </Icon>
)

export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 8h10.5M9 3.75 13.25 8 9 12.25" />
  </Icon>
)

export const IconArrowLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.25 8H2.75M7 3.75 2.75 8 7 12.25" />
  </Icon>
)

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6.25 8 10.75l4.5-4.5" />
  </Icon>
)

/* An outline: rows stepped in, so it reads as structure rather than a list. */
export const IconOutline = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 3.5h11M4.5 6.75h9M6.5 10h7M4.5 13.25h9" />
  </Icon>
)

export const IconProperties = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4.25h4M2.5 8h4M2.5 11.75h4M8.75 4.25h4.75M8.75 8h4.75M8.75 11.75h4.75" />
  </Icon>
)

export const IconComment = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 7.3a4.7 4.7 0 0 1 4.7-4.7h1.8a4.7 4.7 0 0 1 0 9.4H6l-3.6 2.3.8-3.1a4.7 4.7 0 0 1-.8-2.6Z" />
  </Icon>
)

export const IconHistory = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 8a5.6 5.6 0 1 0 1.7-4L2.2 5.9" />
    <path d="M1.9 2.9v3.1h3.1M8 5.1V8l2.1 1.4" />
  </Icon>
)

export const IconTable = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />
    <path d="M2.25 6.5h11.5M6.5 6.5v6.25M2.25 9.6h11.5" />
  </Icon>
)

export const IconBoard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.25" y="2.75" width="3.4" height="10.5" rx="1.2" />
    <rect x="6.9" y="2.75" width="3.4" height="7" rx="1.2" />
    <rect x="11.55" y="2.75" width="2.2" height="9" rx="1.1" />
  </Icon>
)

export const IconGallery = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.25" y="2.75" width="5" height="5" rx="1.2" />
    <rect x="8.75" y="2.75" width="5" height="5" rx="1.2" />
    <rect x="2.25" y="9.25" width="5" height="4" rx="1.2" />
    <rect x="8.75" y="9.25" width="5" height="4" rx="1.2" />
  </Icon>
)

export const IconTimeline = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 4.4h6.4M4.9 8h7.6M2.4 11.6h5" strokeWidth={2.2} strokeLinecap="round" />
  </Icon>
)

export const IconList = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.25 4h8.25M5.25 8h8.25M5.25 12h8.25M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
  </Icon>
)

export const IconSplit = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />
    <path d="M8 3.25v9.5" />
  </Icon>
)

export const IconMore = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="3.4" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="12.6" cy="8" r=".9" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconStar = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 2.2 1.75 3.66 3.95.53-2.88 2.8.71 3.99L8 11.28 4.47 13.18l.71-3.99L2.3 6.39l3.95-.53Z" />
  </Icon>
)

export const IconFilter = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 3.9h11.2L9.3 8.6v4.3l-2.6-1.5V8.6Z" />
  </Icon>
)

export const IconSort = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.4 12.6V3.9M2.3 6l2.1-2.1L6.5 6M11.6 3.4v8.7M9.5 10l2.1 2.1L13.7 10" />
  </Icon>
)

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.4v7.4M5.1 7l2.9 2.9L10.9 7M2.6 12.2v.4a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-.4" />
  </Icon>
)

export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 10.2V2.8M5.1 5.7 8 2.8l2.9 2.9M2.6 12.2v.4a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-.4" />
  </Icon>
)

export const IconCopy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.4" y="5.4" width="8.1" height="8.1" rx="1.5" />
    <path d="M10.6 5.4V4a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5v5.1A1.5 1.5 0 0 0 4 10.6h1.4" />
  </Icon>
)

export const IconRestore = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.6 8A5.6 5.6 0 1 1 11.9 4L13.7 5.9" />
    <path d="M14.1 2.9v3.1H11" />
  </Icon>
)

export const IconPuzzle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.4 2.6h3.2v1.6a1.4 1.4 0 1 0 2.8 0V2.6h1.2v3.2h-1.6a1.4 1.4 0 1 0 0 2.8h1.6v4.8H9.6v-1.6a1.4 1.4 0 1 0-2.8 0v1.6H2.6V8.6h1.6a1.4 1.4 0 1 0 0-2.8H2.6V2.6Z" />
  </Icon>
)

export const IconRelation = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="4" cy="4" r="2.1" />
    <circle cx="12" cy="12" r="2.1" />
    <path d="M6.1 4H10a2 2 0 0 1 2 2v3.9" />
  </Icon>
)

export const IconPalette = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2a6 6 0 0 0 0 12c.9 0 1.4-.6 1.4-1.3 0-.9-.8-1.2-.8-2 0-.6.5-1 1.1-1H11a3 3 0 0 0 3-3c0-2.6-2.7-4.7-6-4.7Z" />
    <circle cx="5.5" cy="7" r=".9" fill="currentColor" stroke="none" />
    <circle cx="8" cy="5" r=".9" fill="currentColor" stroke="none" />
    <circle cx="10.8" cy="6.6" r=".9" fill="currentColor" stroke="none" />
  </Icon>
)

/**
 * A cleaved block of stone — the same hull the app icon is cut from, see
 * scripts/make-icon.cjs. Change one, change the other.
 *
 * The icon separates its three facets by tone; at 20px in the titlebar that
 * turns to mud, so here the block is one solid ink and the two creases are
 * knocked out in the page colour instead. Same read, a tenth of the size.
 */
export function StoneMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <g transform="translate(50 50) scale(.94) translate(-50 -50)">
        <path d="M30 6 72 17 88 50 46 95 18 74 10 28Z" fill="var(--text-strong)" />
        <path
          d="M10 28 50 40 72 17M50 40 46 95"
          stroke="var(--bg-page)"
          strokeWidth="5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}
