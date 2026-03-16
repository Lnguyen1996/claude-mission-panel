import {
  mouse,
  straightTo,
  Point,
  Button,
} from "@nut-tree-fork/nut-js";

export async function click(
  x: number,
  y: number,
  button: "left" | "right" | "double" = "left"
): Promise<void> {
  await mouse.setPosition(new Point(x, y));
  if (button === "double") {
    await mouse.doubleClick(Button.LEFT);
  } else if (button === "right") {
    await mouse.click(Button.RIGHT);
  } else {
    await mouse.click(Button.LEFT);
  }
}

export async function move(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
}

export async function scroll(
  direction: "up" | "down",
  amount: number = 3
): Promise<void> {
  if (direction === "up") {
    await mouse.scrollUp(amount);
  } else {
    await mouse.scrollDown(amount);
  }
}

export async function drag(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<void> {
  await mouse.setPosition(new Point(x1, y1));
  await mouse.pressButton(Button.LEFT);
  await mouse.move(straightTo(new Point(x2, y2)));
  await mouse.releaseButton(Button.LEFT);
}
