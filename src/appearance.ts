export type Appearance = { theme: 'dark' | 'light' | 'system'; fontSize: number; zoom: number };
export const appearanceKey = 'seat-workspace-appearance';
export const defaultAppearance: Appearance = { theme: 'dark', fontSize: 16, zoom: 100 };
export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(appearanceKey) || '{}');
    return {
      theme: ['dark', 'light', 'system'].includes(saved.theme) ? saved.theme : defaultAppearance.theme,
      fontSize: typeof saved.fontSize === 'number' ? Math.min(20, Math.max(12, saved.fontSize)) : defaultAppearance.fontSize,
      zoom: typeof saved.zoom === 'number' ? Math.min(125, Math.max(80, saved.zoom)) : defaultAppearance.zoom,
    };
  } catch { return { ...defaultAppearance }; }
}
export function applyAppearance(value: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = value.theme;
  root.style.colorScheme = value.theme === 'system' ? 'light dark' : value.theme;
  root.style.fontSize = value.fontSize + 'px';
  root.style.setProperty('zoom', value.zoom + '%');
}
applyAppearance(readAppearance());
window.addEventListener('storage', event => {
  if (event.key === appearanceKey || event.key === null) applyAppearance(readAppearance());
});
