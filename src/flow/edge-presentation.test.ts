import { describe, expect, it } from 'vitest';
import { edgePresentation } from './edge-presentation';

describe('edgePresentation', () => {
  it('inlines the light theme stroke needed by SVG and PNG exports', () => {
    const presentation = edgePresentation('light', false);

    expect(presentation.color).toBe('#8e8e93');
    expect(presentation.style).toMatchObject({
      stroke: '#8e8e93',
      strokeWidth: 1.8,
      strokeLinecap: 'square',
      strokeLinejoin: 'miter'
    });
  });

  it('uses the selected dark theme color while preserving other inline styles', () => {
    const presentation = edgePresentation('dark', true, { opacity: 0.75, strokeWidth: 9 });

    expect(presentation.color).toBe('#0a84ff');
    expect(presentation.style.opacity).toBe(0.75);
    expect(presentation.style.stroke).toBe('#0a84ff');
    expect(presentation.style.strokeWidth).toBe(2.2);
  });
});
