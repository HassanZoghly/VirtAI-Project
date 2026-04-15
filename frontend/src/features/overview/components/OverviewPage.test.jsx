/* @vitest-environment happy-dom */

import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { OverviewPage } from '@/features/overview';

beforeEach(() => {
  // prevent test environment errors from window.scrollTo
  global.scrollTo = () => {};
});

const renderOverviewPage = () =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </HelmetProvider>
  );

describe('OverviewPage navbar anchors', () => {
  it('navbar targets map to existing section ids', () => {
    renderOverviewPage();

    const ids = ['features', 'how-it-works', 'demo', 'tech-stack'];
    ids.forEach((id) => {
      expect(document.getElementById(id)).toBeTruthy();
    });
  });

  it('does not render a team nav item', () => {
    renderOverviewPage();

    expect(screen.queryByRole('button', { name: /^team$/i })).toBeNull();
  });

  it('shows process subtitle in how-it-works section', () => {
    renderOverviewPage();

    const howItWorksSection = document.getElementById('how-it-works');
    expect(howItWorksSection).toBeTruthy();
    expect(
      within(howItWorksSection).getByText(
        /voice\s*→\s*asr\s*→\s*rag\s*→\s*llm\s*→\s*tts\s*→\s*avatar/i
      )
    ).toBeInTheDocument();
  });

  it('has exactly one timeline item marked as current step', () => {
    renderOverviewPage();

    const howItWorksSection = document.getElementById('how-it-works');
    expect(howItWorksSection).toBeTruthy();
    expect(howItWorksSection.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('renders pipeline playback controls', () => {
    renderOverviewPage();

    const howItWorksSection = document.getElementById('how-it-works');
    expect(howItWorksSection).toBeTruthy();
    expect(within(howItWorksSection).getByRole('button', { name: /^play$/i })).toBeInTheDocument();
    expect(within(howItWorksSection).getByRole('button', { name: /pause/i })).toBeInTheDocument();
    expect(
      within(howItWorksSection).getByRole('button', { name: /^replay$/i })
    ).toBeInTheDocument();
  });
});
