import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Icon } from './components/Icon';
import { FlowMiniMap } from './components/FlowMiniMap';
import { RENAME_STAGE_EVENT, StageNode } from './components/StageNode';
import { EDGE_POSITION_EVENT, RoutedEdge } from './components/RoutedEdge';
import { optimizeConnectionHandles, orientConnectionFromOrigin, type ConnectionOrigin } from './flow/connections';
import { createBlankDocument, createId, createStage, layoutDocument, parseFlowDocument } from './flow/document';
import { alignSelection, duplicateSelection, insertStageOnEdge, type Alignment } from './flow/editing';
import { exportFlowSvg, placeEdgeLabels, svgToPng } from './flow/image-export';
import { connectionProblem, validateFlow, type FlowIssue } from './flow/validation';
import { edgePresentation } from './flow/edge-presentation';
import { LibavoidWorkerClient } from './flow/libavoid-client';
import { exportFlowToMarkdown } from './flow/markdown';
import { validEdgeRoute, routeDiagramEdges, updateDiagramRoutes, type DiagramRouteState } from './flow/routing';
import { clearElementSelection, deleteSelectedElements, selectAllElements } from './flow/selection';
import type { FlowDocument, FlowEdge, StageKind, StageNode as StageNodeType } from './types';

const NODE_TYPES = { stage: StageNode };
const EDGE_TYPES = { routed: RoutedEdge };
const STAGE_OPTIONS: Array<{ kind: StageKind; label: string; description: string }> = [
  { kind: 'start', label: '开始', description: '流程入口' },
  { kind: 'process', label: '处理阶段', description: '执行动作' },
  { kind: 'decision', label: '判断', description: '条件分支' },
  { kind: 'end', label: '结束', description: '流程出口' }
];

const HANDLE_OPTIONS = ['left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const HANDLE_LABELS = ['左侧', '右侧', '上方左点', '上方右点', '下方左点', '下方右点'];
type EdgeSettings = { source: string; target: string; sourceHandle: string; targetHandle: string; portMode: 'auto' | 'fixed'; waypoints: Array<{ x: number; y: number }>; labelPosition?: number; labelOffset?: { x: number; y: number } };
const edgeSettingsFrom = (edge: FlowEdge): EdgeSettings => ({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle || 'source-right', targetHandle: edge.targetHandle || 'target-left', portMode: edge.data?.portMode || 'auto', waypoints: edge.data?.waypoints?.map((point) => ({ ...point })) || [], labelPosition: edge.data?.labelPosition, labelOffset: edge.data?.labelOffset });

type NoteEditorState = {
  nodeId: string;
  title: string;
  notes: string;
};

function cleanDocument(document: FlowDocument): FlowDocument {
  return {
    ...document,
    nodes: document.nodes.map(({ selected: _selected, dragging: _dragging, ...node }) => node),
    edges: document.edges.map(({ selected: _selected, ...edge }) => edge)
  };
}

function downloadInBrowser(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function FlowSketchApp() {
  const reactFlow = useReactFlow<StageNodeType, FlowEdge>();
  const [flowDocument, setFlowDocument] = useState<FlowDocument>(() => createBlankDocument());
  const documentRef = useRef(flowDocument);
  const [undoStack, setUndoStack] = useState<FlowDocument[]>([]);
  const [redoStack, setRedoStack] = useState<FlowDocument[]>([]);
  const dragSnapshot = useRef<FlowDocument | null>(null);
  const routeStateRef = useRef<DiagramRouteState | undefined>(undefined);
  const routingWorkerRef = useRef<LibavoidWorkerClient | null>(null);
  const routeGenerationRef = useRef(0);
  const routingFailedRef = useRef(false);
  const [routingWorkerVersion, setRoutingWorkerVersion] = useState(0);
  const [routeVersion, setRouteVersion] = useState(0);
  const connectionOriginRef = useRef<ConnectionOrigin | null>(null);
  const pendingSelectionRef = useRef<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [nodeDraft, setNodeDraft] = useState({ title: '', notes: '', kind: 'process' as StageKind });
  const [edgeDraft, setEdgeDraft] = useState('');
  const [edgeSettings, setEdgeSettings] = useState<EdgeSettings>(() => edgeSettingsFrom({ id: '', source: '', target: '' }));
  const reconnectingEdgeIdRef = useRef<string | undefined>(undefined);
  const [imageScale, setImageScale] = useState(2);
  const [transparentExport, setTransparentExport] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const [connectionTargetId, setConnectionTargetId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null);
  const noteDialogRef = useRef<HTMLDialogElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [status, setStatus] = useState('已就绪');
  const [exporting, setExporting] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  useEffect(() => {
    const worker = new LibavoidWorkerClient();
    routingWorkerRef.current = worker;
    routingFailedRef.current = false;
    setRoutingWorkerVersion((value) => value + 1);
    return () => {
      if (routingWorkerRef.current === worker) routingWorkerRef.current = null;
      worker.dispose();
    };
  }, []);

  const selectedNode = useMemo(
    () => flowDocument.nodes.find((node) => node.id === selectedNodeId) || null,
    [flowDocument.nodes, selectedNodeId]
  );
  const selectedEdge = useMemo(
    () => flowDocument.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [flowDocument.edges, selectedEdgeId]
  );
  const selectedNodes = useMemo(
    () => flowDocument.nodes.filter((node) => node.selected),
    [flowDocument.nodes]
  );
  const selectedEdges = useMemo(
    () => flowDocument.edges.filter((edge) => edge.selected),
    [flowDocument.edges]
  );
  const selectedElementCount = selectedNodes.length + selectedEdges.length;
  const hasMultiSelection = selectedElementCount > 1;
  const displayEdges = useMemo(
    () => flowDocument.edges.map((edge) => optimizeConnectionHandles(edge, flowDocument.nodes)),
    [flowDocument.edges, flowDocument.nodes]
  );
  const routingResult = useMemo(() => {
    const routeState = updateDiagramRoutes(flowDocument.nodes, displayEdges, routeStateRef.current, routeDiagramEdges);
    const nodeTitles = new Map(flowDocument.nodes.map((node) => [node.id, node.data.title]));
    return {
      routeState,
      edges: placeEdgeLabels(flowDocument.nodes, displayEdges.map((edge) => {
        const presentation = edgePresentation(theme, Boolean(edge.selected), edge.style);
        return {
          ...edge,
          type: 'routed',
          ariaLabel: [
            `${nodeTitles.get(edge.source) || '起点'}到${nodeTitles.get(edge.target) || '终点'}的连线`,
            typeof edge.label === 'string' && edge.label.trim() ? `标注：${edge.label.trim()}` : ''
          ].filter(Boolean).join('，'),
          markerEnd: { type: MarkerType.ArrowClosed, color: presentation.color },
          style: presentation.style,
          data: { ...edge.data, route: routeState.routes.get(edge.id) }
        };
      }))
    };
  }, [displayEdges, flowDocument.nodes, routeVersion, theme]);
  useLayoutEffect(() => {
    routeStateRef.current = routingResult.routeState;
  }, [routingResult.routeState]);

  useEffect(() => {
    const worker = routingWorkerRef.current;
    const dirtyEdges = displayEdges.filter((edge) => !edge.data?.waypoints?.length && routingResult.routeState.dirtyEdgeIds.has(edge.id));
    const generation = routeGenerationRef.current + 1;
    routeGenerationRef.current = generation;
    if (!worker || routingFailedRef.current || !dirtyEdges.length) return;
    let cancelled = false;

    const isDragging = flowDocument.nodes.some((node) => node.dragging);
    const timer = window.setTimeout(() => {
      const request = worker.route(flowDocument.nodes, dirtyEdges);
      request.promise.then((routes) => {
        if (cancelled || routeGenerationRef.current !== generation || routingWorkerRef.current !== worker) return;
        const current = routeStateRef.current;
        if (!current) return;
        const mergedRoutes = new Map(current.routes);
        for (const [edgeId, route] of routes) {
          const edge = dirtyEdges.find((item) => item.id === edgeId);
          if (edge && validEdgeRoute(documentRef.current.nodes, edge, route)) mergedRoutes.set(edgeId, route);
        }
        routeStateRef.current = { ...current, routes: mergedRoutes, dirtyEdgeIds: new Set() };
        setRouteVersion((value) => value + 1);
      }).catch((error) => {
        if (cancelled || routeGenerationRef.current !== generation || routingWorkerRef.current !== worker) return;
        routingFailedRef.current = true;
        console.error('libavoid 初始化或计算失败，已切换到兼容路由器', error);
        setStatus('智能避障加载失败，已使用兼容路由');
      });
    }, isDragging ? 120 : 0);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [displayEdges, flowDocument.nodes, routingResult.routeState, routingWorkerVersion]);
  const routedEdges = routingResult.edges;
  const availableConnectionTargets = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind === 'end') return [];
    const connectedTargetIds = new Set(
      flowDocument.edges.filter((edge) => edge.source === selectedNode.id).map((edge) => edge.target)
    );
    return flowDocument.nodes.filter((node) => (
      node.data.kind !== 'start' && node.id !== selectedNode.id && !connectedTargetIds.has(node.id)
    ));
  }, [flowDocument.edges, flowDocument.nodes, selectedNode]);

  useEffect(() => {
    if (selectedNode) setNodeDraft({ ...selectedNode.data });
    setConnectionTargetId('');
  }, [selectedNode?.id]);

  useEffect(() => {
    if (selectedEdge) {
      setEdgeDraft(typeof selectedEdge.label === 'string' ? selectedEdge.label : '');
      setEdgeSettings(edgeSettingsFrom(selectedEdge));
    }
  }, [selectedEdge]);

  useEffect(() => {
    const dialog = noteDialogRef.current;
    if (!noteEditor || !dialog || dialog.open) return;
    dialog.showModal();
    window.setTimeout(() => noteTextareaRef.current?.focus(), 0);
  }, [noteEditor]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!window.flowAPI) return;
    window.flowAPI.getTheme().then(setTheme).catch(() => undefined);
    return window.flowAPI.onThemeChange(setTheme);
  }, []);

  useEffect(() => {
    if (!window.flowAPI) return;
    window.flowAPI.loadRecovery().then((result) => {
      if (!result.found || !result.document) return;
      try {
        const recovered = parseFlowDocument(result.document);
        documentRef.current = recovered;
        setFlowDocument(recovered);
        setDirty(true);
        setStatus('已恢复上次未保存的流程');
      } catch {
        setStatus('恢复文件无效，已创建新流程');
      }
    }).catch(() => undefined);
  }, []);

  const replaceDocument = useCallback((next: FlowDocument, markDirty = true) => {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    documentRef.current = updated;
    setFlowDocument(updated);
    if (markDirty) {
      setDirty(true);
      setRevision((value) => value + 1);
    }
  }, []);

  const commit = useCallback((updater: (current: FlowDocument) => FlowDocument) => {
    const current = documentRef.current;
    const next = updater(current);
    if (next === current) return;
    setUndoStack((stack) => [...stack.slice(-49), cleanDocument(current)]);
    setRedoStack([]);
    replaceDocument(next);
  }, [replaceDocument]);

  const undo = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const snapshot = cleanDocument(documentRef.current);
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, snapshot]);
    replaceDocument(previous);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setStatus('已撤销');
  }, [replaceDocument, undoStack]);

  const redo = useCallback(() => {
    const next = redoStack.at(-1);
    if (!next) return;
    const snapshot = cleanDocument(documentRef.current);
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, snapshot]);
    replaceDocument(next);
    setStatus('已重做');
  }, [redoStack, replaceDocument]);

  useEffect(() => {
    if (!revision || !window.flowAPI) return;
    setStatus('正在自动保存…');
    const timer = window.setTimeout(() => {
      window.flowAPI?.autosaveFlow(cleanDocument(documentRef.current))
        .then((result) => setStatus(result.isRecovery ? '草稿已安全保存' : '更改已自动保存'))
        .catch(() => setStatus('自动保存失败，请手动保存'));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [revision]);

  const handleSave = useCallback(async (saveAs = false) => {
    setStatus('正在保存…');
    try {
      if (window.flowAPI) {
        const result = await window.flowAPI.saveFlow(cleanDocument(documentRef.current), saveAs);
        if (result.canceled) return setStatus('已取消保存');
        setFilePath(result.filePath || null);
      } else {
        localStorage.setItem('flowcanvas-document', JSON.stringify(cleanDocument(documentRef.current)));
      }
      setDirty(false);
      setStatus('流程已保存');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    }
  }, []);

  const handleNew = useCallback(async () => {
    if (dirty && !window.confirm('当前流程有未手动保存的更改，仍要新建吗？草稿将被替换。')) return;
    await window.flowAPI?.newFlow();
    const next = createBlankDocument();
    routeStateRef.current = undefined;
    documentRef.current = next;
    setFlowDocument(next);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setFilePath(null);
    setDirty(false);
    setRevision(0);
    setStatus('已新建流程');
    window.setTimeout(() => reactFlow.fitView({ padding: 0.25 }), 50);
  }, [dirty, reactFlow]);

  const handleOpen = useCallback(async () => {
    if (!window.flowAPI) return setStatus('请在桌面应用中打开流程工程');
    if (dirty && !window.confirm('当前流程有未手动保存的更改，仍要打开其他流程吗？')) return;
    try {
      const result = await window.flowAPI.openFlow();
      if (result.canceled || !result.document) return;
      const opened = parseFlowDocument(result.document);
      routeStateRef.current = undefined;
      documentRef.current = opened;
      setFlowDocument(opened);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setFilePath(result.filePath || null);
      setDirty(false);
      setStatus('流程工程已打开');
      window.setTimeout(() => reactFlow.fitView({ padding: 0.25 }), 50);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '打开失败');
    }
  }, [dirty, reactFlow]);

  const addStage = useCallback((kind: StageKind, position?: { x: number; y: number }) => {
    const current = documentRef.current;
    const selected = current.nodes.find((node) => node.id === selectedNodeId);
    const nextPosition = position || (selected
      ? { x: selected.position.x + 300, y: selected.position.y + current.nodes.filter((node) => node.position.x > selected.position.x).length * 24 }
      : reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
    const node = { ...createStage(kind, nextPosition), selected: true };
    commit((document) => {
      const edge = selected && selected.data.kind !== 'end' && kind !== 'start'
        ? [{ id: createId('edge'), source: selected.id, target: node.id, sourceHandle: 'source-right', targetHandle: 'target-left', data: { portMode: 'auto' as const }, type: 'smoothstep' as const }]
        : [];
      return { ...document, nodes: [...document.nodes.map((item) => ({ ...item, selected: false })), node], edges: [...document.edges, ...edge] };
    });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setStatus(`已添加${STAGE_OPTIONS.find((item) => item.kind === kind)?.label}`);
  }, [commit, reactFlow, selectedNodeId]);

  const focusCanvasNode = useCallback((nodeId: string) => {
    pendingSelectionRef.current = nodeId;
    window.setTimeout(() => {
      const nodeElement = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node')).find((element) => element.dataset.id === nodeId);
      if (!nodeElement || !documentRef.current.nodes.some((node) => node.id === nodeId)) return;
      nodeElement.focus();
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
    }, 40);
    window.setTimeout(() => {
      if (pendingSelectionRef.current === nodeId) pendingSelectionRef.current = null;
    }, 300);
  }, []);

  const openNoteEditor = useCallback((nodeId: string) => {
    const node = documentRef.current.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setNoteEditor({ nodeId, title: node.data.title, notes: node.data.notes });
  }, []);

  const closeNoteEditor = useCallback(() => {
    const nodeId = noteEditor?.nodeId;
    if (noteDialogRef.current?.open) noteDialogRef.current.close();
    setNoteEditor(null);
    if (nodeId) window.setTimeout(() => focusCanvasNode(nodeId), 0);
  }, [focusCanvasNode, noteEditor?.nodeId]);

  const saveNoteEditor = useCallback(() => {
    if (!noteEditor) return;
    const title = noteEditor.title.trim();
    if (!title) {
      setStatus('阶段名称不能为空');
      return;
    }
    commit((document) => ({
      ...document,
      nodes: document.nodes.map((node) => node.id === noteEditor.nodeId
        ? { ...node, data: { ...node.data, title, notes: noteEditor.notes } }
        : node)
    }));
    setStatus('阶段备注已保存');
    closeNoteEditor();
  }, [closeNoteEditor, commit, noteEditor]);

  const addChildStage = useCallback((activeNodeId?: string | null) => {
    const current = documentRef.current;
    const parent = current.nodes.find((node) => node.id === (activeNodeId || selectedNodeId));
    if (!parent) return;
    if (parent.data.kind === 'end') {
      setStatus('结束节点不能新增下级阶段');
      return;
    }
    const childCount = current.edges.filter((edge) => edge.source === parent.id).length;
    const child = {
      ...createStage('process', current.direction === 'TB' ? { x: parent.position.x + childCount * 280, y: parent.position.y + 240 } : { x: parent.position.x + 310, y: parent.position.y + childCount * 160 }),
      selected: true
    };
    commit((document) => ({
      ...document,
      nodes: [...document.nodes.map((node) => ({ ...node, selected: false })), child],
      edges: [...document.edges, {
        id: createId('edge'),
        source: parent.id,
        target: child.id,
        sourceHandle: 'source-right',
        targetHandle: 'target-left',
        type: 'smoothstep',
        data: { portMode: 'auto' }
      }]
    }));
    setSelectedNodeId(child.id);
    setSelectedEdgeId(null);
    setStatus('已新增下级阶段');
    focusCanvasNode(child.id);
  }, [commit, focusCanvasNode, selectedNodeId]);

  const addSiblingStage = useCallback((activeNodeId?: string | null) => {
    const current = documentRef.current;
    const selected = current.nodes.find((node) => node.id === (activeNodeId || selectedNodeId));
    if (!selected) return;
    const incoming = current.edges.filter((edge) => edge.target === selected.id);
    const primaryParentId = incoming[0]?.source;
    const siblingIds = primaryParentId
      ? new Set(current.edges.filter((edge) => edge.source === primaryParentId).map((edge) => edge.target))
      : new Set(current.nodes.filter((node) => !current.edges.some((edge) => edge.target === node.id)).map((node) => node.id));
    const siblingY = current.nodes
      .filter((node) => siblingIds.has(node.id))
      .reduce((maximum, node) => Math.max(maximum, node.position.y), selected.position.y);
    const sibling = {
      ...createStage('process', current.direction === 'TB' ? { x: Math.max(...current.nodes.filter((node) => siblingIds.has(node.id)).map((node) => node.position.x), selected.position.x) + 280, y: selected.position.y } : { x: selected.position.x, y: siblingY + 160 }),
      selected: true
    };
    const siblingEdges = incoming.map((edge) => ({
      id: createId('edge'),
      source: edge.source,
      target: sibling.id,
      sourceHandle: edge.sourceHandle || 'source-right',
      targetHandle: 'target-left',
      type: 'smoothstep' as const,
      data: { portMode: 'auto' as const }
    }));
    commit((document) => ({
      ...document,
      nodes: [...document.nodes.map((node) => ({ ...node, selected: false })), sibling],
      edges: [...document.edges, ...siblingEdges]
    }));
    setSelectedNodeId(sibling.id);
    setSelectedEdgeId(null);
    setStatus('已新增同级阶段');
    focusCanvasNode(sibling.id);
  }, [commit, focusCanvasNode, selectedNodeId]);

  const clearSelection = useCallback((focusCanvas = false) => {
    const current = documentRef.current;
    if (!current.nodes.some((node) => node.selected) && !current.edges.some((edge) => edge.selected)) return;
    const cleared = clearElementSelection(current);
    documentRef.current = cleared;
    setFlowDocument(cleared);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setStatus('已取消选择');
    if (focusCanvas) {
      window.setTimeout(() => document.querySelector<HTMLElement>('.react-flow')?.focus(), 0);
    }
  }, []);

  const selectAll = useCallback(() => {
    const current = documentRef.current;
    if (!current.nodes.length && !current.edges.length) return setStatus('画布中还没有可选择的元素');
    const selected = selectAllElements(current);
    documentRef.current = selected;
    setFlowDocument(selected);
    setSelectedNodeId(selected.nodes.at(-1)?.id || null);
    setSelectedEdgeId(selected.nodes.length ? null : selected.edges.at(-1)?.id || null);
    const count = selected.nodes.length + selected.edges.length;
    setStatus(`已选择全部 ${count} 个元素`);
  }, []);

  const deleteSelection = useCallback(() => {
    const result = deleteSelectedElements(documentRef.current, {
      nodeId: selectedNodeId,
      edgeId: selectedEdgeId
    });
    if (!result.deletedNodes && !result.deletedEdges) return;
    commit(() => result.document);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    if (result.deletedNodes && result.deletedEdges) {
      setStatus(`已删除 ${result.deletedNodes} 个阶段和 ${result.deletedEdges} 条连线`);
    } else if (result.deletedNodes) {
      setStatus(`已删除 ${result.deletedNodes} 个阶段`);
    } else {
      setStatus(`已删除 ${result.deletedEdges} 条连线`);
    }
  }, [commit, selectedEdgeId, selectedNodeId]);

  const updateSelectedNode = useCallback(() => {
    if (!selectedNodeId || !nodeDraft.title.trim()) return setStatus('阶段名称不能为空');
    commit((document) => ({
      ...document,
      nodes: document.nodes.map((node) => node.id === selectedNodeId
        ? { ...node, data: { ...nodeDraft, title: nodeDraft.title.trim() } }
        : node)
    }));
    setStatus('阶段信息已更新');
  }, [commit, nodeDraft, selectedNodeId]);

  useEffect(() => {
    const handleRename = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; title?: string }>).detail;
      const title = detail?.title?.trim();
      if (!detail?.nodeId || !title) return;
      commit((document) => ({
        ...document,
        nodes: document.nodes.map((node) => node.id === detail.nodeId
          ? { ...node, data: { ...node.data, title } }
          : node)
      }));
      setStatus('阶段标题已更新');
    };
    window.addEventListener(RENAME_STAGE_EVENT, handleRename);
    return () => window.removeEventListener(RENAME_STAGE_EVENT, handleRename);
  }, [commit]);

  const updateSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    const current = documentRef.current;
    const old = current.edges.find((edge) => edge.id === selectedEdgeId);
    const endpointsChanged = old?.source !== edgeSettings.source || old?.target !== edgeSettings.target;
    const problem = endpointsChanged ? connectionProblem(current.nodes, current.edges, edgeSettings.source, edgeSettings.target, selectedEdgeId) : null;
    if (problem) return setStatus(problem);
    commit((document) => ({
      ...document,
      edges: document.edges.map((edge) => edge.id === selectedEdgeId ? {
        ...edge, source: edgeSettings.source, target: edgeSettings.target,
        sourceHandle: edgeSettings.sourceHandle, targetHandle: edgeSettings.targetHandle,
        label: edgeDraft.trim(), data: { ...edge.data, portMode: edgeSettings.portMode, waypoints: edgeSettings.waypoints.length ? edgeSettings.waypoints : undefined, labelPosition: edgeSettings.labelPosition, labelOffset: edgeSettings.labelOffset }
      } : edge)
    }));
    setStatus('连线设置已更新');
  }, [commit, edgeDraft, edgeSettings, selectedEdgeId]);

  const duplicate = useCallback(() => {
    const current = documentRef.current;
    if (!current.nodes.some((node) => node.selected) && !selectedNodeId) return setStatus('请先选择要复制的阶段');
    commit((document) => duplicateSelection(document.nodes.some((node) => node.selected) ? document : { ...document, nodes: document.nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId })) }));
    const copies = documentRef.current.nodes.filter((node) => node.selected);
    setSelectedNodeId(copies.at(-1)?.id || null);
    setSelectedEdgeId(null);
    setStatus('已复制所选阶段及内部连线');
  }, [commit, selectedNodeId]);

  const align = useCallback((mode: Alignment) => {
    commit((document) => alignSelection(document, mode));
    setStatus('所选阶段已整理');
  }, [commit]);

  const insertStage = useCallback(() => {
    if (!selectedEdgeId) return;
    commit((document) => insertStageOnEdge(document, selectedEdgeId));
    const inserted = documentRef.current.nodes.find((node) => node.selected);
    setSelectedEdgeId(null);
    setSelectedNodeId(inserted?.id || null);
    if (inserted) focusCanvasNode(inserted.id);
    setStatus('已插入处理阶段，原分支条件保留在第一段连线上');
  }, [commit, focusCanvasNode, selectedEdgeId]);

  const flowIssues = useMemo(() => validateFlow(flowDocument), [flowDocument]);
  const focusIssue = useCallback((issue: FlowIssue) => {
    const current = documentRef.current;
    const edge = current.edges.find((item) => item.id === issue.edgeId);
    const next = { ...current, nodes: current.nodes.map((node) => ({ ...node, selected: node.id === issue.nodeId })), edges: current.edges.map((edge) => ({ ...edge, selected: edge.id === issue.edgeId })) };
    documentRef.current = next;
    setFlowDocument(next);
    setSelectedNodeId(issue.nodeId || null);
    setSelectedEdgeId(issue.edgeId || null);
    const target = current.nodes.find((node) => node.id === (issue.nodeId || edge?.source));
    if (target) reactFlow.fitView({ nodes: [target], padding: 0.5, duration: 180 });
    window.setTimeout(() => document.getElementById(issue.edgeId ? 'edge-label' : 'stage-title')?.focus(), 80);
    setStatus(issue.message);
  }, [reactFlow]);

  const connectStages = useCallback((
    sourceId: string | null,
    targetId: string | null,
    sourceHandle = 'source-right',
    targetHandle = 'target-left',
    portMode: 'auto' | 'fixed' = 'auto'
  ) => {
    const problem = connectionProblem(documentRef.current.nodes, documentRef.current.edges, sourceId, targetId);
    if (problem) return setStatus(problem);
    if (!sourceId || !targetId) return;
    const optimized = optimizeConnectionHandles({
      source: sourceId,
      target: targetId,
      sourceHandle,
      targetHandle,
      data: { portMode }
    }, documentRef.current.nodes);
    commit((document) => ({
      ...document,
      edges: addEdge({
        id: createId('edge'),
        source: sourceId,
        target: targetId,
        sourceHandle: optimized.sourceHandle,
        targetHandle: optimized.targetHandle,
        data: { portMode },
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed }
      }, document.edges)
    }));
    setConnectionTargetId('');
    setStatus('流程关系已建立');
  }, [commit]);

  const handleConnect = useCallback((connection: Connection) => {
    setIsConnecting(false);
    const oriented = orientConnectionFromOrigin(connection, connectionOriginRef.current);
    connectionOriginRef.current = null;
    connectStages(
      oriented.source,
      oriented.target,
      oriented.sourceHandle || 'source-right',
      oriented.targetHandle || 'target-left',
      'fixed'
    );
  }, [connectStages]);

  const handleReconnect = useCallback((old: FlowEdge, connection: Connection) => {
    const current = documentRef.current;
    const problem = connectionProblem(current.nodes, current.edges, connection.source, connection.target, old.id);
    if (problem) return setStatus(problem);
    commit((document) => ({ ...document, edges: document.edges.map((edge) => edge.id === old.id ? { ...edge, ...connection, data: { ...edge.data, portMode: 'fixed', waypoints: undefined } } : edge) }));
    setStatus('已重新连接，原条件说明已保留');
  }, [commit]);

  useEffect(() => {
    let snapshot: FlowDocument | null = null;
    const editPosition = (event: Event) => {
      const { edgeId, phase, waypointIndex, point, labelOffset, labelPosition } = (event as CustomEvent<{ edgeId: string; phase: 'start' | 'move' | 'end' | 'cancel'; waypointIndex?: number; point?: { x: number; y: number }; labelOffset?: { x: number; y: number }; labelPosition?: number }>).detail;
      if (phase === 'start') { snapshot = cleanDocument(documentRef.current); return; }
      if (!snapshot) return;
      if (phase === 'cancel') { documentRef.current = snapshot; setFlowDocument(snapshot); snapshot = null; return; }
      const current = documentRef.current;
      const next = { ...current, edges: current.edges.map((edge) => edge.id !== edgeId ? edge : {
        ...edge, data: { ...edge.data,
          ...(point && waypointIndex !== undefined ? { waypoints: edge.data?.waypoints?.map((old, index) => index === waypointIndex ? point : old) } : {}),
          ...(labelOffset ? { labelOffset, labelPosition } : {})
        }
      }) };
      documentRef.current = next;
      setFlowDocument(next);
      if (phase === 'end') {
        const previous = snapshot;
        snapshot = null;
        if (JSON.stringify(previous.edges) === JSON.stringify(cleanDocument(next).edges)) return;
        setUndoStack((stack) => [...stack.slice(-49), previous]);
        setRedoStack([]);
        replaceDocument(next);
        setStatus('连线位置已更新');
      }
    };
    window.addEventListener(EDGE_POSITION_EVENT, editPosition);
    return () => window.removeEventListener(EDGE_POSITION_EVENT, editPosition);
  }, [replaceDocument]);

  const handleNodesChange = useCallback((changes: NodeChange<StageNodeType>[]) => {
    const meaningful = changes.some((change) => change.type === 'position' && !change.dragging);
    const updated = { ...documentRef.current, nodes: applyNodeChanges(changes, documentRef.current.nodes) };
    documentRef.current = updated;
    setFlowDocument(updated);
    if (meaningful) {
      setDirty(true);
      setRevision((value) => value + 1);
    }
  }, []);

  const handleEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const updated = { ...documentRef.current, edges: applyEdgeChanges(changes, documentRef.current.edges) };
    documentRef.current = updated;
    setFlowDocument(updated);
  }, []);

  const handleDragStart = useCallback(() => {
    dragSnapshot.current = cleanDocument(documentRef.current);
  }, []);

  const handleDragStop = useCallback(() => {
    const snapshot = dragSnapshot.current;
    dragSnapshot.current = null;
    if (!snapshot) return;
    const currentNodes = new Map(documentRef.current.nodes.map((node) => [node.id, node]));
    const hasMoved = snapshot.nodes.some((node) => {
      const current = currentNodes.get(node.id);
      return current && (current.position.x !== node.position.x || current.position.y !== node.position.y);
    });
    if (!hasMoved) return;
    setUndoStack((stack) => [...stack.slice(-49), snapshot]);
    setRedoStack([]);
  }, []);

  const organizeLayout = useCallback(() => {
    commit(layoutDocument);
    window.setTimeout(() => reactFlow.fitView({ padding: 0.22, duration: 250 }), 60);
    setStatus('画布已自动整理');
  }, [commit, reactFlow]);

  const exportMarkdown = useCallback(async () => {
    const issues = validateFlow(documentRef.current);
    if (issues.length) setShowChecks(true);
    const markdown = exportFlowToMarkdown(cleanDocument(documentRef.current));
    try {
      if (window.flowAPI) {
        const result = await window.flowAPI.exportMarkdown(markdown, documentRef.current.title);
        if (result.canceled) return setStatus('已取消导出');
      } else downloadInBrowser(markdown, `${documentRef.current.title}.md`, 'text/markdown;charset=utf-8');
      setStatus(issues.length ? `Markdown 已导出；流程检查发现 ${issues.length} 项待确认，请查看右侧检查列表` : 'Markdown 文档已导出');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Markdown 导出失败');
    }
  }, []);

  const exportImage = useCallback(async (format: 'png' | 'svg') => {
    if (exporting) return;
    if (!documentRef.current.nodes.length) return setStatus('画布中没有可导出的阶段');
    setExporting(true);
    setStatus(`正在生成 ${format.toUpperCase()}…`);
    try {
      const current = cleanDocument(documentRef.current);
      const issues = validateFlow(current);
      if (issues.length) setShowChecks(true);
      const edges = placeEdgeLabels(current.nodes, routedEdges);
      const { svg, bounds } = exportFlowSvg(current, edges, transparentExport);
      const png = format === 'png' ? await svgToPng(svg, bounds, imageScale) : null;
      const dataUrl = png?.dataUrl || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      if (window.flowAPI) {
        const result = await window.flowAPI.exportImage(dataUrl, format, current.title);
        if (result.canceled) return setStatus('已取消导出');
      } else {
        const anchor = document.createElement('a');
        anchor.href = dataUrl;
        anchor.download = `${current.title}.${format}`;
        anchor.click();
      }
      setStatus(`${format.toUpperCase()} 已完整导出${png?.reduced ? '；大图已自动降低倍率，SVG 可保留全部精度' : ''}${issues.length ? `；有 ${issues.length} 项流程检查待确认` : ''}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '图片导出失败');
    } finally { setExporting(false); }
  }, [exporting, imageScale, routedEdges, transparentExport]);

  const updateViewport = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    documentRef.current = { ...documentRef.current, viewport };
    setFlowDocument(documentRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isEditing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      const isInDialog = Boolean(target.closest('dialog'));
      const canvasShortcutAllowed = !isEditing && !isInDialog;
      const canvasNodeElement = target.closest<HTMLElement>('.react-flow__node');
      const activeCanvasNodeId = target === canvasNodeElement ? canvasNodeElement?.dataset.id : undefined;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave(event.shiftKey);
      } else if (canvasShortcutAllowed && command && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (canvasShortcutAllowed && command && ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')) {
        event.preventDefault();
        redo();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        exportMarkdown();
      } else if (canvasShortcutAllowed && command && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicate();
      } else if (canvasShortcutAllowed && command && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      } else if (canvasShortcutAllowed && event.key === 'Escape') {
        event.preventDefault();
        clearSelection(true);
      } else if (canvasShortcutAllowed && event.shiftKey && !command && !event.altKey && event.code === 'Digit1') {
        event.preventDefault();
        if (!documentRef.current.nodes.length) {
          setStatus('画布中还没有阶段');
          return;
        }
        reactFlow.fitView({ padding: 0.25, duration: 220 });
        setStatus('已显示全部阶段');
      } else if (canvasShortcutAllowed && event.shiftKey && !command && !event.altKey && event.code === 'Digit2') {
        event.preventDefault();
        const selectedNodes = documentRef.current.nodes.filter((node) => node.selected);
        if (!selectedNodes.length) {
          setStatus('请先选择要聚焦的阶段');
          return;
        }
        reactFlow.fitView({ nodes: selectedNodes, padding: 0.35, duration: 220 });
        setStatus(selectedNodes.length > 1 ? `已聚焦 ${selectedNodes.length} 个阶段` : '已聚焦所选阶段');
      } else if (canvasShortcutAllowed && event.code === 'Digit0' && !command && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        reactFlow.zoomTo(1, { duration: 180 });
        setStatus('画布缩放已恢复为 100%');
      } else if (canvasShortcutAllowed && activeCanvasNodeId && event.key === 'Enter') {
        event.preventDefault();
        addSiblingStage(activeCanvasNodeId);
      } else if (canvasShortcutAllowed && activeCanvasNodeId && !event.shiftKey && event.key === 'Tab') {
        event.preventDefault();
        addChildStage(activeCanvasNodeId);
      } else if (canvasShortcutAllowed && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deleteSelection();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [addChildStage, addSiblingStage, clearSelection, deleteSelection, exportMarkdown, handleSave, reactFlow, redo, selectAll, selectedNodeId, undo, duplicate]);

  return (
    <div className={`app-shell${isConnecting ? ' is-connecting' : ''}${hasMultiSelection ? ' has-multi-selection' : ''}`}>
      <header className="topbar">
        <div className="brand" aria-label="流绘 FlowSketch">
          <img className="brand__mark" src="./app-icon.png" alt="" />
          <div><strong>流绘</strong><small>FLOWSKETCH</small></div>
        </div>
        <div className="file-actions" aria-label="文件操作">
          <button className="tool-button" onClick={handleNew}><Icon name="new" />新建</button>
          <button className="tool-button" onClick={handleOpen}><Icon name="open" />打开</button>
          <button className="tool-button" onClick={() => handleSave(false)}><Icon name="save" />保存</button>
        </div>
        <label className="document-title">
          <span className="sr-only">流程名称</span>
          <input
            value={flowDocument.title}
            maxLength={200}
            onChange={(event) => {
              const updated = { ...documentRef.current, title: event.target.value };
              documentRef.current = updated;
              setFlowDocument(updated);
              setDirty(true);
              setRevision((value) => value + 1);
            }}
          />
          <small>{dirty ? '有未手动保存的更改' : filePath ? filePath.split(/[\\/]/).pop() : '本地流程工程'}</small>
        </label>
        <div className="topbar__right">
          <button className="tool-button icon-only" onClick={undo} disabled={!undoStack.length} aria-label="撤销" title="撤销（⌘Z）"><Icon name="undo" /></button>
          <button className="tool-button icon-only" onClick={redo} disabled={!redoStack.length} aria-label="重做" title="重做（⇧⌘Z）"><Icon name="redo" /></button>
          <span className="topbar__divider" />
          <label className="sr-only" htmlFor="export-scale">PNG 导出倍率</label>
          <select id="export-scale" value={imageScale} onChange={(event) => setImageScale(Number(event.target.value))} title="PNG 导出倍率"><option value={1}>PNG 1×</option><option value={2}>PNG 2×</option><option value={3}>PNG 3×</option></select>
          <button className="tool-button" onClick={() => exportImage('png')} disabled={exporting}><Icon name="image" />PNG</button>
          <button className="tool-button" onClick={() => exportImage('svg')} disabled={exporting}>SVG</button>
          <button className="primary-button" onClick={exportMarkdown}><Icon name="download" />导出 Markdown</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="palette" aria-label="节点工具箱">
          <div className="panel-heading"><span>节点工具箱</span><small>点击或拖入画布</small></div>
          <div className="palette-list">
            {STAGE_OPTIONS.map((item) => (
              <button
                key={item.kind}
                className={`palette-item palette-item--${item.kind}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/flowcanvas-stage', item.kind);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => addStage(item.kind)}
              >
                <span className="palette-item__icon"><Icon name={item.kind} /></span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </div>
          <div className="palette-section">
            <span className="palette-section__label">画布操作</span>
            <label htmlFor="flow-direction" className="field-label">流程方向</label>
            <select id="flow-direction" value={flowDocument.direction || 'LR'} onChange={(event) => commit((document) => layoutDocument({ ...document, direction: event.target.value as 'LR' | 'TB' }))}><option value="LR">从左到右</option><option value="TB">从上到下</option></select>
            <button className="secondary-button wide" onClick={organizeLayout}><Icon name="layout" />自动整理布局</button>
          </div>
          <div className="palette-section">
            <button className="secondary-button wide" onClick={() => { setShowChecks(true); setStatus(flowIssues.length ? `发现 ${flowIssues.length} 项待确认` : '流程检查通过'); }}>检查流程{flowIssues.length ? `（${flowIssues.length}）` : ''}</button>
            <label className="field-label"><input type="checkbox" checked={transparentExport} onChange={(event) => setTransparentExport(event.target.checked)} />图片透明背景</label>
          </div>
          <div className="palette-tip">
            <strong>连接阶段</strong>
            <p>选中节点后连接点才会出现。从任意点位拖向目标点位；拖动连接点会固定点位；面板创建的连线会自动选择相向点位。</p>
          </div>
        </aside>

        <section className="canvas-panel" aria-label="流程图画布">
          <div className="canvas-badge"><span className="status-dot" />流程设计中</div>
          <div className="canvas-navigation-hint" aria-hidden="true">
            <span><kbd>滚轮</kbd> 移动画布</span>
            <span className="canvas-navigation-hint__separator" />
            <span><kbd>⌘/Ctrl</kbd> + 滚轮缩放</span>
            <span className="canvas-navigation-hint__separator" />
            <span><kbd>空格</kbd> + 拖动</span>
          </div>
          <p id="canvas-navigation-help" className="sr-only">
            滚动鼠标滚轮可上下移动画布，按住 Shift 滚动可左右移动画布。按住 Command 或 Control 滚动可缩放。按住空格并拖动，或使用鼠标中键拖动，可自由移动画布。拖动画布空白区域可框选阶段。
          </p>
          <ReactFlow<StageNodeType, FlowEdge>
            nodes={flowDocument.nodes}
            edges={routedEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onNodeDragStart={handleDragStart}
            onNodeDragStop={handleDragStop}
            onSelectionDragStart={handleDragStart}
            onSelectionDragStop={handleDragStop}
            onNodeDoubleClick={(_event, node) => openNoteEditor(node.id)}
            onEdgeClick={(_event, edge) => {
              const sourceTitle = documentRef.current.nodes.find((node) => node.id === edge.source)?.data.title || '起点';
              const targetTitle = documentRef.current.nodes.find((node) => node.id === edge.target)?.data.title || '终点';
              setSelectedNodeId(null);
              setSelectedEdgeId(edge.id);
              setStatus(`已高亮流向：${sourceTitle} → ${targetTitle}`);
            }}
            onEdgeDoubleClick={(_event, edge) => {
              setSelectedNodeId(null);
              setSelectedEdgeId(edge.id);
              setStatus('请输入连线标注');
              window.setTimeout(() => {
                const input = document.getElementById('edge-label') as HTMLInputElement | null;
                input?.focus();
                input?.select();
              }, 0);
            }}
            onConnect={handleConnect}
            isValidConnection={(connection) => !connectionProblem(documentRef.current.nodes, documentRef.current.edges, connection.source, connection.target, reconnectingEdgeIdRef.current)}
            onReconnect={handleReconnect}
            onReconnectStart={(_event, edge) => { reconnectingEdgeIdRef.current = edge.id; setIsConnecting(true); }}
            onReconnectEnd={() => { reconnectingEdgeIdRef.current = undefined; setIsConnecting(false); }}
            onConnectStart={(_event, origin) => {
              connectionOriginRef.current = origin;
              setIsConnecting(true);
              setStatus('请选择要连接的目标阶段');
            }}
            onConnectEnd={() => {
              connectionOriginRef.current = null;
              setIsConnecting(false);
            }}
            onSelectionChange={({ nodes, edges }) => {
              const pendingNodeId = pendingSelectionRef.current;
              if (pendingNodeId && documentRef.current.nodes.some((node) => node.id === pendingNodeId)) {
                setSelectedNodeId(pendingNodeId);
                setSelectedEdgeId(null);
                return;
              }
              const focusedElement = document.activeElement instanceof HTMLElement
                ? document.activeElement.closest<HTMLElement>('.react-flow__node')
                : null;
              const focusedNodeId = focusedElement?.dataset.id;
              const focusedSelectedNode = focusedNodeId
                ? documentRef.current.nodes.find((node) => node.id === focusedNodeId && node.selected)
                : null;
              setSelectedNodeId(focusedSelectedNode?.id || nodes.at(-1)?.id || null);
              setSelectedEdgeId(nodes.length ? null : edges[0]?.id || null);
            }}
            onMoveEnd={updateViewport}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(event) => {
              event.preventDefault();
              const kind = event.dataTransfer.getData('application/flowcanvas-stage') as StageKind;
              if (STAGE_OPTIONS.some((item) => item.kind === kind)) {
                addStage(kind, reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
              }
            }}
            defaultViewport={flowDocument.viewport}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.2}
            maxZoom={2}
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            panOnScrollSpeed={0.5}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            panOnDrag={[1]}
            panActivationKeyCode="Space"
            selectionOnDrag
            selectionKeyCode={null}
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            selectionMode={SelectionMode.Partial}
            connectionRadius={28}
            connectOnClick
            deleteKeyCode={null}
            snapToGrid
            snapGrid={[16, 16]}
            defaultEdgeOptions={{
              type: 'routed',
              markerEnd: { type: MarkerType.ArrowClosed },
              zIndex: 2,
              interactionWidth: 24,
              style: { strokeWidth: 1.8 }
            }}
            connectionLineStyle={{ strokeWidth: 2.2 }}
            aria-label="流程图编辑画布"
            aria-describedby="canvas-navigation-help"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
            <Controls showInteractive={false} position="bottom-center" />
            <FlowMiniMap nodes={flowDocument.nodes} edges={routedEdges} theme={theme} />
          </ReactFlow>
        </section>

        <aside className="inspector" aria-label="属性面板">
          <details className="flow-check" open={showChecks} onToggle={(event) => setShowChecks(event.currentTarget.open)}>
            <summary>流程检查 · {flowIssues.length ? `${flowIssues.length} 项待确认` : '通过'}</summary>
            <p>检查用于发现遗漏，不会阻止草稿保存或导出。允许有出口的回路和多个开始、结束节点。</p>
            {flowIssues.length ? <ul>{flowIssues.map((issue, index) => <li key={`${issue.code}-${issue.nodeId || issue.edgeId || index}`}>{issue.nodeId || issue.edgeId ? <button type="button" onClick={() => focusIssue(issue)}>{issue.message}</button> : issue.message}</li>)}</ul> : <p>节点连接、判断分支和流程出口检查通过。</p>}
          </details>
          <div className="panel-heading">
            <span>{hasMultiSelection ? '多选操作' : selectedNode ? '阶段设置' : selectedEdge ? '连线设置' : '流程概览'}</span>
            <small>{hasMultiSelection ? `已选择 ${selectedElementCount} 个元素` : selectedNode || selectedEdge ? '已选择' : '选择画布元素进行编辑'}</small>
          </div>
          {hasMultiSelection ? (
            <section className="multi-selection-panel" aria-labelledby="multi-selection-title">
              <div className="multi-selection-summary" role="status" aria-live="polite">
                <span className="multi-selection-summary__icon" aria-hidden="true"><i /><i /></span>
                <div>
                  <strong id="multi-selection-title">{selectedElementCount} 个元素</strong>
                  <span>已同时选择</span>
                </div>
              </div>
              <div className="multi-selection-stats" aria-label={`${selectedNodes.length} 个阶段，${selectedEdges.length} 条连线`}>
                <div><strong>{selectedNodes.length}</strong><span>阶段</span></div>
                <div><strong>{selectedEdges.length}</strong><span>连线</span></div>
              </div>
              <div className="edit-actions">
                <button className="secondary-button" onClick={duplicate} disabled={!selectedNodes.length}>复制所选</button>
                {(['left', 'center', 'top', 'middle', 'horizontal', 'vertical'] as Alignment[]).map((mode, index) => <button key={mode} className="secondary-button" disabled={selectedNodes.length < (index > 3 ? 3 : 2)} onClick={() => align(mode)}>{['左对齐', '水平居中', '顶对齐', '垂直居中', '水平等距', '垂直等距'][index]}</button>)}
              </div>
              <div className="multi-selection-guide">
                <strong>整体移动</strong>
                <p>拖动任一已选阶段即可移动全部所选阶段；相连线条会自动重新布线。</p>
              </div>
              <div className="multi-selection-shortcuts">
                <div><span>增减选择</span><kbd>⇧ / ⌘ / Ctrl + 单击</kbd></div>
                <div><span>选择全部</span><kbd>⌘/Ctrl + A</kbd></div>
                <div><span>取消选择</span><kbd>Esc</kbd></div>
              </div>
              <div className="form-actions multi-selection-actions">
                <button type="button" className="secondary-button" onClick={() => clearSelection()}>取消选择</button>
                <button type="button" className="danger-button" onClick={deleteSelection}><Icon name="trash" />删除所选</button>
              </div>
            </section>
          ) : selectedNode ? (
            <form className="inspector-form" onSubmit={(event) => { event.preventDefault(); updateSelectedNode(); }}>
              <div className={`selection-card selection-card--${nodeDraft.kind}`}>
                <Icon name={nodeDraft.kind} />
                <span>{STAGE_OPTIONS.find((item) => item.kind === nodeDraft.kind)?.label}</span>
                <small>#{selectedNode.id.slice(-6)}</small>
              </div>
              <button type="button" className="secondary-button wide" onClick={duplicate}>复制阶段（⌘/Ctrl + D）</button>
              <label className="field-label" htmlFor="stage-kind">阶段类型</label>
              <select id="stage-kind" value={nodeDraft.kind} onChange={(event) => setNodeDraft((draft) => ({ ...draft, kind: event.target.value as StageKind }))}>
                {STAGE_OPTIONS.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
              </select>
              <label className="field-label" htmlFor="stage-title">阶段名称 <span>必填</span></label>
              <input id="stage-title" value={nodeDraft.title} maxLength={160} onChange={(event) => setNodeDraft((draft) => ({ ...draft, title: event.target.value }))} />
              <label className="field-label" htmlFor="stage-notes">阶段备注 <span>{nodeDraft.notes.length}/20000</span></label>
              <textarea
                id="stage-notes"
                value={nodeDraft.notes}
                maxLength={20000}
                rows={11}
                placeholder="记录负责人、输入输出、执行规则、注意事项等。备注会进入导出的 Markdown 文档。"
                onChange={(event) => setNodeDraft((draft) => ({ ...draft, notes: event.target.value }))}
              />
              <section className="connection-builder" aria-labelledby="connection-builder-title">
                <div className="connection-builder__heading">
                  <strong id="connection-builder-title">添加连线</strong>
                  <span>从“{selectedNode.data.title}”出发</span>
                </div>
                {availableConnectionTargets.length ? (
                  <div className="connection-builder__controls">
                    <label className="sr-only" htmlFor="connection-target">目标阶段</label>
                    <select
                      id="connection-target"
                      value={connectionTargetId}
                      onChange={(event) => setConnectionTargetId(event.target.value)}
                    >
                      <option value="">选择目标阶段…</option>
                      {availableConnectionTargets.map((node) => (
                        <option key={node.id} value={node.id}>{node.data.title}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!connectionTargetId}
                      onClick={() => connectStages(selectedNode.id, connectionTargetId)}
                    >
                      建立连线
                    </button>
                  </div>
                ) : (
                  <p className="field-help">结束节点不能发出连线；开始节点和已有关系会从目标列表中排除。</p>
                )}
                <p className="field-help">从画布点位拖动会固定连接点；此处创建的连线会自动选择点位。</p>
              </section>
              <div className="form-actions">
                <button type="button" className="danger-button" onClick={deleteSelection}><Icon name="trash" />删除</button>
                <button type="submit" className="primary-button">应用修改</button>
              </div>
            </form>
          ) : selectedEdge ? (
            <form className="inspector-form" onSubmit={(event) => { event.preventDefault(); updateSelectedEdge(); }}>
              <div className="selection-card"><span className="edge-preview" />流程连线<small>#{selectedEdge.id.slice(-6)}</small></div>
              <button type="button" className="secondary-button wide" onClick={insertStage}>在线上插入处理阶段</button>
              {(['source', 'target'] as const).map((role) => <div key={role}>
                <label className="field-label" htmlFor={`edge-${role}`}>{role === 'source' ? '起点阶段' : '终点阶段'}</label>
                <select id={`edge-${role}`} value={edgeSettings[role]} onChange={(event) => setEdgeSettings((draft) => ({ ...draft, [role]: event.target.value }))}>{flowDocument.nodes.map((node) => <option key={node.id} value={node.id}>{node.data.title}</option>)}</select>
              </div>)}
              <label className="field-label" htmlFor="edge-port-mode">连接点方式</label>
              <select id="edge-port-mode" value={edgeSettings.portMode} onChange={(event) => setEdgeSettings((draft) => ({ ...draft, portMode: event.target.value as 'auto' | 'fixed' }))}><option value="auto">自动选择点位</option><option value="fixed">固定指定点位</option></select>
              {edgeSettings.portMode === 'fixed' && (['source', 'target'] as const).map((role) => <div key={role}>
                <label className="field-label" htmlFor={`edge-${role}-port`}>{role === 'source' ? '起点连接点' : '终点连接点'}</label>
                <select id={`edge-${role}-port`} value={flowDocument.nodes.find((node) => node.id === edgeSettings[role])?.data.kind === 'decision' ? edgeSettings[`${role}Handle`].replace('top-right', 'top-left').replace('bottom-right', 'bottom-left') : edgeSettings[`${role}Handle`]} onChange={(event) => setEdgeSettings((draft) => ({ ...draft, [`${role}Handle`]: event.target.value }))}>{HANDLE_OPTIONS.map((handle, index) => { const decision = flowDocument.nodes.find((node) => node.id === edgeSettings[role])?.data.kind === 'decision'; return decision && (handle === 'top-right' || handle === 'bottom-right') ? null : <option key={handle} value={`${role}-${handle}`}>{decision && handle === 'top-left' ? '上方顶点' : decision && handle === 'bottom-left' ? '下方顶点' : HANDLE_LABELS[index]}</option>; })}</select>
              </div>)}

              <label className="field-label" htmlFor="edge-label">条件或说明</label>
              <input id="edge-label" value={edgeDraft} maxLength={120} placeholder="例如：通过、未通过" onChange={(event) => setEdgeDraft(event.target.value)} />
              <p className="field-help">条件说明会同步进入 Mermaid。可拖动已选连线端点重新连接，也可在上方选择起点和终点。</p>
              <label className="field-label" htmlFor="edge-label-position">标签位置</label>
              <input id="edge-label-position" type="range" min="0" max="100" value={(edgeSettings.labelPosition ?? 0.5) * 100} onChange={(event) => setEdgeSettings((draft) => ({ ...draft, labelPosition: Number(event.target.value) / 100 }))} />
              <div className="route-point-row">{(['x', 'y'] as const).map((axis) => <label key={axis}>标签{axis === 'x' ? '水平' : '垂直'}偏移<input aria-label={`标签${axis === 'x' ? '水平' : '垂直'}偏移`} type="number" min="-2000" max="2000" value={edgeSettings.labelOffset?.[axis] || 0} onChange={(event) => setEdgeSettings((draft) => ({ ...draft, labelOffset: { x: draft.labelOffset?.x || 0, y: draft.labelOffset?.y || 0, [axis]: Math.max(-2000, Math.min(2000, Number(event.target.value))) } }))} /></label>)}</div>
              <button type="button" className="secondary-button wide" onClick={() => setEdgeSettings((draft) => ({ ...draft, labelPosition: undefined, labelOffset: undefined }))}>自动安排标签</button>
              <label className="field-label">固定路径折点</label>
              <p className="field-help">折点按画布坐标依次经过，可用于指定回路通道。固定路径由你控制，可能穿过节点；清空折点可恢复自动避障。</p>
              {edgeSettings.waypoints.map((point, index) => <div className="route-point-row" key={index}>
                {(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<input aria-label={`第 ${index + 1} 个折点 ${axis.toUpperCase()}`} type="number" value={point[axis]} onChange={(event) => setEdgeSettings((draft) => ({ ...draft, waypoints: draft.waypoints.map((item, pointIndex) => pointIndex === index ? { ...item, [axis]: Number(event.target.value) } : item) }))} /></label>)}
                <button type="button" className="secondary-button" aria-label={`删除第 ${index + 1} 个折点`} onClick={() => setEdgeSettings((draft) => ({ ...draft, waypoints: draft.waypoints.filter((_, pointIndex) => pointIndex !== index) }))}>×</button>
              </div>)}
              <div className="edit-actions">
                <button type="button" className="secondary-button" disabled={edgeSettings.waypoints.length >= 50} onClick={() => { const route = routedEdges.find((edge) => edge.id === selectedEdge.id)?.data?.route || []; const point = route.at(Math.floor(route.length / 2)) || { x: 300, y: 300 }; setEdgeSettings((draft) => ({ ...draft, waypoints: [...draft.waypoints, { ...point }] })); }}>添加折点</button>
                <button type="button" className="secondary-button" disabled={!edgeSettings.waypoints.length} onClick={() => setEdgeSettings((draft) => ({ ...draft, waypoints: [] }))}>恢复自动避障</button>
              </div>
              <div className="form-actions">
                <button type="button" className="danger-button" onClick={deleteSelection}><Icon name="trash" />删除</button>
                <button type="submit" className="primary-button">应用修改</button>
              </div>
            </form>
          ) : (
            <div className="overview">
              <div className="overview-hero"><div className="overview-hero__icon"><Icon name="note" size={24} /></div><strong>让流程自己讲清楚</strong><p>选择任一阶段，即可补充备注并随 Markdown 文档一起导出。</p></div>
              <div className="stat-grid"><div><strong>{flowDocument.nodes.length}</strong><span>阶段</span></div><div><strong>{flowDocument.edges.length}</strong><span>连线</span></div></div>
              <div className="shortcut-list">
                <span className="palette-section__label">快捷键</span>
                <div><span>保存流程</span><kbd>⌘ S</kbd></div>
                <div><span>撤销 / 重做</span><span><kbd>⌘ Z</kbd> <kbd>⇧ ⌘ Z</kbd></span></div>
                <div><span>新增同级 / 下级</span><span><kbd>Enter</kbd> <kbd>Tab</kbd></span></div>
                <div><span>删除所选</span><kbd>Delete</kbd></div>
                <div><span>多选 / 取消</span><span><kbd>⇧ + 单击</kbd> <kbd>Esc</kbd></span></div>
                <div><span>选择全部</span><kbd>⌘/Ctrl + A</kbd></div>
                <div><span>移动画布</span><span><kbd>滚轮</kbd> <kbd>Space</kbd></span></div>
                <div><span>缩放画布</span><kbd>⌘/Ctrl + 滚轮</kbd></div>
                <div><span>显示全部 / 所选</span><span><kbd>⇧ 1</kbd> <kbd>⇧ 2</kbd></span></div>
                <div><span>恢复 100%</span><kbd>0</kbd></div>
                <div><span>导出文档</span><kbd>⇧ ⌘ E</kbd></div>
              </div>
            </div>
          )}
        </aside>
      </main>
      {noteEditor && (
        <dialog
          ref={noteDialogRef}
          className="note-dialog"
          aria-labelledby="note-dialog-title"
          aria-describedby="note-dialog-description"
          onCancel={(event) => {
            event.preventDefault();
            closeNoteEditor();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeNoteEditor();
          }}
        >
          <form
            className="note-dialog__card"
            onSubmit={(event) => {
              event.preventDefault();
              saveNoteEditor();
            }}
          >
            <header className="note-dialog__header">
              <div>
                <strong id="note-dialog-title">编辑阶段备注</strong>
                <p id="note-dialog-description">备注会随流程一起保存，并进入导出的 Markdown 文档。</p>
              </div>
              <button type="button" className="dialog-close" onClick={closeNoteEditor} aria-label="关闭备注弹窗">×</button>
            </header>
            <div className="note-dialog__body">
              <label className="field-label" htmlFor="dialog-stage-title">阶段名称 <span>必填</span></label>
              <input
                id="dialog-stage-title"
                value={noteEditor.title}
                maxLength={160}
                onChange={(event) => setNoteEditor((current) => current ? { ...current, title: event.target.value } : current)}
              />
              <label className="field-label" htmlFor="dialog-stage-notes">阶段备注 <span>{noteEditor.notes.length}/20000</span></label>
              <textarea
                ref={noteTextareaRef}
                id="dialog-stage-notes"
                value={noteEditor.notes}
                maxLength={20000}
                rows={12}
                placeholder="记录负责人、输入输出、执行规则、注意事项等。"
                onChange={(event) => setNoteEditor((current) => current ? { ...current, notes: event.target.value } : current)}
              />
            </div>
            <footer className="note-dialog__actions">
              <button type="button" className="secondary-button" onClick={closeNoteEditor}>取消</button>
              <button type="submit" className="primary-button">保存备注</button>
            </footer>
          </form>
        </dialog>
      )}
      <footer className="statusbar">
        <span role="status" aria-live="polite">{status}</span>
        <span>自动保存已开启 · 工程格式 v{flowDocument.version}</span>
      </footer>
    </div>
  );
}

export default function App() {
  return <ReactFlowProvider><FlowSketchApp /></ReactFlowProvider>;
}
