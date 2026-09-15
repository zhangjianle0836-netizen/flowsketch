import type { FlowDocument, FlowEdge, StageNode } from '../types';

export type FlowIssue = { code: string; message: string; nodeId?: string; edgeId?: string };

export function connectionProblem(nodes: StageNode[], edges: FlowEdge[], sourceId: string | null, targetId: string | null, excludingEdgeId?: string): string | null {
  if (!sourceId || !targetId) return '请选择要连接的两个阶段';
  if (sourceId === targetId) return '不能把阶段连接到自身；回路可通过其他阶段返回';
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!source || !target) return '连接的阶段不存在';
  if (source.data.kind === 'end') return '结束节点不能发出连线';
  if (target.data.kind === 'start') return '开始节点不能接收连线';
  if (edges.some((edge) => edge.id !== excludingEdgeId && edge.source === sourceId && edge.target === targetId)) return '这条流程关系已经存在';
  return null;
}

/** Report incomplete semantics without blocking drafting or legitimate loops. */
export function validateFlow(document: FlowDocument): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const incoming = new Map(document.nodes.map((node) => [node.id, [] as FlowEdge[]]));
  const outgoing = new Map(document.nodes.map((node) => [node.id, [] as FlowEdge[]]));
  for (const edge of document.edges) {
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  }
  const starts = document.nodes.filter((node) => node.data.kind === 'start');
  if (!starts.length) issues.push({ code: 'missing-start', message: '流程还没有开始节点' });
  if (!document.nodes.some((node) => node.data.kind === 'end')) issues.push({ code: 'missing-end', message: '流程还没有结束节点' });
  const reachable = new Set<string>();
  const queue = starts.map((node) => node.id);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of outgoing.get(id) || []) queue.push(edge.target);
  }
  // Reverse reachability catches branches trapped in cycles or dead ends.
  const canFinish = new Set<string>();
  const reverseQueue = document.nodes.filter((node) => node.data.kind === 'end').map((node) => node.id);
  for (let index = 0; index < reverseQueue.length; index += 1) {
    const id = reverseQueue[index];
    if (canFinish.has(id)) continue;
    canFinish.add(id);
    for (const edge of incoming.get(id) || []) reverseQueue.push(edge.source);
  }
  for (const node of document.nodes) {
    const ins = incoming.get(node.id)!;
    const outs = outgoing.get(node.id)!;
    const report = (code: string, message: string) => issues.push({ code, message: `“${node.data.title}”：${message}`, nodeId: node.id });
    if (node.data.kind === 'start' && ins.length) report('start-incoming', '开始节点存在入线');
    if (node.data.kind === 'end' && outs.length) report('end-outgoing', '结束节点存在出线');
    if (!ins.length && !outs.length) report('isolated', '未连接到其他阶段');
    if (starts.length && !reachable.has(node.id)) report('unreachable', '从开始节点无法到达');
    if (node.data.kind !== 'end' && !outs.length) report('dead-end', '缺少后续阶段');
    else if (reachable.has(node.id) && !canFinish.has(node.id)) report('no-exit', '这条路径无法到达结束节点，请确认是否为持续运行流程');
    if (node.data.kind === 'decision') {
      if (outs.length < 2) report('decision-branches', '判断至少需要两个条件分支');
      const labels = new Set<string>();
      for (const edge of outs) {
        const label = typeof edge.label === 'string' ? edge.label.trim() : '';
        if (!label) issues.push({ code: 'missing-condition', message: `“${node.data.title}”的分支缺少条件说明`, edgeId: edge.id });
        else if (labels.has(label)) issues.push({ code: 'duplicate-condition', message: `“${node.data.title}”的分支条件“${label}”重复`, edgeId: edge.id });
        labels.add(label);
      }
    }
  }
  return issues;
}
