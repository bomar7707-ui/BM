import * as XLSX from 'xlsx';
import { Hike } from '../types';
import { formatCzechDate } from './dateUtils';

export function exportHikesToExcel(hikes: Hike[], filename = 'vyslapy-z-cloudu.xlsx') {
  if (hikes.length === 0) return;

  const excelData = hikes.map((hike) => {
    const routes = hike.routes || hike.maps || [];
    const mapLinks = routes
      .map((r, i) => (r.link || r.url ? `Úsek ${i + 1}: ${r.link || r.url}` : ''))
      .filter(Boolean)
      .join(' | ');

    const photoLinks = routes
      .map((r, i) => (r.photosUrl || r.photos ? `Úsek ${i + 1}: ${r.photosUrl || r.photos}` : ''))
      .filter(Boolean)
      .join(' | ');

    const ytLinks = routes
      .map((r, i) => (r.youtube || r.video ? `Úsek ${i + 1}: ${r.youtube || r.video}` : ''))
      .filter(Boolean)
      .join(' | ');

    const dist = typeof hike.distance === 'string' ? parseFloat(hike.distance) || 0 : hike.distance;

    return {
      'Název': hike.name,
      'Vzdálenost (km)': dist,
      'Datum od': formatCzechDate(hike.date || hike.rawDate),
      'Datum do': hike.dateTo || hike.endDate ? formatCzechDate(hike.dateTo || hike.endDate) : '',
      'Účastníci': hike.participants || '',
      'Odkazy na mapy': mapLinks || '',
      'Odkazy na fotky': photoLinks || '',
      'YouTube videa': ytLinks || '',
      'Poznámka': hike.note || '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Výšlapy Horský zápisník');
  XLSX.writeFile(wb, filename);
}
