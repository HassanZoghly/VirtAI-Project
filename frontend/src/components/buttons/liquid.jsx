import { useRef, useState } from 'react';
import './liquid.css';

/**
 * LiquidButton
 *
 * Props:
 *  - as        : element type / component to render (default: "button")
 *  - variant   : "primary" (default) | "secondary"
 *  - size      : "md" (default) | "sm" | "lg" | "icon"
 *  - className : extra classes
 *  - children
 *  - ...rest   : forwarded to the root element (onClick, href, to, type, etc.)
 */
export function LiquidButton({
  as: Tag = 'button',
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}) {
  const btnRef = useRef(null);
  const [ripple, setRipple] = useState(null);   // { x, y } of click
  const [active, setActive] = useState(false);   // mouse held

  /* ── Ripple origin on click ─────────────────── */
  const handlePointerDown = (e) => {
    const rect = btnRef.current.getBoundingClientRect();
    setRipple({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setActive(true);
    rest.onPointerDown?.(e);
  };

  const handlePointerUp = (e) => {
    setActive(false);
    rest.onPointerUp?.(e);
  };

  const classes = [
    'lq-btn',
    `lq-btn--${variant}`,
    `lq-btn--${size}`,
    active ? 'lq-btn--pressed' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      ref={btnRef}
      className={classes}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setActive(false)}
      {...rest}
    >
      {/* Liquid fill blob */}
      <span className="lq-btn__liquid" aria-hidden="true" />

      {/* Click-origin ripple */}
      {ripple && (
        <span
          className="lq-btn__ripple"
          aria-hidden="true"
          style={{ '--rx': `${ripple.x}px`, '--ry': `${ripple.y}px` }}
          onAnimationEnd={() => setRipple(null)}
        />
      )}

      {/* Label */}
      <span className="lq-btn__label">{children}</span>
    </Tag>
  );
}

export default LiquidButton;
