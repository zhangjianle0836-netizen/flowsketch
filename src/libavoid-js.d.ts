declare module 'libavoid-js' {
  export type AvoidEnumValue = { readonly value: number };

  export interface AvoidHandle {
    delete(): void;
  }

  export interface AvoidPoint extends AvoidHandle {
    x: number;
    y: number;
  }

  export interface AvoidRectangle extends AvoidHandle {}

  export interface AvoidShapeRef extends AvoidHandle {}

  export interface AvoidShapeConnectionPin extends AvoidHandle {
    setExclusive(exclusive: boolean): void;
  }

  export interface AvoidConnEnd extends AvoidHandle {}

  export interface AvoidPolyLine extends AvoidHandle {
    size(): number;
    at(index: number): AvoidPoint;
  }

  export interface AvoidConnRef extends AvoidHandle {
    displayRoute(): AvoidPolyLine;
    setRoutingType(type: AvoidEnumValue): void;
    setHateCrossings(value: boolean): void;
    hasValidRoute(): boolean;
    hasCrossingObstacles(): boolean;
  }

  export interface AvoidRouter extends AvoidHandle {
    processTransaction(): void;
    setRoutingParameter(parameter: AvoidEnumValue, value: number): void;
    setRoutingOption(option: AvoidEnumValue, value: boolean): void;
  }

  export interface AvoidModule {
    RouterFlag: {
      PolyLineRouting: AvoidEnumValue;
      OrthogonalRouting: AvoidEnumValue;
    };
    ConnType: {
      ConnType_Orthogonal: AvoidEnumValue;
    };
    RoutingParameter: {
      segmentPenalty: AvoidEnumValue;
      crossingPenalty: AvoidEnumValue;
      fixedSharedPathPenalty: AvoidEnumValue;
      portDirectionPenalty: AvoidEnumValue;
      shapeBufferDistance: AvoidEnumValue;
      idealNudgingDistance: AvoidEnumValue;
      reverseDirectionPenalty: AvoidEnumValue;
    };
    RoutingOption: {
      nudgeOrthogonalSegmentsConnectedToShapes: AvoidEnumValue;
      penaliseOrthogonalSharedPathsAtConnEnds: AvoidEnumValue;
      nudgeOrthogonalTouchingColinearSegments: AvoidEnumValue;
      performUnifyingNudgingPreprocessingStep: AvoidEnumValue;
      nudgeSharedPathsWithCommonEndPoint: AvoidEnumValue;
    };
    Router: new (flags: number) => AvoidRouter;
    Point: new (x: number, y: number) => AvoidPoint;
    Rectangle: new (topLeft: AvoidPoint, bottomRight: AvoidPoint) => AvoidRectangle;
    ShapeRef: new (router: AvoidRouter, rectangle: AvoidRectangle) => AvoidShapeRef;
    ShapeConnectionPin: new (
      shape: AvoidShapeRef,
      classId: number,
      xOffset: number,
      yOffset: number,
      proportional: boolean,
      insideOffset: number,
      directions: number
    ) => AvoidShapeConnectionPin;
    ConnEnd: new (shape: AvoidShapeRef, classId: number) => AvoidConnEnd;
    ConnRef: new (router: AvoidRouter, source: AvoidConnEnd, target: AvoidConnEnd) => AvoidConnRef;
  }

  export const AvoidLib: {
    load(filePath?: string): Promise<void>;
    getInstance(): AvoidModule;
  };
}

declare module '*.wasm?base64' {
  const dataUrl: string;
  export default dataUrl;
}
