import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  getNodesBounds,
  getViewportForBounds,
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
import { toPng, toSvg } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import { Icon } from './components/Icon';
import { FlowMiniMap } from './components/FlowMiniMap';
import { RENAME_STAGE_EVENT, StageNode } from './components/StageNode';
import { RoutedEdge } from './components/RoutedEdge';
import { optimizeConnectionHandles, orientConnectionFromOrigin, type ConnectionOrigin } from './flow/connections';
import { createBlankDocument, createId, createStage, layoutDocument, parseFlowDocument } from './flow/document';
import { edgePresentation } from './flow/edge-presentation';
import { LibavoidWorkerClient } from './flow/libavoid-client';
import { exportFlowToMarkdown } from './flow/markdown';
import { routeDiagramEdges, updateDiagramRoutes, type DiagramRouteState } from './flow/routing';
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
    documentRef.current = flowDocument;
  }, [flowDocument]);

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
      edges: displayEdges.map((edge) => {
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
      })
    };
  }, [displayEdges, flowDocument.nodes, routeVersion, theme]);
  useLayoutEffect(() => {
    routeStateRef.current = routingResult.routeState;
  }, [routingResult.routeState]);

  useEffect(() => {
    const worker = routingWorkerRef.current;
    const dirtyEdges = displayEdges.filter((edge) => routingResult.routeState.dirtyEdgeIds.has(edge.id));
    if (!worker || routingFailedRef.current || !dirtyEdges.length) return;
    const generation = routeGenerationRef.current + 1;
    routeGenerationRef.current = generation;

    const isDragging = flowDocument.nodes.some((node) => node.dragging);
    const timer = window.setTimeout(() => {
      const request = worker.route(flowDocument.nodes, dirtyEdges);
      request.promise.then((routes) => {
        if (routeGenerationRef.current !== generation || routingWorkerRef.current !== worker) return;
        const current = routeStateRef.current;
        if (!current) return;
        const mergedRoutes = new Map(current.routes);
        for (const [edgeId, route] of routes) mergedRoutes.set(edgeId, route);
        routeStateRef.current = { ...current, routes: mergedRoutes, dirtyEdgeIds: new Set() };
        setRouteVersion((value) => value + 1);
      }).catch((error) => {
        if (routeGenerationRef.current !== generation || routingWorkerRef.current !== worker) return;
        routingFailedRef.current = true;
        console.error('libavoid 初始化或计算失败，已切换到兼容路由器', error);
        setStatus('智能避障加载失败，已使用兼容路由');
      });
    }, isDragging ? 120 : 0);

    return () => window.clearTimeout(timer);
  }, [displayEdges, flowDocument.nodes, routingResult.routeState, routingWorkerVersion]);
  const routedEdges = routingResult.edges;
  const availableConnectionTargets = useMemo(() => {
    if (!selectedNode) return [];
    const connectedTargetIds = new Set(
      flowDocument.edges.filter((edge) => edge.source === selectedNode.id).map((edge) => edge.target)
    );
    return flowDocument.nodes.filter((node) => (
      node.id !== selectedNode.id && !connectedTargetIds.has(node.id)
    ));
  }, [flowDocument.edges, flowDocument.nodes, selectedNode]);

  useEffect(() => {
    if (selectedNode) setNodeDraft({ ...selectedNode.data });
    setConnectionTargetId('');
  }, [selectedNode?.id]);

  useEffect(() => {
    if (selectedEdge) setEdgeDraft(typeof selectedEdge.label === 'string' ? selectedEdge.label : '');
  }, [selectedEdge?.id]);

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
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, cleanDocument(documentRef.current)]);
    replaceDocument(previous);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setStatus('已撤销');
  }, [replaceDocument, undoStack]);

  const redo = useCallback(() => {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, cleanDocument(documentRef.current)]);
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
        ? [{ id: createId('edge'), source: selected.id, target: node.id, sourceHandle: 'source-right', targetHandle: 'target-left', type: 'smoothstep' as const }]
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
      const nodeElement = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`);
      nodeElement?.focus();
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
      ...createStage('process', { x: parent.position.x + 300, y: parent.position.y + childCount * 150 }),
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
        type: 'smoothstep'
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
      ...createStage('process', { x: selected.position.x, y: siblingY + 150 }),
      selected: true
    };
    const siblingEdges = incoming.map((edge) => ({
      id: createId('edge'),
      source: edge.source,
      target: sibling.id,
      sourceHandle: edge.sourceHandle || 'source-right',
      targetHandle: 'target-left',
      type: 'smoothstep' as const
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
    commit((document) => ({
      ...document,
      edges: document.edges.map((edge) => edge.id === selectedEdgeId ? { ...edge, label: edgeDraft.trim() } : edge)
    }));
    setStatus('连线说明已更新');
  }, [commit, edgeDraft, selectedEdgeId]);

  const connectStages = useCallback((
    sourceId: string | null,
    targetId: string | null,
    sourceHandle = 'source-right',
    targetHandle = 'target-left'
  ) => {
    if (!sourceId || !targetId) return setStatus('请选择要连接的两个阶段');
    if (sourceId === targetId) return setStatus('不能把阶段连接到自身');
    const source = documentRef.current.nodes.find((node) => node.id === sourceId);
    const target = documentRef.current.nodes.find((node) => node.id === targetId);
    if (!source || !target) return setStatus('连接的阶段不存在');
    const duplicate = documentRef.current.edges.some((edge) => edge.source === sourceId && edge.target === targetId);
    if (duplicate) return setStatus('这条流程关系已经存在');
    const optimized = optimizeConnectionHandles({
      source: sourceId,
      target: targetId,
      sourceHandle,
      targetHandle
    }, documentRef.current.nodes);
    commit((document) => ({
      ...document,
      edges: addEdge({
        id: createId('edge'),
        source: sourceId,
        target: targetId,
        sourceHandle: optimized.sourceHandle,
        targetHandle: optimized.targetHandle,
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
      oriented.targetHandle || 'target-left'
    );
  }, [connectStages]);

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
    const markdown = exportFlowToMarkdown(cleanDocument(documentRef.current));
    try {
      if (window.flowAPI) {
        const result = await window.flowAPI.exportMarkdown(markdown, documentRef.current.title);
        if (result.canceled) return setStatus('已取消导出');
      } else downloadInBrowser(markdown, `${documentRef.current.title}.md`, 'text/markdown;charset=utf-8');
      setStatus('Markdown 文档已导出');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Markdown 导出失败');
    }
  }, []);

  const exportImage = useCallback(async (format: 'png' | 'svg') => {
    const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewportElement || !documentRef.current.nodes.length) return setStatus('画布中没有可导出的阶段');
    setExporting(true);
    setStatus(`正在生成 ${format.toUpperCase()}…`);
    try {
      const width = 1600;
      const height = 900;
      const bounds = getNodesBounds(documentRef.current.nodes);
      const viewport = getViewportForBounds(bounds, width, height, 0.3, 2, 0.12);
      const options = {
        backgroundColor: theme === 'dark' ? '#1c1c1e' : '#f5f5f7',
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
        }
      };
      const dataUrl = format === 'png' ? await toPng(viewportElement, options) : await toSvg(viewportElement, options);
      if (window.flowAPI) {
        const result = await window.flowAPI.exportImage(dataUrl, format, documentRef.current.title);
        if (result.canceled) return setStatus('已取消导出');
      } else {
        const anchor = document.createElement('a');
        anchor.href = dataUrl;
        anchor.download = `${documentRef.current.title}.${format}`;
        anchor.click();
      }
      setStatus(`${format.toUpperCase()} 图片已导出`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '图片导出失败');
    } finally {
      setExporting(false);
    }
  }, [theme]);

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
      const activeCanvasNodeId = canvasNodeElement?.dataset.id;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave(event.shiftKey);
      } else if (command && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (command && ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')) {
        event.preventDefault();
        redo();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        exportMarkdown();
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
      } else if (canvasShortcutAllowed && activeCanvasNodeId && event.key === 'Tab') {
        event.preventDefault();
        addChildStage(activeCanvasNodeId);
      } else if (canvasShortcutAllowed && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deleteSelection();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [addChildStage, addSiblingStage, clearSelection, deleteSelection, exportMarkdown, handleSave, reactFlow, redo, selectAll, selectedNodeId, undo]);

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
            <button className="secondary-button wide" onClick={organizeLayout}><Icon name="layout" />自动整理布局</button>
          </div>
          <div className="palette-tip">
            <strong>连接阶段</strong>
            <p>选中节点后连接点才会出现。从任意点位拖向目标点位；同一水平线会自动使用相向侧连接。</p>
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
                  <p className="field-help">当前没有可连接的目标阶段；重复连线会自动排除。</p>
                )}
                <p className="field-help">也可以从节点任一点位拖向目标；同一水平线会自动优化为左右相向连接。</p>
              </section>
              <div className="form-actions">
                <button type="button" className="danger-button" onClick={deleteSelection}><Icon name="trash" />删除</button>
                <button type="submit" className="primary-button">应用修改</button>
              </div>
            </form>
          ) : selectedEdge ? (
            <form className="inspector-form" onSubmit={(event) => { event.preventDefault(); updateSelectedEdge(); }}>
              <div className="selection-card"><span className="edge-preview" />流程连线<small>#{selectedEdge.id.slice(-6)}</small></div>
              <label className="field-label" htmlFor="edge-label">条件或说明</label>
              <input id="edge-label" value={edgeDraft} maxLength={120} placeholder="例如：通过、未通过" onChange={(event) => setEdgeDraft(event.target.value)} />
              <p className="field-help">该文字会显示在线条中部，并同步写入 Mermaid 流程图。也可双击线条快速编辑。</p>
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
