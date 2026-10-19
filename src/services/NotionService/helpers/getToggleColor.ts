import { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { isToggleHeading } from './isToggleHeading';

export function getToggleColor(block: BlockObjectResponse): string | undefined {
  if (block.type === 'toggle') {
    return block.toggle.color;
  }
  if (!isToggleHeading(block)) {
    return undefined;
  }
  switch (block.type) {
    case 'heading_1':
      return block.heading_1.color;
    case 'heading_2':
      return block.heading_2.color;
    case 'heading_3':
      return block.heading_3.color;
    case 'heading_4':
      return block.heading_4.color;
    default:
      return undefined;
  }
}
