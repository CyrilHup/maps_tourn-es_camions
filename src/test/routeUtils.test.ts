import { describe, it, expect } from 'vitest';
import {
  calculateDistance,
  parseGPSCoordinates,
  formatDuration,
  formatDistance,
  generateId,
  isAddress,
  trimAddress,
  decodePolyline,
  encodePolyline,
} from '../utils/routeUtils';

describe('calculateDistance', () => {
  it('should calculate distance between two coordinates using Haversine formula', () => {
    // Paris to London (approximately 344 km)
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    const london = { latitude: 51.5074, longitude: -0.1278 };
    
    const distance = calculateDistance(paris, london);
    
    // Should be approximately 344 km (allow some tolerance for different implementations)
    expect(distance).toBeGreaterThan(340);
    expect(distance).toBeLessThan(350);
  });

  it('should return 0 for same coordinates', () => {
    const coord = { latitude: 48.8566, longitude: 2.3522 };
    
    const distance = calculateDistance(coord, coord);
    
    expect(distance).toBe(0);
  });

  it('should calculate short distances accurately', () => {
    // Two points about 1 km apart in Paris
    const point1 = { latitude: 48.8566, longitude: 2.3522 };
    const point2 = { latitude: 48.8656, longitude: 2.3522 }; // ~1km north
    
    const distance = calculateDistance(point1, point2);
    
    expect(distance).toBeGreaterThan(0.9);
    expect(distance).toBeLessThan(1.1);
  });

  it('should handle negative coordinates (southern/western hemispheres)', () => {
    // Sydney, Australia
    const sydney = { latitude: -33.8688, longitude: 151.2093 };
    // São Paulo, Brazil
    const saoPaulo = { latitude: -23.5505, longitude: -46.6333 };
    
    const distance = calculateDistance(sydney, saoPaulo);
    
    // Should be approximately 13,500 km
    expect(distance).toBeGreaterThan(13000);
    expect(distance).toBeLessThan(14000);
  });
});

describe('parseGPSCoordinates', () => {
  it('should parse comma-separated coordinates', () => {
    const result = parseGPSCoordinates('48.8566, 2.3522');
    
    expect(result).toEqual({ latitude: 48.8566, longitude: 2.3522 });
  });

  it('should parse comma-separated coordinates without space', () => {
    const result = parseGPSCoordinates('48.8566,2.3522');
    
    expect(result).toEqual({ latitude: 48.8566, longitude: 2.3522 });
  });

  it('should parse space-separated coordinates', () => {
    const result = parseGPSCoordinates('48.8566 2.3522');
    
    expect(result).toEqual({ latitude: 48.8566, longitude: 2.3522 });
  });

  it('should parse negative coordinates', () => {
    const result = parseGPSCoordinates('-33.8688, 151.2093');
    
    expect(result).toEqual({ latitude: -33.8688, longitude: 151.2093 });
  });

  it('should parse labeled coordinates (lat/lng)', () => {
    const result = parseGPSCoordinates('lat: 48.8566 lng: 2.3522');
    
    expect(result).toEqual({ latitude: 48.8566, longitude: 2.3522 });
  });

  it('should parse labeled coordinates (latitude/longitude)', () => {
    const result = parseGPSCoordinates('latitude: 48.8566 longitude: 2.3522');
    
    expect(result).toEqual({ latitude: 48.8566, longitude: 2.3522 });
  });

  it('should return null for invalid coordinates', () => {
    expect(parseGPSCoordinates('not coordinates')).toBeNull();
    expect(parseGPSCoordinates('abc, def')).toBeNull();
    expect(parseGPSCoordinates('')).toBeNull();
  });

  it('should return null for out-of-range latitude', () => {
    // Latitude must be between -90 and 90
    expect(parseGPSCoordinates('91.0, 2.3522')).toBeNull();
    expect(parseGPSCoordinates('-91.0, 2.3522')).toBeNull();
  });

  it('should return null for out-of-range longitude', () => {
    // Longitude must be between -180 and 180
    expect(parseGPSCoordinates('48.8566, 181.0')).toBeNull();
    expect(parseGPSCoordinates('48.8566, -181.0')).toBeNull();
  });

  it('should handle integer coordinates', () => {
    const result = parseGPSCoordinates('48, 2');
    
    expect(result).toEqual({ latitude: 48, longitude: 2 });
  });
});

describe('formatDuration', () => {
  it('should format minutes under 60 as minutes', () => {
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(1)).toBe('1 min');
  });

  it('should format exact hours without minutes', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(180)).toBe('3h');
  });

  it('should format hours and minutes', () => {
    expect(formatDuration(90)).toBe('1h 30min');
    expect(formatDuration(150)).toBe('2h 30min');
    expect(formatDuration(75)).toBe('1h 15min');
  });

  it('should round minutes appropriately', () => {
    expect(formatDuration(30.4)).toBe('30 min');
    expect(formatDuration(30.6)).toBe('31 min');
  });
});

describe('formatDistance', () => {
  it('should format distances under 1km as meters', () => {
    expect(formatDistance(0.5)).toBe('500 m');
    expect(formatDistance(0.1)).toBe('100 m');
    expect(formatDistance(0.05)).toBe('50 m');
  });

  it('should format distances 1km and over as kilometers', () => {
    expect(formatDistance(1)).toBe('1.0 km');
    expect(formatDistance(5.5)).toBe('5.5 km');
    expect(formatDistance(100.25)).toBe('100.3 km');
  });
});

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId();
    const id2 = generateId();
    
    expect(id1).not.toBe(id2);
  });

  it('should use provided prefix', () => {
    const id = generateId('location');
    
    expect(id).toMatch(/^location_/);
  });

  it('should use default prefix when none provided', () => {
    const id = generateId();
    
    expect(id).toMatch(/^id_/);
  });

  it('should include timestamp in ID', () => {
    const before = Date.now();
    const id = generateId('test');
    const after = Date.now();
    
    // Extract timestamp from ID (format: prefix_timestamp_random)
    const parts = id.split('_');
    const timestamp = parseInt(parts[1], 10);
    
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('isAddress', () => {
  it('should return true for typical addresses', () => {
    expect(isAddress('10 Downing Street, London')).toBe(true);
    expect(isAddress('123 Main Ave')).toBe(true);
    expect(isAddress('Paris, France')).toBe(true);
  });

  it('should return false for GPS coordinates', () => {
    expect(isAddress('48.8566, 2.3522')).toBe(false);
    expect(isAddress('48.8566 2.3522')).toBe(false);
    expect(isAddress('-33.8688, 151.2093')).toBe(false);
  });

  it('should recognize addresses with postal codes', () => {
    // 5-digit postal codes are recognized
    expect(isAddress('75001 Paris')).toBe(true);
    // UK postal codes with letters may not match the simple 5-digit pattern
    // but addresses with commas are recognized
    expect(isAddress('London, EC1A 1BB')).toBe(true);
  });
});

describe('trimAddress', () => {
  it('should trim long addresses to name and city', () => {
    const fullAddress = 'Cathedral of Notre Dame, 6, Parvis Notre-Dame, Paris, France';
    const result = trimAddress(fullAddress);
    
    expect(result).toBe('Cathedral of Notre Dame, Paris');
  });

  it('should return unchanged if already short', () => {
    const shortAddress = 'Paris';
    const result = trimAddress(shortAddress);
    
    expect(result).toBe('Paris');
  });

  it('should handle empty string', () => {
    expect(trimAddress('')).toBe('');
  });

  it('should handle null/undefined gracefully', () => {
    expect(trimAddress(null as unknown as string)).toBeFalsy();
    expect(trimAddress(undefined as unknown as string)).toBeFalsy();
  });

  it('should extract city from known city names', () => {
    const address = 'Eiffel Tower, Champ de Mars, Paris, Île-de-France, France';
    const result = trimAddress(address);
    
    expect(result).toContain('Paris');
    expect(result).toContain('Eiffel Tower');
  });
});

describe('polyline encoding/decoding', () => {
  it('should encode and decode coordinates symmetrically', () => {
    const originalCoords = [
      [2.3522, 48.8566], // Paris
      [-0.1278, 51.5074], // London
    ];
    
    const encoded = encodePolyline(originalCoords);
    const decoded = decodePolyline(encoded);
    
    // Check first coordinate (with precision tolerance)
    expect(decoded[0][0]).toBeCloseTo(originalCoords[0][0], 4);
    expect(decoded[0][1]).toBeCloseTo(originalCoords[0][1], 4);
    
    // Check second coordinate
    expect(decoded[1][0]).toBeCloseTo(originalCoords[1][0], 4);
    expect(decoded[1][1]).toBeCloseTo(originalCoords[1][1], 4);
  });

  it('should decode empty polyline to empty array', () => {
    const decoded = decodePolyline('');
    
    expect(decoded).toEqual([]);
  });

  it('should handle negative coordinates', () => {
    const coords = [
      [-46.6333, -23.5505], // São Paulo (negative lat/lng)
    ];
    
    const encoded = encodePolyline(coords);
    const decoded = decodePolyline(encoded);
    
    expect(decoded[0][0]).toBeCloseTo(coords[0][0], 4);
    expect(decoded[0][1]).toBeCloseTo(coords[0][1], 4);
  });
});
