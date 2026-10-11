/**
 * Settings modal: volume, mute, edge pan, pan speed, hints, reset progress (with confirm).
 * Changes persist to meta.settings immediately.
 */
import type { AppCtx } from '../types';
import { h } from '../dom';
import { divider, glyph } from './glyphs';

function toggleRow(app: AppCtx, label: string, desc: string, key: 'muted' | 'edgePan' | 'showHints'): HTMLElement {
  const t = h('button', { class: `toggle ${app.meta.settings[key] ? 'on' : ''}`, role: 'switch', 'aria-label': label });
  t.setAttribute('aria-checked', String(app.meta.settings[key]));
  t.addEventListener('click', () => {
    app.meta.settings[key] = !app.meta.settings[key];
    t.classList.toggle('on', app.meta.settings[key]);
    t.setAttribute('aria-checked', String(app.meta.settings[key]));
    app.persistMeta();
    app.applySettings();
    app.click();
  });
  return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('div', null, label), h('div', { class: 'tiny muted' }, desc)), t);
}

function sliderRow(
  app: AppCtx,
  label: string,
  key: 'sfxVolume' | 'panSpeed',
  min: number,
  max: number,
  step: number,
  fmt: (v: number) => string,
): HTMLElement {
  const value = h('span', { class: 'set-value num' }, fmt(app.meta.settings[key]));
  const input = h('input', { class: 'range', type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
  input.value = String(app.meta.settings[key]);
  const paint = (): void => {
    const v = Number(input.value);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    value.textContent = fmt(v);
  };
  paint();
  input.addEventListener('input', () => {
    app.meta.settings[key] = Number(input.value);
    paint();
    app.applySettings();
  });
  input.addEventListener('change', () => {
    app.persistMeta();
    if (key === 'sfxVolume') app.click();
  });
  return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, label), h('div', { class: 'set-slider' }, input, value));
}

export function openSettings(app: AppCtx): void {
  const resetBtn = h(
    'button',
    {
      class: 'btn danger sm',
      onclick: async () => {
        const ok = await app.confirm({
          title: 'Reset all progress?',
          text: 'Renown, unlocks, Houses, Thornbound tiers, statistics and any march in progress will be erased. This cannot be undone.',
          ok: 'Erase everything',
          danger: true,
        });
        if (!ok) return;
        const fresh = app.guard('defaultMeta', () => app.api.defaultMeta());
        if (!fresh) return;
        app.guard('clearRun', () => app.api.clearRun());
        app.meta = fresh;
        app.run = null;
        app.persistMeta();
        app.applySettings();
        handle.close();
        app.toast('Progress erased. The Last Flame burns anew.', 'info');
        app.go({ screen: 'title' });
      },
    },
    'Reset progress',
  );
  const handle = app.modal(
    [
      h('div', { class: 'row' }, glyph('gear', 'title-glyph'), h('h2', { class: 'display h2' }, 'Settings')),
      divider('narrow'),
      h('div', { class: 'set-section' }, 'Sound'),
      sliderRow(app, 'Effects volume', 'sfxVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggleRow(app, 'Mute', 'Silence all sound (M in battle).', 'muted'),
      h('div', { class: 'set-section' }, 'Battle'),
      toggleRow(app, 'Edge panning', 'Move the camera when the cursor touches the screen edge.', 'edgePan'),
      sliderRow(app, 'Camera pan speed', 'panSpeed', 0.5, 2, 0.1, (v) => `${v.toFixed(1)}×`),
      toggleRow(app, 'First-run hints', 'Coach boxes and explicit doctrine answers in briefings.', 'showHints'),
      h('div', { class: 'set-section' }, 'Progress'),
      h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('div', null, 'Reset progress'), h('div', { class: 'tiny muted' }, 'Erase all Renown, unlocks and the current march.')), resetBtn),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: () => { app.click(); handle.close(); } }, 'Done')),
    ],
    { cls: 'settings-modal' },
  );
}
