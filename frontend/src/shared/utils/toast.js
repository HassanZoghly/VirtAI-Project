import { toast as sonnerToast } from 'sonner';

class Toast {
  constructor(position = 'top-right', maxStack = 3) {
    this.position = position;
    this.maxStack = maxStack;
  }

  show(type, title, message, duration = 4000) {
    if (type === 'success') {
      sonnerToast.success(title, { description: message, duration });
    } else if (type === 'error') {
      sonnerToast.error(title, { description: message, duration });
    } else if (type === 'warning') {
      sonnerToast.warning(title, { description: message, duration });
    } else if (type === 'info') {
      sonnerToast.info(title, { description: message, duration });
    } else {
      sonnerToast(title, { description: message, duration });
    }
  }
}

export default Toast;
