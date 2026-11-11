import { jsPDF } from 'jspdf';
import { Coordinate, Hike, FilterState } from '../types';
import { getDisplayDateRange } from './dateUtils';

const CZECH_MONTHS: Record<string, string> = {
  '1': 'Leden',
  '2': 'Únor',
  '3': 'Březen',
  '4': 'Duben',
  '5': 'Květen',
  '6': 'Červen',
  '7': 'Červenec',
  '8': 'Srpen',
  '9': 'Září',
  '10': 'Říjen',
  '11': 'Listopad',
  '12': 'Prosinec',
};

export function drawShapeToRect(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  coords: Coordinate[]
) {
  if (!coords || coords.length === 0) return;

  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;

  coords.forEach((p) => {
    const lat = p[0];
    const lon = p[1];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  });

  if (minLat === Infinity || maxLat === -Infinity) return;

  const pad = Math.round(Math.min(rw, rh) * 0.12);
  const availW = rw - pad * 2;
  const availH = rh - pad * 2;
  const lonSpan = maxLon - minLon || 0.001;
  const latSpan = maxLat - minLat || 0.001;
  const sX = availW / lonSpan;
  const sY = availH / latSpan;
  const scale = Math.min(sX, sY);

  const offsetX = rx + pad + (availW - lonSpan * scale) / 2;
  const offsetY = ry + pad + (availH - latSpan * scale) / 2;

  const gX = (lon: number) => offsetX + (lon - minLon) * scale;
  const gY = (lat: number) => offsetY + availH - (availH - latSpan * scale) - (lat - minLat) * scale;

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  coords.forEach((p, i) => {
    const x = gX(p[1]);
    const y = gY(p[0]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Start point
  ctx.beginPath();
  ctx.fillStyle = '#10b981';
  ctx.arc(gX(coords[0][1]), gY(coords[0][0]), 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // End point
  const last = coords[coords.length - 1];
  ctx.beginPath();
  ctx.fillStyle = '#ef4444';
  ctx.arc(gX(last[1]), gY(last[0]), 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

export function drawProfileToRect(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  coords: Coordinate[],
  minE: number,
  maxE: number
) {
  if (!coords || coords.length < 2) return;

  const padX = 18;
  const padTop = 24;
  const padBottom = 18;
  const plotW = rw - padX * 2;
  const plotH = rh - padTop - padBottom;
  const range = maxE - minE || 1;

  const gX = (i: number) => rx + padX + (i / (coords.length - 1)) * plotW;
  const gY = (ele: number) => ry + padTop + plotH - ((ele - minE) / range) * plotH;

  ctx.save();

  // Filled gradient area
  ctx.beginPath();
  ctx.moveTo(gX(0), ry + padTop + plotH);
  coords.forEach((p, i) => {
    const ele = typeof p[2] === 'number' && !isNaN(p[2]) ? p[2] : minE;
    ctx.lineTo(gX(i), gY(ele));
  });
  ctx.lineTo(gX(coords.length - 1), ry + padTop + plotH);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, ry + padTop, 0, ry + padTop + plotH);
  grad.addColorStop(0, 'rgba(16, 185, 129, 0.42)');
  grad.addColorStop(1, 'rgba(16, 185, 129, 0.04)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Stroke line
  ctx.beginPath();
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  coords.forEach((p, i) => {
    const ele = typeof p[2] === 'number' && !isNaN(p[2]) ? p[2] : minE;
    if (i === 0) ctx.moveTo(gX(i), gY(ele));
    else ctx.lineTo(gX(i), gY(ele));
  });
  ctx.stroke();

  // Max and min labels
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`Max: ${Math.round(maxE)} m`, rx + padX, ry + 16);
  ctx.fillText(`Min: ${Math.round(minE)} m`, rx + rw - padX - 85, ry + 16);

  ctx.restore();
}

export function createShapeDataUrl(coords: Coordinate[]): string {
  if (!coords || coords.length === 0) return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawShapeToRect(ctx, 0, 0, canvas.width, canvas.height, coords);
    return canvas.toDataURL();
  } catch (e) {
    console.warn('Shape canvas generation error:', e);
    return '';
  }
}

export function createProfileDataUrl(coords: Coordinate[], minE: number, maxE: number): string {
  if (!coords || coords.length === 0) return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawProfileToRect(ctx, 0, 0, canvas.width, canvas.height, coords, minE, maxE);
    return canvas.toDataURL();
  } catch (e) {
    console.warn('Profile canvas error:', e);
    return '';
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function formatFilterSummary(filterState: FilterState): string {
  const parts: string[] = [];
  parts.push(`Rok: ${filterState.year === 'all' ? 'Všechny' : filterState.year}`);
  parts.push(
    `Měsíc: ${
      filterState.month === 'all'
        ? 'Všechny'
        : CZECH_MONTHS[filterState.month] || filterState.month
    }`
  );
  parts.push(
    `Účastník: ${filterState.participant === 'all' ? 'Všichni' : filterState.participant}`
  );
  return parts.join('  •  ');
}

export function exportFilteredHikesToPdf(
  hikes: Hike[],
  filterState: FilterState,
  options: { autoPrint?: boolean; filename?: string } = {}
): void {
  const PAGE_W = 1240;
  const PAGE_H = 1754;
  const MARGIN_X = 70;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;

  const totalKm = hikes.reduce((acc, h) => {
    const d = typeof h.distance === 'string' ? parseFloat(h.distance) : h.distance;
    return acc + (isNaN(d) ? 0 : d);
  }, 0);

  const pages: HTMLCanvasElement[] = [];

  const createNewPage = (isFirstPage: boolean): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; startY: number } => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;

    // White page background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    let y = 65;

    if (isFirstPage) {
      // Header bar
      drawRoundedRect(ctx, MARGIN_X, y, CONTENT_W, 135, 20);
      ctx.fillStyle = '#ecfdf5';
      ctx.fill();
      ctx.strokeStyle = '#a7f3d0';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#065f46';
      ctx.font = 'bold 34px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Horský zápisník & Archív tras', PAGE_W / 2, y + 52);

      ctx.fillStyle = '#047857';
      ctx.font = '600 20px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(
        `Přehled výšlapů a turistických tras  •  Celkem ${hikes.length} tras (${totalKm.toFixed(1)} km)`,
        PAGE_W / 2,
        y + 86
      );

      ctx.fillStyle = '#475569';
      ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(formatFilterSummary(filterState), PAGE_W / 2, y + 115);

      ctx.textAlign = 'left';
      y += 165;
    }

    pages.push(canvas);
    return { canvas, ctx, startY: y };
  };

  let currentPage = createNewPage(true);
  let cursorY = currentPage.startY;

  if (hikes.length === 0) {
    const { ctx } = currentPage;
    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 22px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Žádné trasy neodpovídají zvoleným filtrům.', PAGE_W / 2, cursorY + 80);
    ctx.textAlign = 'left';
  }

  hikes.forEach((hike, idx) => {
    const hasNote = Boolean(hike.note && hike.note.trim());
    const cardH = hasNote ? 365 : 320;

    if (cursorY + cardH > PAGE_H - 85) {
      currentPage = createNewPage(false);
      cursorY = currentPage.startY;
    }

    const { ctx } = currentPage;

    // Card container
    drawRoundedRect(ctx, MARGIN_X, cursorY, CONTENT_W, cardH, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Title & Date header
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 23px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const titleStr = `${idx + 1}. ${hike.name || 'Výšlap'}`;
    ctx.fillText(titleStr.slice(0, 62), MARGIN_X + 26, cursorY + 40);

    const dateStr = getDisplayDateRange(hike);
    ctx.fillStyle = '#64748b';
    ctx.font = '600 18px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(dateStr, MARGIN_X + CONTENT_W - 26, cursorY + 40);
    ctx.textAlign = 'left';

    // Divider line
    ctx.beginPath();
    ctx.moveTo(MARGIN_X + 24, cursorY + 56);
    ctx.lineTo(MARGIN_X + CONTENT_W - 24, cursorY + 56);
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Distance & participants row
    ctx.fillStyle = '#047857';
    ctx.font = 'bold 18px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const distText = `Vzdálenost: ${hike.distance} km`;
    ctx.fillText(distText, MARGIN_X + 26, cursorY + 84);

    if (hike.participants) {
      ctx.fillStyle = '#475569';
      ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const partText = `Účastníci: ${hike.participants}`;
      ctx.fillText(partText.slice(0, 75), MARGIN_X + 250, cursorY + 84);
    }

    // Extract coordinates
    const routes = hike.routes || hike.maps || [];
    let allCoords: Coordinate[] = [];
    routes.forEach((m) => {
      if (m.coordinates) allCoords = allCoords.concat(m.coordinates);
    });

    // Left box: Tvar trasy
    const boxY = cursorY + 102;
    const boxH = 195;
    const gap = 22;
    const box1W = Math.round((CONTENT_W - 52 - gap) * 0.42);
    const box2W = CONTENT_W - 52 - gap - box1W;
    const box1X = MARGIN_X + 26;
    const box2X = box1X + box1W + gap;

    drawRoundedRect(ctx, box1X, boxY, box1W, boxH, 12);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 13px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TVAR TRASY', box1X + box1W / 2, boxY + 22);

    if (allCoords.length > 0) {
      drawShapeToRect(ctx, box1X + 10, boxY + 28, box1W - 20, boxH - 34, allCoords);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'italic 16px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('Bez mapových bodů', box1X + box1W / 2, boxY + boxH / 2 + 8);
    }

    // Right box: Výškový profil
    drawRoundedRect(ctx, box2X, boxY, box2W, boxH, 12);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 13px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('VÝŠKOVÝ PROFIL', box2X + box2W / 2, boxY + 22);
    ctx.textAlign = 'left';

    const ptsWithEle = allCoords.filter(
      (p) => p.length >= 3 && typeof p[2] === 'number' && !isNaN(p[2])
    );
    if (ptsWithEle.length > 1) {
      let minE = Infinity;
      let maxE = -Infinity;
      ptsWithEle.forEach((p) => {
        const ele = p[2] as number;
        if (ele < minE) minE = ele;
        if (ele > maxE) maxE = ele;
      });
      drawProfileToRect(ctx, box2X + 10, boxY + 28, box2W - 20, boxH - 34, ptsWithEle, minE, maxE);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'italic 16px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Bez výškových dat', box2X + box2W / 2, boxY + boxH / 2 + 8);
      ctx.textAlign = 'left';
    }

    // Optional note
    if (hasNote && hike.note) {
      const noteY = boxY + boxH + 12;
      drawRoundedRect(ctx, MARGIN_X + 26, noteY, CONTENT_W - 52, 38, 8);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.fillStyle = '#475569';
      ctx.font = 'italic 15px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const cleanNote = hike.note.replace(/\s+/g, ' ').trim();
      ctx.fillText(
        cleanNote.length > 105 ? cleanNote.slice(0, 102) + '...' : cleanNote,
        MARGIN_X + 40,
        noteY + 24
      );
    }

    cursorY += cardH + 24;
  });

  // Add page numbers to all pages and compile into jsPDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  pages.forEach((canvas, idx) => {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 15px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Horský zápisník & Archív tras  •  Strana ${idx + 1} z ${pages.length}`,
      PAGE_W / 2,
      PAGE_H - 32
    );

    if (idx > 0) {
      pdf.addPage();
    }
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
  });

  if (options.autoPrint) {
    pdf.autoPrint();
  }

  const defaultName = `horsky-zapisnik-sestava-${new Date().toISOString().slice(0, 10)}.pdf`;
  pdf.save(options.filename || defaultName);
}
