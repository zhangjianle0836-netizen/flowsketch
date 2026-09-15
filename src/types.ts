import type { Edge, Node, Viewport } from '@xyflow/react';
import type { RoutePoint } from './flow/routing';

export type StageKind = 'start' | 'process' | 'decision' | 'end';

export type StageData = {
  title: string;
  notes: string;
  kind: StageKind;
};

export type StageNode = Node<StageData, 'stage'>;
export type FlowEdge = Edge<{ condition?: string; route?: RoutePoint[]; portMode?: 'auto' | 'fixed'; waypoints?: RoutePoint[]; labelPosition?: number; labelOffset?: RoutePoint }>;

export type FlowDocument = {
  version: 1;
  title: string;
  direction?: 'LR' | 'TB';
  nodes: StageNode[];
  edges: FlowEdge[];
  viewport: Viewport;
  createdAt: string;
  updatedAt: string;
};

export type SaveResult = { canceled: boolean; filePath?: string };

export type FlowAPI = {
  openFlow: () => Promise<{ canceled: boolean; document?: unknown; filePath?: string }>;
  saveFlow: (document: FlowDocument, saveAs?: boolean) => Promise<SaveResult>;
  autosaveFlow: (document: FlowDocument) => Promise<{ filePath: string; isRecovery: boolean }>;
  loadRecovery: () => Promise<{ found: boolean; document?: unknown }>;
  newFlow: () => Promise<{ success: boolean }>;
  exportMarkdown: (content: string, title: string) => Promise<SaveResult>;
  exportImage: (dataUrl: string, format: 'png' | 'svg', title: string) => Promise<SaveResult>;
  getTheme: () => Promise<'light' | 'dark'>;
  onThemeChange: (callback: (theme: 'light' | 'dark') => void) => () => void;
};

declare global {
  interface Window {
    flowAPI?: FlowAPI;
  }
}
