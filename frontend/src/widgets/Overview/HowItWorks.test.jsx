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
    expect(container.querySelector('[data-stage-phase="receiving"]')).toBeInTheDocument();
  });

  it('shows input/process/output/handoff artifacts in the active detail panel', () => {
    render(<HowItWorks />);
    const handoffLabel = screen.getByText(/^HANDOFF:/i);
    const detailPanel = handoffLabel.closest('article');

    expect(detailPanel).toBeInTheDocument();
    expect(within(detailPanel).getByText(/^IN:/i)).toBeInTheDocument();
    expect(within(detailPanel).getByText(/^PROC:/i)).toBeInTheDocument();
    expect(within(detailPanel).getByText(/^OUT:/i)).toBeInTheDocument();
    expect(within(detailPanel).getByText(/^HANDOFF:/i)).toBeInTheDocument();
  });
});
