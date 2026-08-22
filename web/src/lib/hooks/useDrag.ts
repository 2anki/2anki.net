import { useEffect, useState } from 'react';

interface UseDragInput {
  onDrop: (event: DragEvent) => void;
}

export const useDrag = ({ onDrop }: UseDragInput) => {
  const [dropHover, setDropHover] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const body = document.getElementsByTagName('body')[0];
    body.ondragover = (event) => {
      setDropHover(true);
      event.preventDefault();
    };

    body.ondragenter = (event) => {
      event.preventDefault();
      setDropHover(true);
    };

    body.ondragleave = () => {
      setDropHover(false);
    };

    body.ondrop = onDrop;
  }, []);

  return { dropHover };
};
