import { describe, it, expect, beforeEach } from 'vitest';
import { PopoverButton, PopoverGroup } from '../src/popover';

describe('PopoverButton', () => {
  let mount: HTMLDivElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.append(mount);
  });

  function make(group?: PopoverGroup): PopoverButton {
    const pb = new PopoverButton({ icon: '☀', label: 'Light', group });
    mount.append(pb.root);
    return pb;
  }

  it('wires aria-haspopup and starts closed', () => {
    const pb = make();
    expect(pb.button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(pb.button.getAttribute('aria-expanded')).toBe('false');
    expect(pb.button.getAttribute('aria-label')).toBe('Light');
    expect(pb.panel.hidden).toBe(true);
    expect(pb.open).toBe(false);
  });

  it('toggles open/closed on button click and reflects aria-expanded', () => {
    const pb = make();
    pb.button.click();
    expect(pb.open).toBe(true);
    expect(pb.panel.hidden).toBe(false);
    expect(pb.button.getAttribute('aria-expanded')).toBe('true');
    pb.button.click();
    expect(pb.open).toBe(false);
    expect(pb.panel.hidden).toBe(true);
    expect(pb.button.getAttribute('aria-expanded')).toBe('false');
  });

  it('notifies onToggle with the new open state', () => {
    const pb = make();
    const states: boolean[] = [];
    pb.onToggle((open) => states.push(open));
    pb.button.click();
    pb.button.click();
    expect(states).toEqual([true, false]);
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const pb = make();
    pb.setOpen(true);
    pb.panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pb.open).toBe(false);
    expect(document.activeElement).toBe(pb.button);
  });

  it('closes on an outside pointerdown but not on a click inside the panel', () => {
    const pb = make();
    const inner = document.createElement('button');
    pb.panel.append(inner);
    pb.setOpen(true);

    // Pointerdown inside the panel: stays open.
    inner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(pb.open).toBe(true);

    // Pointerdown elsewhere in the document: dismisses.
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(pb.open).toBe(false);
  });

  it('enforces mutual exclusion within a group', () => {
    const group = new PopoverGroup();
    const a = make(group);
    const b = make(group);
    a.setOpen(true);
    expect(a.open).toBe(true);
    b.setOpen(true);
    expect(b.open).toBe(true);
    expect(a.open).toBe(false); // opening b closed a
  });

  it('focuses the first focusable control in the panel on open', () => {
    const pb = make();
    const first = document.createElement('input');
    const second = document.createElement('button');
    pb.panel.append(first, second);
    pb.setOpen(true);
    expect(document.activeElement).toBe(first);
  });

  it('removes its DOM and detaches from the group on dispose', () => {
    const group = new PopoverGroup();
    const pb = make(group);
    pb.setOpen(true);
    pb.dispose();
    expect(mount.querySelector('.popover')).toBeNull();
    // A now-disposed member must not be re-closed by the group.
    const other = make(group);
    expect(() => other.setOpen(true)).not.toThrow();
  });
});
