import { beforeAll, describe, expect, it } from 'vitest';
import { AvoidLib } from 'libavoid-js';
import type { FlowEdge, StageNode } from '../types';
import { createLibavoidEdgeRouter } from './libavoid';
import type { EdgeRouter } from './routing';

function node(id: string, x: number, y: number): StageNode {
  return {
    id,
    type: 'stage',
    position: { x, y },
    measured: { width: 210, height: 88 },
    data: { title: id, notes: '', kind: 'process' }
  };
}

describe('libavoid edge router', () => {
  let routeEdges: EdgeRouter;

  beforeAll(async () => {
    await AvoidLib.load();
    routeEdges = createLibavoidEdgeRouter(AvoidLib.getInstance());
  });

  it('creates an orthogonal path that avoids a blocking node', () => {
    const nodes = [node('source', 0, 100), node('blocker', 260, 100), node('target', 560, 100)];
    const edges: FlowEdge[] = [{
      id: 'edge',
      source: 'source',
      target: 'target',
      sourceHandle: 'source-right',
      targetHandle: 'target-left'
    }];
    const route = routeEdges(nodes, edges).get('edge')!;

    expect(route[0]).toEqual({ x: 210, y: 144 });
    expect(route.at(-1)).toEqual({ x: 560, y: 144 });
    expect(route.length).toBeGreaterThan(2);
    expect(route.slice(1).every((point, index) => (
      route[index].x === point.x || route[index].y === point.y
    ))).toBe(true);
    expect(route.some((point) => point.y <= 86 || point.y >= 202)).toBe(true);
  });

  it('honors the selected top and bottom connection pins', () => {
    const nodes = [node('source', 100, 200), node('target', 420, 20)];
    const edges: FlowEdge[] = [{
      id: 'edge',
      source: 'source',
      target: 'target',
      sourceHandle: 'source-top-left',
      targetHandle: 'target-bottom-right'
    }];
    const route = routeEdges(nodes, edges).get('edge')!;

    expect(route[0]).toEqual({ x: 171.4, y: 200 });
    expect(route.at(-1)).toEqual({ x: 558.6, y: 108 });
  });
});
