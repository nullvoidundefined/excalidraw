import { Excalidraw } from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  render,
  unmountComponent,
} from "@excalidraw/excalidraw/tests/test-utils";

import { TIDY_UP_GAP, tidyUpElements } from "../src/tidyUp";

import type { NonDeletedExcalidrawElement } from "../src/types";

const h = window.h;

const getNonDeleted = () =>
  h.elements.filter((el) => !el.isDeleted) as NonDeletedExcalidrawElement[];

const boundingBoxesOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

describe("tidyUpElements", () => {
  beforeEach(async () => {
    unmountComponent();
    await render(<Excalidraw />);
  });

  it("arranges overlapping shapes into a non-overlapping grid with even gaps", () => {
    const rectangles = [
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }),
      API.createElement({
        type: "rectangle",
        x: 40,
        y: 30,
        width: 100,
        height: 100,
      }),
      API.createElement({
        type: "rectangle",
        x: 10,
        y: 70,
        width: 100,
        height: 100,
      }),
      API.createElement({
        type: "rectangle",
        x: 60,
        y: 60,
        width: 100,
        height: 100,
      }),
    ];
    API.setElements(rectangles);

    tidyUpElements(getNonDeleted(), h.app.scene);

    const tidied = getNonDeleted();
    for (let i = 0; i < tidied.length; i++) {
      for (let j = i + 1; j < tidied.length; j++) {
        expect(boundingBoxesOverlap(tidied[i], tidied[j])).toBe(false);
      }
    }
    // 4 same-size units in a square-ish lasso -> 2x2 grid, gap = TIDY_UP_GAP
    const xs = [...new Set(tidied.map((el) => el.x))].sort((a, b) => a - b);
    const ys = [...new Set(tidied.map((el) => el.y))].sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(ys).toHaveLength(2);
    expect(xs[1] - xs[0]).toBe(100 + TIDY_UP_GAP);
    expect(ys[1] - ys[0]).toBe(100 + TIDY_UP_GAP);
  });

  it("applies majority style values, breaking ties by z-order", () => {
    API.setElements([
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        strokeColor: "#e03131",
        backgroundColor: "#ffc9c9",
      }),
      API.createElement({
        type: "rectangle",
        x: 200,
        y: 0,
        strokeColor: "#e03131",
        backgroundColor: "#b2f2bb",
      }),
      API.createElement({
        type: "ellipse",
        x: 400,
        y: 0,
        strokeColor: "#1971c2",
        backgroundColor: "#b2f2bb",
      }),
    ]);

    tidyUpElements(getNonDeleted(), h.app.scene);

    const tidied = getNonDeleted();
    expect(tidied.map((el) => el.strokeColor)).toEqual([
      "#e03131",
      "#e03131",
      "#e03131",
    ]);
    // backgroundColor is 1x #ffc9c9 vs 2x #b2f2bb -> majority #b2f2bb
    expect(tidied.map((el) => el.backgroundColor)).toEqual([
      "#b2f2bb",
      "#b2f2bb",
      "#b2f2bb",
    ]);
  });

  it("normalizes shape sizes by bucketed majority and never resizes text or lines", () => {
    const text = API.createElement({
      type: "text",
      x: 500,
      y: 0,
      text: "hello",
    });
    API.setElements([
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }),
      API.createElement({
        type: "rectangle",
        x: 200,
        y: 0,
        width: 102,
        height: 98,
      }),
      API.createElement({
        type: "rectangle",
        x: 400,
        y: 0,
        width: 300,
        height: 300,
      }),
      text,
    ]);
    const textWidth = text.width;
    const textHeight = text.height;

    tidyUpElements(getNonDeleted(), h.app.scene);

    const tidied = getNonDeleted();
    const rectangles = tidied.filter((el) => el.type === "rectangle");
    // 16px buckets: 100 and 102 share a bucket, 300 is an outlier
    // -> target = round(mean(100, 102)) = 101
    expect(rectangles.map((el) => el.width)).toEqual([101, 101, 101]);
    expect(rectangles.map((el) => el.height)).toEqual([99, 99, 99]);
    const tidiedText = tidied.find((el) => el.type === "text")!;
    expect(tidiedText.width).toBe(textWidth);
    expect(tidiedText.height).toBe(textHeight);
  });

  it("scales images by their dominant axis, preserving aspect ratio", () => {
    const image = API.createElement({
      type: "image",
      x: 400,
      y: 0,
      width: 200,
      height: 100,
    });
    API.setElements([
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 120,
        height: 120,
      }),
      API.createElement({
        type: "rectangle",
        x: 200,
        y: 0,
        width: 120,
        height: 120,
      }),
      image,
    ]);

    tidyUpElements(getNonDeleted(), h.app.scene);

    const tidiedImage = getNonDeleted().find((el) => el.type === "image")!;
    // landscape -> width snaps to majority width 120, height follows 2:1 aspect
    expect(tidiedImage.width).toBe(120);
    expect(tidiedImage.height).toBe(60);
  });

  it("moves a container and its bound text as one rigid unit", () => {
    const [container, boundText] = API.createTextContainer({
      label: { text: "label" },
    });
    const other = API.createElement({
      type: "rectangle",
      x: 300,
      y: 300,
      width: 100,
      height: 100,
    });
    API.setElements([container, boundText, other]);
    const offsetX = boundText.x - container.x;
    const offsetY = boundText.y - container.y;

    tidyUpElements(
      getNonDeleted().filter((el) => el.id !== boundText.id),
      h.app.scene,
    );

    const tidiedContainer = h.elements.find((el) => el.id === container.id)!;
    const tidiedText = h.elements.find((el) => el.id === boundText.id)!;
    expect(tidiedText.x - tidiedContainer.x).toBeCloseTo(offsetX, 1);
    expect(tidiedText.y - tidiedContainer.y).toBeCloseTo(offsetY, 1);
  });

  it("does not grid-place bound arrows and keeps their bindings", () => {
    const rectangleA = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const rectangleB = API.createElement({
      type: "rectangle",
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    });
    const arrow = API.createElement({
      type: "arrow",
      x: 110,
      y: 50,
      width: 180,
      height: 0,
      startBinding: {
        elementId: rectangleA.id,
        fixedPoint: [0.5, 0.5],
        mode: "orbit",
      },
      endBinding: {
        elementId: rectangleB.id,
        fixedPoint: [0.5, 0.5],
        mode: "orbit",
      },
    });
    API.setElements([rectangleA, rectangleB, arrow]);

    tidyUpElements(getNonDeleted(), h.app.scene);

    const tidiedArrow = h.elements.find(
      (el) => el.id === arrow.id,
    ) as typeof arrow;
    expect(tidiedArrow.startBinding?.elementId).toBe(rectangleA.id);
    expect(tidiedArrow.endBinding?.elementId).toBe(rectangleB.id);
  });

  it("is a no-op for fewer than 2 elements", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 13,
      y: 37,
      width: 50,
      height: 50,
    });
    API.setElements([rectangle]);

    tidyUpElements(getNonDeleted(), h.app.scene);

    expect(h.elements[0].x).toBe(13);
    expect(h.elements[0].y).toBe(37);
  });
});
