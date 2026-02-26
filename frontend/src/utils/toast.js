class Toast {
  constructor(position = 'tr', maxStack = 3) {
    this.maxStack = maxStack;
    this.container = document.querySelector(`.toast-container[data-position="${position}"]`);
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      this.container.dataset.position = position;
      document.body.appendChild(this.container);
    }
  }

  show(type, title, message, duration = 4000) {
    const activeToasts = this.container.querySelectorAll('.toast');
    if (activeToasts.length >= this.maxStack) {
      activeToasts[0].remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${this.getIcon(type)}</div>
      <div class="toast-content">
        <b>${title}</b>
        <div>${message}</div>
      </div>
      <button class="toast-close">&times;</button>
      <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
    `;

    this.container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    const close = () => {
      toast.style.animation = 'fadeOut 0.2s forwards';
      setTimeout(() => toast.remove(), 200);
    };
    closeBtn.addEventListener('click', close);
    setTimeout(close, duration);
  }

  getIcon(type) {
    const icons = {
      success: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
      error: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>',
      warning: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.73 18l-8-14a2 2 0 00-3.48 0l-8 14A2 2 0 004 21h16a2 2 0 001.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
      info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    };
    return icons[type] || '';
  }
}

export default Toast;