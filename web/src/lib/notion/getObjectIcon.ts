export type ObjectIcon = {
  icon:
    | { emoji: string; type?: 'emoji' }
    | { external: { url: string }; type?: 'external' }
    | { file: { url: string }; type?: 'file' }
    | null;
};

export default function getObjectIcon(p?: Partial<ObjectIcon>): string {
  switch (p?.icon?.type) {
    case 'emoji':
      return p.icon.emoji;
    case 'external':
      return p.icon.external.url;
    case 'file':
      return p.icon.file.url;
    default:
      return '';
  }
}
