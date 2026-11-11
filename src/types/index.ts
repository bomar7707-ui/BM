export type Coordinate = [number, number] | [number, number, number]; // [lat, lon] or [lat, lon, ele]

export interface RoutePart {
  distance?: number | string;
  link?: string; // e.g. mapy.cz URL
  gpxData?: string | null; // raw GPX xml or string
  gpxName?: string;
  gpxUrl?: string;
  photosUrl?: string; // photo gallery link
  youtube?: string; // youtube video link
  hasGpx?: boolean;
  coordinates?: Coordinate[];
  visible?: boolean;
  photos?: string;
  video?: string;
  url?: string;
}

export interface Hike {
  id: string;
  name: string;
  distance: number | string;
  date: string; // ISO date or formatted "YYYY-MM-DD" or "DD. MM. YYYY"
  dateTo?: string; // ISO date or formatted
  rawDate?: string;
  endDate?: string;
  participants?: string;
  note?: string;
  routes?: RoutePart[];
  maps?: RoutePart[];
  gpx?: string; // legacy single GPX field
}

export interface FilterState {
  year: string;
  month: string;
  participant: string;
  tripId?: string;
}

export interface GlobalStats {
  tripCount: number;
  totalDistance: number;
  totalAscent: number;
  totalDescent: number;
  maxElevation: number;
  maxElevationTripName: string;
}
