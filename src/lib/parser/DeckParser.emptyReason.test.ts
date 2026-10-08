import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';
import { EmptyDeckError } from '../../usecases/jobs/EmptyDeckError';

beforeEach(() => setupTests());

const page = (body: string) =>
  `<html><head><title>x</title></head><body><article class="page" id="p"><div class="page-body">${body}</div></article></body></html>`;

const toggle = page(
  '<ul class="toggle"><li><details><summary>Capital of France</summary><p>Paris</p></details></li></ul>'
);

const prose = page(
  '<p>The mitochondria is the powerhouse of the cell and powers the body.</p>'
);

const blank = page('');

const makeParser = (
  name: string,
  contents: string,
  settingsInput: Record<string, string> = {}
) =>
  new DeckParser({
    name,
    settings: new CardOption(settingsInput),
    files: [{ name, contents }],
    noLimits: true,
    workspace: new Workspace(true, 'fs'),
  });

describe('DeckParser.emptyDeckReason', () => {
  it('reports no_content when the page has no readable text', () => {
    expect(makeParser('blank.html', blank).emptyDeckReason()).toBe(
      'no_content'
    );
  });

  it('reports no_toggles when there is text but no card structure', () => {
    expect(makeParser('prose.html', prose).emptyDeckReason()).toBe(
      'no_toggles'
    );
  });

  it('reports all_filtered when cherry-pick removed every toggle', () => {
    expect(
      makeParser('cherry.html', toggle, { cherry: 'true' }).emptyDeckReason()
    ).toBe('all_filtered');
  });

  it('reports no_toggles for a plain-text file with prose but no question/answer', () => {
    expect(
      makeParser(
        'notes.txt',
        'The mitochondria is the powerhouse of the cell.'
      ).emptyDeckReason()
    ).toBe('no_toggles');
  });

  it('reports no_content for an empty plain-text file', () => {
    expect(makeParser('blank.txt', '   ').emptyDeckReason()).toBe('no_content');
  });
});

describe('EmptyDeckError carries the classified reason', () => {
  it('throws from processPayload with the reason for an empty payload', async () => {
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'empty.html',
      settings: new CardOption({}),
      files: [{ name: 'empty.html', contents: '' }],
      noLimits: true,
      workspace,
    });

    await expect(parser.build(workspace)).rejects.toMatchObject({
      name: 'EmptyDeckError',
      reason: 'no_content',
    });
  });

  it('throws from tryExperimental with the classified reason', () => {
    const parser = makeParser('blank.html', blank);
    expect(() => parser.tryExperimental()).toThrow(EmptyDeckError);
    try {
      parser.tryExperimental();
    } catch (error) {
      expect((error as EmptyDeckError).reason).toBe('no_content');
    }
  });
});
