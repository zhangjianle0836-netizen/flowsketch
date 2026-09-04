import { describe, expect, it } from 'vitest';
import type { StageNode } from '../types';
import { optimizeConnectionHandles, orientConnectionFromOrigin } from './connections';

function node(id: string, x: number, y: number): StageNode {
  return {
    id,
    type: 'stage',
    position: { x, y },
    measured: { width: 210, height: 88 },
    data: { title: id, notes: '', kind: 'process' }
  };
}

describe('orientConnectionFromOrigin', () => {
  it('keeps the node where dragging began as the source', () => {
    expect(orientConnectionFromOrigin({
      source: 'start-node',
      target: 'end-node',
      sourceHandle: 'source-bottom-left',
      targetHandle: 'target-top-right'
    }, {
      nodeId: 'start-node',
      handleId: 'source-bottom-left'
    })).toEqual({
      source: 'start-node',
      target: 'end-node',
      sourceHandle: 'source-bottom-left',
      targetHandle: 'target-top-right'
    });
  });

  it('reverses the library result when dragging began from a target handle', () => {
    expect(orientConnectionFromOrigin({
      source: 'drop-node',
      target: 'drag-node',
      sourceHandle: 'source-top-left',
      targetHandle: 'target-bottom-right'
    }, {
      nodeId: 'drag-node',
      handleId: 'target-bottom-right'
    })).toEqual({
      source: 'drag-node',
      target: 'drop-node',
      sourceHandle: 'source-bottom-right',
      targetHandle: 'target-top-left'
    });
  });
});

describe('optimizeConnectionHandles', () => {
  const nodes = [node('left', 100, 200), node('right', 420, 200), node('lower', 420, 360)];

  it('uses facing side handles for nodes on the same horizontal level', () => {
    expect(optimizeConnectionHandles({
      source: 'right',
      target: 'left',
      sourceHandle: 'source-top-left',
      targetHandle: 'target-top-right'
    }, nodes)).toEqual({
      source: 'right',
      target: 'left',
      sourceHandle: 'source-left',
      targetHandle: 'target-right'
    });
  });

  it('preserves explicitly selected handles for vertically separated nodes', () => {
    const connection = {
      source: 'left',
      target: 'lower',
      sourceHandle: 'source-bottom-right',
      targetHandle: 'target-top-left'
    };
    expect(optimizeConnectionHandles(connection, nodes)).toBe(connection);
  });
});
