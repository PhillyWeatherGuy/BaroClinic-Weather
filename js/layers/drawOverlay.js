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

let hlOpacity = 0.45;      // 0.10 - 0.95
let hlFadeDir = 'none';    // 'none' | 'middle' | 'top' | 'bottom' | 'left' | 'right'
let hlFadeSpeed = 0.55;    // 0.10 - 1.00

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
   GEOMETRY HELPERS & SMOOTHING
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
        return {
            x: Math.min(obj.x, obj.x + obj.w),
            y: Math.min(obj.y, obj.y + obj.h),
            w: Math.max(12, Math.abs(obj.w)),
            h: Math.max(12, Math.abs(obj.h))
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
        obj.x = nextBounds.x;
        obj.y = nextBounds.y;
        obj.w = nextBounds.w;
        obj.h = nextBounds.h;
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
   CANVAS RENDERING (Pen, Highlighter Fade, Weather Fronts, H/L, Area, Text)
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

function drawHighlighter(obj) {
    const pts = obj.points || [];
    if (pts.length < 2) return;
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
    sc.strokeStyle = obj.color;
    sc.lineWidth = obj.width;
    sc.lineCap = 'round';
    sc.lineJoin = 'round';
    sc.setLineDash([]);
    drawPolylinePath(sc, pts);
    sc.stroke();

    // Fade mask (Middle / Top / Bottom / Left / Right)
    if (obj.fadeDir && obj.fadeDir !== 'none') {
        const b = getObjectBounds(obj);
        if (b) {
            sc.globalCompositeOperation = 'destination-in';
            const spd = Math.max(0.1, Math.min(1.0, obj.fadeSpeed ?? 0.55));
            const reach = Math.max(0.18, 1.15 - spd * 0.85); // higher speed = sharper dropoff

            let grad = null;
            if (obj.fadeDir === 'middle') {
                const cx = b.x + b.w / 2;
                const cy = b.y + b.h / 2;
                const maxR = Math.max(12, Math.hypot(b.w / 2, b.h / 2) * reach);
                grad = sc.createRadialGradient(cx, cy, maxR * 0.08, cx, cy, maxR);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
            } else if (obj.fadeDir === 'top') {
                grad = sc.createLinearGradient(0, b.y, 0, b.y + b.h * reach);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
            } else if (obj.fadeDir === 'bottom') {
                grad = sc.createLinearGradient(0, b.y + b.h, 0, b.y + b.h - b.h * reach);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
            } else if (obj.fadeDir === 'left') {
                grad = sc.createLinearGradient(b.x, 0, b.x + b.w * reach, 0);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
            } else if (obj.fadeDir === 'right') {
                grad = sc.createLinearGradient(b.x + b.w, 0, b.x + b.w - b.w * reach, 0);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
            }

            if (grad) {
                sc.fillStyle = grad;
                sc.fillRect(b.x - 10, b.y - 10, b.w + 20, b.h + 20);
            }
        }
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0.05, Math.min(0.95, obj.opacity ?? 0.45));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratchCanvas, 0, 0);
    ctx.restore();
}

function drawWeatherFront(obj) {
    const pts = obj.points || [];
    if (pts.length < 2) return;

    const w = Math.max(2, obj.width || 4);
    const fType = obj.frontType || 'cold';
    const flip = obj.flipSide || 1;
    const symSize = Math.max(9, Math.min(26, w * 2.3 + 5));
    const step = Math.max(26, symSize * 2.2);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (fType === 'trough') {
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = w;
        ctx.setLineDash([Math.max(8, w * 2.5), Math.max(6, w * 1.8)]);
        drawPolylinePath(ctx, pts);
        ctx.stroke();
        ctx.restore();
        return;
    }

    // Draw base curve
    if (fType === 'stationary') {
        const segs = resamplePolyline(pts, step);
        ctx.lineWidth = w;
        for (let i = 0; i < segs.length - 1; i++) {
            const isCold = i % 2 === 0;
            ctx.strokeStyle = isCold ? '#2563eb' : '#dc2626';
            ctx.beginPath();
            ctx.moveTo(segs[i].x, segs[i].y);
            ctx.lineTo(segs[i + 1].x, segs[i + 1].y);
            ctx.stroke();
        }
    } else {
        const lineCol = fType === 'cold' ? '#2563eb'
            : fType === 'warm' ? '#dc2626'
            : fType === 'occluded' ? '#7c3aed'
            : '#b45309'; // dryline
        ctx.strokeStyle = lineCol;
        ctx.lineWidth = w;
        ctx.setLineDash([]);
        drawPolylinePath(ctx, pts);
        ctx.stroke();
    }

    // Draw meteorological symbols along resampled points
    const samples = resamplePolyline(pts, step);
    for (let i = 0; i < samples.length - 1; i++) {
        const p0 = samples[i];
        const p1 = samples[i + 1];
        const mx = (p0.x + p1.x) * 0.5;
        const my = (p0.y + p1.y) * 0.5;
        const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);

        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);

        const drawTriangle = (color, dir) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(-symSize * 0.48, 0);
            ctx.lineTo(symSize * 0.48, 0);
            ctx.lineTo(0, -symSize * 0.92 * dir);
            ctx.closePath();
            ctx.fill();
        };

        const drawSemiCircle = (color, dir, openOnly = false) => {
            ctx.beginPath();
            if (dir > 0) {
                ctx.arc(0, 0, symSize * 0.45, Math.PI, 0, false);
            } else {
                ctx.arc(0, 0, symSize * 0.45, 0, Math.PI, false);
            }
            if (openOnly) {
                ctx.strokeStyle = color;
                ctx.lineWidth = Math.max(1.8, w * 0.75);
                ctx.stroke();
            } else {
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
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

        ctx.restore();
    }

    ctx.restore();
}

function drawHatchedArea(obj) {
    const pts = obj.points || [];
    if (pts.length < 3) return;
    const b = getObjectBounds(obj);
    if (!b) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    // Subtle tint inside hatched area
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = obj.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);

    // 45° diagonal hatching lines
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = Math.max(1.2, (obj.width || 3) * 0.45);
    const gap = Math.max(9, (obj.width || 3) * 2.2);
    const diag = b.w + b.h;
    ctx.beginPath();
    for (let d = -diag; d < diag * 2; d += gap) {
        ctx.moveTo(b.x + d, b.y);
        ctx.lineTo(b.x + d - b.h, b.y + b.h);
    }
    ctx.stroke();
    ctx.restore();

    // Perimeter outline
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = Math.max(1.8, (obj.width || 3) * 0.7);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
}

function drawTextObject(obj) {
    const fs = obj.fontSize || 20;
    const font = `700 ${fs}px ${obj.fontFamily || "'Roboto', sans-serif"}`;
    const lines = String(obj.text || 'Text').split('\n');
    const lineH = fs * 1.22;

    ctx.save();
    ctx.font = font;
    ctx.textBaseline = 'top';

    let maxW = 20;
    lines.forEach((l) => { maxW = Math.max(maxW, ctx.measureText(l).width); });

    if (obj.labelBox) {
        const padX = 10;
        const padY = 6;
        const boxH = lines.length * lineH + padY * 2;
        const isDarkText = ['#0f172a', '#000000', '#111827'].includes((obj.color || '').toLowerCase());
        ctx.fillStyle = isDarkText ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = obj.color || '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(obj.x - padX, obj.y - padY, maxW + padX * 2, boxH, 6);
        ctx.fill();
        ctx.stroke();
    }

    const eff = obj.effect || 'none';
    if (eff === 'drop') {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 3;
        ctx.shadowBlur = 4;
    } else if (eff === 'glow') {
        ctx.shadowColor = obj.color || '#ffffff';
        ctx.shadowBlur = 12;
    } else if (eff === 'neon') {
        ctx.shadowColor = obj.color || '#3b82f6';
        ctx.shadowBlur = 18;
    }

    lines.forEach((line, idx) => {
        const ly = obj.y + idx * lineH;
        if (eff === 'echo') {
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = obj.color;
            ctx.fillText(line, obj.x + 3, ly + 3);
            ctx.restore();
        }
        if (eff === 'outline') {
            ctx.strokeStyle = ['#ffffff', '#f8fafc'].includes((obj.color || '').toLowerCase()) ? '#0f172a' : '#ffffff';
            ctx.lineWidth = Math.max(2.5, fs * 0.14);
            ctx.lineJoin = 'round';
            ctx.strokeText(line, obj.x, ly);
        }
        if (eff === 'hollow') {
            ctx.strokeStyle = obj.color;
            ctx.lineWidth = Math.max(1.5, fs * 0.08);
            ctx.strokeText(line, obj.x, ly);
        } else {
            ctx.fillStyle = obj.color;
            ctx.fillText(line, obj.x, ly);
        }
    });

    ctx.restore();
}

function drawObject(obj) {
    if (!obj) return;
    if (obj.type === 'highlighter') {
        drawHighlighter(obj);
        return;
    }
    if (obj.type === 'front') {
        drawWeatherFront(obj);
        return;
    }
    if (obj.type === 'area') {
        drawHatchedArea(obj);
        return;
    }
    if (obj.type === 'text') {
        drawTextObject(obj);
        return;
    }

    ctx.save();
    ctx.strokeStyle = obj.color;
    ctx.fillStyle = obj.color;
    ctx.lineWidth = obj.width || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    applyDashPattern(ctx, obj.strokeStyle || 'solid', obj.width || 4);

    if (obj.type === 'pen') {
        drawPolylinePath(ctx, obj.points);
        ctx.stroke();
    } else if (obj.type === 'line' || obj.type === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(obj.x1, obj.y1);
        ctx.lineTo(obj.x2, obj.y2);
        ctx.stroke();
        if (obj.type === 'arrow') {
            const ang = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
            const headLen = Math.max(11, (obj.width || 4) * 2.8 + 4);
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(obj.x2, obj.y2);
            ctx.lineTo(obj.x2 - headLen * Math.cos(ang - Math.PI / 6), obj.y2 - headLen * Math.sin(ang - Math.PI / 6));
            ctx.moveTo(obj.x2, obj.y2);
            ctx.lineTo(obj.x2 - headLen * Math.cos(ang + Math.PI / 6), obj.y2 - headLen * Math.sin(ang + Math.PI / 6));
            ctx.stroke();
        }
    } else if (obj.type === 'shape') {
        ctx.setLineDash([]);
        const x = obj.x, y = obj.y, w = obj.w, h = obj.h;
        ctx.beginPath();
        if (obj.shapeType === 'circle') {
            ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        } else if (obj.shapeType === 'triangle') {
            ctx.moveTo(x + w / 2, y);
            ctx.lineTo(x + w, y + h);
            ctx.lineTo(x, y + h);
            ctx.closePath();
        } else {
            ctx.rect(x, y, w, h);
        }
        if (obj.fill) {
            ctx.save();
            ctx.globalAlpha = 0.25;
            ctx.fill();
            ctx.restore();
        }
        ctx.stroke();
    } else if (obj.type === 'stamp') {
        const s = obj.size || 40;
        const isHigh = obj.stampType === 'H';
        const col = isHigh ? '#2563eb' : '#dc2626';
        ctx.font = `900 ${s}px 'Inter', 'Roboto', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(3, s * 0.14);
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText(obj.stampType, obj.x, obj.y);
        ctx.fillStyle = col;
        ctx.fillText(obj.stampType, obj.x, obj.y);
    }

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
                effect: textEffect
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
    } else if (contextTool === 'highlighter') {
        const curOp = Math.round((selObj ? selObj.opacity : hlOpacity) * 100);
        const curFade = selObj ? (selObj.fadeDir || 'none') : hlFadeDir;
        const curSpeed = Math.round((selObj ? (selObj.fadeSpeed ?? 0.55) : hlFadeSpeed) * 100);
        html += `
            <div class="draw-opt-group">
                <span class="draw-opt-kicker">HIGHLIGHT</span>
                <span class="draw-opt-label">Opacity</span>
                <input id="draw-hl-opacity" class="draw-opt-slider" type="range" min="10" max="95" step="5" value="${curOp}" />
                <span id="draw-hl-opacity-val" class="draw-opt-val">${curOp}%</span>
                <span class="draw-opt-sep"></span>
                <span class="draw-opt-label">Fade</span>
                ${['none', 'middle', 'top', 'bottom', 'left', 'right'].map((dir) => `
                    <button type="button" class="draw-opt-pill ${curFade === dir ? 'active' : ''}" data-hl-fade="${dir}">
                        ${dir[0].toUpperCase() + dir.slice(1)}
                    </button>
                `).join('')}
                ${curFade !== 'none' ? `
                    <span class="draw-opt-sep"></span>
                    <span class="draw-opt-label">Speed</span>
                    <input id="draw-hl-speed" class="draw-opt-slider" type="range" min="10" max="100" step="5" value="${curSpeed}" />
                    <span id="draw-hl-speed-val" class="draw-opt-val">${curSpeed}%</span>
                ` : ''}
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

    const hlOpEl = optionsStripEl.querySelector('#draw-hl-opacity');
    hlOpEl?.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        hlOpacity = pct / 100;
        const valEl = optionsStripEl.querySelector('#draw-hl-opacity-val');
        if (valEl) valEl.textContent = `${pct}%`;
        if (selObj?.type === 'highlighter') {
            selObj.opacity = hlOpacity;
            redrawAll();
        }
    });
    hlOpEl?.addEventListener('change', () => { if (selObj?.type === 'highlighter') pushUndoSnapshot(); });

    optionsStripEl.querySelectorAll('[data-hl-fade]').forEach((btn) => {
        btn.addEventListener('click', () => {
            hlFadeDir = btn.dataset.hlFade;
            if (selObj?.type === 'highlighter') {
                selObj.fadeDir = hlFadeDir;
                pushUndoSnapshot();
                redrawAll();
            }
            renderOptionsStrip();
        });
    });

    const hlSpdEl = optionsStripEl.querySelector('#draw-hl-speed');
    hlSpdEl?.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        hlFadeSpeed = pct / 100;
        const valEl = optionsStripEl.querySelector('#draw-hl-speed-val');
        if (valEl) valEl.textContent = `${pct}%`;
        if (selObj?.type === 'highlighter') {
            selObj.fadeSpeed = hlFadeSpeed;
            redrawAll();
        }
    });
    hlSpdEl?.addEventListener('change', () => { if (selObj?.type === 'highlighter') pushUndoSnapshot(); });

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
            <button type="button" class="draw-tool-btn ${activeTool === 'pen' ? 'active' : ''}" data-tool="pen" title="Pen">
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
            <button type="button" class="draw-wx-btn ${activeTool === 'front' ? 'active' : ''}" data-tool="front" title="Weather Front">
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

    // Bind Toolbar Listeners
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
   CANVAS POINTER EVENTS (Draw, Erase, Select/Move/Resize)
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
                size: stampSize
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
                opacity: hlOpacity,
                fadeDir: hlFadeDir,
                fadeSpeed: hlFadeSpeed
            };
            interaction = { kind: 'draw-poly' };
        } else if (activeTool === 'line' || activeTool === 'arrow') {
            activeDraft = {
                id,
                type: activeTool,
                color: activeColor,
                width: activeWidth,
                strokeStyle,
                x1: pos.x, y1: pos.y,
                x2: pos.x, y2: pos.y
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
                startX: pos.x, startY: pos.y
            };
            interaction = { kind: 'draw-shape' };
        }
    });

    window.addEventListener('pointermove', (e) => {
        if (!drawModeActive || !interaction) return;
        const pos = getPos(e);

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

    window.addEventListener('pointerup', () => {
        if (!drawModeActive || !interaction) return;

        if (interaction.kind === 'erase' && interaction.erasedAny) {
            pushUndoSnapshot();
        } else if ((interaction.kind === 'move' || interaction.kind === 'resize') && interaction.didMove) {
            pushUndoSnapshot();
        } else if (activeDraft) {
            let valid = false;
            if (activeDraft.points) {
                if (activeDraft.points.length >= 2) {
                    if (activeDraft.type === 'pen' && strokeSmoothing > 0) {
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
