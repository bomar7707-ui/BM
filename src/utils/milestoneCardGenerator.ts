import { MilestoneStatus } from './milestonesUtils';

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
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

const CATEGORY_LABELS: Record<MilestoneStatus['category'], string> = {
  distance: 'Kilometrová výzva',
  elevation: 'Výškový milník',
  activity: 'Časový a sezónní milník',
};

/**
 * Generates a high-resolution standalone milestone certificate/card as a PNG data URL.
 */
export function generateMilestoneCardDataUrl(
  milestone: MilestoneStatus,
  participantName: string
): string {
  const canvas = document.createElement('canvas');
  const width = 900;
  const height = 560;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Outer background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#064e3b'); // emerald-900
  bgGrad.addColorStop(0.5, '#0f766e'); // teal-700
  bgGrad.addColorStop(1, '#115e59'); // teal-800
  ctx.fillStyle = bgGrad;
  drawRoundedRect(ctx, 0, 0, width, height, 32);
  ctx.fill();

  // Inner white card
  const pad = 24;
  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 24);
  ctx.fill();

  // Top decorative banner inside white card
  const bannerGrad = ctx.createLinearGradient(pad, pad, width - pad, pad + 88);
  bannerGrad.addColorStop(0, '#ecfdf5'); // emerald-50
  bannerGrad.addColorStop(1, '#f0fdfa'); // teal-50
  ctx.fillStyle = bannerGrad;
  drawRoundedRect(ctx, pad + 16, pad + 16, width - (pad + 16) * 2, 82, 16);
  ctx.fill();

  // Header text
  ctx.fillStyle = '#047857';
  ctx.font = '800 14px Inter, system-ui, sans-serif';
  ctx.fillText('HORSKÝ ZÁPISNÍK & ARCHÍV TRAS • CERTIFIKÁT MILNÍKU', pad + 38, pad + 48);

  ctx.fillStyle = '#1c1917';
  ctx.font = '800 22px Inter, system-ui, sans-serif';
  ctx.fillText(`Turista: ${participantName}`, pad + 38, pad + 78);

  // Category Pill on Top Right
  const catLabel = CATEGORY_LABELS[milestone.category];
  ctx.font = '700 13px Inter, system-ui, sans-serif';
  const catTextW = ctx.measureText(catLabel).width;
  const pillW = catTextW + 28;
  const pillX = width - pad - 36 - pillW;
  const pillY = pad + 40;
  ctx.fillStyle = '#10b981';
  drawRoundedRect(ctx, pillX, pillY, pillW, 32, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(catLabel, pillX + 14, pillY + 21);

  // Milestone Icon Circle
  const iconBoxX = pad + 38;
  const iconBoxY = pad + 125;
  ctx.fillStyle = '#fef3c7'; // amber-100
  drawRoundedRect(ctx, iconBoxX, iconBoxY, 88, 88, 22);
  ctx.fill();
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '48px system-ui, Apple Color Emoji, Segoe UI Emoji, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1c1917';
  ctx.fillText(milestone.icon, iconBoxX + 44, iconBoxY + 61);
  ctx.textAlign = 'left';

  // Milestone Title & Explanation
  const contentX = iconBoxX + 112;
  ctx.fillStyle = '#059669';
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  ctx.fillText('SPLNĚNÝ HORSKÝ MILNÍK', contentX, iconBoxY + 24);

  ctx.fillStyle = '#0f172a';
  ctx.font = '900 30px Inter, system-ui, sans-serif';
  ctx.fillText(milestone.title, contentX, iconBoxY + 58);

  ctx.fillStyle = '#475569';
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.fillText(milestone.explanation, contentX, iconBoxY + 84);

  // Humorous note box
  const humorBoxY = iconBoxY + 114;
  const humorBoxW = width - (pad + 38) * 2;
  ctx.fillStyle = '#f8fafc';
  drawRoundedRect(ctx, iconBoxX, humorBoxY, humorBoxW, 118, 16);
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#334155';
  ctx.font = 'italic 500 16px Inter, system-ui, sans-serif';
  const humorLines = wrapCanvasText(ctx, `„${milestone.humor}“`, humorBoxW - 44);
  humorLines.slice(0, 3).forEach((line, idx) => {
    ctx.fillText(line, iconBoxX + 22, humorBoxY + 38 + idx * 26);
  });

  // Completion badge row
  const footerBoxY = humorBoxY + 140;
  ctx.fillStyle = '#ecfdf5';
  drawRoundedRect(ctx, iconBoxX, footerBoxY, humorBoxW, 64, 14);
  ctx.fill();
  ctx.strokeStyle = '#a7f3d0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#065f46';
  ctx.font = '800 15px Inter, system-ui, sans-serif';
  const completedInfo = [
    milestone.completedDate ? `Datum splnění: ${milestone.completedDate}` : 'Stav: Splněno',
    milestone.completedTripName ? `Trasa: ${milestone.completedTripName}` : '',
    milestone.currentLabel ? `Výkon: ${milestone.currentLabel}` : '',
  ]
    .filter(Boolean)
    .join('   •   ');
  ctx.fillText(completedInfo, iconBoxX + 20, footerBoxY + 38);

  // Bottom Motto
  ctx.fillStyle = '#64748b';
  ctx.font = '800 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    'KDYŽ NEMÁŠ CESTU, NEMŮŽEŠ ZTRATIT CÍL',
    width / 2,
    height - pad - 18
  );
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

export function getMilestoneCardSafeFilename(
  milestone: MilestoneStatus,
  participantName: string
): string {
  const cleanName = participantName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `milnik-${milestone.id}-${cleanName || 'turista'}.png`;
}

export function downloadMilestoneCardPng(
  milestone: MilestoneStatus,
  participantName: string
): string {
  const dataUrl = generateMilestoneCardDataUrl(milestone, participantName);
  if (!dataUrl) return '';
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = getMilestoneCardSafeFilename(milestone, participantName);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return dataUrl;
}

export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: 'image/png' });
  } catch {
    return null;
  }
}

export interface SendMilestoneEmailResult {
  sentViaApi: boolean;
  cardDataUrl: string;
  mailtoUrl: string;
}

/**
 * Sends a milestone completion notification email to the participant's address
 * and prepares the standalone milestone card attachment.
 */
export async function sendMilestoneEmailNotification(params: {
  participantName: string;
  email: string;
  milestone: MilestoneStatus;
}): Promise<SendMilestoneEmailResult> {
  const { participantName, email, milestone } = params;
  const cleanEmail = email.trim();
  const cardDataUrl = generateMilestoneCardDataUrl(milestone, participantName);

  const appUrl = 'https://bomar7707-ui.github.io/BM/';
  const subject = `🏆 Splněn horský milník: ${milestone.icon} ${milestone.title} (${participantName})`;
  const bodyLines = [
    `Ahoj ${participantName}!`,
    ``,
    `Právě byl zaznamenán splněný milník na stránce ${appUrl}`,
    `Zde jsou podrobnosti:`,
    ``,
    `${milestone.icon} ${milestone.title.toUpperCase()}`,
    `Podmínka: ${milestone.explanation}`,
    milestone.completedDate ? `Datum splnění: ${milestone.completedDate}` : '',
    milestone.completedTripName ? `Výšlap: ${milestone.completedTripName}` : '',
    `Aktuální stav: ${milestone.currentLabel}`,
    ``,
    `„${milestone.humor}“`,
    ``,
    `---`,
    `Horský zápisník & Archív tras (${appUrl})`,
    `KDYŽ NEMÁŠ CESTU, NEMŮŽEŠ ZTRATIT CÍL`,
  ].filter((l) => l !== undefined);

  const bodyText = bodyLines.join('\n');
  const mailtoUrl = `mailto:${encodeURIComponent(cleanEmail)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(bodyText)}`;

  // Try sending automatically via FormSubmit AJAX endpoint (works from static GitHub Pages)
  let sentViaApi = false;
  if (cleanEmail && cleanEmail.includes('@')) {
    try {
      const formData = new FormData();
      formData.append('_subject', subject);
      formData.append('_template', 'box');
      formData.append('_captcha', 'false');
      formData.append(
        'Oznámení z Horského zápisníku',
        `Právě byl splněn nový milník v aplikaci Horský zápisník! Zde jsou podrobnosti:`
      );
      formData.append('Odkaz na aplikaci', appUrl);
      formData.append('Turista', participantName);
      formData.append('Milník', `${milestone.icon} ${milestone.title}`);
      formData.append('Podmínka splnění', milestone.explanation);
      if (milestone.completedDate) {
        formData.append('Datum splnění', milestone.completedDate);
      }
      if (milestone.completedTripName) {
        formData.append('Trasa výšlapu', milestone.completedTripName);
      }
      formData.append('Dosažený výkon', milestone.currentLabel);
      formData.append('Poznámka', milestone.humor);

      // Attach the standalone PNG milestone card file
      const file = await dataUrlToFile(
        cardDataUrl,
        getMilestoneCardSafeFilename(milestone, participantName)
      );
      if (file) {
        formData.append('attachment', file, file.name);
      }

      const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(cleanEmail)}`, {
        method: 'POST',
        referrerPolicy: 'unsafe-url',
        headers: {
          Accept: 'application/json',
        },
        body: formData,
      });

      if (response.ok) {
        const resJson = await response.json().catch(() => null);
        if (resJson && (resJson.success === 'true' || resJson.success === true)) {
          sentViaApi = true;
        }
      }
    } catch {
      // Fallback handled by UI modal / mailto / download
    }
  }

  return {
    sentViaApi,
    cardDataUrl,
    mailtoUrl,
  };
}
