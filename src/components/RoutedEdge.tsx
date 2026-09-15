import { useRef, type PointerEvent } from 'react';
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { edgeLabelPoint } from '../flow/image-export';
import { orthogonalRoutePath, routeMidpoint, type RoutePoint } from '../flow/routing';
import type { FlowEdge } from '../types';

export const EDGE_POSITION_EVENT = 'flowsketch:edge-position';

export function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, selected, markerEnd, style, interactionWidth, label, data }: EdgeProps<FlowEdge>) {
  const { screenToFlowPosition } = useReactFlow();
  const drag = useRef<{ origin: RoutePoint; offset: RoutePoint; waypointIndex?: number; labelPosition: number } | null>(null);
  const routed = data?.route;
  const points: RoutePoint[] = routed?.length
    ? routed.map((point, index) => index === 0 ? { x: sourceX, y: sourceY } : index === routed.length - 1 ? { x: targetX, y: targetY } : point)
    : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
  const [fallbackPath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const midpoint = edgeLabelPoint({ id, source: '', target: '', data }, points);
  const labelText = typeof label === 'string' ? label.trim() : '';
  const emit = (detail: object) => window.dispatchEvent(new CustomEvent(EDGE_POSITION_EVENT, { detail: { edgeId: id, ...detail } }));
  const start = (event: PointerEvent<Element>, waypointIndex?: number) => {
    if (!selected || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { origin: screenToFlowPosition({ x: event.clientX, y: event.clientY }), offset: data?.labelOffset || { x: 0, y: 0 }, labelPosition: data?.labelPosition ?? 0.5, waypointIndex };
    emit({ phase: 'start' });
  };
  const move = (event: PointerEvent<Element>, phase: 'move' | 'end') => {
    const current = drag.current;
    if (!current) return;
    event.stopPropagation();
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    emit(current.waypointIndex !== undefined ? { phase, point, waypointIndex: current.waypointIndex } : { phase, labelPosition: current.labelPosition, labelOffset: { x: Math.max(-2000, Math.min(2000, current.offset.x + point.x - current.origin.x)), y: Math.max(-2000, Math.min(2000, current.offset.y + point.y - current.origin.y)) } });
    if (phase === 'end') { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }
  };
  const cancel = () => { if (drag.current) emit({ phase: 'cancel' }); drag.current = null; };

  return <>
    <BaseEdge id={id} path={routed?.length ? orthogonalRoutePath(points) : fallbackPath} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
    {labelText && (Math.abs(data?.labelOffset?.x || 0) + Math.abs(data?.labelOffset?.y || 0) > 24) && <line x1={routeMidpoint(points, data?.labelPosition ?? 0.5).x} y1={routeMidpoint(points, data?.labelPosition ?? 0.5).y} x2={midpoint.x} y2={midpoint.y} stroke="#9aa6b8" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />}
    {selected && data?.waypoints?.map((point, index) => <circle key={index} className="route-waypoint nodrag nopan" cx={point.x} cy={point.y} r={7} aria-hidden="true" onPointerDown={(event) => start(event, index)} onPointerMove={(event) => move(event, 'move')} onPointerUp={(event) => move(event, 'end')} onPointerCancel={cancel} />)}
    {labelText && <EdgeLabelRenderer><div className={`routed-edge-label nodrag nopan${selected ? ' is-selected' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${midpoint.x}px, ${midpoint.y}px)` }} aria-hidden="true" title={selected ? '拖动调整标签；也可在连线设置中输入位置' : labelText} onPointerDown={(event) => start(event)} onPointerMove={(event) => move(event, 'move')} onPointerUp={(event) => move(event, 'end')} onPointerCancel={cancel}>{labelText}</div></EdgeLabelRenderer>}
  </>;
}
