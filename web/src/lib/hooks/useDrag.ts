import { useEffect, useRef, useState } from 'react';

interface UseDragInput {
  onDrop: (event: DragEvent) => void;
}

// Page-wide drop target: the whole body accepts the drag so a file dropped
// anywhere on the upload page lands in the form. Listeners are added, not
// assigned, so several consumers can coexist, and removed on unmount so a
// drop on the next page never reaches a dead handler.
export const useDrag = ({ onDrop }: UseDragInput) => {
  const [dropHover, setDropHover] = useState<boolean | undefined>(undefined);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    const body = document.body;
    const hover = (event: DragEvent) => {
      event.preventDefault();
      setDropHover(true);
    };
    const leave = () => setDropHover(false);
    const drop = (event: DragEvent) => onDropRef.current(event);

    body.addEventListener('dragover', hover);
    body.addEventListener('dragenter', hover);
    body.addEventListener('dragleave', leave);
    body.addEventListener('drop', drop);
    return () => {
      body.removeEventListener('dragover', hover);
      body.removeEventListener('dragenter', hover);
      body.removeEventListener('dragleave', leave);
      body.removeEventListener('drop', drop);
    };
  }, []);

  return { dropHover };
};
