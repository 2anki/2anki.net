import { withTextAlign } from './withTextAlign';
import CardOption from './Settings/CardOption';

describe('withTextAlign', () => {
  const baseStyle = '.card { font-family: sans-serif }';

  it('emits no alignment rule when the value is empty', () => {
    expect(withTextAlign(baseStyle, '')).toBe(baseStyle);
  });

  it('emits no alignment rule when the value is undefined', () => {
    expect(withTextAlign(baseStyle, undefined)).toBe(baseStyle);
  });

  it('appends a container-scoped text-align rule for left', () => {
    expect(withTextAlign(baseStyle, 'left')).toBe(
      `${baseStyle}\n.card { text-align:left }`
    );
  });

  it('appends a container-scoped text-align rule for right', () => {
    expect(withTextAlign(baseStyle, 'right')).toBe(
      `${baseStyle}\n.card { text-align:right }`
    );
  });

  it('scopes the alignment to the card container, not every element', () => {
    expect(withTextAlign(baseStyle, 'center')).not.toContain('* { text-align');
  });

  it('rejects a CSS-injection payload and emits no alignment rule', () => {
    expect(withTextAlign(baseStyle, 'left} body { display:none')).toBe(
      baseStyle
    );
  });

  it('rejects an arbitrary value outside the allowed set', () => {
    expect(withTextAlign(baseStyle, 'justify')).toBe(baseStyle);
  });

  it('passes a null style through unchanged', () => {
    expect(withTextAlign(null, 'left')).toBeNull();
  });
});

describe('CardOption text align parsing', () => {
  it('parses input["text-align"] into textAlign', () => {
    const option = new CardOption({ 'text-align': 'left' });
    expect(option.textAlign).toBe('left');
  });

  it('defaults textAlign to empty string when absent', () => {
    const option = new CardOption({});
    expect(option.textAlign).toBe('');
  });
});
