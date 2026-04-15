/* @vitest-environment happy-dom */

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HowItWorks, { PIPELINE_PHASE_DURATION_MS } from '@/widgets/Overview/HowItWorks';

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
    expect(container.querySelector('[data-stage-phase="receiving"]')).toBeInTheDocument();
  });

  it('shows input/process/output/handoff artifacts in the active detail panel', () => {
    render(<HowItWorks />);
    const detailPanel = screen.getAllByText(/^HANDOFF:/i)[0]?.closest('article');

    expect(detailPanel).toBeInTheDocument();
    expect(within(detailPanel).getByText(/^IN:/i)).toBeInTheDocument();
    expect(within(detailPanel).getByText(/^PROC:/i)).toBeInTheDocument();
    expect(within(detailPanel).getByText(/^OUT:/i)).toBeInTheDocument();
    expect(within(detailPanel).getByText(/^HANDOFF:/i)).toBeInTheDocument();
  });

  it('marks previous stages completed after sequential playback', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<HowItWorks />);

      fireEvent.click(screen.getAllByRole('button', { name: /^play$/i })[0]);
      vi.advanceTimersByTime(PIPELINE_PHASE_DURATION_MS * 5 + 120);

      const firstStage = container.querySelector('[data-step-index="0"]');
      const secondStage = container.querySelector('[data-step-index="1"]');

      expect(container.querySelectorAll('[data-stage-state="active"]')).toHaveLength(1);
      expect(firstStage).toHaveAttribute('data-stage-state', 'completed');
      expect(secondStage).toHaveAttribute('data-stage-state', 'active');
    } finally {
      vi.useRealTimers();
    }
  });
});
