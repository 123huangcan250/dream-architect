/** Keyboard/mouse state with edge detection and pointer lock. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  buttons = new Set<number>();
  private btnPressed = new Set<number>();
  private btnReleased = new Set<number>();
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'Tab', 'F1', 'F3'].includes(e.code) || ((e.ctrlKey || e.metaKey) && ['KeyS', 'KeyZ', 'KeyY', 'KeyD'].includes(e.code))) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.buttons.clear();
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.buttons.has(2)) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button);
      this.btnPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
      this.btnReleased.add(e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange?.(this.locked);
    });
  }

  lock(): void {
    if (!this.locked) {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    }
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  buttonPressed(b: number): boolean {
    return this.btnPressed.has(b);
  }

  buttonReleased(b: number): boolean {
    return this.btnReleased.has(b);
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.btnPressed.clear();
    this.btnReleased.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
