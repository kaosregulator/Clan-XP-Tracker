import {
  createSurface,
  paintBackground,
  card,
  text,
  roundRectPath,
  PALETTE,
  toPng,
} from "../theme";

export type CalendarDayStatus =
  | "done"
  | "missed"
  | "none"
  | "future"
  | "vacation"
  | "skip";

export interface CalendarCardView {
  communityName: string;
  memberName: string;
  activityName: string;
  monthLabel: string; // "August 2026"
  target: number; // daily target (0 = none)
  firstWeekday: number; // 0=Sun..6=Sat, weekday of the 1st
  days: { day: number; amount: number; status: CalendarDayStatus }[];
  doneCount: number;
  missedCount: number;
  monthTotal: number;
  week: number;
  allTime: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Fill colors per day status — the "time card" language. */
function cellColors(status: CalendarDayStatus): { fill: string; stroke: string; ink: string } {
  switch (status) {
    case "done":
      return { fill: "#14351f", stroke: PALETTE.green, ink: PALETTE.greenBright };
    case "missed":
      return { fill: "#3a1a1c", stroke: PALETTE.red, ink: "#ff7a7d" };
    case "none":
      return { fill: "#2a1520", stroke: "#7a2d3a", ink: "#ff9aa2" };
    case "vacation":
      return { fill: "#2a2340", stroke: PALETTE.violet, ink: "#c99bff" };
    case "future":
      return { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, ink: PALETTE.muted };
    case "skip":
      return { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, ink: PALETTE.muted };
  }
}

/** The per-member monthly XP calendar — a manager-style time card. */
export async function renderCalendar(v: CalendarCardView): Promise<Buffer> {
  const W = 960;
  const pad = 40;
  const gridX = pad;
  const gridTop = 250;
  const cols = 7;
  const gap = 10;
  const cellW = (W - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = 84;

  const totalCells = v.firstWeekday + v.days.length;
  const rows = Math.ceil(totalCells / cols);
  const gridH = rows * cellH + (rows - 1) * gap;
  const H = gridTop + gridH + 60;

  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  // Header
  text(ctx, v.communityName.toUpperCase(), pad, 52, {
    size: 20,
    weight: "bold",
    color: PALETTE.soft,
    maxWidth: W - pad * 2,
  });
  text(ctx, `${v.memberName}`, pad, 96, { size: 36, weight: "bold", color: PALETTE.text, maxWidth: W - pad * 2 });
  text(ctx, `${v.activityName} calendar • ${v.monthLabel}`, pad, 124, {
    size: 17,
    color: PALETTE.muted,
  });

  // Stat strip
  const stats: [string, string][] = [
    ["Done", `${v.doneCount}`],
    ["Missed", `${v.missedCount}`],
    ["Month", v.monthTotal.toLocaleString()],
    ["Week", v.week.toLocaleString()],
    ["All-time", v.allTime.toLocaleString()],
  ];
  const stripY = 150;
  const stripH = 66;
  const sw = (W - pad * 2 - gap * (stats.length - 1)) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = pad + i * (sw + gap);
    card(ctx, x, stripY, sw, stripH, { fill: PALETTE.card, shadow: false, radius: 14 });
    text(ctx, label.toUpperCase(), x + 14, stripY + 26, { size: 13, weight: "bold", color: PALETTE.muted });
    text(ctx, value, x + 14, stripY + 52, { size: 26, weight: "bold", color: PALETTE.text });
  });

  const targetLine =
    v.target > 0
      ? `Daily target: ${v.target.toLocaleString()} ${v.activityName}`
      : `No daily target set — any entry counts as done`;
  text(ctx, targetLine, pad, stripY + stripH + 30, { size: 15, color: PALETTE.soft });

  // Weekday headers
  for (let c = 0; c < cols; c++) {
    const x = gridX + c * (cellW + gap);
    text(ctx, WEEKDAYS[c]!, x + cellW / 2, gridTop - 12, {
      size: 14,
      weight: "bold",
      color: PALETTE.muted,
      align: "center",
    });
  }

  // Day cells
  for (let i = 0; i < v.days.length; i++) {
    const d = v.days[i]!;
    const cellIndex = v.firstWeekday + i;
    const col = cellIndex % cols;
    const row = Math.floor(cellIndex / cols);
    const x = gridX + col * (cellW + gap);
    const y = gridTop + row * (cellH + gap);
    const { fill, stroke, ink } = cellColors(d.status);

    roundRectPath(ctx, x, y, cellW, cellH, 12);
    ctx.fillStyle = fill;
    ctx.fill();
    roundRectPath(ctx, x + 0.5, y + 0.5, cellW - 1, cellH - 1, 12);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Day number
    text(ctx, `${d.day}`, x + 12, y + 24, { size: 15, weight: "bold", color: PALETTE.soft });

    // Status glyph / amount
    const glyph =
      d.status === "done"
        ? "✓"
        : d.status === "missed"
          ? "✗"
          : d.status === "none"
            ? "✗"
            : d.status === "vacation"
              ? "V"
              : d.status === "future"
                ? "·"
                : "–";
    text(ctx, glyph, x + cellW - 14, y + 26, { size: 18, weight: "bold", color: ink, align: "right" });

    if (d.status === "done" || d.status === "missed") {
      text(ctx, d.amount.toLocaleString(), x + cellW / 2, y + 60, {
        size: 20,
        weight: "bold",
        color: ink,
        align: "center",
      });
    } else if (d.status === "none") {
      text(ctx, "—", x + cellW / 2, y + 60, { size: 20, weight: "bold", color: ink, align: "center" });
    }
  }

  return toPng(rc.canvas);
}
