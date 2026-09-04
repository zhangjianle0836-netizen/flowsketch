import type { FlowDocument, FlowEdge, StageData, StageKind, StageNode } from '../types';

const STAGE_KINDS: StageKind[] = ['start', 'process', 'decision', 'end'];

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStage(kind: StageKind, position: { x: number; y: number }): StageNode {
  const titles: Record<StageKind, string> = {
    start: '开始',
    process: '新阶段',
    decision: '判断条件',
    end: '结束'
  };
  return {
    id: createId('node'),
    type: 'stage',
    position,
    data: { title: titles[kind], notes: '', kind }
  };
}

export function createBlankDocument(): FlowDocument {
  const now = new Date().toISOString();
  const start = createStage('start', { x: 80, y: 250 });
  const process = createStage('process', { x: 390, y: 250 });
  const end = createStage('end', { x: 700, y: 250 });
  process.data = { ...process.data, title: '处理阶段', notes: '在右侧面板维护这个阶段的补充说明。' };
  return {
    version: 1,
    title: '未命名流程',
    nodes: [start, process, end],
    edges: [
      { id: createId('edge'), source: start.id, target: process.id, type: 'smoothstep' },
      { id: createId('edge'), source: process.id, target: end.id, type: 'smoothstep' }
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

export function parseFlowDocument(input: unknown): FlowDocument {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw new Error('不是有效的流绘流程工程');
  }
  if (input.nodes.length > 2000 || input.edges.length > 5000) throw new Error('流程工程规模超过安全限制');

  const nodeIds = new Set<string>();
  const nodes: StageNode[] = input.nodes.map((raw, index) => {
    if (!isRecord(raw) || !isRecord(raw.data) || !isRecord(raw.position)) throw new Error(`第 ${index + 1} 个节点格式无效`);
    const id = text(raw.id, '', 120);
    const x = Number(raw.position.x);
    const y = Number(raw.position.y);
    if (!id || nodeIds.has(id) || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`第 ${index + 1} 个节点数据无效`);
    nodeIds.add(id);
    const rawKind = raw.data.kind;
    const kind: StageKind = typeof rawKind === 'string' && STAGE_KINDS.includes(rawKind as StageKind) ? (rawKind as StageKind) : 'process';
    const data: StageData = {
      title: text(raw.data.title, '未命名阶段', 160) || '未命名阶段',
      notes: text(raw.data.notes, '', 20000),
      kind
    };
    return { id, type: 'stage', position: { x, y }, data };
  });

  const edgeIds = new Set<string>();
  const edges: FlowEdge[] = input.edges.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`第 ${index + 1} 条连线格式无效`);
    const id = text(raw.id, '', 120);
    const source = text(raw.source, '', 120);
    const target = text(raw.target, '', 120);
    const sourceHandle = text(raw.sourceHandle, '', 120);
    const targetHandle = text(raw.targetHandle, '', 120);
    if (!id || edgeIds.has(id) || !nodeIds.has(source) || !nodeIds.has(target)) throw new Error(`第 ${index + 1} 条连线数据无效`);
    edgeIds.add(id);
    const label = text(raw.label, '', 120);
    const condition = isRecord(raw.data) ? text(raw.data.condition, '', 120) : '';
    return {
      id,
      source,
      target,
      type: 'smoothstep',
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
      ...(label ? { label } : {}),
      ...(condition ? { data: { condition } } : {})
    };
  });

  const now = new Date().toISOString();
  const viewport = isRecord(input.viewport)
    ? { x: Number(input.viewport.x) || 0, y: Number(input.viewport.y) || 0, zoom: Math.min(2, Math.max(0.2, Number(input.viewport.zoom) || 1)) }
    : { x: 0, y: 0, zoom: 1 };
  return {
    version: 1,
    title: text(input.title, '未命名流程', 200) || '未命名流程',
    nodes,
    edges,
    viewport,
    createdAt: text(input.createdAt, now, 50),
    updatedAt: text(input.updatedAt, now, 50)
  };
}

export function layoutDocument(document: FlowDocument): FlowDocument {
  const incoming = new Map(document.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(document.nodes.map((node) => [node.id, [] as string[]]));
  document.edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });

  const ranks = new Map<string, number>();
  const queue = document.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  if (!queue.length && document.nodes[0]) queue.push(document.nodes[0].id);
  queue.forEach((id) => ranks.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const target of outgoing.get(id) || []) {
      const nextRank = Math.max(ranks.get(target) || 0, (ranks.get(id) || 0) + 1);
      ranks.set(target, nextRank);
      if (!queue.includes(target)) queue.push(target);
    }
  }
  document.nodes.forEach((node) => {
    if (!ranks.has(node.id)) ranks.set(node.id, ranks.size);
  });
  const grouped = new Map<number, StageNode[]>();
  document.nodes.forEach((node) => {
    const rank = ranks.get(node.id) || 0;
    grouped.set(rank, [...(grouped.get(rank) || []), node]);
  });
  const nodes = document.nodes.map((node) => {
    const rank = ranks.get(node.id) || 0;
    const group = grouped.get(rank) || [];
    const row = group.findIndex((item) => item.id === node.id);
    return { ...node, position: { x: 100 + rank * 300, y: 100 + row * 150 } };
  });
  return { ...document, nodes, updatedAt: new Date().toISOString() };
}
