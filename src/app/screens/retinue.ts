/**
 * Retinue pick: surviving veterans with portraits, rank chevrons and kills; pop counter vs cap.
 */
import type { AppCtx, ScreenHandle } from '../types';
import { UNITS } from '../../data/units';
import { CLASS_NAMES } from '../../data/text';
import { h, plural } from '../dom';
import { divider, glyph } from '../ui/glyphs';
import { runHeader } from '../ui/header';
import { portrait, rankName } from '../ui/portraits';
import { bestPicks, canAdd, popOf, unitPop } from '../logic/retinue';

export function mountRetinue(app: AppCtx): ScreenHandle {
  const run = app.run;
  const step = run ? app.guard('currentReward', () => app.api.currentReward(run)) : null;
  if (!run || !step || step.kind !== 'retinue') {
    queueMicrotask(() => app.advance());
    return { el: h('div', { class: 'scr' }) };
  }
  const header = runHeader(app);
  const cands = step.candidates;
  const cap = step.capPop;
  const picks = new Set<number>(bestPicks(cands, cap));
  let busy = false;

  const popV = h('span', { class: 'num' });
  const popFill = h('i');
  const confirm = h('button', { class: 'btn primary lg' });
  const cards: HTMLElement[] = [];

  const paint = (): void => {
    const pop = popOf(cands, picks);
    popV.textContent = `${pop} / ${cap}`;
    popFill.style.width = `${cap > 0 ? Math.min(100, (pop / cap) * 100) : 0}%`;
    cards.forEach((c, i) => {
      c.classList.toggle('selected', picks.has(i));
      c.classList.toggle('disabled', !picks.has(i) && !canAdd(cands, picks, i, cap));
    });
    confirm.replaceChildren(glyph('banner'), picks.size ? `March on with ${plural(picks.size, 'veteran')}` : 'March on alone');
  };

  const grid = h('div', { class: 'retinue-grid' });
  const order = cands.map((_, i) => i).sort((a, b) => cands[b].rank - cands[a].rank || cands[b].kills - cands[a].kills || a - b);
  const cardAt: HTMLElement[] = [];
  order.forEach((i) => {
    const u = cands[i];
    const def = UNITS[u.type];
    const card = h(
      'div',
      { class: 'card retinue-card clickable', role: 'checkbox', tabindex: '0' },
      h('span', { class: 'rc-check' }, glyph('check')),
      portrait(u.type, { size: 'lg', rank: u.rank }),
      h('div', { class: 'rc-name' }, def?.name ?? u.type),
      h('div', { class: 'rc-sub' }, `${rankName(u.rank)} · ${CLASS_NAMES[def?.cls ?? 'infantry']}`),
      h('div', { class: 'rc-foot' }, h('span', { class: 'chip' }, glyph('skull'), `${u.kills}`), h('span', { class: 'chip' }, glyph('people'), `${unitPop(u)} pop`)),
    );
    const toggle = (): void => {
      if (busy) return;
      if (picks.has(i)) picks.delete(i);
      else if (canAdd(cands, picks, i, cap)) picks.add(i);
      else {
        app.sfx('ui_error');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        app.toast(`The Retinue can carry ${cap} pop.`, 'bad');
        return;
      }
      app.click();
      paint();
    };
    card.addEventListener('click', toggle);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    cardAt[i] = card;
    grid.appendChild(card);
  });
  cards.push(...cardAt);

  confirm.addEventListener('click', () => {
    if (busy || !app.run) return;
    busy = true;
    app.click();
    const ordered = [...picks].sort((a, b) => a - b);
    const next = app.guard('chooseReward', () => app.api.chooseReward(app.run!, app.meta, 0, ordered));
    if (next === undefined) {
      busy = false;
      return;
    }
    app.advance();
  });

  const best = h(
    'button',
    {
      class: 'btn ghost sm',
      onclick: () => {
        app.click();
        picks.clear();
        for (const i of bestPicks(cands, cap)) picks.add(i);
        paint();
      },
    },
    glyph('chevrons'),
    'Best veterans',
  );
  const none = h(
    'button',
    {
      class: 'btn ghost sm',
      onclick: () => {
        app.click();
        picks.clear();
        paint();
      },
    },
    glyph('close'),
    'Clear',
  );

  const el = h(
    'div',
    { class: 'scr retinue-scr' },
    header.el,
    h(
      'div',
      { class: 'scr-body retinue-body' },
      h(
        'div',
        { class: 'scr-title-row' },
        h('div', { class: 'eyebrow' }, 'Veterans of the field'),
        h('h1', { class: 'display h1 retinue-title' }, step.title || 'Choose your Retinue'),
        divider(),
        step.subtitle ? h('div', { class: 'reward-subtitle' }, step.subtitle) : null,
        h('div', { class: 'small muted center' }, 'Chosen veterans march into the next battle beside the Hearth, keeping their Rank and kills. The rest return home.'),
        step.rankUp && !step.subtitle ? h('div', { class: 'small accent center' }, glyph('chevrons', 'inline-glyph'), " Veteran's Oath: every unit you carry gains +1 Rank.") : null,
      ),
      h(
        'div',
        { class: 'retinue-meter panel' },
        h('span', { class: 'label-caps' }, 'Retinue pop'),
        h('div', { class: 'bar' }, popFill),
        popV,
        h('span', { class: 'spacer' }),
        best,
        none,
      ),
      cands.length
        ? h('div', { class: 'retinue-scroll scroll' }, grid)
        : h('div', { class: 'panel panel-pad muted center' }, 'No soldiers survived to be carried forward.'),
      h('div', { class: 'reward-actions' }, confirm),
    ),
  );
  paint();
  return { el };
}
