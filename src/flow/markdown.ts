import type { FlowDocument, StageKind } from '../types';

const KIND_LABELS: Record<StageKind, string> = {
  start: '开始',
  process: '处理阶段',
  decision: '判断',
  end: '结束'
};

function mermaidText(value: string): string {
  const replacements: Record<string, string> = {
    '[': '［', ']': '］', '{': '｛', '}': '｝', '(': '（', ')': '）', '|': '｜', '`': '｀', ';': '；'
  };
  return value
    .replace(/["\n\r]/g, (character) => (character === '"' ? "'" : ' '))
    .replace(/[<>]/g, '')
    .replace(/[\[\]{}()|`;]/g, (character) => replacements[character])
    .trim();
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

function markdownNotes(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

function nodeExpression(index: number, title: string, kind: StageKind): string {
  const id = `N${index + 1}`;
  const label = mermaidText(title) || '未命名阶段';
  if (kind === 'start' || kind === 'end') return `${id}(["${label}"])`;
  if (kind === 'decision') return `${id}{"${label}"}`;
  return `${id}["${label}"]`;
}

export function orderedNodes(document: FlowDocument) {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const incoming = new Map(document.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(document.nodes.map((node) => [node.id, [] as string[]]));
  document.edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });
  const queue = document.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const seen = new Set<string>();
  const result = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) result.push(node);
    (outgoing.get(id) || []).forEach((target) => queue.push(target));
  }
  document.nodes.forEach((node) => {
    if (!seen.has(node.id)) result.push(node);
  });
  return result;
}

export function exportFlowToMarkdown(document: FlowDocument): string {
  const nodes = orderedNodes(document);
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const lines = [
    `# ${markdownText(document.title) || '未命名流程'}`,
    '',
    '> 本文档由流绘 FlowSketch 导出。',
    '',
    '## 流程图',
    '',
    '```mermaid',
    'flowchart LR'
  ];

  nodes.forEach((node, index) => lines.push(`  ${nodeExpression(index, node.data.title, node.data.kind)}`));
  document.edges.forEach((edge) => {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined) return;
    const label = typeof edge.label === 'string' ? mermaidText(edge.label) : '';
    lines.push(label ? `  N${source + 1} -->|${label}| N${target + 1}` : `  N${source + 1} --> N${target + 1}`);
  });
  lines.push('```', '', '## 阶段说明', '');

  nodes.forEach((node, index) => {
    lines.push(`### ${index + 1}. ${markdownText(node.data.title) || '未命名阶段'}`, '', `- 类型：${KIND_LABELS[node.data.kind]}`, '');
    if (node.data.notes.trim()) lines.push(markdownNotes(node.data.notes), '');
    else lines.push('_暂无备注_', '');
  });
  return `${lines.join('\n').trim()}\n`;
}
