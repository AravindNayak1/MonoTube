/**
 * Shared "blocked" notice, used by:
 *  - the homepage overlay (variant "inline": a card above the search box, after the Shorts DNR
 *    redirect landed the user on /?mt_shorts=<id>), and
 *  - the Shorts module (variant "page": a centred card on a full-screen opaque backdrop).
 *
 * The component only renders; callers own placement, keyboard handling and lifecycle.
 * Styles are added to the UiRoot shadow root once (key "notice").
 */

import noticeCss from './notice.css?inline';
import type { UiRoot } from './root';
import { h, icon, logoMark } from './dom';

export interface NoticeAction {
  /** data-testid of the button (used by the end-to-end tests). */
  testId: string;
  label: string;
  kind: 'primary' | 'secondary';
  icon?: readonly string[];
  onSelect: () => void;
}

export interface NoticeOptions {
  variant: 'inline' | 'page';
  /** data-testid of the notice card. */
  testId: string;
  title: string;
  body: string;
  actions: readonly NoticeAction[];
  /** Page variant only: describes what Esc does, rendered as a quiet "Esc <hint>" line. */
  escHint?: string;
}

export interface Notice {
  /** Element to insert. For the page variant this is the full-screen backdrop holding the card. */
  readonly el: HTMLElement;
  /** Show or hide one action (by test id) without rebuilding the notice. */
  setActionVisible(testId: string, visible: boolean): void;
  /** Move focus to the first visible action. */
  focusFirstAction(): void;
  /** Remove the notice from the DOM. */
  destroy(): void;
}

/** Circle with a diagonal stroke ("not allowed"), on the 24×24 icon grid. */
const BLOCKED_GLYPH = ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.64 5.64l12.72 12.72'];

let sequence = 0;

export function createNotice(ui: UiRoot, opts: NoticeOptions): Notice {
  ui.addStyles('notice', noticeCss);

  const id = `mt-notice-${++sequence}`;
  const isPage = opts.variant === 'page';

  const buttons = new Map<string, HTMLButtonElement>();
  const actionEls = opts.actions.map((action) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: `mt-notice__btn mt-notice__btn--${action.kind}`,
        'data-testid': action.testId,
      },
      [action.icon ? icon([...action.icon], 16, 2) : null, h('span', {}, [action.label])],
      { click: () => action.onSelect() },
    );
    buttons.set(action.testId, btn);
    return btn;
  });

  const title = h('h2', { class: 'mt-notice__title', id: `${id}-title` }, [opts.title]);
  const body = h('p', { class: 'mt-notice__body', id: `${id}-body` }, [opts.body]);
  const actions = h('div', { class: 'mt-notice__actions' }, actionEls);

  let el: HTMLElement;
  if (isPage) {
    const card = h(
      'section',
      {
        class: 'mt-notice mt-notice--page',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': title.id,
        'aria-describedby': body.id,
        'data-testid': opts.testId,
      },
      [
        h('div', { class: 'mt-notice__mark', 'aria-hidden': 'true' }, [
          logoMark(30),
          h('span', { class: 'mt-notice__badge' }, [icon(BLOCKED_GLYPH, 14, 2.25)]),
        ]),
        title,
        body,
        actions,
        opts.escHint
          ? h('p', { class: 'mt-notice__hint' }, [h('kbd', { class: 'mt-notice__kbd' }, ['Esc']), ` ${opts.escHint}`])
          : null,
      ],
    );
    el = h('div', { class: 'mt-notice-backdrop' }, [card]);
  } else {
    el = h(
      'section',
      {
        class: 'mt-notice mt-notice--inline',
        role: 'status',
        'aria-labelledby': title.id,
        'aria-describedby': body.id,
        'data-testid': opts.testId,
      },
      [
        h('div', { class: 'mt-notice__glyph', 'aria-hidden': 'true' }, [icon(BLOCKED_GLYPH, 20, 2)]),
        h('div', { class: 'mt-notice__text' }, [title, body]),
        actions,
      ],
    );
  }

  return {
    el,
    setActionVisible(testId, visible) {
      const btn = buttons.get(testId);
      if (btn && btn.hidden === visible) btn.hidden = !visible;
    },
    focusFirstAction() {
      const first = actionEls.find((b) => !b.hidden);
      first?.focus({ preventScroll: true });
    },
    destroy() {
      el.remove();
    },
  };
}
