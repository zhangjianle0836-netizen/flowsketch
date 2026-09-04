import { Position } from '@xyflow/react';
import type { FlowEdge, StageNode } from '../types';

export type RoutePoint = { x: number; y: number };

type RouteRect = { left: number; top: number; right: number; bottom: number };
type RouteSegment = { from: RoutePoint; to: RoutePoint };

type NodeGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DiagramRouteState = {
  nodeGeometry: Map<string, NodeGeometry>;
  edgeGeometry: Map<string, string>;
  routes: Map<string, RoutePoint[]>;
};

const DEFAULT_NODE_WIDTH = 210;
const DEFAULT_NODE_HEIGHT = 88;
const NODE_CLEARANCE = 14;
const PORT_LEAD = 24;
const EPSILON = 0.01;

function nodeSize(node: StageNode) {
  return {
    width: node.measured?.width || node.width || DEFAULT_NODE_WIDTH,
    height: node.measured?.height || node.height || DEFAULT_NODE_HEIGHT
  };
}

function portName(handleId: string | null | undefined, fallback: string) {
  return handleId?.replace(/^(source|target)-/, '') || fallback;
}

function portPosition(node: StageNode, handleId: string | null | undefined, fallback: string) {
  const { width, height } = nodeSize(node);
  const port = portName(handleId, fallback);
  const left = node.position.x;
  const top = node.position.y;
  switch (port) {
    case 'left': return { point: { x: left, y: top + height / 2 }, position: Position.Left };
    case 'right': return { point: { x: left + width, y: top + height / 2 }, position: Position.Right };
    case 'top-left': return { point: { x: left + width * 0.34, y: top }, position: Position.Top };
    case 'top-right':
    case 'top': return { point: { x: left + width * 0.66, y: top }, position: Position.Top };
    case 'bottom-left': return { point: { x: left + width * 0.34, y: top + height }, position: Position.Bottom };
    case 'bottom-right':
    case 'bottom': return { point: { x: left + width * 0.66, y: top + height }, position: Position.Bottom };
    default: return { point: { x: left + width / 2, y: top + height / 2 }, position: Position.Right };
  }
}

function moveOut(point: RoutePoint, position: Position): RoutePoint {
  if (position === Position.Left) return { x: point.x - PORT_LEAD, y: point.y };
  if (position === Position.Right) return { x: point.x + PORT_LEAD, y: point.y };
  if (position === Position.Top) return { x: point.x, y: point.y - PORT_LEAD };
  return { x: point.x, y: point.y + PORT_LEAD };
}

function inflatedRect(node: StageNode): RouteRect {
  const { width, height } = nodeSize(node);
  return {
    left: node.position.x - NODE_CLEARANCE,
    top: node.position.y - NODE_CLEARANCE,
    right: node.position.x + width + NODE_CLEARANCE,
    bottom: node.position.y + height + NODE_CLEARANCE
  };
}

function geometryOf(node: StageNode): NodeGeometry {
  const { width, height } = nodeSize(node);
  return { x: node.position.x, y: node.position.y, width, height };
}

function sameGeometry(first: NodeGeometry | undefined, second: NodeGeometry) {
  return Boolean(first) &&
    Math.abs(first!.x - second.x) < EPSILON &&
    Math.abs(first!.y - second.y) < EPSILON &&
    Math.abs(first!.width - second.width) < EPSILON &&
    Math.abs(first!.height - second.height) < EPSILON;
}

function edgeGeometry(edge: FlowEdge) {
  return [edge.source, edge.sourceHandle || '', edge.target, edge.targetHandle || ''].join('\u0000');
}

function unique(values: number[]) {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))];
}

function collapse(points: RoutePoint[]) {
  const compact: RoutePoint[] = [];
  for (const point of points) {
    const last = compact.at(-1);
    if (!last || Math.abs(last.x - point.x) > EPSILON || Math.abs(last.y - point.y) > EPSILON) compact.push(point);
  }
  for (let index = compact.length - 2; index > 0; index -= 1) {
    const before = compact[index - 1];
    const current = compact[index];
    const after = compact[index + 1];
    if ((Math.abs(before.x - current.x) < EPSILON && Math.abs(current.x - after.x) < EPSILON) ||
        (Math.abs(before.y - current.y) < EPSILON && Math.abs(current.y - after.y) < EPSILON)) {
      compact.splice(index, 1);
    }
  }
  return compact;
}

function segments(points: RoutePoint[]): RouteSegment[] {
  return points.slice(1).map((point, index) => ({ from: points[index], to: point }));
}

function segmentHitsRect(segment: RouteSegment, rect: RouteRect) {
  if (Math.abs(segment.from.y - segment.to.y) < EPSILON) {
    const y = segment.from.y;
    const left = Math.min(segment.from.x, segment.to.x);
    const right = Math.max(segment.from.x, segment.to.x);
    return y > rect.top + EPSILON && y < rect.bottom - EPSILON && right > rect.left + EPSILON && left < rect.right - EPSILON;
  }
  const x = segment.from.x;
  const top = Math.min(segment.from.y, segment.to.y);
  const bottom = Math.max(segment.from.y, segment.to.y);
  return x > rect.left + EPSILON && x < rect.right - EPSILON && bottom > rect.top + EPSILON && top < rect.bottom - EPSILON;
}

function overlappingLength(first: RouteSegment, second: RouteSegment) {
  const firstHorizontal = Math.abs(first.from.y - first.to.y) < EPSILON;
  const secondHorizontal = Math.abs(second.from.y - second.to.y) < EPSILON;
  if (firstHorizontal !== secondHorizontal) return 0;
  if (firstHorizontal) {
    if (Math.abs(first.from.y - second.from.y) > EPSILON) return 0;
    return Math.max(0, Math.min(Math.max(first.from.x, first.to.x), Math.max(second.from.x, second.to.x)) -
      Math.max(Math.min(first.from.x, first.to.x), Math.min(second.from.x, second.to.x)));
  }
  if (Math.abs(first.from.x - second.from.x) > EPSILON) return 0;
  return Math.max(0, Math.min(Math.max(first.from.y, first.to.y), Math.max(second.from.y, second.to.y)) -
    Math.max(Math.min(first.from.y, first.to.y), Math.min(second.from.y, second.to.y)));
}

function routeLength(points: RoutePoint[]) {
  return segments(points).reduce((total, segment) => total + Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y), 0);
}

function candidateRoutes(source: RoutePoint, sourceLead: RoutePoint, targetLead: RoutePoint, target: RoutePoint, rects: RouteRect[]) {
  const midpoint = { x: (sourceLead.x + targetLead.x) / 2, y: (sourceLead.y + targetLead.y) / 2 };
  const xLanes = unique([
    sourceLead.x,
    targetLead.x,
    midpoint.x,
    midpoint.x - 24,
    midpoint.x + 24,
    ...rects.flatMap((rect) => [rect.left, rect.right])
  ]).sort((a, b) => Math.abs(a - midpoint.x) - Math.abs(b - midpoint.x)).slice(0, 28);
  const yLanes = unique([
    sourceLead.y,
    targetLead.y,
    midpoint.y,
    midpoint.y - 24,
    midpoint.y + 24,
    ...rects.flatMap((rect) => [rect.top, rect.bottom])
  ]).sort((a, b) => Math.abs(a - midpoint.y) - Math.abs(b - midpoint.y)).slice(0, 28);

  const middleRoutes: RoutePoint[][] = [
    [sourceLead, { x: targetLead.x, y: sourceLead.y }, targetLead],
    [sourceLead, { x: sourceLead.x, y: targetLead.y }, targetLead],
    ...xLanes.map((x) => [sourceLead, { x, y: sourceLead.y }, { x, y: targetLead.y }, targetLead]),
    ...yLanes.map((y) => [sourceLead, { x: sourceLead.x, y }, { x: targetLead.x, y }, targetLead])
  ];

  const outerXs = [Math.min(...rects.map((rect) => rect.left), sourceLead.x, targetLead.x) - 24,
    Math.max(...rects.map((rect) => rect.right), sourceLead.x, targetLead.x) + 24];
  const outerYs = [Math.min(...rects.map((rect) => rect.top), sourceLead.y, targetLead.y) - 24,
    Math.max(...rects.map((rect) => rect.bottom), sourceLead.y, targetLead.y) + 24];
  for (const x of outerXs) {
    for (const y of outerYs) {
      middleRoutes.push([sourceLead, { x: sourceLead.x, y }, { x, y }, { x, y: targetLead.y }, targetLead]);
      middleRoutes.push([sourceLead, { x, y: sourceLead.y }, { x, y }, { x: targetLead.x, y }, targetLead]);
    }
  }

  return middleRoutes.map((middle) => collapse([source, ...middle, target]));
}

function chooseRoute(candidates: RoutePoint[][], rects: RouteRect[], existingRoutes: RoutePoint[][]) {
  return candidates.reduce((best, candidate) => {
    const candidateSegments = segments(candidate);
    const collisions = candidateSegments.reduce((count, segment) => count + rects.filter((rect) => segmentHitsRect(segment, rect)).length, 0);
    const overlap = existingRoutes.reduce((total, route) => total + candidateSegments.reduce((edgeTotal, segment) => (
      edgeTotal + segments(route).reduce((segmentTotal, existing) => segmentTotal + overlappingLength(segment, existing), 0)
    ), 0), 0);
    const score = collisions * 1_000_000 + overlap * 18 + routeLength(candidate) + Math.max(0, candidate.length - 2) * 14;
    return !best || score < best.score ? { points: candidate, score } : best;
  }, null as { points: RoutePoint[]; score: number } | null)?.points || candidates[0];
}

export function routeDiagramEdges(nodes: StageNode[], edges: FlowEdge[]) {
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  const routes = new Map<string, RoutePoint[]>();
  const existingRoutes: RoutePoint[][] = [];

  for (const edge of edges) {
    const sourceNode = nodeLookup.get(edge.source);
    const targetNode = nodeLookup.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    const source = portPosition(sourceNode, edge.sourceHandle, 'right');
    const target = portPosition(targetNode, edge.targetHandle, 'left');
    const sourceLead = moveOut(source.point, source.position);
    const targetLead = moveOut(target.point, target.position);
    const blockingRects = nodes
      .filter((node) => node.id !== edge.source && node.id !== edge.target)
      .map(inflatedRect);
    const candidates = candidateRoutes(source.point, sourceLead, targetLead, target.point, blockingRects);
    const route = chooseRoute(candidates, blockingRects, existingRoutes);
    routes.set(edge.id, route);
    existingRoutes.push(route);
  }
  return routes;
}

/**
 * Re-routes only edges whose endpoints or definitions changed. Moving a node
 * must not make unrelated connections jump to a different corridor.
 *
 * Full obstacle avoidance still happens when routes are first created. Once a
 * route exists, visual stability takes priority until one of its endpoints is
 * moved or the connection itself changes.
 */
export function updateDiagramRoutes(
  nodes: StageNode[],
  edges: FlowEdge[],
  previous?: DiagramRouteState
): DiagramRouteState {
  const nodeGeometry = new Map(nodes.map((node) => [node.id, geometryOf(node)]));
  const edgeGeometryMap = new Map(edges.map((edge) => [edge.id, edgeGeometry(edge)]));
  if (!previous) {
    return { nodeGeometry, edgeGeometry: edgeGeometryMap, routes: routeDiagramEdges(nodes, edges) };
  }

  const changedNodes = new Set(
    nodes
      .filter((node) => !sameGeometry(previous.nodeGeometry.get(node.id), nodeGeometry.get(node.id)!))
      .map((node) => node.id)
  );
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  const routes = new Map<string, RoutePoint[]>();
  const existingRoutes: RoutePoint[][] = [];

  for (const edge of edges) {
    const sourceNode = nodeLookup.get(edge.source);
    const targetNode = nodeLookup.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const previousRoute = previous.routes.get(edge.id);
    const definitionChanged = previous.edgeGeometry.get(edge.id) !== edgeGeometryMap.get(edge.id);
    const endpointChanged = changedNodes.has(edge.source) || changedNodes.has(edge.target);

    if (previousRoute && !definitionChanged && !endpointChanged) {
      routes.set(edge.id, previousRoute);
      existingRoutes.push(previousRoute);
      continue;
    }

    const source = portPosition(sourceNode, edge.sourceHandle, 'right');
    const target = portPosition(targetNode, edge.targetHandle, 'left');
    const sourceLead = moveOut(source.point, source.position);
    const targetLead = moveOut(target.point, target.position);
    const blockingRects = nodes
      .filter((node) => node.id !== edge.source && node.id !== edge.target)
      .map(inflatedRect);
    const candidates = candidateRoutes(source.point, sourceLead, targetLead, target.point, blockingRects);
    const route = chooseRoute(candidates, blockingRects, existingRoutes);
    routes.set(edge.id, route);
    existingRoutes.push(route);
  }

  return { nodeGeometry, edgeGeometry: edgeGeometryMap, routes };
}

export function orthogonalRoutePath(points: RoutePoint[]) {
  if (points.length < 2) return '';
  return points.slice(1).reduce(
    (path, point) => `${path} L ${point.x} ${point.y}`,
    `M ${points[0].x} ${points[0].y}`
  );
}

export function routeMidpoint(points: RoutePoint[]) {
  const total = routeLength(points);
  let remaining = total / 2;
  for (const segment of segments(points)) {
    const length = Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y);
    if (remaining <= length) {
      const ratio = length ? remaining / length : 0;
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
        y: segment.from.y + (segment.to.y - segment.from.y) * ratio
      };
    }
    remaining -= length;
  }
  return points.at(-1) || { x: 0, y: 0 };
}
