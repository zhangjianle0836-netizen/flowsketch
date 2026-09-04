import { describe, expect, it } from 'vitest';
import { createBlankDocument } from './document';
import { clearElementSelection, deleteSelectedElements, selectAllElements } from './selection';

describe('flow selection', () => {
  it('selects and clears every node and edge without changing their content', () => {
    const document = createBlankDocument();
    const selected = selectAllElements(document);

    expect(selected.nodes.every((node) => node.selected)).toBe(true);
    expect(selected.edges.every((edge) => edge.selected)).toBe(true);

    const cleared = clearElementSelection(selected);
    expect(cleared.nodes.every((node) => !node.selected)).toBe(true);
    expect(cleared.edges.every((edge) => !edge.selected)).toBe(true);
    expect(cleared.nodes.map((node) => node.id)).toEqual(document.nodes.map((node) => node.id));
    expect(cleared.edges.map((edge) => edge.id)).toEqual(document.edges.map((edge) => edge.id));
  });

  it('deletes all selected nodes together with their connected edges', () => {
    const document = createBlankDocument();
    document.nodes[0].selected = true;
    document.nodes[1].selected = true;

    const result = deleteSelectedElements(document);

    expect(result.deletedNodes).toBe(2);
    expect(result.deletedEdges).toBe(2);
    expect(result.document.nodes).toHaveLength(1);
    expect(result.document.edges).toHaveLength(0);
  });

  it('deletes multiple selected edges while keeping their nodes', () => {
    const document = createBlankDocument();
    document.edges.forEach((edge) => { edge.selected = true; });

    const result = deleteSelectedElements(document);

    expect(result.deletedNodes).toBe(0);
    expect(result.deletedEdges).toBe(2);
    expect(result.document.nodes).toHaveLength(3);
    expect(result.document.edges).toHaveLength(0);
  });
});
