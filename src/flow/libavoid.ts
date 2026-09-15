import type { AvoidModule, AvoidRouter, AvoidShapeRef } from 'libavoid-js';
import type { FlowEdge, StageNode } from '../types';
import type { EdgeRouter, RoutePoint } from './routing';

const NODE_CLEARANCE = 14;

const PORTS = {
  left: { classId: 1, x: 0, y: 0.5, directions: 4 },
  right: { classId: 2, x: 1, y: 0.5, directions: 8 },
  'top-left': { classId: 3, x: 0.34, y: 0, directions: 1 },
  'top-right': { classId: 4, x: 0.66, y: 0, directions: 1 },
  'bottom-left': { classId: 5, x: 0.34, y: 1, directions: 2 },
  'bottom-right': { classId: 6, x: 0.66, y: 1, directions: 2 }
} as const;

type PortName = keyof typeof PORTS;

function nodeSize(node: StageNode) {
  return {
    width: node.measured?.width || node.width || 210,
    height: node.measured?.height || node.height || (node.data.kind === 'decision' ? 140 : 88)
  };
}

function portName(handleId: string | null | undefined, fallback: PortName): PortName {
  const name = handleId?.replace(/^(source|target)-/, '') as PortName | undefined;
  return name && name in PORTS ? name : fallback;
}

function createRectangle(avoid: AvoidModule, node: StageNode) {
  const { width, height } = nodeSize(node);
  const topLeft = new avoid.Point(node.position.x, node.position.y);
  const bottomRight = new avoid.Point(node.position.x + width, node.position.y + height);
  const rectangle = new avoid.Rectangle(topLeft, bottomRight);
  topLeft.delete();
  bottomRight.delete();
  return rectangle;
}

function addShape(avoid: AvoidModule, router: AvoidRouter, node: StageNode) {
  const rectangle = createRectangle(avoid, node);
  const shape = new avoid.ShapeRef(router, rectangle);
  rectangle.delete();
  for (const port of Object.values(PORTS)) {
    const pin = new avoid.ShapeConnectionPin(
      shape,
      port.classId,
      node.data.kind === 'decision' && (port.y === 0 || port.y === 1) ? 0.5 : port.x,
      port.y,
      true,
      0,
      port.directions
    );
    pin.setExclusive(false);
  }
  return shape;
}

function configureRouter(avoid: AvoidModule, router: AvoidRouter) {
  const parameter = avoid.RoutingParameter;
  router.setRoutingParameter(parameter.segmentPenalty, 50);
  router.setRoutingParameter(parameter.crossingPenalty, 200);
  router.setRoutingParameter(parameter.fixedSharedPathPenalty, 110);
  router.setRoutingParameter(parameter.portDirectionPenalty, 100);
  router.setRoutingParameter(parameter.shapeBufferDistance, NODE_CLEARANCE);
  router.setRoutingParameter(parameter.idealNudgingDistance, 12);
  router.setRoutingParameter(parameter.reverseDirectionPenalty, 500);

  const option = avoid.RoutingOption;
  router.setRoutingOption(option.nudgeOrthogonalSegmentsConnectedToShapes, false);
  router.setRoutingOption(option.penaliseOrthogonalSharedPathsAtConnEnds, true);
  router.setRoutingOption(option.nudgeOrthogonalTouchingColinearSegments, true);
  router.setRoutingOption(option.performUnifyingNudgingPreprocessingStep, true);
  router.setRoutingOption(option.nudgeSharedPathsWithCommonEndPoint, true);
}

function compactRoute(points: RoutePoint[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    if (previous && previous.x === point.x && previous.y === point.y) return false;
    const next = points[index + 1];
    if (!previous || !next) return true;
    return !(
      (previous.x === point.x && point.x === next.x) ||
      (previous.y === point.y && point.y === next.y)
    );
  });
}

export function createLibavoidEdgeRouter(avoid: AvoidModule): EdgeRouter {
  return (nodes: StageNode[], edges: FlowEdge[]) => {
    if (!edges.length) return new Map();

    const flags = avoid.RouterFlag.PolyLineRouting.value | avoid.RouterFlag.OrthogonalRouting.value;
    const router = new avoid.Router(flags);
    configureRouter(avoid, router);
    const shapes = new Map<string, AvoidShapeRef>();
    const connectors = new Map<string, InstanceType<AvoidModule['ConnRef']>>();

    try {
      for (const node of nodes) shapes.set(node.id, addShape(avoid, router, node));

      for (const edge of edges) {
        const source = shapes.get(edge.source);
        const target = shapes.get(edge.target);
        if (!source || !target) continue;
        const sourcePort = PORTS[portName(edge.sourceHandle, 'right')];
        const targetPort = PORTS[portName(edge.targetHandle, 'left')];
        const sourceEnd = new avoid.ConnEnd(source, sourcePort.classId);
        const targetEnd = new avoid.ConnEnd(target, targetPort.classId);
        const connector = new avoid.ConnRef(router, sourceEnd, targetEnd);
        sourceEnd.delete();
        targetEnd.delete();
        connector.setRoutingType(avoid.ConnType.ConnType_Orthogonal);
        connector.setHateCrossings(true);
        connectors.set(edge.id, connector);
      }

      router.processTransaction();
      const routes = new Map<string, RoutePoint[]>();
      for (const [edgeId, connector] of connectors) {
        if (!connector.hasValidRoute() || connector.hasCrossingObstacles()) continue;
        const line = connector.displayRoute();
        const points: RoutePoint[] = [];
        for (let index = 0; index < line.size(); index += 1) {
          const point = line.at(index);
          points.push({ x: point.x, y: point.y });
        }
        if (points.length >= 2) routes.set(edgeId, compactRoute(points));
      }
      return routes;
    } finally {
      router.delete();
    }
  };
}
