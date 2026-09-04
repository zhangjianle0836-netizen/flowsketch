import { createContext, useContext, type PropsWithChildren } from 'react';
import { MiniMap, type MiniMapNodeProps } from '@xyflow/react';
import type { FlowEdge, StageKind, StageNode } from '../types';

type FlowMiniMapContextValue = {
  nodes: StageNode[];
  edges: FlowEdge[];
};

type FlowMiniMapProps = FlowMiniMapContextValue & {
  theme: 'light' | 'dark';
};

const DEFAULT_NODE_WIDTH = 210;
const DEFAULT_NODE_HEIGHT = 88;
const NODE_COLORS: Record<StageKind, string> = {
  start: '#2f8f73',
  process: '#2d6cdf',
  decision: '#c98218',
  end: '#66727a'
};

const FlowMiniMapContext = createContext<FlowMiniMapContextValue>({ nodes: [], edges: [] });

function nodeSize(node: StageNode) {
  return {
    width: node.measured?.width || node.width || DEFAULT_NODE_WIDTH,
    height: node.measured?.height || node.height || DEFAULT_NODE_HEIGHT
  };
}

function connectionPoints(edge: FlowEdge, nodes: StageNode[]) {
  if (edge.data?.route?.length) return edge.data.route;

  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return [];

  const sourceSize = nodeSize(source);
  const targetSize = nodeSize(target);
  return [
    { x: source.position.x + sourceSize.width / 2, y: source.position.y + sourceSize.height / 2 },
    { x: target.position.x + targetSize.width / 2, y: target.position.y + targetSize.height / 2 }
  ];
}

function compactTitle(title: string) {
  const normalized = title.trim() || '未命名阶段';
  return normalized.length > 12 ? `${normalized.slice(0, 11)}…` : normalized;
}

function MiniMapStageNode({
  id,
  x,
  y,
  width,
  height,
  color,
  selected,
  borderRadius,
  onClick
}: MiniMapNodeProps) {
  const { nodes, edges } = useContext(FlowMiniMapContext);
  const node = nodes.find((item) => item.id === id);
  if (!node) return null;

  const outgoingEdges = edges.filter((edge) => edge.source === id);
  const clipId = `minimap-node-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const title = compactTitle(node.data.title);

  return (
    <g className="flow-minimap__item">
      {outgoingEdges.map((edge) => {
        const points = connectionPoints(edge, nodes);
        if (points.length < 2) return null;
        const pointList = points.map((point) => `${point.x},${point.y}`).join(' ');
        return (
          <polyline
            key={edge.id}
            className={`flow-minimap__edge${edge.selected ? ' is-selected' : ''}`}
            points={pointList}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      <defs>
        <clipPath id={clipId}>
          <rect x={x + 5} y={y + 3} width={Math.max(0, width - 10)} height={Math.max(0, height - 6)} rx={borderRadius} />
        </clipPath>
      </defs>
      <rect
        className={`flow-minimap__node${selected ? ' is-selected' : ''}`}
        x={x}
        y={y}
        width={width}
        height={height}
        rx={borderRadius}
        ry={borderRadius}
        fill={color}
        vectorEffect="non-scaling-stroke"
        onClick={onClick ? (event) => onClick(event, id) : undefined}
      />
      <text
        className="flow-minimap__title"
        x={x + width / 2}
        y={y + height / 2}
        clipPath={`url(#${clipId})`}
        textAnchor="middle"
        dominantBaseline="central"
        pointerEvents="none"
      >
        {title}
      </text>
      <title>{node.data.title}</title>
    </g>
  );
}

function MiniMapContextProvider({ children, nodes, edges }: PropsWithChildren<FlowMiniMapContextValue>) {
  return <FlowMiniMapContext.Provider value={{ nodes, edges }}>{children}</FlowMiniMapContext.Provider>;
}

export function FlowMiniMap({ nodes, edges, theme }: FlowMiniMapProps) {
  return (
    <MiniMapContextProvider nodes={nodes} edges={edges}>
      <MiniMap<StageNode>
        ariaLabel="流程缩略图，显示阶段名称、连线和当前画布范围"
        className="flow-minimap"
        style={{ width: 300, height: 184 }}
        pannable
        zoomable
        position="bottom-left"
        nodeComponent={MiniMapStageNode}
        nodeColor={(node) => NODE_COLORS[node.data.kind]}
        nodeStrokeColor={theme === 'dark' ? '#f5f5f7' : '#ffffff'}
        nodeStrokeWidth={1}
        maskColor={theme === 'dark' ? 'rgba(28, 28, 30, 0.58)' : 'rgba(245, 245, 247, 0.56)'}
        maskStrokeColor={theme === 'dark' ? '#98989d' : '#8e8e93'}
        maskStrokeWidth={1}
      />
    </MiniMapContextProvider>
  );
}
