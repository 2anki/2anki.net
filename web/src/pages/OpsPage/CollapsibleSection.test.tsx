import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

import CollapsibleSection from './CollapsibleSection';
import { ScoreRow } from './todayTypes';

const summary: ScoreRow = {
  id: 'upload_to_download_7d',
  lever: 'acquisition',
  label: 'Upload → download',
  format: 'percent',
  window_label: '7d',
  value: 61.5,
  delta: null,
  delta_good: null,
  target: null,
  target_direction: null,
  status: 'none',
  link: '/ops/growth',
};

const renderAt = (
  path: string,
  props: Partial<Parameters<typeof CollapsibleSection>[0]> = {}
) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CollapsibleSection slug="upload-funnel" title="Upload funnel" {...props}>
        <div data-testid="body">body</div>
      </CollapsibleSection>
    </MemoryRouter>
  );

describe('CollapsibleSection', () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  test('starts collapsed and does not mount its body', () => {
    renderAt('/ops/growth');
    expect(screen.getByText('Upload funnel')).toBeInTheDocument();
    expect(screen.queryByTestId('body')).toBeNull();
    expect(document.querySelector('details')).not.toHaveAttribute('open');
  });

  test('mounts the body on first open and keeps it mounted after closing', () => {
    renderAt('/ops/growth');
    const details = document.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByTestId('body')).toBeInTheDocument();
    details.open = false;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });

  test('opens and scrolls to the section when the hash names it', () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    renderAt('/ops/growth#upload-funnel');
    expect(document.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByTestId('body')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  test('lets the user close a section the hash opened', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    renderAt('/ops/growth#upload-funnel');
    const details = document.querySelector('details') as HTMLDetailsElement;
    expect(details).toHaveAttribute('open');
    details.open = false;
    fireEvent(details, new Event('toggle'));
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });

  test('shows the headline metric, value and target in the summary row', () => {
    renderAt('/ops/growth', {
      summary: {
        ...summary,
        status: 'amber',
        target: 65,
        target_direction: 'at_least',
      },
    });
    expect(screen.getByText('61.5%')).toBeInTheDocument();
    expect(screen.getByText('≥65.0%')).toBeInTheDocument();
    expect(document.querySelector('summary')).toHaveAttribute(
      'data-status',
      'amber'
    );
    expect(screen.getByText(', status amber')).toBeInTheDocument();
  });

  test('renders a plain title when there is no headline metric', () => {
    renderAt('/ops/growth', { summary: null });
    expect(screen.queryByText('≥')).toBeNull();
    expect(document.querySelector('summary')).toHaveAttribute(
      'data-status',
      'none'
    );
  });
});
