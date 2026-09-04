import type { Connection } from '@xyflow/react';
import type { StageNode } from '../types';

export type ConnectionOrigin = {
  nodeId: string | null;
  handleId: string | null;
};

type ConnectionLike = {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

function nodeBounds(node: StageNode) {
  const width = node.measured?.width || node.width || 210;
  const height = node.measured?.height || node.height || 88;
  return {
    centerX: node.position.x + width / 2,
    top: node.position.y,
    bottom: node.position.y + height
  };
}

function portId(handleId: string | null | undefined, role: 'source' | 'target', fallback: string) {
  const port = handleId?.replace(/^(source|target)-/, '') || fallback;
  return `${role}-${port}`;
}

export function orientConnectionFromOrigin(
  connection: Connection,
  origin: ConnectionOrigin | null
): Connection {
  const startedFromLibraryTarget = Boolean(
    origin?.nodeId &&
    origin.nodeId === connection.target &&
    origin.nodeId !== connection.source
  );

  if (startedFromLibraryTarget) {
    return {
      source: connection.target,
      target: connection.source,
      sourceHandle: portId(origin?.handleId || connection.targetHandle, 'source', 'right'),
      targetHandle: portId(connection.sourceHandle, 'target', 'left')
    };
  }

  return {
    source: connection.source,
    target: connection.target,
    sourceHandle: portId(origin?.handleId || connection.sourceHandle, 'source', 'right'),
    targetHandle: portId(connection.targetHandle, 'target', 'left')
  };
}

/**
 * Nodes on the same horizontal level should connect through their facing sides.
 * This avoids long routes across the tops of two nodes when a top handle was
 * easier to hit during drag-and-drop.
 */
export function optimizeConnectionHandles<T extends ConnectionLike>(
  connection: T,
  nodes: StageNode[]
): T {
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target || source.id === target.id) return connection;

  const sourceBounds = nodeBounds(source);
  const targetBounds = nodeBounds(target);
  const verticalOverlap = Math.min(sourceBounds.bottom, targetBounds.bottom) -
    Math.max(sourceBounds.top, targetBounds.top);
  if (verticalOverlap <= 0) return connection;

  const targetIsRight = targetBounds.centerX >= sourceBounds.centerX;
  return {
    ...connection,
    sourceHandle: targetIsRight ? 'source-right' : 'source-left',
    targetHandle: targetIsRight ? 'target-left' : 'target-right'
  };
}
