import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from '@xyflow/react';
import { orthogonalRoutePath, routeMidpoint, type RoutePoint } from '../flow/routing';
import type { FlowEdge } from '../types';

export function RoutedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  markerEnd,
  style,
  interactionWidth,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  data
}: EdgeProps<FlowEdge>) {
  const routed = data?.route;
  const points: RoutePoint[] = routed?.length
    ? routed.map((point, index) => {
      if (index === 0) return { x: sourceX, y: sourceY };
      if (index === routed.length - 1) return { x: targetX, y: targetY };
      return point;
    })
    : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
  const [fallbackPath, fallbackX, fallbackY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const midpoint = routed?.length ? routeMidpoint(points) : { x: fallbackX, y: fallbackY };
  const labelText = typeof label === 'string' ? label.trim() : '';

  return (
    <>
      <BaseEdge
        id={id}
        path={routed?.length ? orthogonalRoutePath(points) : fallbackPath}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
      />
      {labelText ? (
        <EdgeLabelRenderer>
          <div
            className={`routed-edge-label${selected ? ' is-selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${midpoint.x}px, ${midpoint.y}px)` }}
            aria-hidden="true"
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
