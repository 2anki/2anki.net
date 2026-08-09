import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import CardPreview from './CardPreview';

function makeCards(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    front: `Question ${i + 1}`,
    back: `Answer ${i + 1}`,
  }));
}

describe('CardPreview', () => {
  describe('card count display', () => {
    it('shows "1 card" for a single card', () => {
      render(<CardPreview cards={makeCards(1)} onSave={vi.fn()} />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText(/\bcard\b/)).toBeInTheDocument();
    });

    it('shows "N cards" for multiple cards', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  describe('card list display', () => {
    it('shows first 5 cards by default when there are more than 5', () => {
      render(<CardPreview cards={makeCards(8)} onSave={vi.fn()} />);
      expect(screen.getByText('Question 5')).toBeInTheDocument();
      expect(screen.queryByText('Question 6')).not.toBeInTheDocument();
    });

    it('shows all cards when count is 5 or fewer', () => {
      render(<CardPreview cards={makeCards(5)} onSave={vi.fn()} />);
      expect(screen.getByText('Question 5')).toBeInTheDocument();
      expect(screen.queryByText(/Show all/)).not.toBeInTheDocument();
    });
  });

  describe('expand toggle', () => {
    it('shows expand button when cards exceed 5', () => {
      render(<CardPreview cards={makeCards(8)} onSave={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: 'Show all 8 cards' })
      ).toBeInTheDocument();
    });

    it('shows all cards after clicking expand', () => {
      render(<CardPreview cards={makeCards(8)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Show all 8 cards' }));
      expect(screen.getByText('Question 8')).toBeInTheDocument();
    });

    it('shows "Show fewer" button after expanding', () => {
      render(<CardPreview cards={makeCards(8)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Show all 8 cards' }));
      expect(
        screen.getByRole('button', { name: 'Show fewer' })
      ).toBeInTheDocument();
    });

    it('collapses back to 5 after clicking show fewer', () => {
      render(<CardPreview cards={makeCards(8)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Show all 8 cards' }));
      fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
      expect(screen.queryByText('Question 6')).not.toBeInTheDocument();
    });
  });

  describe('save flow', () => {
    it('starts in idle state with Download deck button', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: 'Download deck' })
      ).toBeInTheDocument();
    });

    it('transitions to naming state when Download deck is clicked', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      expect(
        screen.getByRole('textbox', { name: 'Deck name' })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Cancel' })
      ).toBeInTheDocument();
    });

    it('input has default value of Untitled deck', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      expect(screen.getByRole('textbox', { name: 'Deck name' })).toHaveValue(
        'Untitled deck'
      );
    });

    it('calls onSave with the deck name when Save is clicked', () => {
      const onSave = vi.fn();
      render(<CardPreview cards={makeCards(3)} onSave={onSave} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      const input = screen.getByRole('textbox', { name: 'Deck name' });
      fireEvent.change(input, { target: { value: 'My Deck' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith('My Deck');
    });

    it('transitions to saved state after clicking Save', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByText(/Saved as/)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Save again' })
      ).toBeInTheDocument();
    });

    it('shows saved file name with .apkg extension in saved state', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      const input = screen.getByRole('textbox', { name: 'Deck name' });
      fireEvent.change(input, { target: { value: 'Biology' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByText('Saved as Biology.apkg')).toBeInTheDocument();
    });

    it('returns to naming state when Save again is clicked', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save again' }));
      expect(
        screen.getByRole('textbox', { name: 'Deck name' })
      ).toBeInTheDocument();
    });

    it('returns to idle state when Cancel is clicked and never saved', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(
        screen.getByRole('button', { name: 'Download deck' })
      ).toBeInTheDocument();
    });

    it('Save button is disabled when deck name is empty', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      const input = screen.getByRole('textbox', { name: 'Deck name' });
      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('submits on Enter key press', () => {
      const onSave = vi.fn();
      render(<CardPreview cards={makeCards(3)} onSave={onSave} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      const input = screen.getByRole('textbox', { name: 'Deck name' });
      fireEvent.change(input, { target: { value: 'Chemistry' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSave).toHaveBeenCalledWith('Chemistry');
    });

    it('cancels on Escape key press', () => {
      render(<CardPreview cards={makeCards(3)} onSave={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      const input = screen.getByRole('textbox', { name: 'Deck name' });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(
        screen.getByRole('button', { name: 'Download deck' })
      ).toBeInTheDocument();
    });

    it('sanitizes forbidden characters in deck name', () => {
      const onSave = vi.fn();
      render(<CardPreview cards={makeCards(3)} onSave={onSave} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
      const input = screen.getByRole('textbox', { name: 'Deck name' });
      fireEvent.change(input, { target: { value: 'My/Deck:Name' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith('My-Deck-Name');
    });
  });

  describe('MCQ rendering off card shape', () => {
    const mcqCard = {
      front: 'Which enzyme hydrolyses starch?',
      back: '',
      options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
      correctIndex: 1,
      rationale: 'Amylase breaks down starch.',
    };

    it('renders options and marks the correct one without a template prop', () => {
      render(<CardPreview cards={[mcqCard]} onSave={vi.fn()} />);
      expect(
        screen.getByText('Which enzyme hydrolyses starch?')
      ).toBeInTheDocument();
      for (const opt of mcqCard.options) {
        expect(screen.getByText(opt)).toBeInTheDocument();
      }
      expect(
        screen.getByLabelText('Correct answer').closest('li')
      ).toHaveTextContent('Amylase');
    });

    it('renders MCQ options even when template is not mcq', () => {
      render(
        <CardPreview cards={[mcqCard]} onSave={vi.fn()} template="basic" />
      );
      for (const opt of mcqCard.options) {
        expect(screen.getByText(opt)).toBeInTheDocument();
      }
      expect(screen.getByLabelText('Correct answer')).toBeInTheDocument();
    });

    it('labels the note type as Cloze when cards are cloze even if basic is selected', () => {
      render(
        <CardPreview
          cards={[
            { front: 'The capital of France is {{c1::Paris}}.', back: '' },
          ]}
          onSave={vi.fn()}
          template="basic"
          onTemplateChange={vi.fn()}
        />
      );
      expect(
        screen.getByRole('button', { name: 'Note type: Cloze' })
      ).toBeInTheDocument();
    });

    it('labels the note type as Multiple choice when cards are MCQ even if basic is selected', () => {
      render(
        <CardPreview
          cards={[mcqCard]}
          onSave={vi.fn()}
          template="basic"
          onTemplateChange={vi.fn()}
        />
      );
      expect(
        screen.getByRole('button', { name: 'Note type: Multiple choice' })
      ).toBeInTheDocument();
    });

    it('keeps basic cards as front/back rows even when an MCQ card is also present', () => {
      render(
        <CardPreview
          cards={[mcqCard, { front: 'Capital of France?', back: 'Paris' }]}
          onSave={vi.fn()}
        />
      );
      expect(screen.getByText('Capital of France?')).toBeInTheDocument();
      expect(screen.getByText('Paris')).toBeInTheDocument();
    });
  });

  describe('regenerating', () => {
    it('keeps the existing cards on screen instead of swapping in placeholders', () => {
      render(
        <CardPreview
          cards={makeCards(3)}
          onSave={vi.fn()}
          template="cloze"
          isRegenerating
        />
      );
      expect(screen.getByText('Question 1')).toBeInTheDocument();
      expect(screen.getByText('Answer 1')).toBeInTheDocument();
    });

    it('names the target template in the status banner', () => {
      render(
        <CardPreview
          cards={makeCards(3)}
          onSave={vi.fn()}
          template="cloze"
          isRegenerating
        />
      );
      expect(
        screen.getByRole('status', { name: 'Switching to Cloze' })
      ).toBeInTheDocument();
    });

    it('hides the Download button while regenerating', () => {
      render(
        <CardPreview
          cards={makeCards(3)}
          onSave={vi.fn()}
          template="cloze"
          isRegenerating
        />
      );
      expect(
        screen.queryByRole('button', { name: 'Download deck' })
      ).not.toBeInTheDocument();
    });
  });

  describe('selector-only state (no cards yet)', () => {
    it('shows the note type selector without the empty table chrome', () => {
      render(
        <CardPreview cards={[]} template="basic" onTemplateChange={vi.fn()} />
      );
      expect(
        screen.getByRole('button', { name: 'Note type: Basic' })
      ).toBeInTheDocument();
      expect(screen.queryByText('Front')).not.toBeInTheDocument();
      expect(screen.queryByText('Back')).not.toBeInTheDocument();
    });

    it('keeps the column labels when cards exist', () => {
      render(
        <CardPreview
          cards={makeCards(2)}
          onSave={vi.fn()}
          template="basic"
          onTemplateChange={vi.fn()}
        />
      );
      expect(screen.getAllByText('Front').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Back').length).toBeGreaterThan(0);
    });
  });
});
