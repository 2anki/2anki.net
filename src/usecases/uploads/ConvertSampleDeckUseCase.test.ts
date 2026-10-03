import fs from 'node:fs';
import path from 'node:path';

import { setupTests } from '../../test/configure-jest';
import Package from '../../lib/parser/Package';
import Workspace from '../../lib/parser/WorkSpace';
import GeneratePackagesUseCase from './GeneratePackagesUseCase';
import { ConvertSampleDeckUseCase } from './ConvertSampleDeckUseCase';
import UsersRepository from '../../data_layer/UsersRepository';

jest.mock('../../data_layer/UsersRepository');

beforeEach(() => setupTests());

function fakeGenerate(cardCount: number): GeneratePackagesUseCase {
  const execute = jest.fn(
    async (
      _paying: boolean,
      _files: unknown,
      _settings: unknown,
      ws: Workspace
    ) => {
      fs.writeFileSync(
        path.join(ws.location, 'sample.apkg'),
        Buffer.from('FAKE-APKG')
      );
      return {
        packages: [new Package('Sample deck — Biology 101', cardCount, 0, 0)],
      };
    }
  );
  return { execute } as unknown as GeneratePackagesUseCase;
}

describe('ConvertSampleDeckUseCase', () => {
  it('converts the bundled sample with the standard (non-paying) parser', async () => {
    const generate = fakeGenerate(8);
    const useCase = new ConvertSampleDeckUseCase(generate);

    const result = await useCase.execute();

    expect(result.cardCount).toBe(8);
    expect(result.deckName).toBe('Sample deck — Biology 101');
    expect(result.apkg.toString()).toBe('FAKE-APKG');
    const [paying] = (generate.execute as jest.Mock).mock.calls[0];
    expect(paying).toBe(false);
  });

  it('memoizes the conversion so repeat calls run the parser once', async () => {
    const generate = fakeGenerate(8);
    const useCase = new ConvertSampleDeckUseCase(generate);

    await useCase.execute();
    await useCase.execute();

    expect(generate.execute as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('never constructs a card-usage counter, so it cannot increment usage', async () => {
    const useCase = new ConvertSampleDeckUseCase(fakeGenerate(8));

    await useCase.execute();

    expect(UsersRepository as jest.Mock).not.toHaveBeenCalled();
  });
});
