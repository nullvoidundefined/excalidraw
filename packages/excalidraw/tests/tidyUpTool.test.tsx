import { CaptureUpdateAction } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { act, fireEvent, render, unmountComponent } from "./test-utils";

const h = window.h;
const mouse = new Pointer("mouse");

describe("tidy up tool", () => {
  beforeEach(async () => {
    unmountComponent();
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  const createMessyRectangles = () => {
    API.setElements([
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        strokeColor: "#e03131",
      }),
      API.createElement({
        type: "rectangle",
        x: 40,
        y: 30,
        width: 100,
        height: 100,
        strokeColor: "#e03131",
      }),
      API.createElement({
        type: "rectangle",
        x: 20,
        y: 60,
        width: 100,
        height: 100,
        strokeColor: "#1971c2",
      }),
    ]);
  };

  it("tidies lassoed elements on pointer release and reverts to selection", () => {
    createMessyRectangles();
    const originalPositions = h.elements.map((el) => ({ x: el.x, y: el.y }));

    act(() => {
      h.app.setActiveTool({ type: "tidyup" });
    });
    mouse.downAt(-20, -20);
    mouse.moveTo(200, 200);
    mouse.up();

    // all three overlapped the lasso -> all tidied
    expect(h.elements.every((el) => el.strokeColor === "#e03131")).toBe(true);
    expect(
      h.elements.some(
        (el, index) =>
          el.x !== originalPositions[index].x ||
          el.y !== originalPositions[index].y,
      ),
    ).toBe(true);
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("no-ops when the lasso overlaps fewer than 2 elements", () => {
    createMessyRectangles();
    const originalPositions = h.elements.map((el) => ({ x: el.x, y: el.y }));

    act(() => {
      h.app.setActiveTool({ type: "tidyup" });
    });
    // lasso only clips the corner of the first rectangle
    mouse.downAt(-20, -20);
    mouse.moveTo(10, 10);
    mouse.up();

    expect(h.elements.map((el) => ({ x: el.x, y: el.y }))).toEqual(
      originalPositions,
    );
    expect(h.elements).toHaveLength(3);
  });

  it("undoes the whole tidy as a single step", () => {
    // commit the fixture elements as their own history entry so undoing
    // the tidy restores them instead of reverting their creation too
    API.updateScene({
      elements: [
        API.createElement({
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          strokeColor: "#e03131",
        }),
        API.createElement({
          type: "rectangle",
          x: 40,
          y: 30,
          width: 100,
          height: 100,
          strokeColor: "#e03131",
        }),
        API.createElement({
          type: "rectangle",
          x: 20,
          y: 60,
          width: 100,
          height: 100,
          strokeColor: "#1971c2",
        }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const originalSnapshot = h.elements.map((el) => ({
      x: el.x,
      y: el.y,
      strokeColor: el.strokeColor,
    }));
    const undoStackBefore = API.getUndoStack().length;

    act(() => {
      h.app.setActiveTool({ type: "tidyup" });
    });
    mouse.downAt(-20, -20);
    mouse.moveTo(200, 200);
    mouse.up();

    // the whole tidy is exactly one history entry
    expect(API.getUndoStack().length).toBe(undoStackBefore + 1);

    Keyboard.undo();

    expect(
      h.elements.map((el) => ({
        x: el.x,
        y: el.y,
        strokeColor: el.strokeColor,
      })),
    ).toEqual(originalSnapshot);
  });

  it("activates from the extra-tools dropdown", () => {
    const extraToolsTrigger = document.querySelector(
      "[title='More tools']",
    ) as HTMLElement;
    fireEvent.click(extraToolsTrigger);
    fireEvent.click(
      document.querySelector("[data-testid='toolbar-tidyup']") as HTMLElement,
    );
    expect(h.state.activeTool.type).toBe("tidyup");
  });

  it("creates no elements", () => {
    createMessyRectangles();
    act(() => {
      h.app.setActiveTool({ type: "tidyup" });
    });
    mouse.downAt(-20, -20);
    mouse.moveTo(200, 200);
    mouse.up();
    expect(h.elements).toHaveLength(3);
  });
});
