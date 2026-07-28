import {
  answerMarkerLength,
  questionMarkerLength,
  startsWithAnswerMarker,
  startsWithQuestionMarker,
} from './questionMarkers';

describe('question/answer markers', () => {
  it('matches the English Q:/A: pair', () => {
    expect(startsWithQuestionMarker('Q: What is osmosis?')).toBe(true);
    expect(startsWithAnswerMarker('A: Water crossing a membrane.')).toBe(true);
  });

  it('matches the German F:/A: pair', () => {
    expect(startsWithQuestionMarker('F: Was ist Osmose?')).toBe(true);
    expect(startsWithAnswerMarker('A: Wasser durch eine Membran.')).toBe(true);
  });

  it('matches the Russian Cyrillic В:/О: pair', () => {
    expect(startsWithQuestionMarker('В: Что такое осмос?')).toBe(true);
    expect(startsWithAnswerMarker('О: Вода через мембрану.')).toBe(true);
  });

  it('matches the Japanese 問/答 pair with a fullwidth colon', () => {
    expect(startsWithQuestionMarker('問：浸透とは？')).toBe(true);
    expect(startsWithAnswerMarker('答：膜を通る水。')).toBe(true);
  });

  it('does not treat an ordinary word as a marker', () => {
    expect(startsWithQuestionMarker('Photosynthesis converts light.')).toBe(
      false
    );
    expect(startsWithQuestionMarker('Question the assumptions carefully')).toBe(
      false
    );
    expect(startsWithAnswerMarker('Absorption happens in the gut.')).toBe(
      false
    );
  });

  it('reports the length of the matched marker prefix for slicing', () => {
    expect(questionMarkerLength('Q: What is osmosis?')).toBe(3);
    expect(answerMarkerLength('A:  Water.')).toBe(4);
    expect(questionMarkerLength('no marker here')).toBe(0);
  });
});
