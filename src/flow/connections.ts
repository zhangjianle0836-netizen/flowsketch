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
  data?: { portMode?: 'auto' | 'fixed' };
};

function nodeBounds(node: StageNode) {
  const width = node.measured?.width || node.width || 210;
  const height = node.measured?.height || node.height || (node.data.kind === 'decision' ? 140 : 88);
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
 * Choose facing handles for automatic connections and resolve missing handles
 * in older files before React Flow measures the rendered edge endpoints.
 */
export function optimizeConnectionHandles<T extends ConnectionLike>(
  connection: T,
  nodes: StageNode[]
): T {
  // Older files omit handle IDs. React Flow otherwise picks the first handle
  // (left), while both route engines assume a right-side source by default.
  const resolved = (connection.sourceHandle && connection.targetHandle ? connection : {
    ...connection,
    sourceHandle: connection.sourceHandle || 'source-right',
    targetHandle: connection.targetHandle || 'target-left'
  }) as T;
  if (resolved.data?.portMode === 'fixed') return resolved;
  const source = nodes.find((node) => node.id === resolved.source);
  const target = nodes.find((node) => node.id === resolved.target);
  if (!source || !target || source.id === target.id) return resolved;

  const sourceBounds = nodeBounds(source);
  const targetBounds = nodeBounds(target);
  const verticalOverlap = Math.min(sourceBounds.bottom, targetBounds.bottom) -
    Math.max(sourceBounds.top, targetBounds.top);
  if (verticalOverlap <= 0) {
    const legacyAutomatic = !connection.sourceHandle && !connection.targetHandle && !connection.data?.portMode;
    if (resolved.data?.portMode !== 'auto' && !legacyAutomatic) return resolved;
    const targetIsBelow = target.position.y >= source.position.y;
    return { ...resolved, sourceHandle: targetIsBelow ? 'source-bottom-left' : source.data.kind === 'decision' ? 'source-top-left' : 'source-top-right', targetHandle: targetIsBelow ? 'target-top-left' : target.data.kind === 'decision' ? 'target-bottom-left' : 'target-bottom-right' };
  }

  const targetIsRight = targetBounds.centerX >= sourceBounds.centerX;
  return {
    ...resolved,
    sourceHandle: targetIsRight ? 'source-right' : 'source-left',
    targetHandle: targetIsRight ? 'target-left' : 'target-right'
  };
}
