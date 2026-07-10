// A reusable icon-button-with-anchored-popover primitive for the control cluster.
//
// The raking-light and image-adjust panels (Phase 9/10) — and, later, Bands and
// Measure/Pan (Phase 11) — are all "click an icon button, a small panel floats out of
// it" affordances. This primitive owns the shared behaviour once: aria wiring
// (`aria-haspopup`/`aria-expanded`), focus management, Esc / click-outside dismissal,
// and mutual exclusion so opening one popover closes its siblings. Callers fill
// `panel` with content and drop `root` into the DOM; everything is shadow-DOM safe
// (dismissal uses `composedPath()`, not `contains()`, so it works across the boundary).

/**
 * Coordinates a set of popovers so at most one is open at a time. Every
 * {@link PopoverButton} in the same group closes when another in the group opens.
 */
export class PopoverGroup {
  readonly #members = new Set<PopoverButton>();

  register(member: PopoverButton): void {
    this.#members.add(member);
  }

  unregister(member: PopoverButton): void {
    this.#members.delete(member);
  }

  /** Close every open popover except `keep` (called when `keep` opens). */
  closeOthers(keep: PopoverButton): void {
    for (const member of this.#members) {
      if (member !== keep && member.open) {
        member.setOpen(false);
      }
    }
  }

  /** Close every open popover in the group. */
  closeAll(): void {
    for (const member of this.#members) {
      if (member.open) {
        member.setOpen(false);
      }
    }
  }
}

export interface PopoverButtonOptions {
  /** Glyph/text shown in the trigger button (e.g. "☀"). */
  icon: string;
  /** Accessible name for the trigger (aria-label + title tooltip). */
  label: string;
  /** Group for mutual exclusion; omit for an independent popover. */
  group?: PopoverGroup;
  /** Extra class on the trigger button (in addition to `tool popover-trigger`). */
  buttonClass?: string;
  /** Extra class on the panel (in addition to `popover-panel`). */
  panelClass?: string;
}

export class PopoverButton {
  /** Wrapper holding the trigger + panel; drop this into the DOM. */
  readonly root: HTMLDivElement;
  /** The icon trigger button. */
  readonly button: HTMLButtonElement;
  /** The floating panel; fill it with content. */
  readonly panel: HTMLDivElement;

  #group: PopoverGroup | undefined;
  #open = false;
  #onToggle: ((open: boolean) => void) | null = null;

  constructor(options: PopoverButtonOptions) {
    this.#group = options.group;

    this.root = document.createElement('div');
    this.root.className = 'popover';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = `tool popover-trigger${
      options.buttonClass ? ` ${options.buttonClass}` : ''
    }`;
    this.button.textContent = options.icon;
    this.button.setAttribute('aria-label', options.label);
    this.button.title = options.label;
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => this.toggle());

    this.panel = document.createElement('div');
    this.panel.className = `popover-panel${
      options.panelClass ? ` ${options.panelClass}` : ''
    }`;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', options.label);
    this.panel.hidden = true;
    // Esc inside the panel closes and returns focus to the trigger.
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.setOpen(false);
        this.button.focus();
      }
    });

    this.root.append(this.button, this.panel);
    this.#group?.register(this);
  }

  /** Whether the popover is currently open. */
  get open(): boolean {
    return this.#open;
  }

  /** Notified whenever the popover opens (true) or closes (false). */
  onToggle(callback: ((open: boolean) => void) | null): void {
    this.#onToggle = callback;
  }

  toggle(): void {
    this.setOpen(!this.#open);
  }

  /** Open or close the popover (idempotent). Opening closes group siblings. */
  setOpen(on: boolean): void {
    if (on === this.#open) {
      return;
    }
    this.#open = on;
    this.panel.hidden = !on;
    this.button.setAttribute('aria-expanded', String(on));
    if (on) {
      this.#group?.closeOthers(this);
      document.addEventListener('pointerdown', this.#onDocumentPointerDown, true);
      this.#focusFirst();
    } else {
      document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true);
    }
    this.#onToggle?.(on);
  }

  dispose(): void {
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true);
    this.#group?.unregister(this);
    this.root.remove();
  }

  /** Move focus to the first focusable control in the panel (else the panel itself). */
  #focusFirst(): void {
    const matches = [
      ...this.panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    // querySelectorAll can group by selector rather than document order (happy-dom),
    // so sort into true document order before taking the first.
    const focusable = matches.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )[0];
    if (focusable) {
      focusable.focus();
    } else {
      this.panel.tabIndex = -1;
      this.panel.focus();
    }
  }

  // Capture-phase so it fires before inner handlers; composedPath() sees through the
  // shadow boundary, so a click anywhere outside the trigger/panel dismisses.
  #onDocumentPointerDown = (event: Event): void => {
    const path = event.composedPath();
    if (!path.includes(this.button) && !path.includes(this.panel)) {
      this.setOpen(false);
    }
  };
}
