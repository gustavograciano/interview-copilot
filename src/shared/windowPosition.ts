interface Point { x: number; y: number }
interface WorkArea extends Point { width: number; height: number }

// Keep enough of the drag bar visible, including on monitors left of the primary.
export function visibleOverlayPosition(position: Point, workAreas: WorkArea[]): Point {
  if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
    const point = { x: Math.round(position.x), y: Math.round(position.y) };
    if (workAreas.some((area) =>
      Math.min(point.x + 760, area.x + area.width) - Math.max(point.x, area.x) >= 120 &&
      Math.min(point.y + 36, area.y + area.height) - Math.max(point.y, area.y) >= 24
    )) return point;
  }
  const primary = workAreas[0] || { x: 0, y: 0 };
  return { x: primary.x + 20, y: primary.y + 40 };
}
