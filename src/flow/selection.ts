import type { FlowDocument } from '../types';

type ExplicitSelection = {
  nodeId?: string | null;
  edgeId?: string | null;
};

export type DeleteSelectionResult = {
  document: FlowDocument;
  deletedNodes: number;
  deletedEdges: number;
};

export function selectAllElements(document: FlowDocument): FlowDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => ({ ...node, selected: true })),
    edges: document.edges.map((edge) => ({ ...edge, selected: true }))
  };
}

export function clearElementSelection(document: FlowDocument): FlowDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => node.selected ? { ...node, selected: false } : node),
    edges: document.edges.map((edge) => edge.selected ? { ...edge, selected: false } : edge)
  };
}

export function deleteSelectedElements(
  document: FlowDocument,
  explicit: ExplicitSelection = {}
): DeleteSelectionResult {
  const selectedNodeIds = new Set(
    document.nodes
      .filter((node) => node.selected || node.id === explicit.nodeId)
      .map((node) => node.id)
  );
  const selectedEdgeIds = new Set(
    document.edges
      .filter((edge) => edge.selected || edge.id === explicit.edgeId)
      .map((edge) => edge.id)
  );
  const nodes = document.nodes.filter((node) => !selectedNodeIds.has(node.id));
  const edges = document.edges.filter((edge) => (
    !selectedEdgeIds.has(edge.id)
    && !selectedNodeIds.has(edge.source)
    && !selectedNodeIds.has(edge.target)
  ));

  return {
    document: { ...document, nodes, edges },
    deletedNodes: document.nodes.length - nodes.length,
    deletedEdges: document.edges.length - edges.length
  };
}
