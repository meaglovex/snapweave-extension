export type CaptureMode = "visible" | "selection" | "fullPage";

export type AnnotationKind = "rect" | "arrow" | "brush" | "text" | "mosaic";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationStyle {
  color: string;
  lineWidth: number;
  fontSize?: number;
}

export interface BaseAnnotation {
  id: string;
  type: AnnotationKind;
  style: AnnotationStyle;
}

export interface RectAnnotation extends BaseAnnotation {
  type: "rect";
  rect: Rect;
}

export interface ArrowAnnotation extends BaseAnnotation {
  type: "arrow";
  from: Point;
  to: Point;
}

export interface BrushAnnotation extends BaseAnnotation {
  type: "brush";
  points: Point[];
}

export interface TextAnnotation extends BaseAnnotation {
  type: "text";
  point: Point;
  text: string;
}

export interface MosaicAnnotation extends BaseAnnotation {
  type: "mosaic";
  rect: Rect;
  pixelSize: number;
}

export type Annotation =
  | RectAnnotation
  | ArrowAnnotation
  | BrushAnnotation
  | TextAnnotation
  | MosaicAnnotation;
