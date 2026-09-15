import type { FlowDocument, FlowEdge, StageNode } from '../types';
import { orthogonalRoutePath, routeMidpoint, type RoutePoint } from './routing';

export type ExportBounds = { x: number; y: number; width: number; height: number };
const xml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
const size = (node: StageNode) => ({ width: node.measured?.width || node.width || 210, height: node.measured?.height || node.height || (node.data.kind === 'decision' ? 140 : 88) });

/** Approximate glyph advance conservatively for mixed Chinese and Latin labels. */
export function wrapLabel(value: string, maxWidth: number, fontSize = 15): string[] {
  const lines: string[] = [];
  let line = '';
  let width = 0;
  for (const character of value) {
    const advance = /[^\u0000-\u007f]/u.test(character) ? fontSize : fontSize * 0.65;
    if (character === '\n' || (line && width + advance > maxWidth)) {
      lines.push(line);
      line = '';
      width = 0;
      if (character === '\n') continue;
    }
    line += character;
    width += advance;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

export function edgeLabelPoint(edge: FlowEdge, points: RoutePoint[]): RoutePoint {
  const point = routeMidpoint(points, edge.data?.labelPosition ?? 0.5);
  return { x: point.x + (edge.data?.labelOffset?.x || 0), y: point.y + (edge.data?.labelOffset?.y || 0) };
}

export function edgeLabelSize(label: string) {
  const lines = wrapLabel(label, 240, 12);
  const widths = lines.map((line) => Array.from(line).reduce((sum, character) => sum + (/[^\u0000-\u007f]/u.test(character) ? 12 : 7.8), 0));
  return { width: Math.max(24, ...widths) + 16, height: lines.length * 18 + 8, lines };
}

export function diagramExportBounds(nodes: StageNode[], edges: FlowEdge[]): ExportBounds {
  const boxes = nodes.map((node) => ({ x: node.position.x, y: node.position.y, ...size(node) }));
  for (const edge of edges) {
    const points = edge.data?.route || [];
    for (const point of points) boxes.push({ x: point.x - 12, y: point.y - 12, width: 24, height: 24 });
    const label = typeof edge.label === 'string' ? edge.label.trim() : '';
    if (label && points.length) {
      const center = edgeLabelPoint(edge, points);
      const labelSize = edgeLabelSize(label);
      boxes.push({ x: center.x - labelSize.width / 2, y: center.y - labelSize.height / 2, width: labelSize.width, height: labelSize.height });
    }
  }
  if (!boxes.length) return { x: 0, y: 0, width: 320, height: 200 };
  const left = Math.min(...boxes.map((box) => box.x)) - 48;
  const top = Math.min(...boxes.map((box) => box.y)) - 48;
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + 48;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 48;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Native SVG avoids foreignObject and excludes selection, handles and editor controls. */
export function exportFlowSvg(document: FlowDocument, edges: FlowEdge[], transparent = false): { svg: string; bounds: ExportBounds } {
  const bounds = diagramExportBounds(document.nodes, edges);
  const elements: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img" aria-label="${xml(document.title)}">`,
    `<title>${xml(document.title)}</title>`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#526075"/></marker></defs>',
    transparent ? '' : `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#fff"/>`,
    '<g font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif">'
  ];
  for (const edge of edges) {
    const points = edge.data?.route || [];
    if (points.length > 1) elements.push(`<path d="${orthogonalRoutePath(points)}" fill="none" stroke="#526075" stroke-width="1.8" marker-end="url(#arrow)"/>`);
  }
  const colors = { start: '#28745c', process: '#2d6cdf', decision: '#a76508', end: '#526075' };
  for (const node of document.nodes) {
    const { width, height } = size(node);
    const { x, y } = node.position;
    const color = colors[node.data.kind];
    elements.push(`<g><title>${xml(node.data.title)}</title>`);
    if (node.data.kind === 'decision') elements.push(`<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" fill="#fffaf0" stroke="${color}" stroke-width="1.5"/>`);
    else elements.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${node.data.kind === 'process' ? 6 : height / 2}" fill="#f7f9fc" stroke="${color}" stroke-width="1.5"/>`);
    const lines = wrapLabel(node.data.title, width * (node.data.kind === 'decision' ? 0.58 : 0.82));
    const textY = y + height / 2 - (lines.length - 1) * 10;
    lines.forEach((line, index) => elements.push(`<text x="${x + width / 2}" y="${textY + index * 20}" text-anchor="middle" dominant-baseline="central" fill="#172335" font-size="15" font-weight="600">${xml(line)}</text>`));
    elements.push('</g>');
  }
  // Draw labels last so a crossing line never obscures a condition.
  for (const edge of edges) {
    const label = typeof edge.label === 'string' ? edge.label.trim() : '';
    const points = edge.data?.route || [];
    if (!label || !points.length) continue;
    const center = edgeLabelPoint(edge, points);
    const labelSize = edgeLabelSize(label);
    const anchor = routeMidpoint(points, edge.data?.labelPosition ?? 0.5);
    if (Math.abs(center.x - anchor.x) + Math.abs(center.y - anchor.y) > 24) elements.push(`<line x1="${anchor.x}" y1="${anchor.y}" x2="${center.x}" y2="${center.y}" stroke="#9aa6b8" stroke-width="1" stroke-dasharray="3 3"/>`);
    elements.push(`<g><rect x="${center.x - labelSize.width / 2}" y="${center.y - labelSize.height / 2}" width="${labelSize.width}" height="${labelSize.height}" rx="4" fill="#fff" stroke="#d8dee8"/>`);
    labelSize.lines.forEach((line, index) => elements.push(`<text x="${center.x}" y="${center.y + (index - (labelSize.lines.length - 1) / 2) * 18}" text-anchor="middle" dominant-baseline="central" fill="#27364c" font-size="12">${xml(line)}</text>`));
    elements.push('</g>');
  }
  elements.push('</g></svg>');
  return { svg: elements.join('\n'), bounds };
}

export function pngDimensions(bounds: ExportBounds, requestedScale: number) {
  const scale = Math.min(requestedScale, 8192 / bounds.width, 8192 / bounds.height, Math.sqrt(16_000_000 / (bounds.width * bounds.height)));
  return { width: Math.max(1, Math.ceil(bounds.width * scale)), height: Math.max(1, Math.ceil(bounds.height * scale)), scale };
}

export async function svgToPng(svg: string, bounds: ExportBounds, requestedScale: number): Promise<{ dataUrl: string; reduced: boolean }> {
  const dimensions = pngDimensions(bounds, requestedScale);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片画布');
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = canvas.height = 1;
    if (!dataUrl.startsWith('data:image/png')) throw new Error('图片生成失败，请使用 SVG 导出');
    return { dataUrl, reduced: dimensions.scale < requestedScale };
  } finally { URL.revokeObjectURL(url); }
}

/** Choose readable label positions around nodes and previously placed labels. */
export function placeEdgeLabels(nodes: StageNode[], edges: FlowEdge[]): FlowEdge[] {
  const occupied = nodes.map((node) => ({ ...node.position, ...size(node) }));
  const overlaps = (a: ExportBounds, b: ExportBounds) => a.x < b.x + b.width + 6 && a.x + a.width + 6 > b.x && a.y < b.y + b.height + 6 && a.y + a.height + 6 > b.y;
  return edges.map((edge) => {
    const label = typeof edge.label === 'string' ? edge.label.trim() : '';
    const points = edge.data?.route || [];
    if (!label || !points.length) return edge;
    const labelSize = edgeLabelSize(label);
    const candidates = edge.data?.labelPosition !== undefined || edge.data?.labelOffset
      ? [{ position: edge.data.labelPosition ?? 0.5, offset: edge.data.labelOffset || { x: 0, y: 0 } }]
      : [0.5, 0.35, 0.65, 0.2, 0.8].flatMap((position) => [0, -160, 160, -288, 288].flatMap((x) => [0, -24, 24, -48, 48].map((y) => ({ position, offset: { x, y } }))));
    const ranked = candidates.map((candidate) => {
      const center = routeMidpoint(points, candidate.position);
      const box = { x: center.x + candidate.offset.x - labelSize.width / 2, y: center.y + candidate.offset.y - labelSize.height / 2, width: labelSize.width, height: labelSize.height };
      const collisions = occupied.filter((other) => overlaps(box, other)).length;
      return { ...candidate, box, score: collisions * 1_000_000 + Math.abs(candidate.position - 0.5) * 100 + Math.abs(candidate.offset.y) + Math.abs(candidate.offset.x) };
    });
    ranked.sort((a, b) => a.score - b.score);
    const best = ranked[0];
    occupied.push(best.box);
    return { ...edge, data: { ...edge.data, labelPosition: best.position, labelOffset: best.offset } };
  });
}
