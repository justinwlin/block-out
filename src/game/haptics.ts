// Android vibrates. On iPhone a real tap of a switch is the only tick Safari still gives.

export class Haptics {
  enabled = true;
  private last = 0;
  private readonly canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  readonly iosTap = !this.canVibrate && typeof navigator !== 'undefined' &&
    (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  private label: HTMLLabelElement | null = null;

  constructor() {
    if (!this.iosTap || typeof document === 'undefined') return;
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-80px;top:0;width:1px;height:1px;opacity:0';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    document.body.append(label);
    this.label = label;
  }

  pulse(pattern: number | number[]) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.last < 28) return;
    this.last = now;
    if (this.canVibrate) {
      try { navigator.vibrate(pattern); } catch { /* unsupported pattern */ }
    } else if (this.label) {
      const ticks = Math.min(3, Math.ceil((typeof pattern === 'number' ? 1 : pattern.length) / 2));
      for (let i = 0; i < ticks; i++) setTimeout(() => this.label?.click(), i * 70);
    }
  }
}
