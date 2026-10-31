/** Tiny DOM helper. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

export interface Settings {
  sensitivity: number;
  fov: number;
  maxDepth: number;
  maxPasses: number;
  quality: number;
  clipMode: 'shader' | 'oblique';
  volume: number;
  showStats: boolean;
  adaptive: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 75,
  maxDepth: 7,
  maxPasses: 28,
  quality: 1,
  clipMode: 'shader',
  volume: 0.6,
  showStats: false,
  adaptive: true,
};

const KEY = 'dream-architect:settings';

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Settings panel bound to a Settings object. */
export function settingsPanel(s: Settings, onChange: () => void, onClose: () => void): HTMLElement {
  const range = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt = (v: number) => String(v)) => {
    const out = h('output', {}, fmt(s[key] as number));
    const input = h('input', { type: 'range', min, max, step, value: s[key] as number });
    input.addEventListener('input', () => {
      (s[key] as number) = Number(input.value);
      out.textContent = fmt(s[key] as number);
      saveSettings(s);
      onChange();
    });
    return h('div', { class: 'row' }, h('label', {}, label), input, out);
  };
  const check = (label: string, key: 'showStats' | 'adaptive') => {
    const input = h('input', { type: 'checkbox' });
    input.checked = s[key];
    input.addEventListener('change', () => {
      s[key] = input.checked;
      saveSettings(s);
      onChange();
    });
    return h('div', { class: 'row' }, h('label', {}, label), input);
  };
  const clip = h('select', {}, h('option', { value: 'shader' }, 'GPU 裁剪平面（稳健）'), h('option', { value: 'oblique' }, '斜投影近裁剪（更快）'));
  clip.value = s.clipMode;
  clip.addEventListener('change', () => {
    s.clipMode = clip.value as Settings['clipMode'];
    saveSettings(s);
    onChange();
  });
  return h(
    'div',
    { class: 'panel' },
    h('h2', {}, '设置'),
    range('鼠标灵敏度', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)),
    range('视野 FOV', 'fov', 60, 100, 1),
    range('递归深度', 'maxDepth', 1, 10, 1),
    range('每帧视图上限', 'maxPasses', 4, 64, 1),
    range('分辨率', 'quality', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
    range('音量', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
    h('div', { class: 'row' }, h('label', {}, '门面裁剪'), clip),
    check('自适应性能', 'adaptive'),
    check('性能统计 (F3)', 'showStats'),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: onClose }, '完成')),
  );
}
