import { useState, type DragEvent } from 'react';

interface UseDropZoneInput<T extends HTMLElement> {
  onDrop: (event: DragEvent<T>) => void;
}

// Element-scoped drop target: spread `dragProps` on the zone element. The
// hover flag follows the pointer over that element only, and the drop is
// handed over with the default navigation already suppressed.
export const useDropZone = <T extends HTMLElement = HTMLElement>({
  onDrop,
}: UseDropZoneInput<T>) => {
  const [dropHover, setDropHover] = useState(false);

  const hover = (event: DragEvent<T>) => {
    event.preventDefault();
    setDropHover(true);
  };

  const dragProps = {
    onDragOver: hover,
    onDragEnter: hover,
    onDragLeave: () => setDropHover(false),
    onDrop: (event: DragEvent<T>) => {
      event.preventDefault();
      setDropHover(false);
      onDrop(event);
    },
  };

  return { dropHover, dragProps };
};
