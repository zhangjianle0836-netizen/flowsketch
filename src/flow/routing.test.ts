import { describe, expect, it } from 'vitest';
import type { FlowEdge, StageNode } from '../types';
import { routeDiagramEdges, updateDiagramRoutes, validEdgeRoute } from './routing';

function node(id: string, x: number, y: number): StageNode {
  return {
    id,
    type: 'stage',
    position: { x, y },
    measured: { width: 210, height: 88 },
    data: { title: id, notes: '', kind: 'process' }
  };
}

describe('routeDiagramEdges', () => {
  it('rejects a route that reenters its source node after leaving a bottom port', () => {
    const nodes = [node('source', 0, 0), node('target', 310, 178)];
    const edge: FlowEdge = { id: 'edge', source: 'source', target: 'target', sourceHandle: 'source-bottom-left', targetHandle: 'target-top-left' };
    const crossing = [{ x: 71.4, y: 88 }, { x: 71.4, y: 83 }, { x: 381.4, y: 83 }, { x: 381.4, y: 178 }];

    expect(validEdgeRoute(nodes, edge, crossing)).toBe(false);
    expect(validEdgeRoute(nodes, edge, routeDiagramEdges(nodes, [edge]).get(edge.id)!)).toBe(true);
  });

  it('routes around a node that blocks the direct corridor', () => {
    const nodes = [node('source', 0, 100), node('blocker', 260, 100), node('target', 560, 100)];
    const edges: FlowEdge[] = [{
      id: 'edge',
      source: 'source',
      target: 'target',
      sourceHandle: 'source-right',
      targetHandle: 'target-left'
    }];
    const route = routeDiagramEdges(nodes, edges).get('edge')!;
    const blocker = { left: 246, right: 484, top: 86, bottom: 202 };
    const crossesBlocker = route.slice(2, -1).some((point, index) => {
      const before = route[index + 1];
      if (Math.abs(before.y - point.y) < 0.01) {
        return point.y > blocker.top && point.y < blocker.bottom &&
          Math.max(before.x, point.x) > blocker.left && Math.min(before.x, point.x) < blocker.right;
      }
      return point.x > blocker.left && point.x < blocker.right &&
        Math.max(before.y, point.y) > blocker.top && Math.min(before.y, point.y) < blocker.bottom;
    });
    expect(crossesBlocker).toBe(false);
    expect(route.length).toBeGreaterThan(4);
    expect(route.slice(1).every((point, index) => (
      Math.abs(route[index].x - point.x) < 0.01 || Math.abs(route[index].y - point.y) < 0.01
    ))).toBe(true);
  });

  it('assigns different corridors to reciprocal overlapping edges', () => {
    const nodes = [node('left', 0, 100), node('right', 420, 100)];
    const edges: FlowEdge[] = [
      { id: 'forward', source: 'left', target: 'right', sourceHandle: 'source-right', targetHandle: 'target-left' },
      { id: 'backward', source: 'right', target: 'left', sourceHandle: 'source-left', targetHandle: 'target-right' }
    ];
    const routes = routeDiagramEdges(nodes, edges);
    expect(routes.get('forward')).not.toEqual([...(routes.get('backward') || [])].reverse());
  });

  it('keeps unrelated routes stable when a distant endpoint is dragged', () => {
    const nodes = [
      node('start', -80, 192),
      node('upper', 252, 128),
      node('lower', 252, 278),
      node('decision', 560, 128),
      node('right', 848, 208)
    ];
    const edges: FlowEdge[] = [
      { id: 'upper-edge', source: 'start', target: 'upper', sourceHandle: 'source-right', targetHandle: 'target-left' },
      { id: 'lower-edge', source: 'start', target: 'lower', sourceHandle: 'source-right', targetHandle: 'target-left' },
      { id: 'decision-edge', source: 'upper', target: 'decision', sourceHandle: 'source-right', targetHandle: 'target-left' },
      { id: 'right-edge', source: 'decision', target: 'right', sourceHandle: 'source-right', targetHandle: 'target-left' }
    ];
    const initial = updateDiagramRoutes(nodes, edges);
    const movedNodes = nodes.map((item) => item.id === 'right'
      ? { ...item, position: { x: 960, y: 352 } }
      : item);
    const updated = updateDiagramRoutes(movedNodes, edges, initial);

    expect(updated.routes.get('lower-edge')).toBe(initial.routes.get('lower-edge'));
    expect(updated.routes.get('upper-edge')).toBe(initial.routes.get('upper-edge'));
    expect(updated.routes.get('decision-edge')).toBe(initial.routes.get('decision-edge'));
    expect(updated.routes.get('right-edge')).not.toEqual(initial.routes.get('right-edge'));
  });

  it('re-routes a blocked edge after a non-drag position update', () => {
    const nodes = [node('source', 0, 100), node('target', 560, 100), node('moving', 260, 320)];
    const edges: FlowEdge[] = [{
      id: 'edge',
      source: 'source',
      target: 'target',
      sourceHandle: 'source-right',
      targetHandle: 'target-left'
    }];
    const initial = updateDiagramRoutes(nodes, edges);
    const movedNodes = nodes.map((item) => item.id === 'moving'
      ? { ...item, position: { x: 260, y: 100 } }
      : item);
    const updated = updateDiagramRoutes(movedNodes, edges, initial);

    expect(updated.routes.get('edge')).not.toEqual(initial.routes.get('edge'));
  });

  it('re-routes a blocked unrelated edge once dragging has finished', () => {
    const nodes = [node('source', 0, 100), node('target', 560, 100), node('moving', 260, 320)];
    const edges: FlowEdge[] = [{
      id: 'edge',
      source: 'source',
      target: 'target',
      sourceHandle: 'source-right',
      targetHandle: 'target-left'
    }];
    const initial = updateDiagramRoutes(nodes, edges);
    const draggingNodes = nodes.map((item) => item.id === 'moving'
      ? { ...item, dragging: true, position: { x: 260, y: 100 } }
      : item);
    const whileDragging = updateDiagramRoutes(draggingNodes, edges, initial);
    const droppedNodes = draggingNodes.map((item) => item.id === 'moving'
      ? { ...item, dragging: false }
      : item);
    const afterDrop = updateDiagramRoutes(droppedNodes, edges, whileDragging);

    expect(whileDragging.routes.get('edge')).toBe(initial.routes.get('edge'));
    expect(whileDragging.dirtyEdgeIds.has('edge')).toBe(false);
    expect(afterDrop.routes.get('edge')).not.toBe(initial.routes.get('edge'));
    expect(afterDrop.dirtyEdgeIds.has('edge')).toBe(true);
    expect(afterDrop.routes.get('edge')!.length).toBeGreaterThan(2);
  });
});
