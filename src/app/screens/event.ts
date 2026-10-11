/**
 * Event: illustrated plate, title, text, choice buttons (disabled with reasons), then the outcome
 * text and Continue.
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { EventView } from '../../run/types';
import { h, setChildren } from '../dom';
import { divider, glyph } from '../ui/glyphs';
import { runHeader } from '../ui/header';
import { plate } from '../ui/illustrations';
import { leaveIfOpen } from './common';

export function mountEvent(app: AppCtx, ev: EventView): ScreenHandle {
  const header = runHeader(app);
  let chosen = false;
  const choicesEl = h('div', { class: 'event-choices' });

  const showOutcome = (text: string): void => {
    const cont = h(
      'button',
      {
        class: 'btn primary lg',
        onclick: () => {
          app.click();
          leaveIfOpen(app);
          app.advance();
        },
      },
      'Continue',
      glyph('next'),
    );
    setChildren(choicesEl, h('div', { class: 'event-outcome' }, h('div', { class: 'eo-mark' }, glyph('scroll')), h('p', null, text)), h('div', { class: 'event-actions' }, cont));
    requestAnimationFrame(() => cont.focus({ preventScroll: true }));
  };

  for (const c of ev.choices) {
    const btn = h(
      'button',
      { class: 'event-choice', disabled: !c.enabled },
      h('span', { class: 'ec-label' }, c.label),
      h('span', { class: 'ec-desc' }, c.desc),
      !c.enabled && c.reason ? h('span', { class: 'ec-reason' }, glyph('lock'), c.reason) : null,
    );
    btn.addEventListener('click', () => {
      if (chosen || !app.run) return;
      chosen = true;
      app.click();
      const out = app.guard('chooseEventOption', () => app.api.chooseEventOption(app.run!, app.meta, c.id));
      if (!out) {
        chosen = false;
        return;
      }
      header.update();
      showOutcome(out.text);
    });
    choicesEl.appendChild(btn);
  }

  const el = h(
    'div',
    { class: 'scr event-scr' },
    header.el,
    h(
      'div',
      { class: 'scr-body event-body' },
      h(
        'article',
        { class: 'panel studs event-panel' },
        h('div', { class: 'plate' }, plate(ev.id), h('div', { class: 'plate-title' }, h('div', { class: 'eyebrow' }, 'On the road'), h('h1', { class: 'display h1' }, ev.title))),
        h('div', { class: 'event-text' }, ev.text),
        divider(),
        choicesEl,
      ),
    ),
  );
  return { el };
}
