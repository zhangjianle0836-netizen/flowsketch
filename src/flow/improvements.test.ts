import { describe, expect, it } from 'vitest';
import type { FlowDocument, FlowEdge, StageKind, StageNode } from '../types';
import { layoutDocument, parseFlowDocument } from './document';
import { alignSelection, duplicateSelection, insertStageOnEdge } from './editing';
import { connectionProblem, validateFlow } from './validation';
import { diagramExportBounds, exportFlowSvg, edgeLabelPoint, placeEdgeLabels, pngDimensions, wrapLabel } from './image-export';
import { manualEdgeRoute, routeDiagramEdges, validEdgeRoute } from './routing';
import { optimizeConnectionHandles } from './connections';

const node = (id: string, x = 0, y = 0, kind: StageKind = 'process'): StageNode => ({ id, type: 'stage', position: { x, y }, data: { title: id, notes: '', kind } });
const edge = (source: string, target: string): FlowEdge => ({ id: `${source}-${target}`, source, target });
function document(nodes: StageNode[], edges: FlowEdge[]): FlowDocument {
  return { version: 1, title: '测试', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, createdAt: '', updatedAt: '' };
}

describe('dependency-aware layout', () => {
  it('propagates a late merge rank to its successor', () => {
    const result = layoutDocument(document(['A', 'D', 'B', 'C', 'E'].map((id) => node(id)), [edge('A', 'D'), edge('A', 'B'), edge('B', 'C'), edge('C', 'D'), edge('D', 'E')]));
    const x = Object.fromEntries(result.nodes.map((item) => [item.id, item.position.x]));
    expect(x.D).toBeGreaterThan(x.C);
    expect(x.E).toBeGreaterThan(x.D);
  });
  it('keeps a cycle together and puts its exit after it', () => {
    const result = layoutDocument(document(['A', 'B', 'C', 'E'].map((id) => node(id)), [edge('A', 'B'), edge('B', 'C'), edge('C', 'B'), edge('C', 'E')]));
    const byId = new Map(result.nodes.map((item) => [item.id, item]));
    expect(byId.get('B')!.position.x).toBe(byId.get('C')!.position.x);
    expect(byId.get('B')!.position.y).not.toBe(byId.get('C')!.position.y);
    expect(byId.get('E')!.position.x).toBeGreaterThan(byId.get('C')!.position.x);
  });
  it('supports downward layout and measured node sizes', () => {
    const result = layoutDocument({ ...document([{ ...node('A'), measured: { width: 400, height: 300 } }, node('B')], [edge('A', 'B')]), direction: 'TB' });
    expect(result.nodes[1].position.y).toBeGreaterThanOrEqual(result.nodes[0].position.y + 400);
  });
  it('separates disconnected nodes and leaves the empty document unchanged', () => {
    const blank = document([], []);
    expect(layoutDocument(blank)).toBe(blank);
    const result = layoutDocument(document([node('A'), node('B')], []));
    expect(result.nodes[0].position.y).not.toBe(result.nodes[1].position.y);
  });
});

describe('flow semantics and connection constraints', () => {
  it('reports missing branches and conditions and unreachable stages', () => {
    const source = document([node('S', 0, 0, 'start'), node('D', 0, 0, 'decision'), node('E', 0, 0, 'end'), node('X')], [edge('S', 'D'), edge('D', 'E')]);
    expect(validateFlow(source).map((issue) => issue.code)).toEqual(expect.arrayContaining(['decision-branches', 'missing-condition', 'isolated', 'unreachable']));
  });
  it('allows legitimate cycles with exits', () => {
    const source = document([node('S', 0, 0, 'start'), node('A'), node('B'), node('E', 0, 0, 'end')], [edge('S', 'A'), edge('A', 'B'), edge('B', 'A'), edge('B', 'E')]);
    expect(validateFlow(source)).toEqual([]);
  });
  it('detects a reachable cycle with no exit', () => {
    const source = document([node('S', 0, 0, 'start'), node('A'), node('B'), node('E', 0, 0, 'end')], [edge('S', 'A'), edge('A', 'B'), edge('B', 'A')]);
    expect(validateFlow(source).map((issue) => issue.code)).toContain('no-exit');
  });
  it('checks old invalid start/end relations but prevents creating them', () => {
    const nodes = [node('S', 0, 0, 'start'), node('E', 0, 0, 'end')];
    expect(connectionProblem(nodes, [], 'E', 'S')).toContain('结束');
    expect(connectionProblem(nodes, [], 'S', 'S')).toContain('自身');
    expect(connectionProblem(nodes, [edge('S', 'E')], 'S', 'E', 'S-E')).toBeNull();
    expect(connectionProblem(nodes, [edge('S', 'E')], 'S', 'E')).toContain('存在');
  });
  it('reports duplicate decision conditions on specific edges', () => {
    const source = document([node('S', 0, 0, 'start'), node('D', 0, 0, 'decision'), node('E1', 0, 0, 'end'), node('E2', 0, 0, 'end')], [edge('S', 'D'), { ...edge('D', 'E1'), label: '是' }, { ...edge('D', 'E2'), label: '是' }]);
    expect(validateFlow(source).find((issue) => issue.code === 'duplicate-condition')?.edgeId).toBe('D-E2');
  });
});

describe('editing transactions and persistence', () => {
  it('duplicates internal edges only and shifts fixed paths', () => {
    const source = document([{ ...node('A'), selected: true }, { ...node('B', 310), selected: true }, node('C', 620)], [{ ...edge('A', 'B'), label: '通过', data: { portMode: 'fixed', waypoints: [{ x: 240, y: 160 }] } }, edge('B', 'C')]);
    const result = duplicateSelection(source);
    expect(result.nodes).toHaveLength(5);
    expect(result.edges).toHaveLength(3);
    expect(result.edges[2].label).toBe('通过');
    expect(result.edges[2].data?.waypoints).toEqual([{ x: 288, y: 208 }]);
    expect(result.nodes.filter((item) => item.selected)).toHaveLength(2);
    expect(source.nodes[0].selected).toBe(true);
  });
  it('inserts a node and preserves the original branch condition', () => {
    const source = document([node('A'), node('B', 620)], [{ ...edge('A', 'B'), label: '满足条件' }]);
    const result = insertStageOnEdge(source, 'A-B');
    const inserted = result.nodes.find((item) => item.selected)!;
    expect(result.edges[0].target).toBe(inserted.id);
    expect(result.edges[0].label).toBe('满足条件');
    expect(result.edges[1].source).toBe(inserted.id);
    expect(result.edges[1].target).toBe('B');
  });
  it('aligns and distributes nodes without changing topology', () => {
    const source = document([{ ...node('A', 0, 0), selected: true }, { ...node('B', 300, 180), selected: true }, { ...node('C', 900, 340), selected: true }], [edge('A', 'B')]);
    expect(alignSelection(source, 'top').nodes.map((item) => item.position.y)).toEqual([0, 0, 0]);
    expect(alignSelection(source, 'horizontal').nodes.map((item) => item.position.x)).toEqual([0, 450, 900]);
    expect(alignSelection(source, 'horizontal').edges).toBe(source.edges);
  });
  it('round-trips direction, fixed ports, waypoints and label position', () => {
    const source = { ...document([node('A'), node('B', 310)], [{ ...edge('A', 'B'), type: 'smoothstep', data: { portMode: 'fixed' as const, waypoints: [{ x: -80, y: 200 }], labelPosition: 0.7, labelOffset: { x: -30, y: 24 } } }]), direction: 'TB' as const };
    expect(parseFlowDocument(JSON.parse(JSON.stringify(source)))).toEqual(source);
    const invalid = structuredClone(source);
    invalid.edges[0].data!.waypoints![0].x = Infinity;
    expect(() => parseFlowDocument(invalid)).toThrow('折点');
  });
  it('preserves fixed ports but optimizes automatic downward connections', () => {
    const nodes = [node('A'), node('B', 0, 250)];
    const fixed = { ...edge('A', 'B'), sourceHandle: 'source-right', targetHandle: 'target-left', data: { portMode: 'fixed' as const } };
    expect(optimizeConnectionHandles(fixed, nodes)).toBe(fixed);
    expect(optimizeConnectionHandles({ ...fixed, data: { portMode: 'auto' } }, nodes).sourceHandle).toBe('source-bottom-left');
  });
});

describe('complete portable image export', () => {
  it('includes detours and displaced labels outside node bounds', () => {
    const edges = [{ ...edge('A', 'B'), label: '通过条件', data: { route: [{ x: -500, y: -300 }, { x: 500, y: -300 }], labelOffset: { x: 0, y: -100 } } }];
    const bounds = diagramExportBounds([node('A'), node('B', 310)], edges);
    expect(bounds.x).toBeLessThan(-500);
    expect(bounds.y).toBeLessThan(-400);
    expect(bounds.x + bounds.width).toBeGreaterThan(520);
  });
  it('exports native escaped SVG symbols and excludes editor UI', () => {
    const source = document([node('<&"', 0, 0, 'decision')], []);
    const { svg } = exportFlowSvg(source, []);
    expect(svg).toContain('<polygon');
    expect(svg).toContain('&lt;&amp;&quot;');
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('stage-handle');
  });
  it('wraps Chinese without losing text and keeps huge PNG allocations bounded', () => {
    const title = '是否满足退款申请条件并已核对订单状态';
    expect(wrapLabel(title, 100).join('')).toBe(title);
    expect(wrapLabel(title, 100).length).toBeGreaterThan(1);
    const dimensions = pngDimensions({ x: 0, y: 0, width: 100000, height: 10000 }, 3);
    expect(dimensions.width).toBeLessThanOrEqual(8192);
    expect(dimensions.width * dimensions.height).toBeLessThan(16_020_000);
  });
  it('supports transparent exports and automatic label separation', () => {
    const source = document([node('A')], []);
    const white = exportFlowSvg(source, []).svg;
    expect(exportFlowSvg(source, [], true).svg.length).toBeLessThan(white.length);
    const routes = [{ ...edge('A', 'B'), label: '是', data: { route: [{ x: 0, y: 0 }, { x: 600, y: 0 }] } }, { ...edge('A', 'C'), label: '否', data: { route: [{ x: 0, y: 0 }, { x: 600, y: 0 }] } }];
    const arranged = placeEdgeLabels([], routes);
    expect(edgeLabelPoint(arranged[0], arranged[0].data!.route!)).not.toEqual(edgeLabelPoint(arranged[1], arranged[1].data!.route!));
  });
  it('routes fixed waypoints orthogonally and anchors diamond ports at their tips', () => {
    const nodes = [node('D', 0, 0, 'decision'), node('E', 310, 240)];
    const fixed = { ...edge('D', 'E'), sourceHandle: 'source-top-left', data: { waypoints: [{ x: 400, y: -120 }] } };
    const points = manualEdgeRoute(nodes, fixed)!;
    expect(points[0]).toEqual({ x: 105, y: 0 });
    expect(points).toContainEqual({ x: 400, y: -120 });
    expect(points.slice(1).every((point, index) => point.x === points[index].x || point.y === points[index].y)).toBe(true);
    expect(routeDiagramEdges(nodes, [fixed]).get(fixed.id)).toEqual(points);
  });
});

describe('asynchronous route acceptance', () => {
  it('rejects nudged endpoints, diagonals, stale geometry and obstacle crossings', () => {
    const nodes = [node('A'), node('B', 620), node('blocker', 310)];
    const connection = edge('A', 'B');
    expect(validEdgeRoute(nodes, connection, [{ x: 210, y: 44 }, { x: 620, y: 44 }])).toBe(false);
    expect(validEdgeRoute(nodes, connection, [{ x: 210, y: 24 }, { x: 620, y: 24 }])).toBe(false);
    const route = routeDiagramEdges(nodes, [connection]).get(connection.id)!;
    expect(validEdgeRoute(nodes, connection, route)).toBe(true);
    expect(validEdgeRoute([{ ...nodes[0], position: { x: 10, y: 0 } }, ...nodes.slice(1)], connection, route)).toBe(false);
  });
  it('separates labels in a narrow return-loop corridor', () => {
    const nodes = [node('D', 410, 100, 'decision'), node('B', 410, 304)];
    const edges = [{ ...edge('D', 'B'), label: '资料不完整', data: { route: [{ x: 515, y: 240 }, { x: 515, y: 304 }] } }, { ...edge('B', 'D'), label: '补充后重新判断', data: { route: [{ x: 548, y: 304 }, { x: 548, y: 240 }] } }];
    const arranged = placeEdgeLabels(nodes, edges);
    const first = edgeLabelPoint(arranged[0], arranged[0].data!.route!);
    const second = edgeLabelPoint(arranged[1], arranged[1].data!.route!);
    expect(Math.abs(first.x - second.x)).toBeGreaterThan(100);
  });
});
