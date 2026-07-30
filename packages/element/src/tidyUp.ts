/**
 * Tidy up: arrange a lassoed group of elements into a centered grid,
 * normalize styles and sizes to group-majority values, and keep all
 * bindings (bound text, bound arrows, frame membership) intact.
 */
import { updateBoundElements } from "./binding";
import { getCommonBoundingBox } from "./bounds";
import { getFrameChildren } from "./frame";
import { getBoundTextElement, redrawTextBoundingBox } from "./textElement";
import {
  isFrameLikeElement,
  isImageElement,
  isLinearElement,
  isTextElement,
} from "./typeChecks";

import type { Scene } from "./Scene";
import type { BoundingBox } from "./bounds";
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "./types";

export const TIDY_UP_GAP = 16;

const SIZE_BUCKET_PX = 16;
const HALF = 2;

const RESIZABLE_SHAPE_TYPES = new Set<ExcalidrawElement["type"]>([
  "rectangle",
  "diamond",
  "ellipse",
  "embeddable",
  "iframe",
]);

const STYLEABLE_TYPES = new Set<ExcalidrawElement["type"]>([
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
]);

const STYLE_PROPERTIES = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "roughness",
] as const;

interface TidyUnit {
  elements: NonDeletedExcalidrawElement[];
}

export const tidyUpElements = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  scene: Scene,
): void => {
  if (selectedElements.length < HALF) {
    return;
  }
  const selectionBoundingBox = getCommonBoundingBox(selectedElements);

  const untetheredElements = selectedElements.filter(
    (element) => !element.frameId,
  );

  normalizeStyles(untetheredElements, scene);
  normalizeSizes(untetheredElements, scene);

  const units = buildTidyUnits(selectedElements, scene);
  if (units.length < HALF) {
    return;
  }
  placeUnitsInGrid(units, selectionBoundingBox, scene);
};

const normalizeStyles = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  scene: Scene,
) => {
  for (const property of STYLE_PROPERTIES) {
    const candidates = selectedElements.filter(
      (element) =>
        STYLEABLE_TYPES.has(element.type) ||
        (property === "strokeColor" && isTextElement(element)),
    );
    const majority = findMajorityValue(
      candidates.map((element) => element[property]),
    );
    if (majority === null) {
      continue;
    }
    for (const element of candidates) {
      if (element[property] !== majority) {
        scene.mutateElement(element, { [property]: majority });
      }
    }
  }
};

const normalizeSizes = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  scene: Scene,
) => {
  const shapes = selectedElements.filter((element) =>
    RESIZABLE_SHAPE_TYPES.has(element.type),
  );
  const targetWidth = findMajorityDimension(shapes.map((s) => s.width));
  const targetHeight = findMajorityDimension(shapes.map((s) => s.height));
  if (targetWidth === null || targetHeight === null) {
    return;
  }
  const elementsMap = scene.getNonDeletedElementsMap();
  for (const shape of shapes) {
    if (shape.width === targetWidth && shape.height === targetHeight) {
      continue;
    }
    scene.mutateElement(shape, {
      height: targetHeight,
      width: targetWidth,
      x: shape.x + (shape.width - targetWidth) / HALF,
      y: shape.y + (shape.height - targetHeight) / HALF,
    });
    const boundText = getBoundTextElement(shape, elementsMap);
    if (boundText) {
      redrawTextBoundingBox(boundText, shape, scene);
    }
  }
  for (const element of selectedElements) {
    if (!isImageElement(element) || element.height === 0) {
      continue;
    }
    const aspectRatio = element.width / element.height;
    const isLandscape = aspectRatio >= 1;
    const newWidth = isLandscape ? targetWidth : targetHeight * aspectRatio;
    const newHeight = isLandscape ? targetWidth / aspectRatio : targetHeight;
    scene.mutateElement(element, {
      height: newHeight,
      width: newWidth,
      x: element.x + (element.width - newWidth) / HALF,
      y: element.y + (element.height - newHeight) / HALF,
    });
  }
};

const buildTidyUnits = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  scene: Scene,
): TidyUnit[] => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const units: TidyUnit[] = [];
  for (const element of selectedElements) {
    // bound text rides with its container
    if (isTextElement(element) && element.containerId) {
      continue;
    }
    // frame children ride with their frame; if the frame wasn't lassoed,
    // leave the child untouched rather than tearing it out of the frame
    if (element.frameId) {
      continue;
    }
    // bound arrows are re-routed by updateBoundElements, never grid-placed
    if (
      isLinearElement(element) &&
      (element.startBinding || element.endBinding)
    ) {
      continue;
    }
    if (isFrameLikeElement(element)) {
      units.push({
        elements: [
          element,
          ...(getFrameChildren(
            elementsMap,
            element.id,
          ) as NonDeletedExcalidrawElement[]),
        ],
      });
      continue;
    }
    const boundText = getBoundTextElement(element, elementsMap);
    units.push({
      elements: boundText ? [element, boundText] : [element],
    });
  }
  return units;
};

const placeUnitsInGrid = (
  units: TidyUnit[],
  selectionBoundingBox: BoundingBox,
  scene: Scene,
) => {
  const measured = units.map((unit) => ({
    box: getCommonBoundingBox(unit.elements),
    unit,
  }));
  const maxUnitWidth = Math.max(...measured.map(({ box }) => box.width));
  const maxUnitHeight = Math.max(...measured.map(({ box }) => box.height));
  const cellWidth = maxUnitWidth + TIDY_UP_GAP;
  const cellHeight = maxUnitHeight + TIDY_UP_GAP;

  const aspectRatio =
    selectionBoundingBox.height > 0
      ? selectionBoundingBox.width / selectionBoundingBox.height
      : 1;
  const columns = Math.min(
    units.length,
    Math.max(1, Math.round(Math.sqrt(units.length * aspectRatio))),
  );
  const rows = Math.ceil(units.length / columns);

  // row-major ordering that roughly preserves original positions:
  // sort by centerY, chunk into rows, sort each row by centerX
  const sortedByY = [...measured].sort((a, b) => a.box.midY - b.box.midY);
  const ordered: typeof measured = [];
  for (let row = 0; row < rows; row++) {
    ordered.push(
      ...sortedByY
        .slice(row * columns, (row + 1) * columns)
        .sort((a, b) => a.box.midX - b.box.midX),
    );
  }

  const gridWidth = columns * cellWidth - TIDY_UP_GAP;
  const gridHeight = rows * cellHeight - TIDY_UP_GAP;
  const originX = selectionBoundingBox.midX - gridWidth / HALF;
  const originY = selectionBoundingBox.midY - gridHeight / HALF;

  const movedElements: NonDeletedExcalidrawElement[] = [];
  ordered.forEach(({ unit, box }, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const targetCenterX = originX + column * cellWidth + maxUnitWidth / HALF;
    const targetCenterY = originY + row * cellHeight + maxUnitHeight / HALF;
    const deltaX = targetCenterX - box.midX;
    const deltaY = targetCenterY - box.midY;
    for (const element of unit.elements) {
      scene.mutateElement(element, {
        x: element.x + deltaX,
        y: element.y + deltaY,
      });
      movedElements.push(element);
    }
  });
  for (const element of movedElements) {
    updateBoundElements(element, scene, {
      simultaneouslyUpdated: movedElements,
    });
  }
};

const findMajorityValue = <T>(values: T[]): T | null => {
  if (!values.length) {
    return null;
  }
  const counts = new Map<T, number>();
  let winner: T = values[0];
  let winnerCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }
  return winner;
};

const findMajorityDimension = (values: number[]): number | null => {
  if (!values.length) {
    return null;
  }
  const buckets = new Map<number, number[]>();
  for (const value of values) {
    const key = Math.round(value / SIZE_BUCKET_PX);
    const bucket = buckets.get(key) ?? [];
    bucket.push(value);
    buckets.set(key, bucket);
  }
  let winningBucket: number[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length > winningBucket.length) {
      winningBucket = bucket;
    }
  }
  const sum = winningBucket.reduce((total, value) => total + value, 0);
  return Math.round(sum / winningBucket.length);
};
