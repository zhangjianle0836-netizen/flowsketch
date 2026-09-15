import type { FlowDocument, StageNode } from '../types';

/** Collapse cycles before ranking, so a late merge update reaches every successor. */
export function layoutFlow(document: FlowDocument): FlowDocument {
  if (!document.nodes.length) return document;
  const ids = new Set(document.nodes.map((node) => node.id));
  const outgoing = new Map(document.nodes.map((node) => [node.id, [] as string[]]));
  const incoming = new Map(document.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of document.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge.target);
    incoming.get(edge.target)!.push(edge.source);
  }
  // Iterative Kosaraju avoids a deep call stack on long imported workflows.
  const seen = new Set<string>();
  const finished: string[] = [];
  for (const node of document.nodes) {
    if (seen.has(node.id)) continue;
    const stack: Array<[string, boolean]> = [[node.id, false]];
    while (stack.length) {
      const [id, exiting] = stack.pop()!;
      if (exiting) { finished.push(id); continue; }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push([id, true]);
      for (const next of outgoing.get(id)!) if (!seen.has(next)) stack.push([next, false]);
    }
  }
  const componentById = new Map<string, number>();
  const components: string[][] = [];
  for (const id of finished.reverse()) {
    if (componentById.has(id)) continue;
    const index = components.length;
    const group: string[] = [];
    const stack = [id];
    componentById.set(id, index);
    while (stack.length) {
      const current = stack.pop()!;
      group.push(current);
      for (const next of incoming.get(current)!) {
        if (componentById.has(next)) continue;
        componentById.set(next, index);
        stack.push(next);
      }
    }
    components.push(group);
  }
  const successors = components.map(() => new Set<number>());
  const indegree = components.map(() => 0);
  for (const edge of document.edges) {
    const source = componentById.get(edge.source);
    const target = componentById.get(edge.target);
    if (source === undefined || target === undefined || source === target || successors[source].has(target)) continue;
    successors[source].add(target);
    indegree[target] += 1;
  }
  const ranks = components.map(() => 0);
  const queue = indegree.flatMap((count, index) => count === 0 ? [index] : []);
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    for (const target of successors[source]) {
      ranks[target] = Math.max(ranks[target], ranks[source] + 1);
      if (--indegree[target] === 0) queue.push(target);
    }
  }
  const layers: StageNode[][] = [];
  for (const node of document.nodes) {
    const rank = ranks[componentById.get(node.id)!];
    (layers[rank] ||= []).push(node);
  }
  const order = new Map<string, number>();
  const refreshOrder = () => layers.forEach((layer) => layer.forEach((node, index) => order.set(node.id, index)));
  refreshOrder();
  // Barycenter sweeps improve branch ordering without changing the flow's topology.
  for (let pass = 0; pass < 4; pass += 1) {
    for (const direction of [1, -1]) {
      const indexes = layers.map((_, index) => index);
      if (direction < 0) indexes.reverse();
      for (const index of indexes) {
        const neighbors = direction > 0 ? incoming : outgoing;
        const score = (node: StageNode) => {
          const adjacent = neighbors.get(node.id)!.filter((id) => ranks[componentById.get(id)!] !== index);
          return adjacent.length ? adjacent.reduce((sum, id) => sum + (order.get(id) || 0), 0) / adjacent.length : order.get(node.id)!;
        };
        layers[index].sort((a, b) => score(a) - score(b));
        refreshOrder();
      }
    }
  }
  const vertical = document.direction === 'TB';
  const size = (node: StageNode) => ({
    width: node.measured?.width || node.width || 210,
    height: node.measured?.height || node.height || (node.data.kind === 'decision' ? 140 : 88)
  });
  const crossSize = (node: StageNode) => vertical ? size(node).width : size(node).height;
  const layerSpan = (layer: StageNode[]) => layer.reduce((sum, node) => sum + crossSize(node), 0) + Math.max(0, layer.length - 1) * 64;
  const maxSpan = Math.max(...layers.map(layerSpan));
  const positions = new Map<string, { x: number; y: number }>();
  let primary = 100;
  for (const layer of layers) {
    let cross = 100 + (maxSpan - layerSpan(layer)) / 2;
    for (const node of layer) {
      positions.set(node.id, vertical ? { x: cross, y: primary } : { x: primary, y: cross });
      cross += crossSize(node) + 64;
    }
    primary += Math.max(...layer.map((node) => vertical ? size(node).height : size(node).width)) + 100;
  }
  return {
    ...document,
    nodes: document.nodes.map((node) => ({ ...node, position: positions.get(node.id)! })),
    updatedAt: new Date().toISOString()
  };
}
