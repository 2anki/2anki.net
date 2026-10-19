import { withTextColor } from './withTextColor';
import CardOption from './Settings/CardOption';

describe('withTextColor', () => {
  const baseStyle = '.card { font-family: sans-serif }';

  it('emits no color rule when the value is empty', () => {
    expect(withTextColor(baseStyle, '')).toBe(baseStyle);
  });

  it('emits no color rule when the value is undefined', () => {
    expect(withTextColor(baseStyle, undefined)).toBe(baseStyle);
  });

  it('appends an important container-scoped color rule for a valid swatch hex', () => {
    expect(withTextColor(baseStyle, '#1f6feb')).toBe(
      `${baseStyle}\n.card { color:#1f6feb !important }`
    );
  });

  it('scopes the color to the card container, not every element', () => {
    expect(withTextColor(baseStyle, '#d1242f')).not.toContain('* { color');
  });

  it('rejects a CSS-injection payload and emits no color rule', () => {
    expect(withTextColor(baseStyle, 'red} body { display:none')).toBe(
      baseStyle
    );
  });

  it('rejects an arbitrary hex outside the swatch set', () => {
    expect(withTextColor(baseStyle, '#000000')).toBe(baseStyle);
  });

  it('passes a null style through unchanged', () => {
    expect(withTextColor(null, '#1f6feb')).toBeNull();
  });
});

describe('CardOption text color parsing', () => {
  it('parses input["text-color"] into textColor', () => {
    const option = new CardOption({ 'text-color': '#1f6feb' });
    expect(option.textColor).toBe('#1f6feb');
  });

  it('defaults textColor to empty string when absent', () => {
    const option = new CardOption({});
    expect(option.textColor).toBe('');
  });
});
