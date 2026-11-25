import { convertDocxToHTML } from './convertDocxToHTML';
import type { DocxImageMediaSink } from './docxImageMediaSink';
import {
  STUDY_NOTES_FAN_OUT_HTML,
  STUDY_NOTES_HTML,
  studyNotes,
} from '../../../test/fakes/studyNotesDocx';

const figureSink: DocxImageMediaSink = { write: () => 'figure.png' };

describe('convertDocxToHTML output', () => {
  it('converts short study notes to the same HTML as before', async () => {
    expect(await convertDocxToHTML(studyNotes(), figureSink)).toBe(
      STUDY_NOTES_HTML
    );
  });

  it('converts short study notes with bullet fan-out to the same HTML as before', async () => {
    expect(
      await convertDocxToHTML(studyNotes(), figureSink, { bulletFanOut: true })
    ).toBe(STUDY_NOTES_FAN_OUT_HTML);
  });
});
