import type { CSSProperties } from 'react';

export type FlowTheme = 'light' | 'dark';

/**
 * Keeps SVG paint properties inline so image exporters that deep-clone the
 * React Flow SVG do not lose edge styling from external stylesheets.
 */
export function edgePresentation(theme: FlowTheme, selected: boolean, style?: CSSProperties) {
  const color = selected
    ? (theme === 'dark' ? '#0a84ff' : '#0066cc')
    : (theme === 'dark' ? '#98989d' : '#8e8e93');

  return {
    color,
    style: {
      ...style,
      stroke: color,
      strokeWidth: selected ? 2.2 : style?.strokeWidth ?? 1.8,
      strokeLinecap: 'square',
      strokeLinejoin: 'miter'
    } satisfies CSSProperties
  };
}
