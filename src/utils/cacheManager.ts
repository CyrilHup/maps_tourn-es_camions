// Cache management for route calculations and user preferences
import { Route, RouteOptimizationRequest } from '../types/index';
import { cacheLogger as logger } from './logger';

// Cache pour les routes calculées
const routeCache = new Map<string, { route: Route, timestamp: number }>();
const ROUTE_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Cache pour les préférences utilisateur
const PREFERENCES_KEY = 'routeOptimizer_preferences';

export interface UserPreferences {
  vehicleType: 'car' | 'truck';
  optimizationMethod: 'shortest_distance' | 'fastest_time' | 'balanced';
  isLoop: boolean;
  autoSaveLocations: boolean;
  darkMode?: boolean;
}

// Génère une clé de cache pour une requête de route
export function generateRouteKey(request: RouteOptimizationRequest): string {
  const locationIds = request.locations
    .map(loc => `${loc.coordinates?.latitude?.toFixed(4)}_${loc.coordinates?.longitude?.toFixed(4)}`)
    .join('-');
  
  return `${locationIds}_${request.vehicleType}_${request.optimizationMethod}_${request.isLoop}`;
}

// Nettoie le cache des routes expirées
export function cleanRouteCache(): void {
  const now = Date.now();
  for (const [key, value] of routeCache.entries()) {
    if (now - value.timestamp > ROUTE_CACHE_DURATION) {
      routeCache.delete(key);
      logger.debug(`Route expirée supprimée du cache: ${key.substring(0, 20)}...`);
    }
  }
}

// Récupère une route du cache
export function getCachedRoute(request: RouteOptimizationRequest): Route | null {
  cleanRouteCache();
  
  const key = generateRouteKey(request);
  const cached = routeCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < ROUTE_CACHE_DURATION) {
    logger.debug(`Route récupérée du cache: ${key.substring(0, 20)}...`);
    return cached.route;
  }
  
  return null;
}

// Sauvegarde une route dans le cache
export function setCachedRoute(request: RouteOptimizationRequest, route: Route): void {
  const key = generateRouteKey(request);
  routeCache.set(key, {
    route,
    timestamp: Date.now()
  });
  
  logger.debug(`Route mise en cache: ${key.substring(0, 20)}...`);
  
  // Nettoyer le cache si il devient trop gros (max 50 routes)
  if (routeCache.size > 50) {
    const oldestKey = Array.from(routeCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
    routeCache.delete(oldestKey);
    logger.debug('Cache trop volumineux, suppression de la plus ancienne route');
  }
}

// Sauvegarde les préférences utilisateur
export function saveUserPreferences(preferences: UserPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    logger.debug('Préférences utilisateur sauvegardées');
  } catch (error) {
    logger.warn('Impossible de sauvegarder les préférences:', error);
  }
}

// Récupère les préférences utilisateur
export function getUserPreferences(): UserPreferences | null {
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    if (stored) {
      const preferences = JSON.parse(stored);
      logger.debug('Préférences utilisateur chargées');
      return preferences;
    }
  } catch (error) {
    logger.warn('Impossible de charger les préférences:', error);
  }
  
  return null;
}

// Récupère les préférences par défaut
export function getDefaultPreferences(): UserPreferences {
  return {
    vehicleType: 'car',
    optimizationMethod: 'balanced',
    isLoop: false,
    autoSaveLocations: true,
    darkMode: false
  };
}

// Vide tout le cache (pour le debugging ou les paramètres)
export function clearAllCache(): void {
  routeCache.clear();
  localStorage.removeItem(PREFERENCES_KEY);
  logger.debug('Tout le cache a été vidé');
}

// Statistiques du cache
export function getCacheStats(): { routeCount: number, totalSizeKB: number } {
  const totalSizeKB = Math.round(
    Array.from(routeCache.values())
      .reduce((acc, value) => acc + JSON.stringify(value).length, 0) / 1024
  );
  
  return {
    routeCount: routeCache.size,
    totalSizeKB
  };
}
