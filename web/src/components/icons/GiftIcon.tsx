interface Props {
  width?: number;
  height?: number;
  boxStroke?: string;
  ribbonStroke?: string;
}

export default function GiftIcon({
  width = 20,
  height = 20,
  boxStroke = 'currentColor',
  ribbonStroke = 'currentColor',
}: Readonly<Props>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      <path
        style={{ stroke: boxStroke }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M3.375 11.25h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
      />
      <path
        style={{ stroke: ribbonStroke }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21"
      />
    </svg>
  );
}
