import type { FlowEdge, StageNode } from '../types';
import type { RoutePoint } from './routing';

type RouteResponse = {
  id: number;
  routes?: Array<[string, RoutePoint[]]>;
  error?: string;
};

type PendingRequest = {
  resolve: (routes: Map<string, RoutePoint[]>) => void;
  reject: (error: Error) => void;
};

export class LibavoidWorkerClient {
  private readonly worker = new Worker(new URL('./libavoid.worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<RouteResponse>) => {
      const response = event.data;
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.error) request.reject(new Error(response.error));
      else request.resolve(new Map(response.routes || []));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || '智能避障工作线程异常');
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
  }

  route(nodes: StageNode[], edges: FlowEdge[]) {
    const id = this.nextId;
    this.nextId += 1;
    return {
      id,
      promise: new Promise<Map<string, RoutePoint[]>>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ id, nodes, edges });
      })
    };
  }

  dispose() {
    this.worker.terminate();
    const error = new Error('智能避障工作线程已关闭');
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
