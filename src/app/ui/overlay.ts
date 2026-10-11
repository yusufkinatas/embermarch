/**
 * Modal dialogs (confirm / alert / custom) and the toast stack.
 */
import { h, type Child } from '../dom';
import { divider } from './glyphs';

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

export class Overlays {
  private readonly toastStack: HTMLDivElement;
  private readonly modals: { handle: ModalHandle; onEscape: () => void }[] = [];

  constructor(private readonly host: HTMLElement) {
    this.toastStack = h('div', { class: 'toast-stack' });
    host.appendChild(this.toastStack);
  }

  get hasModal(): boolean {
    return this.modals.length > 0;
  }

  /** Close the top-most modal via its Escape behavior. Returns true if one was open. */
  escape(): boolean {
    const top = this.modals[this.modals.length - 1];
    if (!top) return false;
    top.onEscape();
    return true;
  }

  closeAll(): void {
    while (this.modals.length) this.modals[this.modals.length - 1].handle.close();
  }

  /** Open a modal with arbitrary content. onEscape defaults to close. */
  open(content: Child, opts: { cls?: string; onEscape?: () => void } = {}): ModalHandle {
    const modal = h('div', { class: `modal panel studs ${opts.cls ?? ''}`.trim(), role: 'dialog', 'aria-modal': 'true' }, content);
    const backdrop = h('div', { class: 'modal-backdrop' }, modal);
    const handle: ModalHandle = {
      el: modal,
      close: () => {
        const i = this.modals.findIndex((m) => m.handle === handle);
        if (i >= 0) this.modals.splice(i, 1);
        backdrop.remove();
      },
    };
    this.modals.push({ handle, onEscape: opts.onEscape ?? (() => handle.close()) });
    this.host.appendChild(backdrop);
    return handle;
  }

  confirm(opts: { title: string; text: string; ok?: string; cancel?: string; danger?: boolean }, click: () => void): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: boolean): void => {
        if (done) return;
        done = true;
        click();
        handle.close();
        resolve(v);
      };
      const okBtn = h('button', { class: `btn ${opts.danger ? 'danger' : 'primary'}`, onclick: () => finish(true) }, opts.ok ?? 'Confirm');
      const handle = this.open(
        [
          h('h2', { class: 'display h2' }, opts.title),
          divider('narrow'),
          h('p', null, opts.text),
          h(
            'div',
            { class: 'modal-actions' },
            h('button', { class: 'btn ghost', onclick: () => finish(false) }, opts.cancel ?? 'Cancel'),
            okBtn,
          ),
        ],
        { onEscape: () => finish(false) },
      );
      requestAnimationFrame(() => okBtn.focus());
    });
  }

  alert(title: string, text: string, click: () => void): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        click();
        handle.close();
        resolve();
      };
      const okBtn = h('button', { class: 'btn primary', onclick: finish }, 'Onward');
      const handle = this.open(
        [h('h2', { class: 'display h2' }, title), divider('narrow'), h('p', null, text), h('div', { class: 'modal-actions' }, okBtn)],
        { onEscape: finish },
      );
      requestAnimationFrame(() => okBtn.focus());
    });
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 3200): void {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toastStack.appendChild(t);
    while (this.toastStack.children.length > 4) this.toastStack.firstElementChild?.remove();
    window.setTimeout(() => {
      t.classList.add('out');
      window.setTimeout(() => t.remove(), 380);
    }, ms);
  }
}
