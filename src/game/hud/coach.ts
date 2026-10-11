/**
 * First-run hint coach box (top center, GDD §O). Shows the HintDirector's current hint;
 * a click dismisses it (→ callbacks.onHintSeen).
 */
import type { HintDef } from '../../data/text';
import { h, setHidden, setText } from '../dom';
import { GLYPHS } from '../glyphs';

export class CoachBox {
  readonly el: HTMLDivElement;
  private readonly text: HTMLElement;
  private shownId = '';

  constructor(parent: HTMLElement, onDismiss: () => void) {
    this.el = h('div', 'bt-coach bt-hidden', parent);
    h('div', 'bt-coach-ic', this.el).innerHTML = GLYPHS.ember;
    const body = h('div', 'bt-coach-body', this.el);
    h('div', 'bt-coach-label', body, 'Counsel');
    this.text = h('div', 'bt-coach-text', body);
    const btn = h('button', 'bt-btn bt-coach-btn', this.el, 'Got it');
    btn.type = 'button';
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onDismiss();
    });
  }

  show(hint: HintDef | null): void {
    setHidden(this.el, !hint);
    if (!hint) {
      this.shownId = '';
      return;
    }
    if (hint.id !== this.shownId) {
      this.shownId = hint.id;
      setText(this.text, hint.text);
      this.el.classList.remove('enter');
      void this.el.offsetWidth;
      this.el.classList.add('enter');
    }
  }
}
