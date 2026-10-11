/**
 * Reward pick: cards flip in with a rarity glow. Boons show name, rarity, tags, kind and text;
 * drafts show unit portraits and stats. Skip for +N Crowns.
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { BoonId, DraftId } from '../../sim/types';
import { BOONS } from '../../data/boons';
import { DRAFTS } from '../../data/drafts';
import { h } from '../dom';
import { boonCard, cardBack, draftCard } from '../ui/cards';
import { divider, glyph } from '../ui/glyphs';
import { runHeader } from '../ui/header';

export function mountReward(app: AppCtx): ScreenHandle {
  const run = app.run;
  const step = run ? app.guard('currentReward', () => app.api.currentReward(run)) : null;
  if (!run || !step || step.kind === 'retinue') {
    queueMicrotask(() => app.advance());
    return { el: h('div', { class: 'scr' }) };
  }
  const header = runHeader(app);
  const timers: number[] = [];
  let selected = -1;
  let busy = false;

  const options: (BoonId | DraftId)[] = step.options;
  const cardEls: HTMLElement[] = [];
  const isBoon = step.kind === 'boon';

  const claim = h('button', { class: 'btn primary lg', disabled: true }, glyph('check'), 'Claim');
  const choose = (choice: number | 'skip'): void => {
    if (busy || !app.run) return;
    busy = true;
    app.click();
    const next = app.guard('chooseReward', () => app.api.chooseReward(app.run!, app.meta, choice));
    if (next === undefined) {
      busy = false;
      return;
    }
    if (choice === 'skip') app.toast(`+${step.skipCrowns} Crowns`, 'good');
    app.advance();
  };
  claim.addEventListener('click', () => {
    if (selected >= 0) choose(selected);
  });

  const select = (i: number): void => {
    if (busy) return;
    if (selected !== i) app.click();
    selected = i;
    cardEls.forEach((c, j) => c.classList.toggle('selected', j === i));
    const name = isBoon ? BOONS[options[i] as BoonId]?.name : DRAFTS[options[i] as DraftId]?.name;
    claim.disabled = false;
    claim.replaceChildren(glyph('check'), `Claim ${name ?? ''}`.trim());
  };

  const row = h('div', { class: `reward-row ${isBoon ? 'boons' : 'drafts'} n${options.length}` });
  options.forEach((opt, i) => {
    const front = isBoon ? boonCard(opt as BoonId) : draftCard(opt as DraftId);
    front.classList.add('clickable');
    front.setAttribute('role', 'button');
    front.setAttribute('tabindex', '0');
    front.addEventListener('click', () => select(i));
    front.addEventListener('dblclick', () => choose(i));
    front.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (selected === i) choose(i);
        else select(i);
      }
    });
    cardEls.push(front);
    const flip = h(
      'div',
      { class: 'flip', style: `--d:${(0.15 + i * 0.2).toFixed(2)}s` },
      h('div', { class: 'flip-inner' }, h('div', { class: 'flip-face flip-back' }, cardBack()), h('div', { class: 'flip-face flip-front' }, front)),
    );
    row.appendChild(flip);
  });

  const skip = h(
    'button',
    { class: 'btn ghost', onclick: () => choose('skip') },
    glyph('skip'),
    'Skip',
    h('span', { class: 'crowns small' }, glyph('crown'), `+${step.skipCrowns}`),
  );

  const el = h(
    'div',
    { class: 'scr reward-scr' },
    header.el,
    h(
      'div',
      { class: 'scr-body reward-body' },
      h(
        'div',
        { class: 'scr-title-row' },
        h('div', { class: 'eyebrow' }, isBoon ? 'Choose a Boon' : 'Draft a new unit type'),
        h('h1', { class: 'display h1' }, step.title),
        divider(),
        step.subtitle ? h('div', { class: 'reward-subtitle' }, step.subtitle) : null,
        h('div', { class: 'small muted' }, isBoon ? 'Boons last for the whole march. Rule Boons change how you play.' : 'Drafted units can be trained in every battle that follows.'),
      ),
      row,
      h('div', { class: 'reward-actions' }, skip, claim),
    ),
  );

  return {
    el,
    mounted: () => {
      options.forEach((_, i) => {
        timers.push(window.setTimeout(() => app.sfx('card_flip'), (0.15 + i * 0.2) * 1000 + 120));
      });
    },
    destroy: () => timers.forEach((t) => window.clearTimeout(t)),
    onKey: (e) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        select(n - 1);
        return true;
      }
      if (e.key === 'Enter' && selected >= 0 && !(document.activeElement instanceof HTMLButtonElement)) {
        choose(selected);
        return true;
      }
      return false;
    },
  };
}
