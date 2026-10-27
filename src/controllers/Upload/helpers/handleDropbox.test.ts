import { vi } from 'vitest';
import type express from 'express';

const savedRows = vi.hoisted(() => [] as { table: string; rows: unknown }[]);

vi.mock('../../../services/observability/instrumentedAxios');

vi.mock('../../../data_layer', () => ({
  getDatabase: () => (table: string) => ({
    insert: async (rows: unknown) => {
      savedRows.push({ table, rows });
    },
  }),
}));

import instrumentedAxios from '../../../services/observability/instrumentedAxios';
import { handleDropbox } from './handleDropbox';

const mockedAxios = vi.mocked(instrumentedAxios);

const pickedSlides = {
  bytes: 4096,
  icon: '',
  id: 'id:lecture-slides',
  isDir: false,
  link: 'https://dl.dropboxusercontent.com/s/lecture.pptx',
  linkType: 'direct',
  name: 'lecture.pptx',
};

describe('handleDropbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedRows.length = 0;
  });

  it('hands a PowerPoint picked in Dropbox to the upload path with its name and bytes', async () => {
    const slideBytes = Buffer.from('PK\x03\x04 lecture slides');
    mockedAxios.get.mockResolvedValue({ data: slideBytes } as never);
    const req = {
      body: { files: JSON.stringify([pickedSlides]) },
    } as unknown as express.Request;
    const res = {
      locals: { owner: 42, subscriber: true },
    } as unknown as express.Response;
    const handleUpload = vi.fn();

    await handleDropbox(req, res, handleUpload);

    expect(mockedAxios.get).toHaveBeenCalledWith('dropbox', pickedSlides.link, {
      responseType: 'arraybuffer',
    });
    expect(handleUpload).toHaveBeenCalledWith(req, res);
    expect((req as unknown as { files: unknown[] }).files).toEqual([
      { originalname: 'lecture.pptx', size: 4096, buffer: slideBytes },
    ]);
  });
});
