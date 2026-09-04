import { describe, expect, it } from 'vitest';
import type { FlowDocument } from '../types';
import { exportFlowToMarkdown } from './markdown';

const document: FlowDocument = {
  version: 1,
  title: '订单审批',
  nodes: [
    { id: 'start', type: 'stage', position: { x: 0, y: 0 }, data: { title: '提交申请', notes: '申请人填写订单。', kind: 'start' } },
    { id: 'check', type: 'stage', position: { x: 200, y: 0 }, data: { title: '金额超过 1 万？', notes: '按含税金额判断。', kind: 'decision' } },
    { id: 'end', type: 'stage', position: { x: 400, y: 0 }, data: { title: '审批完成', notes: '', kind: 'end' } }
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'check' },
    { id: 'e2', source: 'check', target: 'end', label: '否' }
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

describe('exportFlowToMarkdown', () => {
  it('exports Mermaid relations and stage notes', () => {
    const markdown = exportFlowToMarkdown(document);
    expect(markdown).toContain('# 订单审批');
    expect(markdown).toContain('N2{"金额超过 1 万？"}');
    expect(markdown).toContain('N2 -->|否| N3');
    expect(markdown).toContain('按含税金额判断。');
    expect(markdown).toContain('_暂无备注_');
  });

  it('removes characters that can break Mermaid labels', () => {
    const changed = structuredClone(document);
    changed.nodes[0].data.title = '提交 "申请" <script> | [回退]';
    const markdown = exportFlowToMarkdown(changed);
    expect(markdown).toContain("提交 '申请' script ｜ ［回退］");
    expect(markdown).not.toContain('<script>');
  });
});
