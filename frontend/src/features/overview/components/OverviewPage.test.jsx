/* @vitest-environment happy-dom */

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { OverviewPage } from '@/features/overview';

beforeEach(() => {
  // prevent test environment errors from window.scrollTo
  global.scrollTo = () => {};
});

describe('OverviewPage navbar anchors', () => {
  it('navbar targets map to existing section ids', () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );

    const ids = ['features', 'how-it-works', 'demo', 'tech-stack'];
    ids.forEach((id) => {
      expect(document.getElementById(id)).toBeTruthy();
    });
  });

  it('does not render a team nav item', () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );

    expect(screen.queryByText(/team/i)).toBeNull();
  });
});
