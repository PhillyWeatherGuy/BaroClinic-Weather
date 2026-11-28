// js/layers/drawOverlay.js
import { stateManager } from '../core/stateManager.js';

const PRESET_COLORS = [
    { hex: '#0f172a', label: 'Navy' },
    { hex: '#ffffff', label: 'White' },
    { hex: '#dc2626', label: 'Red' },
    { hex: '#2563eb', label: 'Blue' },
    { hex: '#ea580c', label: 'Orange' },
    { hex: '#7c3aed', label: 'Purple' }
];

const WIDTH_PRESETS = [
    { id: 'thin', label: 'Thin', px: 2 },
    { id: 'med', label: 'Medium', px: 5 },
    { id: 'thick', label: 'Thick', px: 10 }
];

const FRONT_TYPES = [
    { id: 'cold', label: 'Cold' },
    { id: 'warm', label: 'Warm' },
    { id: 'stationary', label: 'Stationary' },
    { id: 'occluded', label: 'Occluded' },
    { id: 'trough', label: 'Trough' },
    { id: 'dryline', label: 'Dryline' }
];

const FADE_DIRS = ['middle', 'top', 'bottom', 'left', 'right'];

const TEXT_FONTS = [
    { label: 'Roboto', value: "'Roboto', sans-serif" },
    { label: 'Inter', value: "'Inter', sans-serif" },
    { label: 'Montserrat', value: "'Montserrat', sans-serif" },
    { label: 'Oswald', value: "'Oswald', sans-serif" },
    { label: 'Bebas Neue', value: "'Bebas Neue', Impact, sans-serif" },
    { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
    { label: 'Georgia', value: "Georgia, serif" }
];

const TEXT_EFFECTS = [
    { id: 'none', label: 'None' },
    { id: 'drop', label: 'Drop' },
    { id: 'outline', label: 'Outline' },
    { id: 'glow', label: 'Glow' },
    { id: 'neon', label: 'Neon' },
    { id: 'hollow', label: 'Hollow' },
    { id: 'echo', label: 'Echo' }
];

let mapRef = null;
let canvasEl = null;
let ctx = null;
let scratchCanvas = null;
let scratchCtx = null;
let uiWrap = null;
let optionsStripEl = null;
let toolbarEl = null;
let inlineTextInput = null;

let drawModeActive = false;
let activeTool = 'pen';
let activeColor = '#2563eb';
let activeWidth = 5;
let widthPresetId = 'med';
let customWidthOpen = false;

// Tool-specific options
let frontType = 'cold';
let frontFlip = 1;
let strokeStyle = 'solid'; // 'solid' | 'dashed' | 'dotted'
let strokeSmoothing = 45;  // 0 - 100
let shapeType = 'rect';    // 'rect' | 'circle' | 'triangle'
let shapeFill = false;

// Universal Opacity & Multi-Direction Fade
let activeOpacity = 1.0;
let hlOpacity = 0.45;
let activeFadeDirs = [];   // e.g. ['top', 'left'] or ['middle']
let activeFadeSpeed = 0.55;
let fadePanelOpen = false;

let textFont = "'Roboto', sans-serif";
let textSize = 20;
let textLabelBox = false;
let textEffect = 'none';
let effectsMenuOpen = false;

// Vector scene & history
let objects = [];
let selectedObjId = null;
let objCounter = 0;
let undoStack = [];
let redoStack = [];
let activeDraft = null;
let interaction = null;

function getCssZoomFactor() {
    if (canvasEl && typeof canvasEl.currentCSSZoom === 'number' && canvasEl.currentCSSZoom > 0) {
        return canvasEl.currentCSSZoom;
    }
    const htmlZ = parseFloat(getComputedStyle(document.documentElement).zoom);
    const bodyZ = parseFloat(getComputedStyle(document.body).zoom);
    const z = (Number.isFinite(htmlZ) && htmlZ > 0 ? htmlZ : 1) *
              (Number.isFinite(bodyZ) && bodyZ > 0 ? bodyZ : 1);
    return z > 0 ? z : 1;
}

function getViewportSize() {
    const z = getCssZoomFactor();
    return {
        w: Math.max(1, Math.round(canvasEl?.clientWidth || (window.innerWidth / z))),
        h: Math.max(1, Math.round(canvasEl?.clientHeight || (window.innerHeight / z)))
    };
}

function pushUndoSnapshot() {
    undoStack.push(JSON.stringify(objects));
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    syncActionButtons();
}

function undoDraw() {
    if (undoStack.length <= 1) return;
    const current = undoStack.pop();
    redoStack.push(current);
    objects = JSON.parse(undoStack[undoStack.length - 1]);
    selectedObjId = null;
    redrawAll();
    syncActionButtons();
    renderOptionsStrip();
}

function redoDraw() {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    undoStack.push(next);
    objects = JSON.parse(next);
    selectedObjId = null;
    redrawAll();
    syncActionButtons();
    renderOptionsStrip();
}

function clearAllDrawings() {
    if (objects.length === 0) return;
    objects = [];
    selectedObjId = null;
    pushUndoSnapshot();
    redrawAll();
    renderOptionsStrip();
}

function freezeMap(freeze) {
    if (!mapRef) return;
    const handlers = ['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard'];
    handlers.forEach((key) => {
        const h = mapRef[key];
        if (!h) return;
        try {
            if (freeze) h.disable();
            else h.enable();
        } catch (e) {}
    });
}

export function isDrawModeActive() {
    return drawModeActive;
}

export function toggleDrawMode(forceState = null) {
    const next = forceState !== null ? Boolean(forceState) : !drawModeActive;
    if (next === drawModeActive) return;

    drawModeActive = next;
    document.body.classList.toggle('draw-mode-active', drawModeActive);
    freezeMap(drawModeActive);

    const railBtn = document.getElementById('btn-draw-mode');
    if (railBtn) {
        railBtn.classList.toggle('active', drawModeActive);
        railBtn.setAttribute('aria-expanded', String(drawModeActive));
    }

    if (canvasEl) {
        canvasEl.style.pointerEvents = drawModeActive ? 'auto' : 'none';
    }
    if (uiWrap) {
        uiWrap.style.display = drawModeActive ? 'flex' : 'none';
    }

    if (!drawModeActive) {
        closeInlineTextInput(true);
        selectedObjId = null;
        effectsMenuOpen = false;
        customWidthOpen = false;
        fadePanelOpen = false;
    } else {
        const basemapPanel = document.getElementById('basemap-editor-panel');
        if (basemapPanel?.classList.contains('open')) {
            document.getElementById('btn-close-basemap-editor')?.click();
        }
        renderToolbar();
        renderOptionsStrip();
    }

    redrawAll();
}

/* =========================================================================
   GEOMETRY HELPERS, SMOOTHING & MAC-STYLE SHIFT SHAPE SNAP
   ========================================================================= */

function smoothPoints(pts, amountPct) {
    if (!pts || pts.length < 3 || amountPct <= 0) return pts;
    const passes = amountPct >= 75 ? 3 : (amountPct >= 35 ? 2 : 1);
    let curr = pts.map((p) => ({ x: p.x, y: p.y }));
    for (let pass = 0; pass < passes; pass++) {
        const next = [curr[0]];
        for (let i = 0; i < curr.length - 1; i++) {
            const p0 = curr[i];
            const p1 = curr[i + 1];
            next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
            next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
        }
        next.push(curr[curr.length - 1]);
        curr = next;
    }
    return curr;
}

function simplifyRDP(pts, eps) {
    if (pts.length <= 2) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let maxD = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const d = len < 1e-4
            ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y)
            : Math.abs((b.y - a.y) * pts[i].x - (b.x - a.x) * pts[i].y + b.x * a.y - b.y * a.x) / len;
        if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) {
        const left = simplifyRDP(pts.slice(0, idx + 1), eps);
        const right = simplifyRDP(pts.slice(idx), eps);
        return left.slice(0, -1).concat(right);
    }
    return [a, b];
}

function snapFreehandStroke(pts, isClosedLoop = false) {
    if (!pts || pts.length < 3) return pts;

    let pathLen = 0;
    for (let i = 1; i < pts.length; i++) {
        pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (pathLen < 12) return pts;

    const A = pts[0];
    const B = pts[pts.length - 1];
    const chord = Math.hypot(B.x - A.x, B.y - A.y);

    // 1. Closed Loop -> Smooth Ellipse (great for closed lows, area circles, loops)
    if ((isClosedLoop || chord < pathLen * 0.22) && pts.length >= 8) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach((p) => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        });
        const rx = (maxX - minX) / 2;
        const ry = (maxY - minY) / 2;
        if (rx > 8 && ry > 8) {
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const out = [];
            const steps = 48;
            for (let i = 0; i <= steps; i++) {
                const th = (i / steps) * Math.PI * 2;
                out.push({ x: cx + rx * Math.cos(th), y: cy + ry * Math.sin(th) });
            }
            return out;
        }
    }

    // 2. Straight Line Check -> Crisp straight line A -> B
    let maxDev = 0;
    let peakPt = pts[Math.floor(pts.length / 2)];
    for (let i = 1; i < pts.length - 1; i++) {
        const d = chord < 1e-4
            ? Math.hypot(pts[i].x - A.x, pts[i].y - A.y)
            : Math.abs((B.y - A.y) * pts[i].x - (B.x - A.x) * pts[i].y + B.x * A.y - B.y * A.x) / chord;
        if (d > maxDev) {
            maxDev = d;
            peakPt = pts[i];
        }
    }

    if (chord > 10 && maxDev / chord < 0.085) {
        const steps = Math.max(8, Math.ceil(chord / 18));
        const out = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            out.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
        }
        return out;
    }

    // 3. Single Smooth Arc / Trough / Ridge Check -> Quadratic Bezier through peak!
    const ctrlX = 2 * peakPt.x - 0.5 * (A.x + B.x);
    const ctrlY = 2 * peakPt.y - 0.5 * (A.y + B.y);
    const bezPts = [];
    const steps = 44;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        bezPts.push({
            x: u * u * A.x + 2 * u * t * ctrlX + t * t * B.x,
            y: u * u * A.y + 2 * u * t * ctrlY + t * t * B.y
        });
    }

    let sumErr = 0;
    for (let i = 0; i < pts.length; i++) {
        let best = Infinity;
        for (let j = 0; j < bezPts.length; j++) {
            const d = Math.hypot(pts[i].x - bezPts[j].x, pts[i].y - bezPts[j].y);
            if (d < best) best = d;
        }
        sumErr += best;
    }
    const avgErr = sumErr / pts.length;
    if (avgErr < Math.max(14, pathLen * 0.045)) {
        return bezPts;
    }

    // 4. Multi-Inflection Wave / S-Curve -> Simplified smooth Chaikin spline
    const keyPts = simplifyRDP(pts, Math.max(10, pathLen * 0.028));
    return smoothPoints(keyPts, 100);
}

function resamplePolyline(pts, spacing) {
    if (!pts || pts.length < 2) return pts || [];
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        let p0 = pts[i - 1];
        const p1 = pts[i];
        let segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (segLen < 0.001) continue;
        while (acc + segLen >= spacing) {
            const t = (spacing - acc) / segLen;
            const nx = p0.x + (p1.x - p0.x) * t;
            const ny = p0.y + (p1.y - p0.y) * t;
            const np = { x: nx, y: ny };
            out.push(np);
            p0 = np;
            segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            acc = 0;
        }
        acc += segLen;
    }
    return out;
}

function getObjectBounds(obj) {
    if (!obj) return null;
    if (obj.type === 'pen' || obj.type === 'highlighter' || obj.type === 'front' || obj.type === 'area') {
        const pts = obj.points || [];
        if (pts.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach((p) => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        });
        const pad = Math.max(8, (obj.width || 4) / 2 + (obj.type === 'front' ? 14 : 4));
        return { x: minX - pad, y: minY - pad, w: Math.max(20, maxX - minX + pad * 2), h: Math.max(20, maxY - minY + pad * 2) };
    }
    if (obj.type === 'line' || obj.type === 'arrow') {
        const minX = Math.min(obj.x1, obj.x2);
        const minY = Math.min(obj.y1, obj.y2);
        const maxX = Math.max(obj.x1, obj.x2);
        const maxY = Math.max(obj.y1, obj.y2);
        const pad = Math.max(10, (obj.width || 4) / 2 + 8);
        return { x: minX - pad, y: minY - pad, w: Math.max(20, maxX - minX + pad * 2), h: Math.max(20, maxY - minY + pad * 2) };
    }
    if (obj.type === 'shape') {
        const pad = Math.max(4, (obj.width || 4) / 2);
        return {
            x: Math.min(obj.x, obj.x + obj.w) - pad,
            y: Math.min(obj.y, obj.y + obj.h) - pad,
            w: Math.max(12, Math.abs(obj.w)) + pad * 2,
            h: Math.max(12, Math.abs(obj.h)) + pad * 2
        };
    }
    if (obj.type === 'stamp') {
        const s = Math.max(26, obj.size || 40);
        return { x: obj.x - s * 0.6, y: obj.y - s * 0.6, w: s * 1.2, h: s * 1.2 };
    }
    if (obj.type === 'text') {
        const fs = obj.fontSize || 20;
        const lines = String(obj.text || 'Text').split('\n');
        let maxW = 40;
        if (ctx) {
            ctx.save();
            ctx.font = `700 ${fs}px ${obj.fontFamily || "'Roboto', sans-serif"}`;
            lines.forEach((line) => {
                maxW = Math.max(maxW, ctx.measureText(line).width);
            });
            ctx.restore();
        }
        const padX = obj.labelBox ? 12 : 6;
        const padY = obj.labelBox ? 8 : 4;
        const h = lines.length * fs * 1.22 + padY * 2;
        return { x: obj.x - padX, y: obj.y - padY, w: maxW + padX * 2, h };
    }
    return null;
}

function hitTestObject(obj, px, py) {
    const b = getObjectBounds(obj);
    if (!b) return false;
    return px >= b.x - 6 && px <= b.x + b.w + 6 && py >= b.y - 6 && py <= b.y + b.h + 6;
}

function moveObject(obj, dx, dy) {
    if (obj.points) {
        obj.points.forEach((p) => { p.x += dx; p.y += dy; });
    } else if (obj.type === 'line' || obj.type === 'arrow') {
        obj.x1 += dx; obj.y1 += dy;
        obj.x2 += dx; obj.y2 += dy;
    } else {
        obj.x += dx; obj.y += dy;
    }
}

function scaleObject(obj, origBounds, nextBounds) {
    const sx = nextBounds.w / Math.max(1, origBounds.w);
    const sy = nextBounds.h / Math.max(1, origBounds.h);
    if (obj.points) {
        obj.points.forEach((p) => {
            p.x = nextBounds.x + (p.x - origBounds.x) * sx;
            p.y = nextBounds.y + (p.y - origBounds.y) * sy;
        });
    } else if (obj.type === 'line' || obj.type === 'arrow') {
        obj.x1 = nextBounds.x + (obj.x1 - origBounds.x) * sx;
        obj.y1 = nextBounds.y + (obj.y1 - origBounds.y) * sy;
        obj.x2 = nextBounds.x + (obj.x2 - origBounds.x) * sx;
        obj.y2 = nextBounds.y + (obj.y2 - origBounds.y) * sy;
    } else if (obj.type === 'shape') {
        const pad = Math.max(4, (obj.width || 4) / 2);
        obj.x = nextBounds.x + pad;
        obj.y = nextBounds.y + pad;
        obj.w = Math.max(8, nextBounds.w - pad * 2);
        obj.h = Math.max(8, nextBounds.h - pad * 2);
    } else if (obj.type === 'stamp') {
        const avgScale = (sx + sy) * 0.5;
        obj.size = Math.max(18, Math.min(220, Math.round((obj.origSize || obj.size) * avgScale)));
        obj.x = nextBounds.x + nextBounds.w / 2;
        obj.y = nextBounds.y + nextBounds.h / 2;
    } else if (obj.type === 'text') {
        obj.x = nextBounds.x + (obj.labelBox ? 12 : 6);
        obj.y = nextBounds.y + (obj.labelBox ? 8 : 4);
        obj.fontSize = Math.max(10, Math.min(140, Math.round((obj.origFontSize || obj.fontSize) * sy)));
    }
}

/* =========================================================================
   UNIVERSAL RENDERING (Supports Multi-Direction Fade & Opacity on ANY Object)
   ========================================================================= */

function applyDashPattern(c, style, width) {
    if (style === 'dashed') c.setLineDash([Math.max(8, width * 2.6), Math.max(5, width * 1.6)]);
    else if (style === 'dotted') c.setLineDash([Math.max(1.5, width * 0.6), Math.max(4, width * 1.8)]);
    else c.setLineDash([]);
}

function drawPolylinePath(c, pts) {
    if (!pts || pts.length < 2) return;
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        c.lineTo(pts[i].x, pts[i].y);
    }
}

function drawWeatherFront(c, obj) {
    const pts = obj.points || [];
    if (pts.length < 2) return;

    const w = Math.max(2, obj.width || 4);
    const fType = obj.frontType || 'cold';
    const flip = obj.flipSide || 1;
    const symSize = Math.max(9, Math.min(26, w * 2.3 + 5));
    const step = Math.max(26, symSize * 2.2);

    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';

    if (fType === 'trough') {
        c.strokeStyle = '#b45309';
        c.lineWidth = w;
        c.setLineDash([Math.max(8, w * 2.5), Math.max(6, w * 1.8)]);
        drawPolylinePath(c, pts);
        c.stroke();
        c.restore();
        return;
    }

    if (fType === 'stationary') {
        const segs = resamplePolyline(pts, step);
        c.lineWidth = w;
        for (let i = 0; i < segs.length - 1; i++) {
            const isCold = i % 2 === 0;
            c.strokeStyle = isCold ? '#2563eb' : '#dc2626';
            c.beginPath();
            c.moveTo(segs[i].x, segs[i].y);
            c.lineTo(segs[i + 1].x, segs[i + 1].y);
            c.stroke();
        }
    } else {
        const lineCol = fType === 'cold' ? '#2563eb'
            : fType === 'warm' ? '#dc2626'
            : fType === 'occluded' ? '#7c3aed'
            : '#b45309';
        c.strokeStyle = lineCol;
        c.lineWidth = w;
        c.setLineDash([]);
        drawPolylinePath(c, pts);
        c.stroke();
    }

    const samples = resamplePolyline(pts, step);
    for (let i = 0; i < samples.length - 1; i++) {
        const p0 = samples[i];
        const p1 = samples[i + 1];
        const mx = (p0.x + p1.x) * 0.5;
        const my = (p0.y + p1.y) * 0.5;
        const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);

        c.save();
        c.translate(mx, my);
        c.rotate(ang);

        const drawTriangle = (color, dir) => {
            c.fillStyle = color;
            c.beginPath();
            c.moveTo(-symSize * 0.48, 0);
            c.lineTo(symSize * 0.48, 0);
            c.lineTo(0, -symSize * 0.92 * dir);
            c.closePath();
            c.fill();
        };

        const drawSemiCircle = (color, dir, openOnly = false) => {
            c.beginPath();
            if (dir > 0) c.arc(0, 0, symSize * 0.45, Math.PI, 0, false);
            else c.arc(0, 0, symSize * 0.45, 0, Math.PI, false);
            if (openOnly) {
                c.strokeStyle = color;
                c.lineWidth = Math.max(1.8, w * 0.75);
                c.stroke();
            } else {
                c.closePath();
                c.fillStyle = color;
                c.fill();
            }
        };

        if (fType === 'cold') {
            drawTriangle('#2563eb', flip);
        } else if (fType === 'warm') {
            drawSemiCircle('#dc2626', flip, false);
        } else if (fType === 'stationary') {
            if (i % 2 === 0) drawTriangle('#2563eb', flip);
            else drawSemiCircle('#dc2626', -flip, false);
        } else if (fType === 'occluded') {
            if (i % 2 === 0) drawTriangle('#7c3aed', flip);
            else drawSemiCircle('#7c3aed', flip, false);
        } else if (fType === 'dryline') {
            drawSemiCircle('#b45309', flip, true);
        }

        c.restore();
    }

    c.restore();
}

function drawHatchedArea(c, obj) {
    const pts = obj.points || [];
    if (pts.length < 3) return;
    const b = getObjectBounds(obj);
    if (!b) return;

    c.save();
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    c.closePath();

    c.save();
    c.clip();
    c.globalAlpha = 0.14;
    c.fillStyle = obj.color;
    c.fillRect(b.x, b.y, b.w, b.h);

    c.globalAlpha = 0.8;
    c.strokeStyle = obj.color;
    c.lineWidth = Math.max(1.2, (obj.width || 3) * 0.45);
    const gap = Math.max(9, (obj.width || 3) * 2.2);
    const diag = b.w + b.h;
    c.beginPath();
    for (let d = -diag; d < diag * 2; d += gap) {
        c.moveTo(b.x + d, b.y);
        c.lineTo(b.x + d - b.h, b.y + b.h);
    }
    c.stroke();
    c.restore();

    c.strokeStyle = obj.color;
    c.lineWidth = Math.max(1.8, (obj.width || 3) * 0.7);
    c.lineJoin = 'round';
    c.stroke();
    c.restore();
}

function drawTextObject(c, obj) {
    const fs = obj.fontSize || 20;
    const font = `700 ${fs}px ${obj.fontFamily || "'Roboto', sans-serif"}`;
    const lines = String(obj.text || 'Text').split('\n');
    const lineH = fs * 1.22;

    c.save();
    c.font = font;
    c.textBaseline = 'top';

    let maxW = 20;
    lines.forEach((l) => { maxW = Math.max(maxW, c.measureText(l).width); });

    if (obj.labelBox) {
        const padX = 10;
        const padY = 6;
        const boxH = lines.length * lineH + padY * 2;
        const isDarkText = ['#0f172a', '#000000', '#111827'].includes((obj.color || '').toLowerCase());
        c.fillStyle = isDarkText ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)';
        c.strokeStyle = obj.color || '#ffffff';
        c.lineWidth = 1.5;
        c.beginPath();
        c.roundRect(obj.x - padX, obj.y - padY, maxW + padX * 2, boxH, 6);
        c.fill();
        c.stroke();
    }

    const eff = obj.effect || 'none';
    if (eff === 'drop') {
        c.shadowColor = 'rgba(0, 0, 0, 0.75)';
        c.shadowOffsetX = 2;
        c.shadowOffsetY = 3;
        c.shadowBlur = 4;
    } else if (eff === 'glow') {
        c.shadowColor = obj.color || '#ffffff';
        c.shadowBlur = 12;
    } else if (eff === 'neon') {
        c.shadowColor = obj.color || '#3b82f6';
        c.shadowBlur = 18;
    }

    lines.forEach((line, idx) => {
        const ly = obj.y + idx * lineH;
        if (eff === 'echo') {
            c.save();
            c.globalAlpha = 0.35;
            c.fillStyle = obj.color;
            c.fillText(line, obj.x + 3, ly + 3);
            c.restore();
        }
        if (eff === 'outline') {
            c.strokeStyle = ['#ffffff', '#f8fafc'].includes((obj.color || '').toLowerCase()) ? '#0f172a' : '#ffffff';
            c.lineWidth = Math.max(2.5, fs * 0.14);
            c.lineJoin = 'round';
            c.strokeText(line, obj.x, ly);
        }
        if (eff === 'hollow') {
            c.strokeStyle = obj.color;
            c.lineWidth = Math.max(1.5, fs * 0.08);
            c.strokeText(line, obj.x, ly);
        } else {
            c.fillStyle = obj.color;
            c.fillText(line, obj.x, ly);
        }
    });

    c.restore();
}

function drawObjectGeometry(c, obj) {
    if (obj.type === 'front') {
        drawWeatherFront(c, obj);
        return;
    }
    if (obj.type === 'area') {
        drawHatchedArea(c, obj);
        return;
    }
    if (obj.type === 'text') {
        drawTextObject(c, obj);
        return;
    }

    c.save();
    c.strokeStyle = obj.color;
    c.fillStyle = obj.color;
    c.lineWidth = obj.width || 4;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    applyDashPattern(c, obj.type === 'highlighter' ? 'solid' : (obj.strokeStyle || 'solid'), obj.width || 4);

    if (obj.type === 'pen' || obj.type === 'highlighter') {
        drawPolylinePath(c, obj.points);
        c.stroke();
    } else if (obj.type === 'line' || obj.type === 'arrow') {
        c.beginPath();
        c.moveTo(obj.x1, obj.y1);
        c.lineTo(obj.x2, obj.y2);
        c.stroke();
        if (obj.type === 'arrow') {
            const ang = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
            const headLen = Math.max(11, (obj.width || 4) * 2.8 + 4);
            c.setLineDash([]);
            c.beginPath();
            c.moveTo(obj.x2, obj.y2);
            c.lineTo(obj.x2 - headLen * Math.cos(ang - Math.PI / 6), obj.y2 - headLen * Math.sin(ang - Math.PI / 6));
            c.moveTo(obj.x2, obj.y2);
            c.lineTo(obj.x2 - headLen * Math.cos(ang + Math.PI / 6), obj.y2 - headLen * Math.sin(ang + Math.PI / 6));
            c.stroke();
        }
    } else if (obj.type === 'shape') {
        c.setLineDash([]);
        const x = obj.x, y = obj.y, w = obj.w, h = obj.h;
        c.beginPath();
        if (obj.shapeType === 'circle') {
            c.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        } else if (obj.shapeType === 'triangle') {
            c.moveTo(x + w / 2, y);
            c.lineTo(x + w, y + h);
            c.lineTo(x, y + h);
            c.closePath();
        } else {
            c.rect(x, y, w, h);
        }
        if (obj.fill) {
            c.save();
            c.globalAlpha = 0.25;
            c.fill();
            c.restore();
        }
        c.stroke();
    } else if (obj.type === 'stamp') {
        const s = obj.size || 40;
        const isHigh = obj.stampType === 'H';
        const col = isHigh ? '#2563eb' : '#dc2626';
        c.font = `900 ${s}px 'Inter', 'Roboto', sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineWidth = Math.max(3, s * 0.14);
        c.strokeStyle = '#ffffff';
        c.strokeText(obj.stampType, obj.x, obj.y);
        c.fillStyle = col;
        c.fillText(obj.stampType, obj.x, obj.y);
    }

    c.restore();
}

function getNormalizedFadeDirs(obj) {
    if (Array.isArray(obj.fadeDirs)) return obj.fadeDirs;
    if (obj.fadeDir && obj.fadeDir !== 'none') return [obj.fadeDir];
    return [];
}

function drawObject(obj) {
    if (!obj) return;

    const fadeDirs = getNormalizedFadeDirs(obj);
    const opacity = Number.isFinite(obj.opacity) ? obj.opacity : (obj.type === 'highlighter' ? 0.45 : 1.0);
    const needsScratch = obj.type === 'highlighter' || fadeDirs.length > 0 || opacity < 0.999;

    if (!needsScratch) {
        drawObjectGeometry(ctx, obj);
        return;
    }

    const { w: vw, h: vh } = getViewportSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (!scratchCanvas) {
        scratchCanvas = document.createElement('canvas');
        scratchCtx = scratchCanvas.getContext('2d');
    }
    if (scratchCanvas.width !== vw * dpr || scratchCanvas.height !== vh * dpr) {
        scratchCanvas.width = vw * dpr;
        scratchCanvas.height = vh * dpr;
    }

    const sc = scratchCtx;
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc.clearRect(0, 0, vw, vh);
    sc.globalCompositeOperation = 'source-over';
    drawObjectGeometry(sc, obj);

    // Apply multi-direction alpha masks via multiplicative destination-in passes!
    if (fadeDirs.length > 0) {
        const b = getObjectBounds(obj);
        if (b) {
            sc.globalCompositeOperation = 'destination-in';
            const spd = Math.max(0.1, Math.min(1.0, obj.fadeSpeed ?? 0.55));
            const hasTopAndBot = fadeDirs.includes('top') && fadeDirs.includes('bottom');
            const hasLeftAndRight = fadeDirs.includes('left') && fadeDirs.includes('right');

            const pad = 16;
            const rx = b.x - pad, ry = b.y - pad, rw = b.w + pad * 2, rh = b.h + pad * 2;

            fadeDirs.forEach((dir) => {
                let grad = null;
                if (dir === 'middle') {
                    // Bright in middle, fades smoothly outward toward outer edges
                    const cx = b.x + b.w / 2;
                    const cy = b.y + b.h / 2;
                    const reach = Math.max(0.18, 1.15 - spd * 0.85);
                    const maxR = Math.max(12, Math.hypot(b.w / 2, b.h / 2) * reach);
                    grad = sc.createRadialGradient(cx, cy, maxR * 0.06, cx, cy, maxR);
                    grad.addColorStop(0, 'rgba(0,0,0,1)');
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                } else if (dir === 'top') {
                    // Fades out from the top edge inward (0 at top -> 1 inward)
                    const depth = hasTopAndBot ? Math.max(0.12, 0.5 - spd * 0.36) : Math.max(0.15, 1.0 - spd * 0.82);
                    grad = sc.createLinearGradient(0, b.y, 0, b.y + b.h * depth);
                    grad.addColorStop(0, 'rgba(0,0,0,0)');
                    grad.addColorStop(1, 'rgba(0,0,0,1)');
                } else if (dir === 'bottom') {
                    const depth = hasTopAndBot ? Math.max(0.12, 0.5 - spd * 0.36) : Math.max(0.15, 1.0 - spd * 0.82);
                    grad = sc.createLinearGradient(0, b.y + b.h, 0, b.y + b.h - b.h * depth);
                    grad.addColorStop(0, 'rgba(0,0,0,0)');
                    grad.addColorStop(1, 'rgba(0,0,0,1)');
                } else if (dir === 'left') {
                    const depth = hasLeftAndRight ? Math.max(0.12, 0.5 - spd * 0.36) : Math.max(0.15, 1.0 - spd * 0.82);
                    grad = sc.createLinearGradient(b.x, 0, b.x + b.w * depth, 0);
                    grad.addColorStop(0, 'rgba(0,0,0,0)');
                    grad.addColorStop(1, 'rgba(0,0,0,1)');
                } else if (dir === 'right') {
                    const depth = hasLeftAndRight ? Math.max(0.12, 0.5 - spd * 0.36) : Math.max(0.15, 1.0 - spd * 0.82);
                    grad = sc.createLinearGradient(b.x + b.w, 0, b.x + b.w - b.w * depth, 0);
                    grad.addColorStop(0, 'rgba(0,0,0,0)');
                    grad.addColorStop(1, 'rgba(0,0,0,1)');
                }

                if (grad) {
                    sc.fillStyle = grad;
                    sc.fillRect(rx, ry, rw, rh);
                }
            });
        }
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0.05, Math.min(1.0, opacity));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratchCanvas, 0, 0);
    ctx.restore();
}

function drawSelectionBox(obj) {
    const b = getObjectBounds(obj);
    if (!b) return;
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);

    const corners = [
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x + b.w, b.y + b.h],
        [b.x, b.y + b.h]
    ];
    corners.forEach(([cx, cy]) => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.rect(cx - 4.5, cy - 4.5, 9, 9);
        ctx.fill();
        ctx.stroke();
    });
    ctx.restore();
}

function redrawAll() {
    if (!canvasEl || !ctx) return;
    const { w, h } = getViewportSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvasEl.width !== w * dpr || canvasEl.height !== h * dpr) {
        canvasEl.width = w * dpr;
        canvasEl.height = h * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    objects.forEach((obj) => drawObject(obj));
    if (activeDraft) drawObject(activeDraft);

    if (drawModeActive && selectedObjId) {
        const sel = objects.find((o) => o.id === selectedObjId);
        if (sel) drawSelectionBox(sel);
    }
}

/* =========================================================================
   INLINE TEXT INPUT (Click or Double-Click to Type)
   ========================================================================= */

function closeInlineTextInput(commit = true) {
    if (!inlineTextInput) return;
    const val = inlineTextInput.value.trim();
    const targetId = inlineTextInput.dataset.targetId;
    const x = parseFloat(inlineTextInput.dataset.x);
    const y = parseFloat(inlineTextInput.dataset.y);

    inlineTextInput.remove();
    inlineTextInput = null;

    if (commit && val) {
        if (targetId) {
            const existing = objects.find((o) => o.id === targetId);
            if (existing) existing.text = val;
        } else {
            const newObj = {
                id: `draw_${++objCounter}`,
                type: 'text',
                x, y,
                text: val,
                color: activeColor,
                fontFamily: textFont,
                fontSize: textSize,
                labelBox: textLabelBox,
                effect: textEffect,
                opacity: activeOpacity,
                fadeDirs: [...activeFadeDirs],
                fadeSpeed: activeFadeSpeed
            };
            objects.push(newObj);
            selectedObjId = newObj.id;
        }
        pushUndoSnapshot();
    }
    redrawAll();
    renderOptionsStrip();
}

function openInlineTextInput(x, y, existingObj = null) {
    closeInlineTextInput(true);
    const z = getCssZoomFactor();

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'draw-inline-text-input';
    inp.placeholder = 'Type label...';
    inp.value = existingObj ? existingObj.text : '';
    inp.dataset.targetId = existingObj ? existingObj.id : '';
    inp.dataset.x = String(existingObj ? existingObj.x : x);
    inp.dataset.y = String(existingObj ? existingObj.y : y);
    inp.style.left = `${Math.round((existingObj ? existingObj.x : x) * z) / z}px`;
    inp.style.top = `${Math.round((existingObj ? existingObj.y : y) * z) / z}px`;
    inp.style.fontFamily = existingObj ? existingObj.fontFamily : textFont;
    inp.style.fontSize = `${existingObj ? existingObj.fontSize : textSize}px`;
    inp.style.color = existingObj ? existingObj.color : activeColor;

    document.body.appendChild(inp);
    inlineTextInput = inp;
    setTimeout(() => { inp.focus(); inp.select(); }, 10);

    inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') closeInlineTextInput(true);
        else if (e.key === 'Escape') closeInlineTextInput(false);
    });
    inp.addEventListener('blur', () => closeInlineTextInput(true));
}

/* =========================================================================
   FLOATING TOOLBAR & CONTEXTUAL OPTIONS STRIP UI
   ========================================================================= */

function syncActionButtons() {
    const undoBtn = toolbarEl?.querySelector('#btn-draw-undo');
    const redoBtn = toolbarEl?.querySelector('#btn-draw-redo');
    const clearBtn = toolbarEl?.querySelector('#btn-draw-clear');
    if (undoBtn) undoBtn.disabled = undoStack.length <= 1;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    if (clearBtn) clearBtn.disabled = objects.length === 0;
}

function getFrontMiniSvg(type) {
    if (type === 'cold') return `<svg width="24" height="12" viewBox="0 0 24 12"><line x1="1" y1="9" x2="23" y2="9" stroke="#2563eb" stroke-width="2"/><polygon points="5,9 9,9 7,3" fill="#2563eb"/><polygon points="15,9 19,9 17,3" fill="#2563eb"/></svg>`;
    if (type === 'warm') return `<svg width="24" height="12" viewBox="0 0 24 12"><line x1="1" y1="9" x2="23" y2="9" stroke="#dc2626" stroke-width="2"/><path d="M4,9 A3,3 0 0,1 10,9 Z" fill="#dc2626"/><path d="M14,9 A3,3 0 0,1 20,9 Z" fill="#dc2626"/></svg>`;
    if (type === 'stationary') return `<svg width="24" height="14" viewBox="0 0 24 14"><line x1="1" y1="7" x2="12" y2="7" stroke="#2563eb" stroke-width="2"/><line x1="12" y1="7" x2="23" y2="7" stroke="#dc2626" stroke-width="2"/><polygon points="4,7 9,7 6.5,12" fill="#2563eb"/><path d="M14,7 A3,3 0 0,1 20,7 Z" fill="#dc2626"/></svg>`;
    if (type === 'occluded') return `<svg width="24" height="12" viewBox="0 0 24 12"><line x1="1" y1="3" x2="23" y2="3" stroke="#7c3aed" stroke-width="2"/><polygon points="4,3 9,3 6.5,9" fill="#7c3aed"/><path d="M14,3 A3,3 0 0,0 20,3 Z" fill="#7c3aed"/></svg>`;
    if (type === 'trough') return `<svg width="24" height="12" viewBox="0 0 24 12"><line x1="1" y1="6" x2="23" y2="6" stroke="#b45309" stroke-width="2.2" stroke-dasharray="4 3"/></svg>`;
    return `<svg width="24" height="12" viewBox="0 0 24 12"><line x1="1" y1="9" x2="23" y2="9" stroke="#b45309" stroke-width="2"/><path d="M4,9 A3,3 0 0,1 10,9" fill="none" stroke="#b45309" stroke-width="1.8"/><path d="M14,9 A3,3 0 0,1 20,9" fill="none" stroke="#b45309" stroke-width="1.8"/></svg>`;
}

function renderOptionsStrip() {
    if (!optionsStripEl) return;

    const selObj = selectedObjId ? objects.find((o) => o.id === selectedObjId) : null;
    const contextTool = selObj ? selObj.type : activeTool;
    const isHighlighter = contextTool === 'highlighter';
    const canFade = contextTool !== 'eraser' && !(contextTool === 'select' && !selObj);

    const curDirs = selObj ? getNormalizedFadeDirs(selObj) : activeFadeDirs;
    const curOp = Math.round((selObj ? (selObj.opacity ?? (isHighlighter ? 0.45 : 1)) : (isHighlighter ? hlOpacity : activeOpacity)) * 100);
    const curSpeed = Math.round((selObj ? (selObj.fadeSpeed ?? 0.55) : activeFadeSpeed) * 100);
    const showFadeControls = isHighlighter || fadePanelOpen || curDirs.length > 0;

    let html = '';

    // Show Custom 1–80px Thickness Slider whenever 4th size button is open
    if (customWidthOpen) {
        html += `
            <div class="draw-opt-group">
                <span class="draw-opt-kicker">SIZE</span>
                <input id="draw-custom-width-slider" class="draw-opt-slider is-wide" type="range" min="1" max="80" step="1" value="${activeWidth}" />
                <span id="draw-custom-width-val" class="draw-opt-val">${activeWidth}px</span>
            </div>
        `;
    }

    if (contextTool === 'front') {
        const curType = selObj ? selObj.frontType : frontType;
        html += `
            <div class="draw-opt-group">
                <span class="draw-opt-kicker">FRONT</span>
                ${FRONT_TYPES.map((f) => `
                    <button type="button" class="draw-opt-pill ${curType === f.id ? 'active' : ''}" data-front-type="${f.id}">
                        ${getFrontMiniSvg(f.id)}
                        <span>${f.label}</span>
                    </button>
                `).join('')}
                <span class="draw-opt-sep"></span>
                <button type="button" id="btn-front-flip" class="draw-opt-pill">
                    <span>↺ Flip side</span>
                </button>
            </div>
        `;
    } else if (contextTool === 'pen' || contextTool === 'line' || contextTool === 'arrow') {
        const curStyle = selObj ? (selObj.strokeStyle || 'solid') : strokeStyle;
        html += `
            <div class="draw-opt-group">
                <span class="draw-opt-kicker">STROKE</span>
                ${['solid', 'dashed', 'dotted'].map((s) => `
                    <button type="button" class="draw-opt-pill ${curStyle === s ? 'active' : ''}" data-stroke-style="${s}">
                        <span>${s[0].toUpperCase() + s.slice(1)}</span>
                    </button>
                `).join('')}
                ${contextTool === 'pen' ? `
                    <span class="draw-opt-sep"></span>
                    <span class="draw-opt-label">Smooth</span>
                    <input id="draw-smooth-slider" class="draw-opt-slider" type="range" min="0" max="100" step="5" value="${strokeSmoothing}" />
                    <span id="draw-smooth-val" class="draw-opt-val">${strokeSmoothing}%</span>
                ` : ''}
            </div>
        `;
    } else if (contextTool === 'shape') {
        const curShape = selObj ? selObj.shapeType : shapeType;
        const curFill = selObj ? selObj.fill : shapeFill;
        html += `
            <div class="draw-opt-group">
                <span class="draw-opt-kicker">SHAPE</span>
                ${[
                    { id: 'rect', label: 'Rectangle' },
                    { id: 'circle', label: 'Circle' },
                    { id: 'triangle', label: 'Triangle' }
                ].map((sh) => `
                    <button type="button" class="draw-opt-pill ${curShape === sh.id ? 'active' : ''}" data-shape-type="${sh.id}">${sh.label}</button>
                `).join('')}
                <span class="draw-opt-sep"></span>
                <button type="button" id="btn-shape-fill" class="draw-opt-pill ${curFill ? 'active' : ''}">Fill</button>
            </div>
        `;
    } else if (contextTool === 'text') {
        const curFont = selObj ? selObj.fontFamily : textFont;
        const curSize = selObj ? selObj.fontSize : textSize;
        const curBox = selObj ? selObj.labelBox : textLabelBox;
        const curEff = selObj ? (selObj.effect || 'none') : textEffect;
        html += `
            <div class="draw-opt-group">
                <span class="draw-opt-kicker">TEXT</span>
                <select id="draw-text-font" class="draw-opt-select">
                    ${TEXT_FONTS.map((f) => `<option value="${f.value}" ${curFont === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
                </select>
                <input id="draw-text-size" class="draw-opt-num" type="number" min="10" max="120" value="${curSize}" />
                <button type="button" id="btn-draw-label-box" class="draw-opt-pill ${curBox ? 'active' : ''}">Label Box</button>
                <button type="button" id="btn-draw-text-effects" class="draw-opt-pill ${effectsMenuOpen || curEff !== 'none' ? 'active' : ''}">Effects…</button>
                ${effectsMenuOpen ? `
                    <span class="draw-opt-sep"></span>
                    ${TEXT_EFFECTS.map((ef) => `
                        <button type="button" class="draw-opt-pill ${curEff === ef.id ? 'active' : ''}" data-text-effect="${ef.id}">${ef.label}</button>
                    `).join('')}
                ` : ''}
            </div>
        `;
    }

    // Universal Opacity & Multi-Direction Fade Controls
    if (canFade) {
        if (!isHighlighter) {
            html += `
                <div class="draw-opt-group">
                    ${html ? '<span class="draw-opt-sep"></span>' : ''}
                    <button type="button" id="btn-toggle-universal-fade" class="draw-opt-pill ${showFadeControls ? 'active' : ''}">
                        <span>Fade${curDirs.length > 0 ? ` (${curDirs.length})` : ''}</span>
                    </button>
                </div>
            `;
        }

        if (showFadeControls) {
            html += `
                <div class="draw-opt-group">
                    <span class="draw-opt-sep"></span>
                    <span class="draw-opt-kicker">${isHighlighter ? 'HIGHLIGHT' : 'FADE'}</span>
                    <span class="draw-opt-label">Opacity</span>
                    <input id="draw-hl-opacity" class="draw-opt-slider" type="range" min="10" max="100" step="5" value="${curOp}" />
                    <span id="draw-hl-opacity-val" class="draw-opt-val">${curOp}%</span>
                    <span class="draw-opt-sep"></span>
                    <button type="button" class="draw-opt-pill ${curDirs.length === 0 ? 'active' : ''}" data-hl-fade="none">None</button>
                    ${FADE_DIRS.map((dir) => `
                        <button type="button" class="draw-opt-pill ${curDirs.includes(dir) ? 'active' : ''}" data-hl-fade="${dir}">
                            ${dir[0].toUpperCase() + dir.slice(1)}
                        </button>
                    `).join('')}
                    ${curDirs.length > 0 ? `
                        <span class="draw-opt-sep"></span>
                        <span class="draw-opt-label">Speed</span>
                        <input id="draw-hl-speed" class="draw-opt-slider" type="range" min="10" max="100" step="5" value="${curSpeed}" />
                        <span id="draw-hl-speed-val" class="draw-opt-val">${curSpeed}%</span>
                    ` : ''}
                </div>
            `;
        }
    }

    if (!html) {
        optionsStripEl.style.display = 'none';
        optionsStripEl.innerHTML = '';
        return;
    }

    optionsStripEl.style.display = 'flex';
    optionsStripEl.innerHTML = html;

    // Bind Option Listeners
    const cwSlider = optionsStripEl.querySelector('#draw-custom-width-slider');
    cwSlider?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        activeWidth = v;
        widthPresetId = 'custom';
        const vEl = optionsStripEl.querySelector('#draw-custom-width-val');
        if (vEl) vEl.textContent = `${v}px`;
        if (selObj && selObj.type !== 'text') {
            if (selObj.type === 'stamp') selObj.size = Math.max(20, v * 2);
            else selObj.width = v;
            redrawAll();
        }
        renderToolbar(false);
    });
    cwSlider?.addEventListener('change', () => {
        if (selObj) pushUndoSnapshot();
    });

    optionsStripEl.querySelectorAll('[data-front-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
            frontType = btn.dataset.frontType;
            if (selObj?.type === 'front') {
                selObj.frontType = frontType;
                pushUndoSnapshot();
                redrawAll();
            }
            renderOptionsStrip();
        });
    });

    optionsStripEl.querySelector('#btn-front-flip')?.addEventListener('click', () => {
        frontFlip *= -1;
        if (selObj?.type === 'front') {
            selObj.flipSide = (selObj.flipSide || 1) * -1;
            pushUndoSnapshot();
            redrawAll();
        }
    });

    optionsStripEl.querySelectorAll('[data-stroke-style]').forEach((btn) => {
        btn.addEventListener('click', () => {
            strokeStyle = btn.dataset.strokeStyle;
            if (selObj && (selObj.type === 'pen' || selObj.type === 'line' || selObj.type === 'arrow')) {
                selObj.strokeStyle = strokeStyle;
                pushUndoSnapshot();
                redrawAll();
            }
            renderOptionsStrip();
        });
    });

    const smoothEl = optionsStripEl.querySelector('#draw-smooth-slider');
    smoothEl?.addEventListener('input', (e) => {
        strokeSmoothing = parseInt(e.target.value, 10);
        const valEl = optionsStripEl.querySelector('#draw-smooth-val');
        if (valEl) valEl.textContent = `${strokeSmoothing}%`;
    });

    optionsStripEl.querySelectorAll('[data-shape-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
            shapeType = btn.dataset.shapeType;
            if (selObj?.type === 'shape') {
                selObj.shapeType = shapeType;
                pushUndoSnapshot();
                redrawAll();
            }
            renderOptionsStrip();
        });
    });

    optionsStripEl.querySelector('#btn-shape-fill')?.addEventListener('click', () => {
        shapeFill = !shapeFill;
        if (selObj?.type === 'shape') {
            selObj.fill = shapeFill;
            pushUndoSnapshot();
            redrawAll();
        }
        renderOptionsStrip();
    });

    optionsStripEl.querySelector('#btn-toggle-universal-fade')?.addEventListener('click', () => {
        fadePanelOpen = !fadePanelOpen;
        renderOptionsStrip();
    });

    const hlOpEl = optionsStripEl.querySelector('#draw-hl-opacity');
    hlOpEl?.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        if (isHighlighter) hlOpacity = pct / 100;
        else activeOpacity = pct / 100;
        const valEl = optionsStripEl.querySelector('#draw-hl-opacity-val');
        if (valEl) valEl.textContent = `${pct}%`;
        if (selObj) {
            selObj.opacity = pct / 100;
            redrawAll();
        }
    });
    hlOpEl?.addEventListener('change', () => { if (selObj) pushUndoSnapshot(); });

    // Multi-Select Fade Direction Toggles
    optionsStripEl.querySelectorAll('[data-hl-fade]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const dir = btn.dataset.hlFade;
            const targetArr = selObj ? [...getNormalizedFadeDirs(selObj)] : [...activeFadeDirs];
            let nextArr;
            if (dir === 'none') {
                nextArr = [];
            } else if (targetArr.includes(dir)) {
                nextArr = targetArr.filter((d) => d !== dir);
            } else {
                nextArr = [...targetArr, dir];
            }

            if (selObj) {
                selObj.fadeDirs = nextArr;
                delete selObj.fadeDir;
                pushUndoSnapshot();
                redrawAll();
            } else {
                activeFadeDirs = nextArr;
            }
            renderOptionsStrip();
        });
    });

    const hlSpdEl = optionsStripEl.querySelector('#draw-hl-speed');
    hlSpdEl?.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        activeFadeSpeed = pct / 100;
        const valEl = optionsStripEl.querySelector('#draw-hl-speed-val');
        if (valEl) valEl.textContent = `${pct}%`;
        if (selObj) {
            selObj.fadeSpeed = activeFadeSpeed;
            redrawAll();
        }
    });
    hlSpdEl?.addEventListener('change', () => { if (selObj) pushUndoSnapshot(); });

    optionsStripEl.querySelector('#draw-text-font')?.addEventListener('change', (e) => {
        textFont = e.target.value;
        if (selObj?.type === 'text') {
            selObj.fontFamily = textFont;
            pushUndoSnapshot();
            redrawAll();
        }
    });

    optionsStripEl.querySelector('#draw-text-size')?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!Number.isFinite(val) || val < 10) return;
        textSize = Math.min(120, val);
        if (selObj?.type === 'text') {
            selObj.fontSize = textSize;
            redrawAll();
        }
    });

    optionsStripEl.querySelector('#btn-draw-label-box')?.addEventListener('click', () => {
        textLabelBox = !textLabelBox;
        if (selObj?.type === 'text') {
            selObj.labelBox = textLabelBox;
            pushUndoSnapshot();
            redrawAll();
        }
        renderOptionsStrip();
    });

    optionsStripEl.querySelector('#btn-draw-text-effects')?.addEventListener('click', () => {
        effectsMenuOpen = !effectsMenuOpen;
        renderOptionsStrip();
    });

    optionsStripEl.querySelectorAll('[data-text-effect]').forEach((btn) => {
        btn.addEventListener('click', () => {
            textEffect = btn.dataset.textEffect;
            if (selObj?.type === 'text') {
                selObj.effect = textEffect;
                pushUndoSnapshot();
                redrawAll();
            }
            renderOptionsStrip();
        });
    });
}

function renderToolbar(refreshStrip = true) {
    if (!toolbarEl) return;

    const isPresetColor = PRESET_COLORS.some((c) => c.hex.toLowerCase() === activeColor.toLowerCase());

    toolbarEl.innerHTML = `
        <!-- Group 1: Basic Tools -->
        <div class="draw-bar-group">
            <button type="button" class="draw-tool-btn ${activeTool === 'select' ? 'active' : ''}" data-tool="select" title="Select & Move">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 3l7.2 17 2.6-6.2L20 11.2 4 3z"/></svg>
            </button>
            <button type="button" class="draw-tool-btn ${activeTool === 'pen' ? 'active' : ''}" data-tool="pen" title="Pen (Hold Shift to snap smooth curve/line)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
            </button>
            <button type="button" class="draw-tool-btn ${activeTool === 'highlighter' ? 'active' : ''}" data-tool="highlighter" title="Highlighter">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
            </button>
            <button type="button" class="draw-tool-btn ${activeTool === 'line' ? 'active' : ''}" data-tool="line" title="Line">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>
            </button>
            <button type="button" class="draw-tool-btn ${activeTool === 'arrow' ? 'active' : ''}" data-tool="arrow" title="Arrow">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="10 5 19 5 19 14"/></svg>
            </button>
            <button type="button" class="draw-tool-btn ${activeTool === 'shape' ? 'active' : ''}" data-tool="shape" title="Shape">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="11" height="11" rx="1.5"/><circle cx="16.5" cy="16.5" r="4.5"/></svg>
            </button>
            <button type="button" class="draw-tool-btn ${activeTool === 'text' ? 'active' : ''}" data-tool="text" title="Text">
                <span class="draw-text-glyph">T</span>
            </button>
            <button type="button" class="draw-tool-btn ${activeTool === 'eraser' ? 'active' : ''}" data-tool="eraser" title="Eraser">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16c-.6-.6-.6-1.5 0-2.1l9.9-9.9c.6-.6 1.5-.6 2.1 0l6 6c.6.6.6 1.5 0 2.1L13 20"/><path d="M6.5 11.5L13 18"/></svg>
            </button>
        </div>

        <span class="draw-bar-divider"></span>

        <!-- Group 2: Weather Tools -->
        <div class="draw-bar-group">
            <button type="button" class="draw-wx-btn ${activeTool === 'front' ? 'active' : ''}" data-tool="front" title="Weather Front (Hold Shift to snap smooth curve)">
                <svg width="22" height="12" viewBox="0 0 24 12"><line x1="1" y1="6" x2="12" y2="6" stroke="#2563eb" stroke-width="2"/><line x1="12" y1="6" x2="23" y2="6" stroke="#dc2626" stroke-width="2"/><polygon points="4,6 9,6 6.5,11" fill="#2563eb"/><path d="M14,6 A3,3 0 0,1 20,6 Z" fill="#dc2626"/></svg>
                <span>Front</span>
            </button>
            <button type="button" class="draw-wx-stamp-btn is-high ${activeTool === 'high' ? 'active' : ''}" data-tool="high" title="High Pressure (H)">H</button>
            <button type="button" class="draw-wx-stamp-btn is-low ${activeTool === 'low' ? 'active' : ''}" data-tool="low" title="Low Pressure (L)">L</button>
            <button type="button" class="draw-wx-btn ${activeTool === 'area' ? 'active' : ''}" data-tool="area" title="Hatched Forecast Area">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="12" rx="9" ry="7"/><line x1="7" y1="17" x2="15" y2="6"/><line x1="11" y1="19" x2="19" y2="8"/></svg>
                <span>Area</span>
            </button>
        </div>

        <span class="draw-bar-divider"></span>

        <!-- Group 3: Colors -->
        <div class="draw-bar-group draw-colors-group">
            ${PRESET_COLORS.map((c) => `
                <button
                    type="button"
                    class="draw-color-swatch ${activeColor.toLowerCase() === c.hex ? 'active' : ''}"
                    data-color="${c.hex}"
                    style="background: ${c.hex};"
                    title="${c.label}"
                ></button>
            `).join('')}
            <label class="draw-custom-color-btn ${!isPresetColor ? 'active' : ''}" title="Custom Color" style="${!isPresetColor ? `background:${activeColor};color:#fff;` : ''}">
                <span>+</span>
                <input id="draw-custom-color-input" type="color" value="${activeColor}" />
            </label>
        </div>

        <span class="draw-bar-divider"></span>

        <!-- Group 4: Line Width / Size (Thin, Med, Thick + 4th Custom Slider) -->
        <div class="draw-bar-group draw-width-group">
            ${WIDTH_PRESETS.map((wp) => `
                <button type="button" class="draw-width-btn ${widthPresetId === wp.id ? 'active' : ''}" data-width-id="${wp.id}" data-width-px="${wp.px}" title="${wp.label} (${wp.px}px)">
                    <span class="draw-width-line" style="height: ${Math.max(1.5, Math.min(6, wp.px * 0.55))}px;"></span>
                </button>
            `).join('')}
            <button type="button" id="btn-draw-custom-width" class="draw-width-btn ${widthPresetId === 'custom' || customWidthOpen ? 'active' : ''}" title="Custom Size Slider (1–80px)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="15" cy="7" r="2.5" fill="currentColor"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="17" r="2.5" fill="currentColor"/></svg>
            </button>
        </div>

        <span class="draw-bar-divider"></span>

        <!-- Group 5: Finishing -->
        <div class="draw-bar-group">
            <button type="button" id="btn-draw-undo" class="draw-tool-btn" title="Undo (Cmd+Z)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            </button>
            <button type="button" id="btn-draw-redo" class="draw-tool-btn" title="Redo">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
            </button>
            <button type="button" id="btn-draw-clear" class="draw-tool-btn is-danger" title="Clear All Drawings">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
            <button type="button" id="btn-draw-done" class="draw-done-btn">Done</button>
        </div>
    `;

    toolbarEl.querySelectorAll('[data-tool]').forEach((btn) => {
        btn.addEventListener('click', () => {
            activeTool = btn.dataset.tool;
            if (activeTool !== 'select') selectedObjId = null;
            effectsMenuOpen = false;
            if (canvasEl) {
                canvasEl.style.cursor = activeTool === 'select' ? 'default'
                    : activeTool === 'text' ? 'text'
                    : 'crosshair';
            }
            renderToolbar();
            redrawAll();
        });
    });

    const applyColor = (hex) => {
        activeColor = hex;
        const sel = selectedObjId ? objects.find((o) => o.id === selectedObjId) : null;
        if (sel && sel.type !== 'front' && sel.type !== 'stamp') {
            sel.color = hex;
            pushUndoSnapshot();
            redrawAll();
        }
        renderToolbar(false);
    };

    toolbarEl.querySelectorAll('[data-color]').forEach((btn) => {
        btn.addEventListener('click', () => applyColor(btn.dataset.color));
    });

    toolbarEl.querySelector('#draw-custom-color-input')?.addEventListener('input', (e) => {
        applyColor(e.target.value);
    });

    toolbarEl.querySelectorAll('[data-width-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
            widthPresetId = btn.dataset.widthId;
            activeWidth = parseInt(btn.dataset.widthPx, 10);
            customWidthOpen = false;
            const sel = selectedObjId ? objects.find((o) => o.id === selectedObjId) : null;
            if (sel && sel.type !== 'text') {
                if (sel.type === 'stamp') sel.size = Math.max(24, activeWidth * 4);
                else sel.width = activeWidth;
                pushUndoSnapshot();
                redrawAll();
            }
            renderToolbar();
        });
    });

    toolbarEl.querySelector('#btn-draw-custom-width')?.addEventListener('click', () => {
        customWidthOpen = !customWidthOpen;
        renderToolbar();
    });

    toolbarEl.querySelector('#btn-draw-undo')?.addEventListener('click', undoDraw);
    toolbarEl.querySelector('#btn-draw-redo')?.addEventListener('click', redoDraw);
    toolbarEl.querySelector('#btn-draw-clear')?.addEventListener('click', clearAllDrawings);
    toolbarEl.querySelector('#btn-draw-done')?.addEventListener('click', () => toggleDrawMode(false));

    syncActionButtons();
    if (refreshStrip) renderOptionsStrip();
}

/* =========================================================================
   CANVAS POINTER EVENTS (Draw, Shift Smooth Snap, Erase, Select/Move/Resize)
   ========================================================================= */

function attachCanvasEvents() {
    const getPos = (e) => {
        const z = getCssZoomFactor();
        return { x: e.clientX / z, y: e.clientY / z };
    };

    canvasEl.addEventListener('pointerdown', (e) => {
        if (!drawModeActive) return;
        if (e.button !== 0) return;
        closeInlineTextInput(true);

        const pos = getPos(e);

        // 1. Eraser
        if (activeTool === 'eraser') {
            interaction = { kind: 'erase', erasedAny: false };
            for (let i = objects.length - 1; i >= 0; i--) {
                if (hitTestObject(objects[i], pos.x, pos.y)) {
                    objects.splice(i, 1);
                    interaction.erasedAny = true;
                    redrawAll();
                    break;
                }
            }
            return;
        }

        // 2. Select / Move / Corner-Resize
        if (activeTool === 'select') {
            if (selectedObjId) {
                const sel = objects.find((o) => o.id === selectedObjId);
                const b = getObjectBounds(sel);
                if (sel && b) {
                    const corners = [
                        { dir: 'nw', x: b.x, y: b.y },
                        { dir: 'ne', x: b.x + b.w, y: b.y },
                        { dir: 'se', x: b.x + b.w, y: b.y + b.h },
                        { dir: 'sw', x: b.x, y: b.y + b.h }
                    ];
                    const hitCorner = corners.find((c) => Math.hypot(pos.x - c.x, pos.y - c.y) <= 10);
                    if (hitCorner) {
                        sel.origSize = sel.size;
                        sel.origFontSize = sel.fontSize;
                        interaction = {
                            kind: 'resize',
                            dir: hitCorner.dir,
                            obj: sel,
                            origBounds: { ...b },
                            startX: pos.x,
                            startY: pos.y,
                            didMove: false
                        };
                        return;
                    }
                }
            }

            let hit = null;
            for (let i = objects.length - 1; i >= 0; i--) {
                if (hitTestObject(objects[i], pos.x, pos.y)) {
                    hit = objects[i];
                    break;
                }
            }

            selectedObjId = hit ? hit.id : null;
            redrawAll();
            renderOptionsStrip();

            if (hit) {
                interaction = {
                    kind: 'move',
                    obj: hit,
                    lastX: pos.x,
                    lastY: pos.y,
                    didMove: false
                };
            }
            return;
        }

        // 3. Text
        if (activeTool === 'text') {
            for (let i = objects.length - 1; i >= 0; i--) {
                if (objects[i].type === 'text' && hitTestObject(objects[i], pos.x, pos.y)) {
                    openInlineTextInput(pos.x, pos.y, objects[i]);
                    return;
                }
            }
            openInlineTextInput(pos.x, pos.y, null);
            return;
        }

        // 4. H / L Stamps
        if (activeTool === 'high' || activeTool === 'low') {
            const stampSize = widthPresetId === 'custom'
                ? Math.max(22, activeWidth * 2 + 12)
                : (widthPresetId === 'thin' ? 28 : (widthPresetId === 'thick' ? 54 : 40));
            const stampObj = {
                id: `draw_${++objCounter}`,
                type: 'stamp',
                stampType: activeTool === 'high' ? 'H' : 'L',
                x: pos.x,
                y: pos.y,
                size: stampSize,
                opacity: activeOpacity,
                fadeDirs: [...activeFadeDirs],
                fadeSpeed: activeFadeSpeed
            };
            objects.push(stampObj);
            pushUndoSnapshot();
            redrawAll();
            return;
        }

        // 5. Freehand / Front / Highlighter / Area / Line / Arrow / Shape
        const id = `draw_${++objCounter}`;
        if (activeTool === 'pen' || activeTool === 'highlighter' || activeTool === 'front' || activeTool === 'area') {
            const w = activeTool === 'highlighter' && widthPresetId !== 'custom'
                ? activeWidth * 3.5 + 8
                : activeWidth;
            activeDraft = {
                id,
                type: activeTool,
                color: activeColor,
                width: w,
                strokeStyle,
                points: [{ x: pos.x, y: pos.y }],
                frontType,
                flipSide: frontFlip,
                opacity: activeTool === 'highlighter' ? hlOpacity : activeOpacity,
                fadeDirs: [...activeFadeDirs],
                fadeSpeed: activeFadeSpeed
            };
            interaction = { kind: 'draw-poly', shiftSnap: Boolean(e.shiftKey) };
        } else if (activeTool === 'line' || activeTool === 'arrow') {
            activeDraft = {
                id,
                type: activeTool,
                color: activeColor,
                width: activeWidth,
                strokeStyle,
                x1: pos.x, y1: pos.y,
                x2: pos.x, y2: pos.y,
                opacity: activeOpacity,
                fadeDirs: [...activeFadeDirs],
                fadeSpeed: activeFadeSpeed
            };
            interaction = { kind: 'draw-line' };
        } else if (activeTool === 'shape') {
            activeDraft = {
                id,
                type: 'shape',
                shapeType,
                fill: shapeFill,
                color: activeColor,
                width: activeWidth,
                x: pos.x, y: pos.y, w: 0, h: 0,
                startX: pos.x, startY: pos.y,
                opacity: activeOpacity,
                fadeDirs: [...activeFadeDirs],
                fadeSpeed: activeFadeSpeed
            };
            interaction = { kind: 'draw-shape' };
        }
    });

    window.addEventListener('pointermove', (e) => {
        if (!drawModeActive || !interaction) return;
        const pos = getPos(e);
        if (e.shiftKey && interaction.kind === 'draw-poly') {
            interaction.shiftSnap = true;
        }

        if (interaction.kind === 'erase') {
            for (let i = objects.length - 1; i >= 0; i--) {
                if (hitTestObject(objects[i], pos.x, pos.y)) {
                    objects.splice(i, 1);
                    interaction.erasedAny = true;
                    redrawAll();
                    break;
                }
            }
        } else if (interaction.kind === 'move') {
            const dx = pos.x - interaction.lastX;
            const dy = pos.y - interaction.lastY;
            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) interaction.didMove = true;
            moveObject(interaction.obj, dx, dy);
            interaction.lastX = pos.x;
            interaction.lastY = pos.y;
            redrawAll();
        } else if (interaction.kind === 'resize') {
            const dx = pos.x - interaction.startX;
            const dy = pos.y - interaction.startY;
            interaction.didMove = true;
            const ob = interaction.origBounds;
            let nx = ob.x, ny = ob.y, nw = ob.w, nh = ob.h;
            if (interaction.dir.includes('e')) nw = Math.max(16, ob.w + dx);
            if (interaction.dir.includes('s')) nh = Math.max(16, ob.h + dy);
            if (interaction.dir.includes('w')) { nw = Math.max(16, ob.w - dx); nx = ob.x + (ob.w - nw); }
            if (interaction.dir.includes('n')) { nh = Math.max(16, ob.h - dy); ny = ob.y + (ob.h - nh); }
            scaleObject(interaction.obj, getObjectBounds(interaction.obj), { x: nx, y: ny, w: nw, h: nh });
            redrawAll();
        } else if (interaction.kind === 'draw-poly' && activeDraft) {
            const pts = activeDraft.points;
            const last = pts[pts.length - 1];
            if (Math.hypot(pos.x - last.x, pos.y - last.y) >= 2.5) {
                pts.push({ x: pos.x, y: pos.y });
                redrawAll();
            }
        } else if (interaction.kind === 'draw-line' && activeDraft) {
            activeDraft.x2 = pos.x;
            activeDraft.y2 = pos.y;
            redrawAll();
        } else if (interaction.kind === 'draw-shape' && activeDraft) {
            let w = pos.x - activeDraft.startX;
            let h = pos.y - activeDraft.startY;
            if (e.shiftKey) {
                const m = Math.max(Math.abs(w), Math.abs(h));
                w = (w < 0 ? -1 : 1) * m;
                h = (h < 0 ? -1 : 1) * m;
            }
            activeDraft.x = w < 0 ? activeDraft.startX + w : activeDraft.startX;
            activeDraft.y = h < 0 ? activeDraft.startY + h : activeDraft.startY;
            activeDraft.w = Math.abs(w);
            activeDraft.h = Math.abs(h);
            redrawAll();
        }
    });

    window.addEventListener('pointerup', (e) => {
        if (!drawModeActive || !interaction) return;

        if (interaction.kind === 'erase' && interaction.erasedAny) {
            pushUndoSnapshot();
        } else if ((interaction.kind === 'move' || interaction.kind === 'resize') && interaction.didMove) {
            pushUndoSnapshot();
        } else if (activeDraft) {
            let valid = false;
            if (activeDraft.points) {
                if (activeDraft.points.length >= 2) {
                    // 🌟 Hold/Press Shift -> Mac-style Smart Smooth Line / Arc / Ellipse Snap!
                    if (interaction.shiftSnap || e.shiftKey) {
                        activeDraft.points = snapFreehandStroke(activeDraft.points, activeDraft.type === 'area');
                    } else if (activeDraft.type === 'pen' && strokeSmoothing > 0) {
                        activeDraft.points = smoothPoints(activeDraft.points, strokeSmoothing);
                    }
                    valid = true;
                }
            } else if (activeDraft.type === 'line' || activeDraft.type === 'arrow') {
                valid = Math.hypot(activeDraft.x2 - activeDraft.x1, activeDraft.y2 - activeDraft.y1) >= 4;
            } else if (activeDraft.type === 'shape') {
                valid = activeDraft.w >= 6 && activeDraft.h >= 6;
            }

            if (valid) {
                objects.push(activeDraft);
                pushUndoSnapshot();
            }
            activeDraft = null;
            redrawAll();
        }

        interaction = null;
    });

    canvasEl.addEventListener('dblclick', (e) => {
        if (!drawModeActive) return;
        const pos = getPos(e);
        for (let i = objects.length - 1; i >= 0; i--) {
            if (objects[i].type === 'text' && hitTestObject(objects[i], pos.x, pos.y)) {
                openInlineTextInput(pos.x, pos.y, objects[i]);
                return;
            }
        }
    });

    window.addEventListener('keydown', (e) => {
        if (!drawModeActive) return;
        if (document.activeElement?.tagName === 'INPUT') return;

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) redoDraw();
            else undoDraw();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObjId) {
            e.preventDefault();
            objects = objects.filter((o) => o.id !== selectedObjId);
            selectedObjId = null;
            pushUndoSnapshot();
            redrawAll();
            renderOptionsStrip();
        } else if (e.key === 'Escape') {
            toggleDrawMode(false);
        }
    });
}

/* =========================================================================
   INIT
   ========================================================================= */

export function initDrawOverlay(map) {
    if (map) mapRef = map;
    if (canvasEl) return;

    canvasEl = document.createElement('canvas');
    canvasEl.id = 'draw-canvas';
    canvasEl.className = 'draw-canvas';
    document.body.appendChild(canvasEl);
    ctx = canvasEl.getContext('2d');

    uiWrap = document.createElement('div');
    uiWrap.id = 'draw-toolbar-wrap';
    uiWrap.className = 'draw-toolbar-wrap';
    uiWrap.style.display = 'none';
    uiWrap.innerHTML = `
        <div id="draw-options-strip" class="draw-options-strip" style="display: none;"></div>
        <div id="draw-toolbar" class="draw-toolbar"></div>
    `;
    document.body.appendChild(uiWrap);

    optionsStripEl = document.getElementById('draw-options-strip');
    toolbarEl = document.getElementById('draw-toolbar');

    const railBtn = document.getElementById('btn-draw-mode');
    if (railBtn) {
        railBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDrawMode();
        });
    }

    pushUndoSnapshot();
    attachCanvasEvents();
    window.addEventListener('resize', redrawAll);
}
