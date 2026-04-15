/* @vitest-environment happy-dom */

import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HowItWorks from '@/widgets/Overview/HowItWorks';

describe('HowItWorks', () => {
  it('renders playback controls', () => {
    render(<HowItWorks />);

    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^replay$/i })).toBeInTheDocument();
  });

  it('marks one active stage and exposes stage phase metadata', () => {
    const { container } = render(<HowItWorks />);

    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-stage-state="active"]')).toHaveLength(1);
    expect(container.querySelector('[data-stage-phase="processing"]')).toBeInTheDocument();
  });

  it('shows input/process/output artifacts in the active stage card', () => {
    const { container } = render(<HowItWorks />);
    const activeStage = container.querySelector('[aria-current="step"]');

    expect(activeStage).toBeInTheDocument();
    expect(within(activeStage).getByText(/^IN:/i)).toBeInTheDocument();
    expect(within(activeStage).getByText(/^PROC:/i)).toBeInTheDocument();
    expect(within(activeStage).getByText(/^OUT:/i)).toBeInTheDocument();
  });
});
