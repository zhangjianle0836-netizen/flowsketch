import { describe, expect, it } from 'vitest';
import { createBlankDocument, layoutDocument, parseFlowDocument } from './document';

describe('flow document', () => {
  it('round-trips a valid document through boundary validation', () => {
    const document = createBlankDocument();
    expect(parseFlowDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('rejects edges that point to unknown nodes', () => {
    const document = createBlankDocument();
    document.edges[0].target = 'missing';
    expect(() => parseFlowDocument(document)).toThrow('连线数据无效');
  });

  it('lays a linear flow out from left to right', () => {
    const document = layoutDocument(createBlankDocument());
    expect(document.nodes[0].position.x).toBeLessThan(document.nodes[1].position.x);
    expect(document.nodes[1].position.x).toBeLessThan(document.nodes[2].position.x);
  });

  it('preserves selected connection points when reopening a document', () => {
    const document = createBlankDocument();
    document.edges[0].sourceHandle = 'source-bottom-left';
    document.edges[0].targetHandle = 'target-top-right';
    const parsed = parseFlowDocument(JSON.parse(JSON.stringify(document)));
    expect(parsed.edges[0].sourceHandle).toBe('source-bottom-left');
    expect(parsed.edges[0].targetHandle).toBe('target-top-right');
  });

  it('repairs old handle IDs and displays legacy condition labels', () => {
    const document = createBlankDocument();
    document.edges[0].sourceHandle = 'source-bottom';
    document.edges[0].targetHandle = 'target-unknown';
    document.edges[0].data = { condition: '通过', portMode: 'fixed' };
    const parsed = parseFlowDocument(JSON.parse(JSON.stringify(document)));
    expect(parsed.edges[0].sourceHandle).toBeUndefined();
    expect(parsed.edges[0].targetHandle).toBeUndefined();
    expect(parsed.edges[0].label).toBe('通过');
  });
});
