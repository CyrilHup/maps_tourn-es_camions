import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateRouteKey,
  getCachedRoute,
  setCachedRoute,
  cleanRouteCache,
  saveUserPreferences,
  getUserPreferences,
  getDefaultPreferences,
  clearAllCache,
  getCacheStats,
  UserPreferences,
} from '../utils/cacheManager';
import { RouteOptimizationRequest, Route, Location } from '../types';

// Helper to create mock locations
const createMockLocation = (id: string, lat: number, lng: number): Location => ({
  id,
  address: `Address ${id}`,
  coordinates: { latitude: lat, longitude: lng },
});

// Helper to create mock request
const createMockRequest = (overrides?: Partial<RouteOptimizationRequest>): RouteOptimizationRequest => ({
  locations: [
    createMockLocation('1', 48.8566, 2.3522),
    createMockLocation('2', 48.8606, 2.3376),
  ],
  vehicleType: 'car',
  optimizationMethod: 'balanced',
  isLoop: false,
  ...overrides,
});

// Helper to create mock route
const createMockRoute = (overrides?: Partial<Route>): Route => ({
  id: 'route_123',
  locations: [
    createMockLocation('1', 48.8566, 2.3522),
    createMockLocation('2', 48.8606, 2.3376),
  ],
  totalDistance: 10.5,
  totalDuration: 15,
  vehicleType: 'car',
  isLoop: false,
  segments: [],
  optimizationMethod: 'balanced',
  ...overrides,
});

describe('generateRouteKey', () => {
  it('should generate consistent keys for same request', () => {
    const request = createMockRequest();
    
    const key1 = generateRouteKey(request);
    const key2 = generateRouteKey(request);
    
    expect(key1).toBe(key2);
  });

  it('should generate different keys for different locations', () => {
    const request1 = createMockRequest();
    const request2 = createMockRequest({
      locations: [
        createMockLocation('1', 48.8566, 2.3522),
        createMockLocation('2', 51.5074, -0.1278), // Different location
      ],
    });
    
    const key1 = generateRouteKey(request1);
    const key2 = generateRouteKey(request2);
    
    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for different vehicle types', () => {
    const request1 = createMockRequest({ vehicleType: 'car' });
    const request2 = createMockRequest({ vehicleType: 'truck' });
    
    const key1 = generateRouteKey(request1);
    const key2 = generateRouteKey(request2);
    
    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for different optimization methods', () => {
    const request1 = createMockRequest({ optimizationMethod: 'balanced' });
    const request2 = createMockRequest({ optimizationMethod: 'shortest_distance' });
    
    const key1 = generateRouteKey(request1);
    const key2 = generateRouteKey(request2);
    
    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for loop vs non-loop', () => {
    const request1 = createMockRequest({ isLoop: false });
    const request2 = createMockRequest({ isLoop: true });
    
    const key1 = generateRouteKey(request1);
    const key2 = generateRouteKey(request2);
    
    expect(key1).not.toBe(key2);
  });

  it('should include coordinate precision in key', () => {
    const key = generateRouteKey(createMockRequest());
    
    // Key should contain truncated coordinates (4 decimal places)
    expect(key).toContain('48.8566');
    expect(key).toContain('2.3522');
  });
});

describe('Route Cache', () => {
  beforeEach(() => {
    clearAllCache();
  });

  describe('setCachedRoute and getCachedRoute', () => {
    it('should cache and retrieve a route', () => {
      const request = createMockRequest();
      const route = createMockRoute();
      
      setCachedRoute(request, route);
      const cached = getCachedRoute(request);
      
      expect(cached).toEqual(route);
    });

    it('should return null for non-existent cache', () => {
      const request = createMockRequest();
      
      const cached = getCachedRoute(request);
      
      expect(cached).toBeNull();
    });

    it('should return null for different request', () => {
      const request1 = createMockRequest({ vehicleType: 'car' });
      const request2 = createMockRequest({ vehicleType: 'truck' });
      const route = createMockRoute();
      
      setCachedRoute(request1, route);
      const cached = getCachedRoute(request2);
      
      expect(cached).toBeNull();
    });

    it('should overwrite existing cache with same key', () => {
      const request = createMockRequest();
      const route1 = createMockRoute({ totalDistance: 10 });
      const route2 = createMockRoute({ totalDistance: 20 });
      
      setCachedRoute(request, route1);
      setCachedRoute(request, route2);
      const cached = getCachedRoute(request);
      
      expect(cached?.totalDistance).toBe(20);
    });
  });

  describe('cleanRouteCache', () => {
    it('should remove expired routes', () => {
      const request = createMockRequest();
      const route = createMockRoute();
      
      setCachedRoute(request, route);
      
      // Fast forward time by manipulating Date.now
      const originalNow = Date.now;
      Date.now = vi.fn(() => originalNow() + 31 * 60 * 1000); // 31 minutes later
      
      cleanRouteCache();
      const cached = getCachedRoute(request);
      
      Date.now = originalNow;
      
      expect(cached).toBeNull();
    });

    it('should keep non-expired routes', () => {
      const request = createMockRequest();
      const route = createMockRoute();
      
      setCachedRoute(request, route);
      
      // Fast forward only 10 minutes
      const originalNow = Date.now;
      Date.now = vi.fn(() => originalNow() + 10 * 60 * 1000);
      
      cleanRouteCache();
      const cached = getCachedRoute(request);
      
      Date.now = originalNow;
      
      expect(cached).toEqual(route);
    });
  });

  describe('getCacheStats', () => {
    it('should return correct route count', () => {
      const request1 = createMockRequest({ vehicleType: 'car' });
      const request2 = createMockRequest({ vehicleType: 'truck' });
      const route = createMockRoute();
      
      setCachedRoute(request1, route);
      setCachedRoute(request2, route);
      
      const stats = getCacheStats();
      
      expect(stats.routeCount).toBe(2);
    });

    it('should return zero for empty cache', () => {
      const stats = getCacheStats();
      
      expect(stats.routeCount).toBe(0);
      expect(stats.totalSizeKB).toBe(0);
    });
  });
});

describe('User Preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('saveUserPreferences', () => {
    it('should save preferences to localStorage', () => {
      const preferences: UserPreferences = {
        vehicleType: 'truck',
        optimizationMethod: 'fastest_time',
        isLoop: true,
        autoSaveLocations: false,
        darkMode: true,
      };
      
      saveUserPreferences(preferences);
      
      const stored = localStorage.getItem('routeOptimizer_preferences');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(preferences);
    });
  });

  describe('getUserPreferences', () => {
    it('should retrieve saved preferences', () => {
      const preferences: UserPreferences = {
        vehicleType: 'truck',
        optimizationMethod: 'fastest_time',
        isLoop: true,
        autoSaveLocations: false,
      };
      
      saveUserPreferences(preferences);
      const retrieved = getUserPreferences();
      
      expect(retrieved).toEqual(preferences);
    });

    it('should return null when no preferences saved', () => {
      const retrieved = getUserPreferences();
      
      expect(retrieved).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      localStorage.setItem('routeOptimizer_preferences', 'not valid json');
      
      const retrieved = getUserPreferences();
      
      // Should handle gracefully and return null
      expect(retrieved).toBeNull();
    });
  });

  describe('getDefaultPreferences', () => {
    it('should return default preferences', () => {
      const defaults = getDefaultPreferences();
      
      expect(defaults).toEqual({
        vehicleType: 'car',
        optimizationMethod: 'balanced',
        isLoop: false,
        autoSaveLocations: true,
        darkMode: false,
      });
    });
  });

  describe('clearAllCache', () => {
    it('should clear route cache and preferences', () => {
      const request = createMockRequest();
      const route = createMockRoute();
      const preferences: UserPreferences = {
        vehicleType: 'truck',
        optimizationMethod: 'fastest_time',
        isLoop: true,
        autoSaveLocations: false,
      };
      
      setCachedRoute(request, route);
      saveUserPreferences(preferences);
      
      clearAllCache();
      
      expect(getCachedRoute(request)).toBeNull();
      expect(getUserPreferences()).toBeNull();
      expect(getCacheStats().routeCount).toBe(0);
    });
  });
});
