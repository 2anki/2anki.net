import { HttpCodedError } from '../../lib/errors/HttpCodedError';

export const FREE_TIER_IMAGE_LIMIT = 3;

export class ImageLimitError extends HttpCodedError {
  constructor(readonly limit: number = FREE_TIER_IMAGE_LIMIT) {
    super(`Upgrade to process more than ${limit} images`, 403, 'image_limit');
  }
}
