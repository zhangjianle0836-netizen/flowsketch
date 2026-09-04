/// <reference lib="webworker" />

import { AvoidLib } from 'libavoid-js';
import libavoidWasmUrl from '../../node_modules/libavoid-js/dist/libavoid.wasm?base64';
import type { FlowEdge, StageNode } from '../types';
import { createLibavoidEdgeRouter } from './libavoid';

type RouteRequest = {
  id: number;
  nodes: StageNode[];
  edges: FlowEdge[];
};

type RouteResponse = {
  id: number;
  routes?: Array<[string, Array<{ x: number; y: number }>]>;
  error?: string;
};

const workerScope = self as DedicatedWorkerGlobalScope;
let routerPromise: ReturnType<typeof createRouter> | undefined;
let requestQueue = Promise.resolve();

async function createRouter() {
  await AvoidLib.load(libavoidWasmUrl);
  return createLibavoidEdgeRouter(AvoidLib.getInstance());
}

workerScope.onmessage = (event: MessageEvent<RouteRequest>) => {
  const request = event.data;
  requestQueue = requestQueue.then(async () => {
    try {
      routerPromise ||= createRouter();
      const routeEdges = await routerPromise;
      const routes = [...routeEdges(request.nodes, request.edges)];
      workerScope.postMessage({ id: request.id, routes } satisfies RouteResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知路由错误';
      workerScope.postMessage({ id: request.id, error: message } satisfies RouteResponse);
    }
  });
};
