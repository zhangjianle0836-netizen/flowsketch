import type { FlowDocument, StageNode } from '../types';
import { createId, createStage } from './document';

export type Alignment = 'left' | 'center' | 'top' | 'middle' | 'horizontal' | 'vertical';
const dimensions = (node: StageNode) => ({ width: node.measured?.width || node.width || 210, height: node.measured?.height || node.height || (node.data.kind === 'decision' ? 140 : 88) });

export function alignSelection(document: FlowDocument, mode: Alignment): FlowDocument {
  const selected = document.nodes.filter((node) => node.selected);
  if (selected.length < (mode === 'horizontal' || mode === 'vertical' ? 3 : 2)) return document;
  const positions = new Map<string, { x: number; y: number }>();
  if (mode === 'horizontal' || mode === 'vertical') {
    const axis = mode === 'horizontal' ? 'x' : 'y';
    const extent = (node: StageNode) => mode === 'horizontal' ? dimensions(node).width : dimensions(node).height;
    const sorted = [...selected].sort((a, b) => a.position[axis] - b.position[axis]);
    const first = sorted[0].position[axis];
    const last = sorted.at(-1)!;
    const totalSize = sorted.reduce((sum, node) => sum + extent(node), 0);
    const gap = (last.position[axis] + extent(last) - first - totalSize) / (sorted.length - 1);
    // Do not distribute into overlapping boxes when the available span is too small.
    let cursor = first;
    for (const node of sorted) {
      positions.set(node.id, { ...node.position, [axis]: cursor });
      cursor += extent(node) + Math.max(32, gap);
    }
  } else {
    const left = Math.min(...selected.map((node) => node.position.x));
    const top = Math.min(...selected.map((node) => node.position.y));
    const right = Math.max(...selected.map((node) => node.position.x + dimensions(node).width));
    const bottom = Math.max(...selected.map((node) => node.position.y + dimensions(node).height));
    for (const node of selected) positions.set(node.id, {
      x: mode === 'left' ? left : mode === 'center' ? (left + right - dimensions(node).width) / 2 : node.position.x,
      y: mode === 'top' ? top : mode === 'middle' ? (top + bottom - dimensions(node).height) / 2 : node.position.y
    });
  }
  return { ...document, nodes: document.nodes.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node) };
}

/** Duplicate the selected subgraph, including internal links but no external links. */
export function duplicateSelection(document: FlowDocument): FlowDocument {
  const selected = document.nodes.filter((node) => node.selected);
  if (!selected.length) return document;
  const mapping = new Map(selected.map((node) => [node.id, createId('node')]));
  const copies = selected.map((node) => ({ ...node, id: mapping.get(node.id)!, position: { x: node.position.x + 48, y: node.position.y + 48 }, data: { ...node.data }, selected: true }));
  const edges = document.edges.filter((edge) => mapping.has(edge.source) && mapping.has(edge.target)).map((edge) => ({
    ...edge, id: createId('edge'), source: mapping.get(edge.source)!, target: mapping.get(edge.target)!, selected: false,
    data: edge.data ? { ...edge.data, route: undefined, waypoints: edge.data.waypoints?.map((point) => ({ x: point.x + 48, y: point.y + 48 })) } : undefined
  }));
  return { ...document, nodes: [...document.nodes.map((node) => ({ ...node, selected: false })), ...copies], edges: [...document.edges.map((edge) => ({ ...edge, selected: false })), ...edges] };
}

export function insertStageOnEdge(document: FlowDocument, edgeId: string): FlowDocument {
  const edge = document.edges.find((item) => item.id === edgeId);
  const source = document.nodes.find((node) => node.id === edge?.source);
  const target = document.nodes.find((node) => node.id === edge?.target);
  if (!edge || !source || !target) return document;
  const node = { ...createStage('process', { x: (source.position.x + target.position.x) / 2, y: (source.position.y + target.position.y) / 2 }), selected: true };
  // Find space rather than covering a neighboring branch or either endpoint.
  while (document.nodes.some((other) => node.position.x < other.position.x + dimensions(other).width + 24 && node.position.x + 234 > other.position.x && node.position.y < other.position.y + dimensions(other).height + 24 && node.position.y + 112 > other.position.y)) node.position.y += 160;
  const vertical = document.direction === 'TB';
  const first = { ...edge, target: node.id, targetHandle: vertical ? 'target-top-left' : 'target-left', selected: false, data: { ...edge.data, waypoints: undefined, route: undefined } };
  const second = { id: createId('edge'), source: node.id, target: target.id, sourceHandle: vertical ? 'source-bottom-left' : 'source-right', targetHandle: edge.targetHandle, type: 'smoothstep' };
  return { ...document, nodes: [...document.nodes.map((item) => ({ ...item, selected: false })), node], edges: [...document.edges.filter((item) => item.id !== edgeId).map((item) => ({ ...item, selected: false })), first, second] };
}
