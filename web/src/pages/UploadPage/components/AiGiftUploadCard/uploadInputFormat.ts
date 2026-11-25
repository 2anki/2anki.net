// The file type an event records, never the name: a name can carry the
// person's coursework or their own name.
export function uploadInputFormat(files: readonly { name: string }[]): string {
  const formats = new Set(
    files.map((file) => {
      const dot = file.name.lastIndexOf('.');
      return dot < 0 ? 'none' : file.name.slice(dot + 1).toLowerCase();
    })
  );
  return formats.size === 1 ? Array.from(formats)[0] : 'mixed';
}
