// Island window: placement on the chosen display, the two window sizes
// (full panel / invisible wake strip), click-through and the cursor poll.
//
// There is no notch on a PC, so the island is a black shape drawn at the top
// centre of the main display inside a borderless, transparent, always-on-top
// window that never takes focus.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::platform::{self, cursor_physical, left_button_down};

/// Logical size of the full window — the largest island view, like the macOS panel.
pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 320.0;
/// Logical size of the invisible strip that wakes the island when it is hidden
/// and the closed island is set to show nothing.
pub const STRIP_W: f64 = 240.0;
pub const STRIP_H: f64 = 6.0;

pub const WINDOW_LABEL: &str = "island";

/// Around the window, how far the cursor is still worth telling the page
/// about (Mochi's eyes follow it), in logical px. Past it the page hears once
/// that the cursor left, then nothing until it comes back: a cursor working in
/// another app costs neither messages nor island frames.
const NEAR_ZONE: f64 = 420.0;
/// The poll's period while the cursor is far from the island, in ms.
const FAR_PERIOD_MS: u64 = 50;

/// Whether a cursor at window-logical (x, y) is near a window of `size`.
fn is_near(x: f64, y: f64, size: (f64, f64)) -> bool {
    x >= -NEAR_ZONE && x <= size.0 + NEAR_ZONE && y >= -NEAR_ZONE && y <= size.1 + NEAR_ZONE
}

/// Folded in a corner, the mascot follows a cursor this close to its centre
/// (logical px): Wobnimo looks up to about 3.3 widths away from itself.
const GAZE_RADIUS: f64 = 700.0;
/// The parked poll's period while the cursor is that close, in ms (30 Hz).
const GAZE_NEAR_MS: u64 = 33;
/// The parked poll's period otherwise, in ms.
const PARKED_WAIT_MS: u64 = 250;

/// How long the parked poll waits before reading a cursor at window-logical
/// (x, y) again, around a folded corner window of `size`.
fn gaze_wait_ms(x: f64, y: f64, size: (f64, f64)) -> u64 {
    if (x - size.0 / 2.0).hypot(y - size.1 / 2.0) <= GAZE_RADIUS { GAZE_NEAR_MS } else { PARKED_WAIT_MS }
}

/// The cursor in the window's logical coordinates, with the window's logical size.
fn cursor_in_window(win: &WebviewWindow) -> Option<(f64, f64, (f64, f64))> {
    let origin = win.outer_position().ok()?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let size = win.inner_size().ok()?;
    let (cx, cy) = cursor_physical()?;
    Some((
        (cx - origin.x as f64) / scale,
        (cy - origin.y as f64) / scale,
        (size.width as f64 / scale, size.height as f64 / scale),
    ))
}

/// Margin around the island that still counts as "on the island", in logical px.
/// Wider than the macOS 6 pt because a click must never be swallowed.
const HIT_MARGIN: f64 = 14.0;

#[derive(Serialize, Clone)]
pub struct CursorPayload {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone)]
pub struct ScreenInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// The island shape in window-logical coordinates, pushed by the front end.
/// The poll thread owns the click-through decision so it lands in the same 16 ms
/// tick as the cursor read — an IPC round trip here loses clicks.
#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, serde::Deserialize)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Side of the MascotForge mascot (or Mochi) in corner mode, logical px. Wider
/// than the mascot itself: a hop or a shake must not leave the window.
pub const MASCOT_SIZE: f64 = 240.0;
pub const MINI_SIZE: f64 = 120.0;
pub const MINI_GAP: f64 = 8.0;
/// Gap between the mascot and the edges of the work area, logical px.
const CORNER_MARGIN: f64 = 16.0;
pub(crate) static CORNER_MINIS: Mutex<Vec<MiniSlot>> = Mutex::new(Vec::new());
pub(crate) static CORNER_MINI_DRAG: AtomicBool = AtomicBool::new(false);
pub(crate) static CORNER_PANEL_ANCHOR: Mutex<Option<IslandRect>> = Mutex::new(None);
static CORNER_MASCOT_OFFSET: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));
static CORNER_HELD_RECTS: Mutex<Vec<IslandRect>> = Mutex::new(Vec::new());

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct MiniSlot {
    pub size: f64,
    pub at: Option<(f64, f64)>,
}

pub(crate) fn replace_corner_minis(slots: Vec<MiniSlot>, dragging: bool) {
    *CORNER_MINIS.lock().unwrap() = slots;
    if !dragging {
        CORNER_MINI_DRAG.store(false, Ordering::Relaxed);
    }
}

/// Corner mode: where the window goes and what sits where inside it.
/// `window` is in physical screen px; the other rectangles are window-logical px.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CornerLayout {
    pub window: IslandRect,
    pub mascot: IslandRect,
    pub panel: Option<IslandRect>,
    pub minis: Vec<IslandRect>,
    pub scale: f64,
}

fn physical_mascot_offset(layout: &CornerLayout, scale: f64) -> (f64, f64) {
    (layout.mascot.x * scale, layout.mascot.y * scale)
}

fn mascot_at_from_window(window_at: (f64, f64), offset: (f64, f64)) -> (f64, f64) {
    (window_at.0 + offset.0, window_at.1 + offset.1)
}

fn remember_mascot_offset(layout: &CornerLayout, scale: f64) {
    *CORNER_MASCOT_OFFSET.lock().unwrap() = physical_mascot_offset(layout, scale);
}

pub fn dragged_mascot_at(window_at: (f64, f64)) -> (f64, f64) {
    mascot_at_from_window(window_at, *CORNER_MASCOT_OFFSET.lock().unwrap())
}

/// The window for the mascot at `mascot_at` (physical top-left; None, or off
/// the work area: the bottom-right corner), and the panel of logical size
/// `panel`, optionally anchored to a mini's physical screen rectangle.
pub fn corner_layout(
    work: IslandRect,
    scale: f64,
    mascot_at: Option<(f64, f64)>,
    panel: Option<(f64, f64)>,
    minis: &[MiniSlot],
    dragging: bool,
    mascot_size: f64,
    panel_anchor: Option<IslandRect>,
) -> CornerLayout {
    let size = mascot_size * scale;
    let margin = CORNER_MARGIN * scale;
    let (right, bottom) = (work.x + work.w, work.y + work.h);
    let home = (right - margin - size, bottom - margin - size);
    // Partly off the work area (dropped over the taskbar): pulled back in.
    // Nowhere on it (its screen is gone): home.
    let (mx, my) = mascot_at
        .filter(|&(x, y)| x + size > work.x && y + size > work.y && x < right && y < bottom)
        .map(|(x, y)| (x.min(right - size).max(work.x), y.min(bottom - size).max(work.y)))
        .unwrap_or(home);
    let mascot = IslandRect { x: mx, y: my, w: size, h: size };
    let left = mx + size / 2.0 >= work.x + work.w / 2.0;
    let up = my + size / 2.0 >= work.y + work.h / 2.0;

    if minis.is_empty() && !dragging && panel_anchor.is_none() {
        let Some((pw, ph)) = panel else {
            return CornerLayout {
                window: mascot,
                mascot: IslandRect { x: 0.0, y: 0.0, w: mascot_size, h: mascot_size },
                panel: None,
                minis: Vec::new(),
                scale,
            };
        };
        let (pw, ph) = (pw * scale, ph * scale);
        let px = if left { mx - pw } else { mx + size };
        let py = if up { my + size - ph } else { my };
        let px = px.min(right - pw).max(work.x);
        let py = py.min(bottom - ph).max(work.y);
        let panel = IslandRect { x: px, y: py, w: pw, h: ph };
        let x0 = mascot.x.min(panel.x);
        let y0 = mascot.y.min(panel.y);
        let x1 = (mascot.x + mascot.w).max(panel.x + panel.w);
        let y1 = (mascot.y + mascot.h).max(panel.y + panel.h);
        let inside = |r: IslandRect| IslandRect {
            x: (r.x - x0) / scale,
            y: (r.y - y0) / scale,
            w: r.w / scale,
            h: r.h / scale,
        };
        return CornerLayout {
            window: IslandRect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
            mascot: inside(mascot),
            panel: Some(inside(panel)),
            minis: Vec::new(),
            scale,
        };
    }

    let gap = MINI_GAP * scale;
    let mut mini_rects = vec![IslandRect::default(); minis.len()];
    let queued: Vec<usize> = minis
        .iter()
        .enumerate()
        .filter_map(|(index, mini)| mini.at.is_none().then_some(index))
        .collect();
    if !queued.is_empty() {
        let cell_size = queued
            .iter()
            .map(|&index| minis[index].size * scale)
            .fold(0.0, f64::max);
        let step = cell_size + gap;
        let capacity = |room: f64| ((room.max(0.0) + gap) / step).floor() as usize;
        let preferred_room = if left { mx - work.x } else { right - (mx + size) };
        let opposite_room = if left { right - (mx + size) } else { mx - work.x };
        let preferred_capacity = capacity(preferred_room);
        let total_capacity = (preferred_capacity + capacity(opposite_room)).max(1);
        let max_rows = capacity(work.h).max(1);
        let needed_per_row = queued.len().div_ceil(max_rows);
        let per_row = preferred_capacity.max(needed_per_row).min(total_capacity).max(1);
        let rows = queued.len().div_ceil(per_row);
        let first_y = if up { my + size - cell_size } else { my };
        let raw_top = if up { first_y - (rows - 1) as f64 * step } else { first_y };
        let raw_bottom = if up {
            first_y + cell_size
        } else {
            first_y + (rows - 1) as f64 * step + cell_size
        };
        let y_shift = if raw_top < work.y {
            work.y - raw_top
        } else if raw_bottom > bottom {
            bottom - raw_bottom
        } else {
            0.0
        };
        for (queue_index, &index) in queued.iter().enumerate() {
            let mini_size = minis[index].size * scale;
            let row = (queue_index / per_row) as f64;
            let column = queue_index % per_row;
            let x = if column < preferred_capacity {
                let column = column as f64;
                if left {
                    mx - gap - mini_size - column * step
                } else {
                    mx + size + gap + column * step
                }
            } else {
                let column = (column - preferred_capacity) as f64;
                if left {
                    mx + size + gap + column * step
                } else {
                    mx - gap - mini_size - column * step
                }
            };
            let row_y = if up {
                first_y - row * step + y_shift
            } else {
                first_y + row * step + y_shift
            };
            let y = if up { row_y + cell_size - mini_size } else { row_y };
            mini_rects[index] = IslandRect { x, y, w: mini_size, h: mini_size };
        }
    }
    let mut placed_rects = Vec::new();
    for (index, mini) in minis.iter().enumerate() {
        let Some((x, y)) = mini.at else { continue };
        let mini_size = mini.size * scale;
        let mut placed = IslandRect {
            x: x.min(right - mini_size).max(work.x),
            y: y.min(bottom - mini_size).max(work.y),
            w: mini_size,
            h: mini_size,
        };
        if placed_rects.iter().any(|other| same_origin(*other, placed)) {
            let step = mini_size / 2.0;
            let directions = if placed.x + mini_size / 2.0 < work.x + work.w / 2.0 {
                [1.0, -1.0]
            } else {
                [-1.0, 1.0]
            };
            'distance: for distance in 1..=placed_rects.len() + 1 {
                for direction in directions {
                    let candidate = IslandRect {
                        x: placed.x + direction * step * distance as f64,
                        ..placed
                    };
                    if candidate.x >= work.x
                        && candidate.x + candidate.w <= right
                        && !placed_rects.iter().any(|other| same_origin(*other, candidate))
                    {
                        placed = candidate;
                        break 'distance;
                    }
                }
            }
        }
        mini_rects[index] = placed;
        placed_rects.push(placed);
    }

    let mut block_rects = Vec::with_capacity(queued.len() + 1);
    block_rects.push(mascot);
    block_rects.extend(queued.iter().map(|&index| mini_rects[index]));
    let block = bounding(&block_rects);
    let panel = panel.map(|(pw, ph)| {
        let (pw, ph) = (pw * scale, ph * scale);
        let px = if left { mascot.x + mascot.w - pw } else { mascot.x };
        let px = px.min(right - pw).max(work.x);
        let above = block.y - gap - ph;
        let below = block.y + block.h + gap;
        let fits = |y: f64| y >= work.y && y + ph <= bottom;
        let preferred = if up { above } else { below };
        let alternate = if up { below } else { above };
        let mut placed = if fits(preferred) || fits(alternate) {
            let py = if fits(preferred) { preferred } else { alternate };
            IslandRect { x: px, y: py, w: pw, h: ph }
        } else {
            let before = block.x - gap - pw;
            let after = block.x + block.w + gap;
            let fits_x = |x: f64| x >= work.x && x + pw <= right;
            let side = if left { before } else { after };
            let other_side = if left { after } else { before };
            let px = if fits_x(side) {
                side
            } else if fits_x(other_side) {
                other_side
            } else {
                px
            };
            let py = if up { mascot.y + mascot.h - ph } else { mascot.y };
            IslandRect { x: px, y: py.min(bottom - ph).max(work.y), w: pw, h: ph }
        };

        let Some(anchor) = panel_anchor else { return placed };
        placed.x = (anchor.x + anchor.w / 2.0 - pw / 2.0).min(right - pw).max(work.x);
        let queued_anchor = queued.iter().any(|&index| {
            let mini = mini_rects[index];
            (mini.x - anchor.x).abs() < 0.5
                && (mini.y - anchor.y).abs() < 0.5
                && (mini.w - anchor.w).abs() < 0.5
                && (mini.h - anchor.h).abs() < 0.5
        });
        if !queued_anchor {
            placed.y = if anchor.y + anchor.h / 2.0 >= work.y + work.h / 2.0 {
                anchor.y - gap - ph
            } else {
                anchor.y + anchor.h + gap
            }
            .min(bottom - ph)
            .max(work.y);
        }
        placed
    });

    let mut drawn = Vec::with_capacity(minis.len() + 2);
    drawn.push(mascot);
    drawn.extend(mini_rects.iter().copied());
    if let Some(panel) = panel {
        drawn.push(panel);
    }
    let window = if dragging { work } else { bounding(&drawn) };
    let inside = |r: IslandRect| IslandRect {
        x: (r.x - window.x) / scale,
        y: (r.y - window.y) / scale,
        w: r.w / scale,
        h: r.h / scale,
    };
    CornerLayout {
        window,
        mascot: inside(mascot),
        panel: panel.map(|rect| inside(rect)),
        minis: mini_rects.into_iter().map(|rect| inside(rect)).collect(),
        scale,
    }
}

/// The smallest rect around `rects` (empty when there are none).
fn bounding(rects: &[IslandRect]) -> IslandRect {
    let drawn: Vec<&IslandRect> = rects.iter().filter(|r| r.w > 0.0).collect();
    if drawn.is_empty() {
        return IslandRect::default();
    }
    let x0 = drawn.iter().map(|r| r.x).fold(f64::INFINITY, f64::min);
    let y0 = drawn.iter().map(|r| r.y).fold(f64::INFINITY, f64::min);
    let x1 = drawn.iter().map(|r| r.x + r.w).fold(f64::NEG_INFINITY, f64::max);
    let y1 = drawn.iter().map(|r| r.y + r.h).fold(f64::NEG_INFINITY, f64::max);
    IslandRect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/// The work area the mascot at `at` (physical top-left) is on; `fallback`
/// (the screen chosen in Settings) when it is on none.
pub fn pick_work(works: &[IslandRect], fallback: IslandRect, at: Option<(f64, f64)>) -> IslandRect {
    let Some((x, y)) = at else { return fallback };
    works
        .iter()
        .copied()
        .find(|w| x >= w.x && y >= w.y && x < w.x + w.w && y < w.y + w.h)
        .unwrap_or(fallback)
}

fn work_of(m: &Monitor) -> IslandRect {
    let area = m.work_area();
    IslandRect {
        x: area.position.x as f64,
        y: area.position.y as f64,
        w: area.size.width as f64,
        h: area.size.height as f64,
    }
}

/// Whether window-logical (x, y) is on one of `rects`, give or take HIT_MARGIN.
pub fn hits(rects: &[IslandRect], x: f64, y: f64) -> bool {
    rects.iter().any(|r| {
        r.w > 0.0
            && x >= r.x - HIT_MARGIN
            && x <= r.x + r.w + HIT_MARGIN
            && y >= r.y - HIT_MARGIN
            && y <= r.y + r.h + HIT_MARGIN
    })
}

fn same_origin(a: IslandRect, b: IslandRect) -> bool {
    a.x == b.x && a.y == b.y
}

#[derive(Debug, PartialEq)]
struct FoldedPointer {
    takes_mouse: bool,
    wakes: bool,
}

fn folded_pointer(rects: &[IslandRect], x: f64, y: f64) -> FoldedPointer {
    FoldedPointer {
        takes_mouse: hits(rects, x, y),
        wakes: rects.first().is_some_and(|mascot| hits(std::slice::from_ref(mascot), x, y)),
    }
}

fn active_pointer_takes_mouse(
    drawn: &[IslandRect],
    held: &[IslandRect],
    x: f64,
    y: f64,
    button_down: bool,
    mini_dragging: bool,
) -> bool {
    hits(drawn, x, y) || (button_down && (mini_dragging || hits(held, x, y)))
}

/// Wakes / parks the cursor poll thread so a hidden island costs literally nothing.
pub struct PollGate {
    active: Mutex<bool>,
    cv: Condvar,
    pub collapsed: AtomicBool,
    /// The window's logical size while collapsed: the closed island the page
    /// draws, or the wake strip.
    pub collapsed_size: Mutex<(f64, f64)>,
    /// What takes the mouse: the island shape, or in corner mode the mascot
    /// and the open panel.
    pub rects: Mutex<Vec<IslandRect>>,
    /// Mirrors the window flag so we only call into the OS when it changes.
    ignoring: AtomicBool,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            cv: Condvar::new(),
            collapsed: AtomicBool::new(true),
            collapsed_size: Mutex::new((STRIP_W, STRIP_H)),
            rects: Mutex::new(Vec::new()),
            ignoring: AtomicBool::new(false),
        }
    }

    pub fn set_rect(&self, rect: IslandRect) {
        self.set_rects(vec![rect]);
    }

    pub fn set_rects(&self, rects: Vec<IslandRect>) {
        *self.rects.lock().unwrap() = rects;
    }

    /// Forces the next poll tick to re-apply the flag (after a window resize).
    pub fn forget_ignore_state(&self) {
        self.ignoring.store(false, Ordering::Relaxed);
    }

    pub fn set_active(&self, on: bool) {
        let mut guard = self.active.lock().unwrap();
        *guard = on;
        self.cv.notify_all();
    }

    pub(crate) fn wait_until_active(&self) {
        let mut guard = self.active.lock().unwrap();
        while !*guard {
            guard = self.cv.wait(guard).unwrap();
        }
    }

    /// Waits until the gate opens or `timeout` passes; true when it is open.
    pub(crate) fn wait_active_for(&self, timeout: Duration) -> bool {
        let guard = self.active.lock().unwrap();
        if *guard {
            return true;
        }
        let (guard, _) = self.cv.wait_timeout(guard, timeout).unwrap();
        *guard
    }

    pub(crate) fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn monitor_contains(m: &Monitor, x: f64, y: f64) -> bool {
    let p = m.position();
    let s = m.size();
    x >= p.x as f64
        && x < (p.x + s.width as i32) as f64
        && y >= p.y as f64
        && y < (p.y + s.height as i32) as f64
}

/// A display's logical origin, the key `at:<x>,<y>` preferences are matched on.
/// Names are no good for that: two monitors of the same model share one.
fn logical_origin(m: &Monitor) -> (i32, i32) {
    let scale = m.scale_factor();
    let p = m.position();
    ((p.x as f64 / scale).round() as i32, (p.y as f64 / scale).round() as i32)
}

/// One entry of the "Island lives on" list in Settings.
#[derive(Serialize, Clone)]
pub struct MonitorChoice {
    pub key: String,
    pub label: String,
}

pub fn monitor_choices(app: &AppHandle) -> Vec<MonitorChoice> {
    let Ok(monitors) = app.available_monitors() else { return Vec::new() };
    monitors
        .iter()
        .map(|m| {
            let d = describe(m);
            MonitorChoice {
                key: d.key(),
                label: crate::i18n::tf(
                    "{name} — {width}×{height} at {x},{y}",
                    &[
                        ("name", &d.name),
                        ("width", &d.w.to_string()),
                        ("height", &d.h.to_string()),
                        ("x", &d.x.to_string()),
                        ("y", &d.y.to_string()),
                    ],
                ),
            }
        })
        .collect()
}

/// What a display is remembered by: its logical origin, plus its name and
/// logical size, so it is still found after the layout is rearranged or the
/// resolution changes (the Mac keeps the display's UUID for the same reason;
/// Tauri has no stable ID).
#[derive(Debug, Clone, PartialEq)]
struct DisplayId {
    name: String,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

impl DisplayId {
    /// `at:<x>,<y>` stays first, so a preference saved before still matches.
    fn key(&self) -> String {
        format!("at:{},{}|{}|{}x{}", self.x, self.y, self.name.replace('|', " "), self.w, self.h)
    }
}

fn describe(m: &Monitor) -> DisplayId {
    let (x, y) = logical_origin(m);
    let scale = m.scale_factor();
    let s = m.size();
    DisplayId {
        name: m.name().cloned().unwrap_or_else(|| "Display".into()),
        x,
        y,
        w: (s.width as f64 / scale).round() as i32,
        h: (s.height as f64 / scale).round() as i32,
    }
}

/// Which display a saved `at:` preference points at, best match first: same
/// place and name; the same name and size elsewhere (layout rearranged); the
/// same name alone when unique (resolution changed); the same place. None
/// means unplugged, and the caller falls back to the primary display.
fn pick_display(pref: &str, displays: &[DisplayId]) -> Option<usize> {
    let rest = pref.strip_prefix("at:")?;
    let mut parts = rest.split('|');
    let (x, y) = parts.next()?.split_once(',')?;
    let (x, y) = (x.trim().parse::<i32>().ok()?, y.trim().parse::<i32>().ok()?);
    let name = parts.next();
    let size = parts.next().and_then(|s| {
        let (w, h) = s.split_once('x')?;
        Some((w.parse::<i32>().ok()?, h.parse::<i32>().ok()?))
    });
    let at = |d: &DisplayId| d.x == x && d.y == y;
    if let Some(name) = name {
        if let Some(i) = displays.iter().position(|d| at(d) && d.name == name) {
            return Some(i);
        }
        if let Some((w, h)) = size {
            if let Some(i) = displays.iter().position(|d| d.name == name && d.w == w && d.h == h) {
                return Some(i);
            }
        }
        let mut same_name = displays.iter().enumerate().filter(|(_, d)| d.name == name);
        if let (Some((i, _)), None) = (same_name.next(), same_name.next()) {
            return Some(i);
        }
    }
    displays.iter().position(at)
}

/// The display the island lives on: a chosen one, the primary one, or the one
/// under the cursor.
fn target_monitor(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    let ids: Vec<DisplayId> = monitors.iter().map(describe).collect();
    if let Some(i) = pick_display(pref, &ids) {
        return Some(monitors[i].clone());
    }
    if pref == "cursor" {
        if let Some((cx, cy)) = cursor_physical() {
            if let Some(m) = monitors.iter().find(|m| monitor_contains(m, cx, cy)) {
                return Some(m.clone());
            }
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next())
}

#[cfg(test)]
mod display_tests {
    use super::*;

    fn d(name: &str, x: i32, y: i32, w: i32, h: i32) -> DisplayId {
        DisplayId { name: name.into(), x, y, w, h }
    }

    #[test]
    fn a_display_is_found_again_after_changes() {
        let dell = d("DELL U2720Q", 1920, 0, 2560, 1440);
        let lap = d("eDP-1", 0, 0, 1920, 1200);
        let key = dell.key();
        assert_eq!(pick_display(&key, &[lap.clone(), dell.clone()]), Some(1));
        // Rearranged: the Dell moved to the left of the laptop.
        let moved = [d("eDP-1", 2560, 0, 1920, 1200), d("DELL U2720Q", 0, 0, 2560, 1440)];
        assert_eq!(pick_display(&key, &moved), Some(1));
        // Resolution changed, still the only Dell.
        let rescaled = [lap.clone(), d("DELL U2720Q", 1920, 0, 1920, 1080)];
        assert_eq!(pick_display(&key, &rescaled), Some(1));
        // Unplugged: nothing, so the caller falls back to the primary display.
        assert_eq!(pick_display(&key, &[lap.clone()]), None);
    }

    #[test]
    fn two_identical_monitors_are_told_apart_by_place() {
        let a = d("LG 27UL500", 0, 0, 1920, 1080);
        let b = d("LG 27UL500", 1920, 0, 1920, 1080);
        assert_eq!(pick_display(&b.key(), &[a.clone(), b.clone()]), Some(1));
        assert_eq!(pick_display(&a.key(), &[a, b]), Some(0));
    }

    #[test]
    fn preferences_saved_before_still_match() {
        let lap = d("eDP-1", 0, 0, 1920, 1200);
        let ext = d("HDMI-1", 1920, 0, 1920, 1080);
        assert_eq!(pick_display("at:1920,0", &[lap.clone(), ext.clone()]), Some(1));
        assert_eq!(pick_display("primary", &[lap, ext]), None);
        assert_eq!(pick_display("at:nonsense", &[]), None);
    }
}

/// Calculates the zoom correction factor so that 1 CSS pixel equals 1 window logical pixel.
/// If WebView2's devicePixelRatio differs from the window's scale factor (e.g. system text
/// scaling or multi-monitor DPI mismatch), adjusting the webview zoom ensures the island
/// canvas (PANEL_W / EXPANDED_W) fits within the window without clipping.
pub fn calculate_zoom_correction(current_zoom: f64, scale: f64, dpr: f64) -> Option<f64> {
    if dpr <= 0.0 || !dpr.is_finite() || scale <= 0.0 || !scale.is_finite() {
        return None;
    }
    if (dpr - scale).abs() / scale < 0.02 {
        return None;
    }
    let new_zoom = (current_zoom * (scale / dpr)).clamp(0.25, 4.0);
    Some(new_zoom)
}

#[cfg(test)]
mod zoom_tests {
    use super::*;

    #[test]
    fn zoom_correction_is_none_when_dpr_matches_window_scale() {
        assert_eq!(calculate_zoom_correction(1.0, 1.0, 1.0), None);
        assert_eq!(calculate_zoom_correction(1.0, 1.25, 1.25), None);
        // Within 2% threshold
        assert_eq!(calculate_zoom_correction(1.0, 1.0, 1.01), None);
    }

    #[test]
    fn zoom_correction_adjusts_for_dpi_mismatch() {
        // Issue #346: 100% scale display (scale 1.0) but WebView2 dpr = 1.25
        let zoom = calculate_zoom_correction(1.0, 1.0, 1.25);
        assert_eq!(zoom, Some(0.8));

        // 125% display with 125% text scale (dpr 1.5625 vs scale 1.25)
        let zoom = calculate_zoom_correction(1.0, 1.25, 1.5625);
        assert_eq!(zoom, Some(0.8));

        // 150% display with 100% webview dpr
        let zoom = calculate_zoom_correction(1.0, 1.5, 1.0);
        assert_eq!(zoom, Some(1.5));
    }

    #[test]
    fn only_a_cursor_near_the_island_is_followed() {
        let size = (PANEL_W, PANEL_H);
        assert!(is_near(360.0, 10.0, size));
        assert!(is_near(-400.0, PANEL_H + 400.0, size));
        assert!(!is_near(-500.0, 10.0, size));
        assert!(!is_near(360.0, PANEL_H + 900.0, size));
    }

    #[test]
    fn a_closed_island_stays_inside_the_panel() {
        assert_eq!(clamp_collapsed((160.0, 26.0)), (160.0, 26.0));
        assert_eq!(clamp_collapsed((5000.0, 900.0)), (PANEL_W, PANEL_H));
        assert_eq!(clamp_collapsed((0.0, -3.0)), (1.0, 1.0));
        assert_eq!(clamp_collapsed((f64::NAN, 26.0)), (PANEL_W, 26.0));
    }

    #[test]
    fn zoom_correction_handles_invalid_inputs() {
        assert_eq!(calculate_zoom_correction(1.0, 0.0, 1.0), None);
        assert_eq!(calculate_zoom_correction(1.0, 1.0, -1.0), None);
        assert_eq!(calculate_zoom_correction(1.0, f64::NAN, 1.0), None);
        assert_eq!(calculate_zoom_correction(1.0, 1.0, f64::INFINITY), None);
    }

    #[test]
    fn a_top_taskbar_moves_the_island_down_and_nothing_else_does() {
        // Taskbar at the bottom (or none): the work area starts at the top.
        assert_eq!(top_inset_from(0, 0), 0);
        // A 48 px taskbar at the top of a display placed at y = -1080.
        assert_eq!(top_inset_from(-1080, -1032), 48);
        // Nonsense from the system never pushes the island off the display.
        assert_eq!(top_inset_from(0, -20), 0);
        assert_eq!(top_inset_from(0, 900), 0);
    }
}


pub fn screen_info(app: &AppHandle, pref: &str) -> ScreenInfo {
    match target_monitor(app, pref) {
        Some(m) => {
            let scale = m.scale_factor();
            let p = m.position();
            let s = m.size();
            ScreenInfo {
                x: p.x as f64 / scale,
                y: p.y as f64 / scale,
                width: s.width as f64 / scale,
                height: s.height as f64 / scale,
                scale,
            }
        }
        None => ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
    }
}

/// Places and sizes the window: the full panel, or `collapsed` to the size the
/// closed island needs (the wake strip when it shows nothing).
/// Windows: how far a taskbar docked at the top of this display (or another
/// app bar there) pushes the island down, read from the display's work area,
/// so the island sits under it (#956). An auto-hidden taskbar takes no work
/// area and moves nothing. Linux anchors the island to the screen edge: 0.
fn top_inset(m: &tauri::Monitor) -> i32 {
    if cfg!(windows) {
        top_inset_from(m.position().y, m.work_area().position.y)
    } else {
        0
    }
}

fn top_inset_from(monitor_y: i32, work_y: i32) -> i32 {
    let inset = work_y - monitor_y;
    if (0..200).contains(&inset) { inset } else { 0 }
}

pub fn apply_geometry(app: &AppHandle, pref: &str, collapsed: Option<(f64, f64)>) {
    let Some(win) = window(app) else { return };
    let Some(m) = target_monitor(app, pref) else { return };

    if let Some(corner_pos) = corner_mode(app) {
        apply_corner(&win, &m, corner_pos, collapsed.is_none());
        return;
    }

    let scale = m.scale_factor();
    let mp = *m.position();
    let ms = *m.size();

    let (lw, lh) = collapsed.map(clamp_collapsed).unwrap_or((PANEL_W, PANEL_H));
    let pw = (lw * scale).round().max(1.0) as u32;
    let ph = (lh * scale).round().max(1.0) as u32;
    let x = mp.x + (ms.width as i32 - pw as i32) / 2;
    let y = mp.y + top_inset(&m);

    // GTK never sizes a non-resizable window below its natural size (200 px
    // here), so on Linux the 6 px wake strip would stay a 200 px block. tao
    // re-applies the config's `resizable: false` after the first configure, so
    // this is asked every time, just before the resize. Undecorated, the window
    // still offers the user nothing to resize it by. (Found by @YossiYad, #44.)
    #[cfg(target_os = "linux")]
    let _ = win.set_resizable(true);
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let (lx, ly) = logical_origin(&m);
    platform::pin_to_monitor(&win, lx, ly);
    // Moving across displays can rescale the window: re-assert the physical size.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);

    // On Windows, moving across displays or waking from the strip can clamp or lag
    // the resize. If the physical inner size differs from what was requested, retry once.
    if let Ok(got) = win.inner_size() {
        if got.width != pw || got.height != ph {
            crate::log::line(format!(
                "window size mismatch: wanted {pw}x{ph}, got {}x{} (scale {scale}, monitor {}x{})",
                got.width, got.height, ms.width, ms.height
            ));
            let _ = win.set_size(PhysicalSize::new(pw, ph));
            let _ = win.set_position(PhysicalPosition::new(x, y));
        }
    }
}

/// In corner mode, where the user left the mascot (None: the default corner);
/// None outside corner mode.
pub fn corner_mode(app: &AppHandle) -> Option<Option<(f64, f64)>> {
    // Linux anchors the island with gtk-layer-shell, which can't place it in a corner.
    if !cfg!(windows) {
        return None;
    }
    let shared = app.try_state::<crate::Shared>()?;
    let settings = shared.settings.lock().unwrap();
    (settings.island_anchor == "corner").then(|| settings.corner_pos.map(|p| (p.x, p.y)))
}

/// Corner mode: the mascot alone, or the mascot and the panel beside it.
/// The page hears where each sits through `corner-layout`.
fn apply_corner(win: &WebviewWindow, m: &Monitor, corner_pos: Option<(f64, f64)>, open: bool) {
    // The screen the mascot was dropped on, whichever that is.
    let monitors = win.available_monitors().unwrap_or_default();
    let works: Vec<IslandRect> = monitors.iter().map(work_of).collect();
    let work = pick_work(&works, work_of(m), corner_pos);
    let scale = monitors
        .iter()
        .find(|other| work_of(other) == work)
        .map(|other| other.scale_factor())
        .unwrap_or_else(|| m.scale_factor());
    let minis = CORNER_MINIS.lock().unwrap().clone();
    let mascot_size = win
        .app_handle()
        .try_state::<crate::Shared>()
        .map(|shared| shared.settings.lock().unwrap().mascot_size)
        .unwrap_or(MASCOT_SIZE);
    let layout = corner_layout(
        work,
        scale,
        corner_pos,
        open.then_some((PANEL_W, PANEL_H)),
        &minis,
        CORNER_MINI_DRAG.load(Ordering::Relaxed),
        mascot_size,
        *CORNER_PANEL_ANCHOR.lock().unwrap(),
    );
    remember_mascot_offset(&layout, scale);
    let mut held_rects: Vec<IslandRect> = layout.panel.into_iter().collect();
    let mut group_rects = vec![layout.mascot];
    group_rects.extend(
        minis
            .iter()
            .zip(layout.minis.iter())
            .filter_map(|(slot, rect)| slot.at.is_none().then_some(*rect)),
    );
    held_rects.push(bounding(&group_rects));
    *CORNER_HELD_RECTS.lock().unwrap() = held_rects;
    let w = layout.window;
    let _ = win.set_size(PhysicalSize::new(w.w.round() as u32, w.h.round() as u32));
    let _ = win.set_position(PhysicalPosition::new(w.x.round() as i32, w.y.round() as i32));
    let _ = win.set_always_on_top(true);
    let _ = win.emit("corner-layout", layout);
}

/// A closed island never grows past the panel, and never shrinks below one
/// pixel (a zero-sized window can't be placed).
pub fn clamp_collapsed((w, h): (f64, f64)) -> (f64, f64) {
    let ok = |v: f64, max: f64| if v.is_finite() { v.clamp(1.0, max) } else { max };
    (ok(w, PANEL_W), ok(h, PANEL_H))
}

/// Position, size and scale of the monitor the island lives on. Any change here
/// means the island has to be placed again.
fn current_screen_key(app: &AppHandle) -> Option<(i32, i32, u32, u32, u64)> {
    let pref = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().screen.clone())
        .unwrap_or_else(|| "primary".into());
    let m = target_monitor(app, &pref)?;
    let p = m.position();
    let size = m.size();
    Some((p.x, p.y + top_inset(&m), size.width, size.height, m.scale_factor().to_bits()))
}

/// Emits `cursor` (window-logical coordinates) at ~60 Hz while the island is
/// visible. Parked on a condvar the rest of the time.
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    std::thread::spawn(move || {
        let mut was_down = false;
        // Remembered across wakes so a display change while hidden is noticed the
        // moment the island comes back.
        let mut last_screen: Option<(i32, i32, u32, u32, u64)> = None;
        // Without a cursor to read (Linux) the loop only watches the display
        // layout, and twice a second is plenty for that: waking at 60 Hz just to
        // find no cursor costs CPU for nothing.
        let (period, screen_every) = if platform::CURSOR_POLL { (16, 30) } else { (500, 1) };
        loop {
            // Parked. Folded on Windows, a glance at the cursor four times a
            // second: on the closed island, it is told to wake up, whether or
            // not the webview delivers the pointer to such a small window.
            //
            // A folded corner mascot also follows the cursor with its eyes: while
            // the cursor is near, it is read 30 times a second and the page hears
            // `mascot-cursor`; far away, back to four times a second.
            let mut wait = PARKED_WAIT_MS;
            let mut last_wake = Instant::now();
            let mut last_display = Instant::now();
            let mut gaze: Option<(f64, f64)> = None;
            loop {
                if gate.wait_active_for(Duration::from_millis(wait)) {
                    break;
                }
                wait = PARKED_WAIT_MS;
                let folded = platform::CURSOR_POLL && gate.collapsed.load(Ordering::Relaxed);
                if folded && last_wake.elapsed() >= Duration::from_millis(PARKED_WAIT_MS) {
                    last_wake = Instant::now();
                    wake_if_hovered(&app, &gate);
                }
                let corner = corner_mode(&app).is_some();
                if folded && corner {
                    if let Some(win) = window(&app) {
                        if let Some((x, y, size)) = cursor_in_window(&win) {
                            wait = gaze_wait_ms(x, y, size);
                            let near = wait == GAZE_NEAR_MS;
                            let moved = gaze.map_or(true, |(gx, gy)| (x - gx).abs() >= 1.0 || (y - gy).abs() >= 1.0);
                            // Near: every move. Leaving: once more, so the page sees it go.
                            if moved && (near || gaze.is_some()) {
                                let _ = win.emit("mascot-cursor", CursorPayload { x, y });
                            }
                            gaze = if near { Some((x, y)) } else { None };
                        }
                    }
                }
                // A corner mascot is folded nearly all the time: displays that
                // come and go are watched from here too, every 2 s.
                if corner && last_display.elapsed() >= Duration::from_secs(2) {
                    last_display = Instant::now();
                    let now = current_screen_key(&app);
                    if now.is_some() && now != last_screen {
                        let first = last_screen.is_none();
                        last_screen = now;
                        if !first {
                            crate::log::line("display layout changed (corner) — repositioning".to_string());
                            let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
                        }
                    }
                }
            }
            let mut last = (f64::MIN, f64::MIN);
            let mut ticks: u32 = 0;
            // The cursor was far at the last tick, and the page has been told.
            let mut far = false;
            while gate.is_active() {
                std::thread::sleep(Duration::from_millis(if far { FAR_PERIOD_MS } else { period }));
                if !gate.is_active() {
                    break;
                }

                // Monitors get plugged in, unplugged, rearranged and rescaled, and
                // an island pinned to coordinates that no longer exist is an island
                // nobody can reach. Checked about twice a second — the cursor poll
                // is already running, so this costs one monitor query.
                ticks = ticks.wrapping_add(1);
                if ticks % screen_every == 0 {
                    let now = current_screen_key(&app);
                    if now.is_some() && now != last_screen {
                        let first = last_screen.is_none();
                        last_screen = now;
                        if !first {
                            crate::log::line("display layout changed — repositioning".to_string());
                            let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
                        }
                    }
                }

                let Some(win) = window(&app) else { continue };
                let Ok(origin) = win.outer_position() else { continue };
                let scale = win.scale_factor().unwrap_or(1.0);
                let Some((cx, cy)) = cursor_physical() else { continue };
                let x = (cx - origin.x as f64) / scale;
                let y = (cy - origin.y as f64) / scale;
                let size = match win.inner_size() {
                    Ok(s) => (s.width as f64 / scale, s.height as f64 / scale),
                    Err(_) => (PANEL_W, PANEL_H),
                };
                if (x - last.0).abs() < 1.0 && (y - last.1).abs() < 1.0 {
                    continue;
                }
                last = (x, y);

                // Click-through: the window only takes the mouse over the island
                // shape. A small entry margin means the flag is already off by the
                // time a moving cursor reaches a button.
                // A file being dragged has to be able to find us. WS_EX_TRANSPARENT
                // — what click-through is on Windows — hides the window from
                // WindowFromPoint, so OLE finds no drop target and shows the "no
                // drop" cursor. macOS has no such problem: AppKit delivers drags to
                // registered destinations whatever ignoresMouseEvents says. While a
                // button is held, only the panel and the mascot queue stay drop
                // targets. A mini drag is the exception: its moving box keeps the
                // mouse across the work area.
                let down = left_button_down();
                if down && !was_down {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || platform::unblock_webview_drops(&handle));
                }
                was_down = down;

                let held_rects = if corner_mode(&app).is_some() {
                    CORNER_HELD_RECTS.lock().unwrap().clone()
                } else {
                    vec![IslandRect { x: 0.0, y: 0.0, w: size.0, h: size.1 }]
                };
                let mini_dragging = CORNER_MINI_DRAG.load(Ordering::Relaxed);
                let drawn = gate.rects.lock().unwrap();
                let accept = active_pointer_takes_mouse(
                    drawn.as_slice(),
                    &held_rects,
                    x,
                    y,
                    down,
                    mini_dragging,
                );
                drop(drawn);
                let dragging = down && (mini_dragging || hits(&held_rects, x, y));
                if gate.ignoring.load(Ordering::Relaxed) == accept {
                    // Under the gate's lock, and only while it is open: a tick
                    // still running as the island folds must not race the
                    // parked loop's click-through decision after the gate closes.
                    let active = gate.active.lock().unwrap();
                    if !*active {
                        break;
                    }
                    gate.ignoring.store(!accept, Ordering::Relaxed);
                    platform::set_click_through(&win, !accept);
                }

                // Far from the island: the page hears it once, then nothing.
                let near = dragging || is_near(x, y, size);
                if !near && far {
                    continue;
                }
                far = !near;
                let _ = win.emit("cursor", CursorPayload { x, y });
            }
        }
    });
}

/// Folded in a corner, only drawn rectangles take the mouse. The page hears
/// `closed-hover` only over the large mascot.
fn wake_if_hovered(app: &AppHandle, gate: &PollGate) {
    let Some(win) = window(app) else { return };
    let Some((x, y, size)) = cursor_in_window(&win) else { return };
    let pointer = if corner_mode(app).is_some() {
        folded_pointer(&gate.rects.lock().unwrap(), x, y)
    } else {
        let inside = x >= 0.0 && y >= 0.0 && x <= size.0 && y <= size.1 + 2.0;
        FoldedPointer { takes_mouse: inside, wakes: inside }
    };
    let ignore = !pointer.takes_mouse;
    if gate.ignoring.load(Ordering::Relaxed) != ignore {
        gate.ignoring.store(ignore, Ordering::Relaxed);
        platform::set_click_through(&win, ignore);
    }
    if pointer.wakes {
        let _ = win.emit("closed-hover", ());
    }
}

/// Re-applies click-through after the window or the island changed shape.
///
/// With the cursor poll (Windows) the window takes the mouse again and the next
/// tick decides from the cursor. Without it (Linux) the input region is set to
/// the island itself, or to the whole wake strip while collapsed.
pub fn refresh_click_through(app: &AppHandle, gate: &PollGate) {
    if platform::CURSOR_POLL {
        set_ignore_cursor(app, false);
        gate.forget_ignore_state();
        if gate.collapsed.load(Ordering::Relaxed) && corner_mode(app).is_some() {
            wake_if_hovered(app, gate);
        }
        return;
    }
    let Some(win) = window(app) else { return };
    let region = if gate.collapsed.load(Ordering::Relaxed) {
        // The closed island (or the wake strip) itself, never "the whole
        // window": if the window ever fails to shrink, the rest of it must not
        // swallow clicks meant for whatever sits under the top of the screen.
        let (w, h) = clamp_collapsed(*gate.collapsed_size.lock().unwrap());
        Some((0.0, 0.0, w, h))
    } else {
        // Linux takes one input region: the box around everything drawn.
        let r = bounding(&gate.rects.lock().unwrap());
        if r.w <= 0.0 {
            // Nothing drawn yet: nothing takes the mouse.
            Some((0.0, 0.0, 0.0, 0.0))
        } else {
            let x0 = (r.x - HIT_MARGIN).max(0.0);
            let y0 = (r.y - HIT_MARGIN).max(0.0);
            let x1 = r.x + r.w + HIT_MARGIN;
            let y1 = r.y + r.h + HIT_MARGIN;
            Some((x0, y0, x1 - x0, y1 - y0))
        }
    };
    platform::set_input_region(&win, region);
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    if let Some(win) = window(app) {
        platform::set_click_through(&win, ignore);
    }
}

#[cfg(test)]
mod corner_tests {
    use super::*;

    static MINI_DRAG_TEST: Mutex<()> = Mutex::new(());

    #[test]
    fn a_folded_mascot_watches_a_nearby_cursor_closely() {
        // A 200 x 200 window: its centre is (100, 100).
        assert_eq!(gaze_wait_ms(150.0, 120.0, (200.0, 200.0)), GAZE_NEAR_MS);
        assert_eq!(gaze_wait_ms(-500.0, 100.0, (200.0, 200.0)), GAZE_NEAR_MS);
        assert_eq!(gaze_wait_ms(-900.0, -400.0, (200.0, 200.0)), PARKED_WAIT_MS);
    }

    fn rect(x: f64, y: f64, w: f64, h: f64) -> IslandRect {
        IslandRect { x, y, w, h }
    }

    const WORK: IslandRect = IslandRect { x: 0.0, y: 0.0, w: 1920.0, h: 1040.0 };

    fn on_screen(window: IslandRect, item: IslandRect) -> IslandRect {
        rect(window.x + item.x, window.y + item.y, item.w, item.h)
    }

    fn on_screen_at_scale(window: IslandRect, item: IslandRect, scale: f64) -> IslandRect {
        rect(
            window.x + item.x * scale,
            window.y + item.y * scale,
            item.w * scale,
            item.h * scale,
        )
    }

    fn inside(outer: IslandRect, inner: IslandRect) -> bool {
        inner.x >= outer.x
            && inner.y >= outer.y
            && inner.x + inner.w <= outer.x + outer.w
            && inner.y + inner.h <= outer.y + outer.h
    }

    fn overlaps(a: IslandRect, b: IslandRect) -> bool {
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    }

    #[test]
    fn the_mascot_starts_bottom_right() {
        let layout = corner_layout(WORK, 1.0, None, None, &[], false, 240.0, None);
        assert_eq!(layout.window, rect(1664.0, 784.0, 240.0, 240.0));
        assert_eq!(layout.mascot, rect(0.0, 0.0, 240.0, 240.0));
        assert_eq!(layout.panel, None);
    }

    #[test]
    fn the_panel_opens_toward_the_centre() {
        let layout = corner_layout(WORK, 1.0, None, Some((720.0, 320.0)), &[], false, 240.0, None);
        assert_eq!(layout.window, rect(944.0, 704.0, 960.0, 320.0));
        assert_eq!(layout.panel, Some(rect(0.0, 0.0, 720.0, 320.0)));
        assert_eq!(layout.mascot, rect(720.0, 80.0, 240.0, 240.0));
        // The mascot has not moved on screen.
        assert_eq!((layout.window.x + layout.mascot.x, layout.window.y + layout.mascot.y), (1664.0, 784.0));
    }

    #[test]
    fn a_top_left_mascot_opens_right_and_down() {
        let layout = corner_layout(WORK, 1.0, Some((16.0, 16.0)), Some((720.0, 320.0)), &[], false, 240.0, None);
        assert_eq!(layout.window, rect(16.0, 16.0, 960.0, 320.0));
        assert_eq!(layout.mascot, rect(0.0, 0.0, 240.0, 240.0));
        assert_eq!(layout.panel, Some(rect(240.0, 0.0, 720.0, 320.0)));
    }

    #[test]
    fn the_panel_stays_on_screen() {
        let short = rect(0.0, 0.0, 1920.0, 360.0);
        let layout = corner_layout(short, 1.0, Some((1664.0, 70.0)), Some((720.0, 320.0)), &[], false, 240.0, None);
        // Upward would put the panel at y = -10: it comes down to the top of the work area.
        assert_eq!(layout.window.y, 0.0);
        assert_eq!(layout.panel.map(|p| p.y), Some(0.0));
        assert_eq!(layout.window.y + layout.mascot.y, 70.0);
    }

    #[test]
    fn a_lost_screen_sends_the_mascot_home() {
        let layout = corner_layout(WORK, 1.0, Some((5000.0, 5000.0)), None, &[], false, 240.0, None);
        assert_eq!(layout.window, rect(1664.0, 784.0, 240.0, 240.0));
    }

    #[test]
    fn scale_two_doubles_the_window() {
        let work = rect(0.0, 0.0, 3840.0, 2080.0);
        let layout = corner_layout(work, 2.0, None, None, &[], false, 240.0, None);
        assert_eq!(layout.window.w, 480.0);
        assert_eq!(layout.mascot.w, 240.0);
        assert_eq!(layout.window.x, 3840.0 - 32.0 - 480.0);
    }

    #[test]
    fn a_mascot_over_the_edge_is_pulled_back_in() {
        let layout = corner_layout(WORK, 1.0, Some((1800.0, 900.0)), None, &[], false, 240.0, None);
        assert_eq!(layout.window, rect(1680.0, 800.0, 240.0, 240.0));
    }

    #[test]
    fn a_smaller_big_mascot_keeps_its_top_left() {
        let layout = corner_layout(
            WORK,
            1.0,
            Some((1000.0, 500.0)),
            None,
            &[],
            false,
            160.0,
            None,
        );

        assert_eq!(on_screen(layout.window, layout.mascot), rect(1000.0, 500.0, 160.0, 160.0));
    }

    #[test]
    fn a_smaller_big_mascot_at_home_sits_in_the_corner() {
        let layout = corner_layout(WORK, 1.0, None, None, &[], false, 160.0, None);

        assert_eq!(on_screen(layout.window, layout.mascot), rect(1744.0, 864.0, 160.0, 160.0));
    }

    #[test]
    fn minis_line_up_toward_the_centre() {
        let layout = corner_layout(WORK, 1.0, None, None, &[MiniSlot { size: 120.0, at: None }; 3], false, 240.0, None);
        assert_eq!(layout.window, rect(1280.0, 784.0, 624.0, 240.0));
        assert_eq!(layout.mascot, rect(384.0, 0.0, 240.0, 240.0));
        assert_eq!(
            layout.minis,
            vec![
                rect(256.0, 120.0, 120.0, 120.0),
                rect(128.0, 120.0, 120.0, 120.0),
                rect(0.0, 120.0, 120.0, 120.0),
            ]
        );
    }

    #[test]
    fn minis_wrap_on_a_narrow_screen() {
        let work = rect(0.0, 0.0, 800.0, 600.0);
        let layout = corner_layout(work, 1.0, None, None, &[MiniSlot { size: 120.0, at: None }; 6], false, 240.0, None);
        let mascot = on_screen(layout.window, layout.mascot);
        let mut rows = Vec::new();

        assert_eq!(layout.minis.len(), 6);
        for &mini in &layout.minis {
            let mini = on_screen(layout.window, mini);
            assert!(inside(work, mini));
            assert!(!overlaps(mini, mascot));
            if !rows.contains(&mini.y) {
                rows.push(mini.y);
            }
        }
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn the_panel_opens_beside_the_minis_not_over_them() {
        let layout = corner_layout(
            WORK,
            1.0,
            None,
            Some((720.0, 320.0)),
            &[MiniSlot { size: 120.0, at: None }; 3],
            false,
            240.0,
            None,
        );
        let mascot = on_screen(layout.window, layout.mascot);
        let panel = on_screen(layout.window, layout.panel.unwrap());

        assert_eq!(layout.minis.len(), 3);
        assert!(inside(WORK, panel));
        assert!(!overlaps(panel, mascot));
        for &mini in &layout.minis {
            assert!(!overlaps(panel, on_screen(layout.window, mini)));
        }
        assert_eq!(layout.window.x + layout.mascot.x, 1664.0);
        assert_eq!(layout.window.y + layout.mascot.y, 784.0);
    }

    #[test]
    fn a_subagent_card_opens_above_the_line_centred_on_its_mascot() {
        let anchor = rect(1280.0, 904.0, 120.0, 120.0);
        let layout = corner_layout(
            WORK,
            1.0,
            None,
            Some((720.0, 320.0)),
            &[MiniSlot { size: 120.0, at: None }; 3],
            false,
            240.0,
            Some(anchor),
        );

        assert_eq!(on_screen(layout.window, layout.panel.unwrap()), rect(980.0, 456.0, 720.0, 320.0));
        assert_eq!(on_screen(layout.window, layout.mascot), rect(1664.0, 784.0, 240.0, 240.0));
        assert_eq!(on_screen(layout.window, layout.minis[2]), anchor);
    }

    #[test]
    fn a_subagent_card_opens_below_a_placed_mascot_near_the_top() {
        let anchor = rect(100.0, 100.0, 120.0, 120.0);
        let layout = corner_layout(
            WORK,
            1.0,
            None,
            Some((720.0, 320.0)),
            &[MiniSlot { size: 120.0, at: Some((100.0, 100.0)) }],
            false,
            240.0,
            Some(anchor),
        );

        assert_eq!(on_screen(layout.window, layout.panel.unwrap()), rect(0.0, 228.0, 720.0, 320.0));
        assert_eq!(on_screen(layout.window, layout.mascot), rect(1664.0, 784.0, 240.0, 240.0));
        assert_eq!(on_screen(layout.window, layout.minis[0]), anchor);
    }

    #[test]
    fn twenty_agents_still_fit_a_small_screen() {
        let work = rect(0.0, 0.0, 1366.0, 728.0);
        let layout = corner_layout(
            work,
            1.0,
            None,
            Some((720.0, 320.0)),
            &[MiniSlot { size: 120.0, at: None }; 9],
            false,
            240.0,
            None,
        );

        assert_eq!(layout.minis.len(), 9);
        assert!(inside(work, layout.window));
        assert!(inside(work, on_screen(layout.window, layout.mascot)));
        assert!(inside(work, on_screen(layout.window, layout.panel.unwrap())));
        for &mini in &layout.minis {
            assert!(inside(work, on_screen(layout.window, mini)));
        }
    }

    #[test]
    fn dragging_a_group_keeps_the_mascot_in_place() {
        let scale = 1.5;
        let work = rect(0.0, 0.0, 2880.0, 1560.0);
        let before = corner_layout(work, scale, None, None, &[MiniSlot { size: 120.0, at: None }; 3], false, 240.0, None);
        remember_mascot_offset(&before, scale);
        let saved = dragged_mascot_at((before.window.x, before.window.y));
        let after = corner_layout(
            work,
            scale,
            Some(saved),
            None,
            &[MiniSlot { size: 120.0, at: None }; 3],
            false,
            240.0,
            None,
        );

        assert_eq!(
            on_screen_at_scale(before.window, before.mascot, scale),
            on_screen_at_scale(after.window, after.mascot, scale),
        );
    }

    #[test]
    fn folded_pointer_only_wakes_on_the_large_mascot() {
        let rects = [rect(300.0, 0.0, 240.0, 240.0), rect(0.0, 120.0, 120.0, 120.0)];

        assert_eq!(
            folded_pointer(&rects, 60.0, 180.0),
            FoldedPointer { takes_mouse: true, wakes: false },
        );
        assert_eq!(
            folded_pointer(&rects, 200.0, 180.0),
            FoldedPointer { takes_mouse: false, wakes: false },
        );
        assert_eq!(
            folded_pointer(&rects, 420.0, 120.0),
            FoldedPointer { takes_mouse: true, wakes: true },
        );
    }

    #[test]
    fn nine_minis_fit_when_the_mascot_is_near_the_horizontal_centre() {
        let work = rect(0.0, 0.0, 1280.0, 728.0);
        let scale = 1.5;
        let layout = corner_layout(
            work,
            scale,
            Some((460.0, 344.0)),
            None,
            &[MiniSlot { size: 120.0, at: None }; 9],
            false,
            240.0,
            None,
        );

        assert!(inside(work, layout.window));
        assert!(inside(work, on_screen_at_scale(layout.window, layout.mascot, scale)));
        for &mini in &layout.minis {
            assert!(inside(work, on_screen_at_scale(layout.window, mini, scale)));
        }
    }

    #[test]
    fn a_middle_panel_falls_beside_the_mascot() {
        let work = rect(0.0, 0.0, 1366.0, 728.0);
        let layout = corner_layout(
            work,
            1.0,
            Some((1110.0, 260.0)),
            Some((720.0, 320.0)),
            &[MiniSlot { size: 120.0, at: None }],
            false,
            240.0,
            None,
        );
        let mascot = on_screen(layout.window, layout.mascot);
        let panel = on_screen(layout.window, layout.panel.unwrap());

        assert!(inside(work, panel));
        assert!(!overlaps(panel, mascot));
        for &mini in &layout.minis {
            assert!(!overlaps(panel, on_screen(layout.window, mini)));
        }
    }

    #[test]
    fn mixed_sizes_line_up_bottom_aligned() {
        let layout = corner_layout(
            WORK,
            1.0,
            None,
            None,
            &[
                MiniSlot { size: 120.0, at: None },
                MiniSlot { size: 90.0, at: None },
            ],
            false,
            240.0,
            None,
        );
        let bottoms: Vec<f64> = layout
            .minis
            .iter()
            .map(|&mini| {
                let mini = on_screen(layout.window, mini);
                mini.y + mini.h
            })
            .collect();

        assert_eq!(bottoms, vec![1024.0, 1024.0]);
    }

    #[test]
    fn a_placed_mini_sets_the_window_bounds() {
        let layout = corner_layout(
            WORK,
            1.0,
            None,
            None,
            &[MiniSlot { size: 120.0, at: Some((16.0, 16.0)) }],
            false,
            240.0,
            None,
        );

        assert_eq!(layout.window, rect(16.0, 16.0, 1888.0, 1008.0));
        assert_eq!(on_screen(layout.window, layout.mascot), rect(1664.0, 784.0, 240.0, 240.0));
    }

    #[test]
    fn a_mini_placed_off_screen_comes_back() {
        let layout = corner_layout(
            WORK,
            1.0,
            None,
            None,
            &[MiniSlot { size: 120.0, at: Some((5000.0, 5000.0)) }],
            false,
            240.0,
            None,
        );

        assert!(inside(WORK, on_screen(layout.window, layout.minis[0])));
    }

    #[test]
    fn dragging_covers_the_work_area() {
        let layout = corner_layout(
            WORK,
            1.0,
            None,
            None,
            &[MiniSlot { size: 120.0, at: None }],
            true,
            240.0,
            None,
        );

        assert_eq!(layout.window, WORK);
    }

    #[test]
    fn the_mascot_keeps_its_own_screen() {
        let left = rect(-1920.0, 0.0, 1920.0, 1040.0);
        assert_eq!(pick_work(&[WORK, left], WORK, Some((-600.0, 300.0))), left);
        assert_eq!(pick_work(&[WORK, left], WORK, Some((5000.0, 5000.0))), WORK);
        assert_eq!(pick_work(&[WORK, left], WORK, None), WORK);
    }

    #[test]
    fn a_click_between_mascot_and_panel_goes_through() {
        let rects = [rect(720.0, 120.0, 200.0, 200.0), rect(0.0, 0.0, 720.0, 320.0)];
        assert!(!hits(&rects, 850.0, 40.0), "the empty corner above the mascot");
        assert!(hits(&rects, 800.0, 200.0), "on the mascot");
        assert!(hits(&rects, 300.0, 100.0), "on the panel");
        assert!(!hits(&[], 10.0, 10.0), "nothing drawn yet");
    }

    #[test]
    fn replacing_minis_ends_a_drag() {
        let _guard = MINI_DRAG_TEST.lock().unwrap();
        CORNER_MINI_DRAG.store(true, Ordering::Relaxed);

        replace_corner_minis(Vec::new(), false);

        assert!(!CORNER_MINI_DRAG.load(Ordering::Relaxed));
    }

    #[test]
    fn replacing_minis_preserves_a_reported_drag() {
        let _guard = MINI_DRAG_TEST.lock().unwrap();
        CORNER_MINI_DRAG.store(true, Ordering::Relaxed);

        replace_corner_minis(Vec::new(), true);

        assert!(CORNER_MINI_DRAG.load(Ordering::Relaxed));
        CORNER_MINI_DRAG.store(false, Ordering::Relaxed);
    }

    #[test]
    fn a_dragged_mini_keeps_the_mouse() {
        assert!(active_pointer_takes_mouse(&[], &[], 900.0, 500.0, true, true));
    }

    #[test]
    fn two_placed_minis_at_the_left_edge_stay_distinct() {
        let layout = corner_layout(
            WORK,
            1.0,
            None,
            None,
            &[
                MiniSlot { size: 120.0, at: Some((0.0, 200.0)) },
                MiniSlot { size: 120.0, at: Some((-60.0, 200.0)) },
            ],
            false,
            240.0,
            None,
        );
        let first = on_screen(layout.window, layout.minis[0]);
        let second = on_screen(layout.window, layout.minis[1]);

        assert_ne!(first, second);
        assert!(inside(WORK, first));
        assert!(inside(WORK, second));
    }

    #[test]
    fn a_held_file_outside_the_panel_and_queue_passes_through() {
        let held = [
            rect(0.0, 0.0, 720.0, 320.0),
            rect(900.0, 400.0, 500.0, 240.0),
        ];

        assert!(active_pointer_takes_mouse(&[], &held, 200.0, 100.0, true, false));
        assert!(active_pointer_takes_mouse(&[], &held, 1000.0, 500.0, true, false));
        assert!(!active_pointer_takes_mouse(&[], &held, 800.0, 700.0, true, false));
    }
}
