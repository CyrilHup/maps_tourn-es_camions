/**
 * Utility functions for route optimization and map operations
 */

/**
 * Decode a polyline string to an array of coordinates
 * This is a simplified implementation of Google's polyline algorithm
 */
export function decodePolyline(polyline: string, precision = 5): number[][] {
  const coordinates: number[][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const factor = Math.pow(10, precision);

  while (index < polyline.length) {
    let b: number;
    let shift = 0;
    let result = 0;

    // Decode latitude
    do {
      b = polyline.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    // Decode longitude
    do {
      b = polyline.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([lng / factor, lat / factor]);
  }

  return coordinates;
}

/**
 * Encode coordinates to a polyline string
 */
export function encodePolyline(coordinates: number[][], precision = 5): string {
  const factor = Math.pow(10, precision);
  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const [lng, lat] of coordinates) {
    const iLat = Math.round(lat * factor);
    const iLng = Math.round(lng * factor);

    const deltaLat = iLat - prevLat;
    const deltaLng = iLng - prevLng;

    output += encodeValue(deltaLat);
    output += encodeValue(deltaLng);

    prevLat = iLat;
    prevLng = iLng;
  }

  return output;
}

function encodeValue(value: number): string {
  value = value < 0 ? ~(value << 1) : value << 1;
  let output = '';

  while (value >= 0x20) {
    output += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
    value >>= 5;
  }

  output += String.fromCharCode(value + 63);
  return output;
}

/**
 * Calculate the distance between two coordinates using the Haversine formula
 */
export function calculateDistance(
  coord1: { latitude: number; longitude: number },
  coord2: { latitude: number; longitude: number }
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = degToRad(coord2.latitude - coord1.latitude);
  const dLon = degToRad(coord2.longitude - coord1.longitude);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degToRad(coord1.latitude)) * Math.cos(degToRad(coord2.latitude)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Generate a unique ID for routes, locations, etc.
 */
export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Format duration in minutes to a human-readable string
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  
  return `${hours}h ${remainingMinutes}min`;
}

/**
 * Format distance in kilometers to a human-readable string
 */
export function formatDistance(kilometers: number): string {
  if (kilometers < 1) {
    return `${Math.round(kilometers * 1000)} m`;
  }
  
  return `${kilometers.toFixed(1)} km`;
}

/**
 * Validate if a string is a valid GPS coordinate pair
 */
export function parseGPSCoordinates(input: string): { latitude: number; longitude: number } | null {
  // Remove any extra whitespace
  const cleaned = input.trim();
  
  // Try different coordinate formats
  const patterns = [
    /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/, // "lat,lng" or "lat, lng"
    /^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)$/, // "lat lng"
    /^lat:\s*(-?\d+\.?\d*)\s*lng:\s*(-?\d+\.?\d*)$/i, // "lat: X lng: Y"
    /^latitude:\s*(-?\d+\.?\d*)\s*longitude:\s*(-?\d+\.?\d*)$/i, // "latitude: X longitude: Y"
  ];
  
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      
      // Validate coordinate ranges
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { latitude: lat, longitude: lng };
      }
    }
  }
  
  return null;
}

/**
 * Validate if a string looks like an address (not GPS coordinates)
 */
export function isAddress(input: string): boolean {
  // If it parses as GPS coordinates, it's not an address
  if (parseGPSCoordinates(input)) {
    return false;
  }
  
  // Basic heuristics for addresses
  const addressIndicators = [
    /\d+\s+[a-zA-Z]/, // Number followed by letter (street number)
    /(street|street|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl)/i,
    /,/, // Contains comma (common in addresses)
    /\d{5}/, // Contains 5-digit number (postal code)
  ];
  
  return addressIndicators.some(pattern => pattern.test(input));
}

/**
 * Trim long addresses to just the basic name and city
 * Example: "Cathedral of Notre Dame, 6, Parvis Notre-Dame - Place Jean-Paul II, Quartier Les Îles, 4th Arrondissement, Paris, Metropolitan France, 75004, France"
 * Returns: "Cathedral of Notre Dame, Paris"
 */
export function trimAddress(fullAddress: string): string {
  if (!fullAddress) return fullAddress;
  
  const parts = fullAddress.split(',').map(part => part.trim());
  
  if (parts.length <= 1) {
    return fullAddress;
  }
  
  // Get the first part (main name/place)
  const mainName = parts[0];
  
  // Common city patterns and known cities
  const cityPatterns = [
    /^Paris$/i,
    /^London$/i,
    /^New York$/i,
    /^Berlin$/i,
    /^Madrid$/i,
    /^Rome$/i,
    /^Amsterdam$/i,
    /^Brussels$/i,
    /^Vienna$/i,
    /^Prague$/i,
    /^Warsaw$/i,
    /^Budapest$/i,
    /^Stockholm$/i,
    /^Oslo$/i,
    /^Copenhagen$/i,
    /^Helsinki$/i,
    /^Dublin$/i,
    /^Lisbon$/i,
    /^Athens$/i,
    /^Barcelona$/i,
    /^Milan$/i,
    /^Munich$/i,
    /^Frankfurt$/i,
    /^Hamburg$/i,
    /^Lyon$/i,
    /^Marseille$/i,
    /^Toulouse$/i,
    /^Nice$/i,
    /^Lille$/i,
    /^Bordeaux$/i,
    /^Nantes$/i,
    /^Strasbourg$/i,
    /^Montpellier$/i,
  ];
  
  // Find city by looking for known city patterns
  let city = '';
  for (const part of parts) {
    const cleanPart = part.trim();
    
    // Skip if it's a postal code, country, or administrative region
    if (/^\d+$/.test(cleanPart)) continue; // postal codes
    if (/^[A-Z]{2,3}$/.test(cleanPart)) continue; // country codes
    if (/(france|germany|italy|spain|uk|united kingdom|netherlands|belgium|austria|switzerland)$/i.test(cleanPart)) continue; // countries
    if (/(metropolitan|arrondissement|quartier|district|borough|county|province|region|state)$/i.test(cleanPart)) continue; // administrative regions
    
    // Check if it matches a known city pattern
    const isCity = cityPatterns.some(pattern => pattern.test(cleanPart));
    if (isCity) {
      city = cleanPart;
      break;
    }
    
    // If no known city found, look for parts that seem like cities (simple names, not too long)
    if (!city && cleanPart.length >= 3 && cleanPart.length <= 20 && 
        !/^\d/.test(cleanPart) && // doesn't start with number
        !/[-–—]/.test(cleanPart) && // doesn't contain dashes (usually street names)
        !/^(avenue|street|road|boulevard|place|square|rue|via|plaza)$/i.test(cleanPart)) { // not street types
      city = cleanPart;
    }
  }
  
  // If we found both name and city, combine them
  if (mainName && city && mainName !== city) {
    return `${mainName}, ${city}`;
  }
  
  // Fallback: return just the main name or first two parts
  return parts.length > 1 ? `${parts[0]}, ${parts[1]}` : parts[0];
}
