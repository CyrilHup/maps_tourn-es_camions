import { Location, Route, RouteSegment, VehicleType, OptimizationMethod, RouteOptimizationRequest, RouteOptimizationResponse } from '../types/index.ts';
import { getCachedRoute, setCachedRoute } from '../utils/cacheManager.ts';
import { routingLogger as logger } from '../utils/logger.ts';
import { config } from '../config/index.ts';

export interface FreeRoutingProvider {
  calculateRoute(request: RouteOptimizationRequest): Promise<RouteOptimizationResponse>;
  geocodeAddress(address: string): Promise<{ latitude: number; longitude: number } | null>;
}

// Maximum number of segments to keep in cache to prevent memory leaks
const MAX_SEGMENT_CACHE_SIZE = 100;

// OpenRouteService API configuration
const ORS_BASE_URL = 'https://api.openrouteservice.org';

export class OpenStreetMapRoutingService implements FreeRoutingProvider {
  private nominatimBaseUrl = 'https://nominatim.openstreetmap.org';
  private osrmBaseUrl = 'https://router.project-osrm.org';
  private openRouteServiceApiKey: string | null = null;
  
  // Cache for calculated segments to avoid redundant API calls (LRU-like with max size)
  private segmentCache = new Map<string, RouteSegment>();
  private segmentCacheOrder: string[] = []; // Track insertion order for LRU eviction

  constructor() {
    // Check for OpenRouteService API key for real truck routing
    this.openRouteServiceApiKey = import.meta.env.VITE_OPENROUTESERVICE_API_KEY || null;
    if (this.openRouteServiceApiKey) {
      logger.info('OpenRouteService API key configurée - routing camion réel activé');
    }
  }

  /**
   * Check if real truck routing is available via OpenRouteService
   */
  public hasTruckRouting(): boolean {
    return !!this.openRouteServiceApiKey;
  }

  private generateSegmentKey(from: Location, to: Location, vehicleType: VehicleType): string {
    return `${from.id}-${to.id}-${vehicleType}`;
  }

  private clearSegmentCache(): void {
    this.segmentCache.clear();
  }

  async calculateRoute(request: RouteOptimizationRequest): Promise<RouteOptimizationResponse> {
    const startTime = Date.now();
    
    // Vérifier le cache en premier
    const cachedRoute = getCachedRoute(request);
    if (cachedRoute) {
      logger.debug('Route trouvée dans le cache, retour immédiat');
      return {
        route: cachedRoute,
        metadata: {
          calculationTime: Date.now() - startTime,
          algorithm: 'cache-hit',
          apiProvider: 'Cache'
        }
      };
    }
    
    // Clear cache for each new route calculation
    this.clearSegmentCache();
    
    try {
      // Vérifier que tous les emplacements ont des coordonnées
      const missingCoordinates = request.locations.filter(loc => !loc.coordinates);
      if (missingCoordinates.length > 0) {
        throw new Error(
          `Les emplacements suivants n'ont pas de coordonnées : ${missingCoordinates.map(loc => loc.address).join(', ')}`
        );
      }

      if (request.locations.length < 2) {
        throw new Error('Au moins 2 emplacements sont requis pour calculer un trajet');
      }

      // Tous les emplacements ont des coordonnées, procéder à l'optimisation
      const optimizedLocations = await this.optimizeLocationOrder(
        request.locations,
        request.optimizationMethod,
        request.isLoop,
        request.vehicleType
      );

      // Calculer les segments du trajet
      const segments = await this.calculateRouteSegments(
        optimizedLocations,
        request.vehicleType,
        request.isLoop
      );

      const route: Route = {
        id: this.generateRouteId(),
        locations: optimizedLocations,
        totalDistance: segments.reduce((sum, seg) => sum + seg.distance, 0),
        totalDuration: segments.reduce((sum, seg) => sum + seg.duration, 0),
        vehicleType: request.vehicleType,
        isLoop: request.isLoop,
        segments,
        optimizationMethod: request.optimizationMethod,
      };

      // Log optimization results for debugging
      logger.debug('Optimisation de trajet terminée:', {
        vehicleType: request.vehicleType,
        method: request.optimizationMethod,
        isLoop: request.isLoop,
        optimizationType: request.locations.length <= 8 ? 'advanced' : 'nearest-neighbor',
        totalDistance: route.totalDistance.toFixed(1) + 'km',
        totalDuration: Math.round(route.totalDuration) + 'min',
        locationsOrder: optimizedLocations.map(loc => loc.address.substring(0, 30) + '...')
      });

      // Enhanced logging to show parameter effects
      if (request.optimizationMethod === 'shortest_distance') {
        logger.debug(`Optimisé pour DISTANCE LA PLUS COURTE: ${route.totalDistance.toFixed(1)}km`);
      } else if (request.optimizationMethod === 'fastest_time') {
        logger.debug(`Optimisé pour TEMPS LE PLUS RAPIDE: ${Math.round(route.totalDuration)}min`);
      } else {
        logger.debug(`Optimisation ÉQUILIBRÉE: ${route.totalDistance.toFixed(1)}km / ${Math.round(route.totalDuration)}min`);
      }

      // Cache performance summary
      logger.debug(`Performance du cache: ${this.segmentCache.size} segments en cache`);

      // Sauvegarder la route calculée dans le cache
      setCachedRoute(request, route);

      return {
        route,
        metadata: {
          calculationTime: Date.now() - startTime,
          algorithm: 'openstreetmap-free',
          apiProvider: 'nominatim+osrm',
        },
      };
    } catch (error) {
      logger.error('Échec du calcul de trajet:', error);
      throw new Error(`Impossible de calculer le trajet: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  async geocodeAddress(address: string): Promise<{ latitude: number; longitude: number } | null> {
    try {
      const encodedAddress = encodeURIComponent(address);
      const url = `${this.nominatimBaseUrl}/search?format=json&q=${encodedAddress}&limit=1&addressdetails=1`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'RouteOptimizer/1.0.0 (https://github.com/yourproject/route-optimizer)',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Échec du géocodage: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data && data.length > 0) {
        const result = data[0];
        return { 
          latitude: parseFloat(result.lat), 
          longitude: parseFloat(result.lon) 
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Échec du géocodage:', error);
      return null;
    }
  }

  private async optimizeLocationOrder(
    locations: Location[],
    method: OptimizationMethod,
    isLoop: boolean,
    vehicleType: VehicleType
  ): Promise<Location[]> {
    if (locations.length <= 2) {
      return locations;
    }

    // Séparer les emplacements verrouillés
    const lockedLocations = locations.filter(loc => loc.isLocked);
    const unlockedLocations = locations.filter(loc => !loc.isLocked);

    if (unlockedLocations.length === 0) {
      return locations.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    // Pour des performances optimales avec l'API, utiliser une approche hybride
    let optimized: Location[];
    
    if (unlockedLocations.length <= 8) {
      // Pour peu d'emplacements, utiliser un algorithme plus sophistiqué
      optimized = await this.advancedOptimization(unlockedLocations, method, isLoop, vehicleType);
    } else {
      // Pour beaucoup d'emplacements, utiliser l'algorithme du plus proche voisin amélioré
      optimized = await this.nearestNeighborOptimization(unlockedLocations, method, isLoop);
    }

    // Fusionner avec les emplacements verrouillés
    const result: Location[] = [];
    let optimizedIndex = 0;

    for (let i = 0; i < locations.length; i++) {
      const lockedAtPosition = lockedLocations.find(loc => loc.order === i);
      if (lockedAtPosition) {
        result.push(lockedAtPosition);
      } else if (optimizedIndex < optimized.length) {
        result.push(optimized[optimizedIndex++]);
      }
    }

    return result;
  }

  private async advancedOptimization(
    locations: Location[],
    method: OptimizationMethod,
    isLoop: boolean,
    vehicleType: VehicleType
  ): Promise<Location[]> {
    if (locations.length <= 1) return locations;

    // Essayer plusieurs permutations et garder la meilleure
    const maxPermutations = Math.min(this.factorial(locations.length), 120); // Limiter pour les performances
    let bestOrder = locations;
    let bestScore = Infinity;

    // Commencer par l'algorithme du plus proche voisin
    const nearestNeighborResult = await this.nearestNeighborOptimization(locations, method, isLoop);
    const nearestScore = await this.calculateOrderScore(nearestNeighborResult, method, isLoop, vehicleType);
    
    if (nearestScore < bestScore) {
      bestScore = nearestScore;
      bestOrder = nearestNeighborResult;
    }

    // Essayer quelques permutations supplémentaires pour les petits ensembles
    if (locations.length <= 6) {
      const permutations = this.generatePermutations(locations, Math.min(maxPermutations, 20));
      
      for (const permutation of permutations) {
        const score = await this.calculateOrderScore(permutation, method, isLoop, vehicleType);
        if (score < bestScore) {
          bestScore = score;
          bestOrder = permutation;
        }
      }
    }

    return bestOrder;
  }

  private async calculateOrderScore(
    locations: Location[],
    method: OptimizationMethod,
    isLoop: boolean,
    vehicleType: VehicleType = 'car'
  ): Promise<number> {
    if (locations.length === 0) return 0;
    let totalScore = 0;

    // Calculate segments for the complete route
    const segmentCount = isLoop ? locations.length : locations.length - 1;
    
    for (let i = 0; i < segmentCount; i++) {
      const from = locations[i];
      // For loop, connect last location back to first
      const to = isLoop && i === locations.length - 1 ? locations[0] : locations[i + 1];
      
      if (!from.coordinates || !to.coordinates) continue;

      try {
        // For small route sets, use actual API calls for precise optimization
        const segment = await this.calculateSegment(from, to, vehicleType);
        
        if (method === 'shortest_distance') {
          totalScore += segment.distance;
        } else if (method === 'fastest_time') {
          totalScore += segment.duration;
        } else { // balanced
          // Balanced approach: 40% distance, 60% time
          totalScore += segment.distance * 0.4 + segment.duration * 0.6;
        }
      } catch (error) {
        // Fallback to Haversine distance calculation
        const distance = this.calculateDistance(from.coordinates, to.coordinates);
        
        if (method === 'shortest_distance') {
          totalScore += distance;
        } else if (method === 'fastest_time') {
          const estimatedSpeed = vehicleType === 'truck' ? 50 : 65;
          totalScore += (distance / estimatedSpeed) * 60;
        } else { // balanced
          const estimatedSpeed = vehicleType === 'truck' ? 55 : 60;
          const time = (distance / estimatedSpeed) * 60;
          totalScore += distance * 0.4 + time * 0.6;
        }
      }
    }

    return totalScore;
  }

  private generatePermutations<T>(arr: T[], maxCount: number): T[][] {
    const result: T[][] = [];
    
    const permute = (current: T[], remaining: T[]) => {
      if (result.length >= maxCount) return;
      
      if (remaining.length === 0) {
        result.push([...current]);
        return;
      }

      for (let i = 0; i < remaining.length; i++) {
        const next = remaining[i];
        const newRemaining = remaining.filter((_, index) => index !== i);
        permute([...current, next], newRemaining);
      }
    };

    permute([], arr);
    return result.slice(0, maxCount);
  }

  private async nearestNeighborOptimization(
    locations: Location[],
    method: OptimizationMethod,
    isLoop: boolean = false
  ): Promise<Location[]> {
    if (locations.length <= 1) return locations;

    // For loop optimization, we need to consider the complete circuit
    // Instead of greedy nearest neighbor, try different starting approaches
    if (isLoop && locations.length >= 3) {
      return await this.loopAwareOptimization(locations, method);
    }

    // Standard nearest neighbor for non-loop routes
    const visited = new Set<string>();
    const result: Location[] = [];
    let current = locations[0]; // Fixed starting point
    
    result.push(current);
    visited.add(current.id);

    while (visited.size < locations.length) {
      let nearest: Location | null = null;
      let bestScore = Infinity;

      for (const location of locations) {
        if (visited.has(location.id) || !location.coordinates || !current.coordinates) {
          continue;
        }

        const distance = this.calculateDistance(current.coordinates, location.coordinates);
        let score: number;
        
        if (method === 'shortest_distance') {
          score = distance;
        } else if (method === 'fastest_time') {
          const baseSpeed = 50;
          const speedMultiplier = distance > 10 ? 1.3 : distance > 5 ? 1.1 : 0.8;
          const adjustedSpeed = baseSpeed * speedMultiplier;
          score = (distance / adjustedSpeed) * 60;
        } else { // balanced
          const estimatedSpeed = 55;
          const time = (distance / estimatedSpeed) * 60;
          score = distance * 0.4 + time * 0.6;
        }

        if (score < bestScore) {
          nearest = location;
          bestScore = score;
        }
      }

      if (nearest) {
        result.push(nearest);
        visited.add(nearest.id);
        current = nearest;
      }
    }

    return result;
  }

  private async loopAwareOptimization(
    locations: Location[],
    method: OptimizationMethod
  ): Promise<Location[]> {
    const startLocation = locations[0]; // Fixed depot
    const otherLocations = locations.slice(1);
    
    // Try multiple different approaches and pick the best one
    let bestOrder = locations;
    let bestScore = Infinity;

    logger.debug(`Optimisation intelligente de boucle pour ${locations.length} emplacements à partir de ${startLocation.address.substring(0, 30)}`);
    logger.debug('Test de plusieurs stratégies d\'optimisation:');

    // Approach 1: Nearest neighbor from start
    const nearestFirst = await this.findNearestNeighborLoop(startLocation, otherLocations, method);
    const nearestScore = await this.calculateCompleteLoopScore(nearestFirst, method);
    logger.debug(`  Stratégie du plus proche d'abord: ${nearestScore.toFixed(1)} score`);
    
    if (nearestScore < bestScore) {
      bestScore = nearestScore;
      bestOrder = nearestFirst;
    }

    // Approach 2: Farthest first (sometimes better for loops)
    const farthestFirst = await this.findFarthestFirstLoop(startLocation, otherLocations);
    const farthestScore = await this.calculateCompleteLoopScore(farthestFirst, method);
    logger.debug(`  Stratégie du plus loin d'abord: ${farthestScore.toFixed(1)} score`);
    
    if (farthestScore < bestScore) {
      bestScore = farthestScore;
      bestOrder = farthestFirst;
    }

    // Approach 3: Try starting with each location and see which gives best loop
    for (let i = 0; i < Math.min(otherLocations.length, 3); i++) {
      const testOrder = [startLocation, otherLocations[i], ...otherLocations.filter((_, idx) => idx !== i)];
      const reorderedTest = await this.optimizeFromSecondLocation(testOrder);
      const testScore = await this.calculateCompleteLoopScore(reorderedTest, method);
      logger.debug(`  Stratégie commencer-par-${otherLocations[i].address.substring(0, 20)}: ${testScore.toFixed(1)} score`);
      
      if (testScore < bestScore) {
        bestScore = testScore;
        bestOrder = reorderedTest;
      }
    }

    logger.debug(`Meilleur score de boucle: ${bestScore.toFixed(1)} pour la méthode: ${method}`);
    logger.debug(`Ordre optimal: ${bestOrder.map(loc => loc.address.substring(0, 20)).join(' → ')} → ${bestOrder[0].address.substring(0, 20)}`);
    return bestOrder;
  }

  private async findNearestNeighborLoop(
    start: Location,
    others: Location[],
    method: OptimizationMethod
  ): Promise<Location[]> {
    const result = [start];
    const remaining = [...others];
    let current = start;

    while (remaining.length > 0) {
      let nearest: Location | null = null;
      let bestScore = Infinity;
      let bestIndex = -1;

      for (let i = 0; i < remaining.length; i++) {
        const location = remaining[i];
        if (!location.coordinates || !current.coordinates) continue;

        // For the last location, consider return cost to start
        let totalScore = 0;
        const distance = this.calculateDistance(current.coordinates, location.coordinates);
        
        if (remaining.length === 1) {
          // This is the last location - include return cost
          if (location.coordinates && start.coordinates) {
            const returnDistance = this.calculateDistance(location.coordinates, start.coordinates);
            
            if (method === 'shortest_distance') {
              totalScore = distance + returnDistance;
            } else if (method === 'fastest_time') {
              const speed1 = this.estimateSpeed(distance);
              const speed2 = this.estimateSpeed(returnDistance);
              totalScore = (distance / speed1) * 60 + (returnDistance / speed2) * 60;
            } else { // balanced
              const speed1 = this.estimateSpeed(distance);
              const speed2 = this.estimateSpeed(returnDistance);
              const time1 = (distance / speed1) * 60;
              const time2 = (returnDistance / speed2) * 60;
              totalScore = (distance * 0.4 + time1 * 0.6) + (returnDistance * 0.4 + time2 * 0.6);
            }
          } else {
            // Fallback if coordinates missing
            totalScore = distance;
          }
        } else {
          // Regular scoring
          if (method === 'shortest_distance') {
            totalScore = distance;
          } else if (method === 'fastest_time') {
            const speed = this.estimateSpeed(distance);
            totalScore = (distance / speed) * 60;
          } else { // balanced
            const speed = this.estimateSpeed(distance);
            const time = (distance / speed) * 60;
            totalScore = distance * 0.4 + time * 0.6;
          }
        }

        if (totalScore < bestScore) {
          nearest = location;
          bestScore = totalScore;
          bestIndex = i;
        }
      }

      if (nearest && bestIndex >= 0) {
        result.push(nearest);
        remaining.splice(bestIndex, 1);
        current = nearest;
      }
    }

    return result;
  }

  private async findFarthestFirstLoop(
    start: Location,
    others: Location[]
  ): Promise<Location[]> {
    // Find the farthest location from start to visit first
    // This sometimes creates better loops by "getting the long distance out of the way"
    
    let farthest: Location | null = null;
    let maxDistance = 0;

    for (const location of others) {
      if (!location.coordinates || !start.coordinates) continue;
      const distance = this.calculateDistance(start.coordinates, location.coordinates);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = location;
      }
    }

    if (!farthest) return [start, ...others];

    // Start with farthest, then optimize the rest
    const remaining = others.filter(loc => loc.id !== farthest.id);
    const result = [start, farthest];
    
    // Now use nearest neighbor for the rest
    let current = farthest;
    while (remaining.length > 0) {
      let nearest: Location | null = null;
      let bestScore = Infinity;
      let bestIndex = -1;

      for (let i = 0; i < remaining.length; i++) {
        const location = remaining[i];
        if (!location.coordinates || !current.coordinates) continue;

        const distance = this.calculateDistance(current.coordinates, location.coordinates);
        
        // Include return cost for last location
        let score = distance;
        if (remaining.length === 1 && location.coordinates && start.coordinates) {
          const returnDistance = this.calculateDistance(location.coordinates, start.coordinates);
          score += returnDistance;
        }

        if (score < bestScore) {
          nearest = location;
          bestScore = score;
          bestIndex = i;
        }
      }

      if (nearest && bestIndex >= 0) {
        result.push(nearest);
        remaining.splice(bestIndex, 1);
        current = nearest;
      }
    }

    return result;
  }

  private async optimizeFromSecondLocation(
    order: Location[]
  ): Promise<Location[]> {
    // Given a fixed start and second location, optimize the rest
    if (order.length <= 2) return order;

    const fixed = order.slice(0, 2); // Keep first two fixed
    const toOptimize = order.slice(2);
    
    // Simple nearest neighbor from the second location
    const result = [...fixed];
    const remaining = [...toOptimize];
    let current = fixed[1];

    while (remaining.length > 0) {
      let nearest: Location | null = null;
      let bestScore = Infinity;
      let bestIndex = -1;

      for (let i = 0; i < remaining.length; i++) {
        const location = remaining[i];
        if (!location.coordinates || !current.coordinates) continue;

        const distance = this.calculateDistance(current.coordinates, location.coordinates);
        let score = distance;

        // Include return cost for last location
        if (remaining.length === 1 && location.coordinates && order[0].coordinates) {
          const returnDistance = this.calculateDistance(location.coordinates, order[0].coordinates);
          score += returnDistance;
        }

        if (score < bestScore) {
          nearest = location;
          bestScore = score;
          bestIndex = i;
        }
      }

      if (nearest && bestIndex >= 0) {
        result.push(nearest);
        remaining.splice(bestIndex, 1);
        current = nearest;
      }
    }

    return result;
  }

  private async calculateCompleteLoopScore(
    locations: Location[],
    method: OptimizationMethod
  ): Promise<number> {
    let totalScore = 0;

    // Calculate score for complete loop including return
    for (let i = 0; i < locations.length; i++) {
      const from = locations[i];
      const to = i === locations.length - 1 ? locations[0] : locations[i + 1]; // Loop back to start
      
      if (!from.coordinates || !to.coordinates) continue;

      const distance = this.calculateDistance(from.coordinates, to.coordinates);
      
      if (method === 'shortest_distance') {
        totalScore += distance;
      } else if (method === 'fastest_time') {
        const speed = this.estimateSpeed(distance);
        totalScore += (distance / speed) * 60;
      } else { // balanced
        const speed = this.estimateSpeed(distance);
        const time = (distance / speed) * 60;
        totalScore += distance * 0.4 + time * 0.6;
      }
    }

    return totalScore;
  }

  private estimateSpeed(distance: number): number {
    // Estimate speed based on distance (longer distances likely use faster roads)
    if (distance > 10) return 65; // Highway speeds
    if (distance > 5) return 55;  // Suburban
    return 40; // Urban
  }

  private async calculateRouteSegments(
    locations: Location[],
    vehicleType: VehicleType,
    isLoop: boolean
  ): Promise<RouteSegment[]> {
    const segments: RouteSegment[] = [];
    
    for (let i = 0; i < locations.length - 1; i++) {
      const from = locations[i];
      const to = locations[i + 1];
      
      const segment = await this.calculateSegment(from, to, vehicleType);
      segments.push(segment);
    }

    // Ajouter le segment de retour pour les trajets en boucle
    if (isLoop && locations.length > 2) {
      const returnSegment = await this.calculateSegment(
        locations[locations.length - 1],
        locations[0],
        vehicleType
      );
      segments.push(returnSegment);
    }

    return segments;
  }

  private async calculateSegment(
    from: Location,
    to: Location,
    vehicleType: VehicleType
  ): Promise<RouteSegment> {
    if (!from.coordinates || !to.coordinates) {
      throw new Error('Les deux emplacements doivent avoir des coordonnées');
    }

    // Check cache first
    const cacheKey = this.generateSegmentKey(from, to, vehicleType);
    const cachedSegment = this.segmentCache.get(cacheKey);
    if (cachedSegment) {
      logger.debug(`Cache trouvé pour segment: ${from.address.substring(0,20)} -> ${to.address.substring(0,20)}`);
      return cachedSegment;
    }

    logger.debug(`Appel API pour segment: ${from.address.substring(0,20)} -> ${to.address.substring(0,20)}`);

    // Use OpenRouteService for truck routing if API key is available
    if (vehicleType === 'truck' && this.openRouteServiceApiKey) {
      try {
        return await this.calculateSegmentWithORS(from, to, cacheKey);
      } catch (error) {
        logger.warn('OpenRouteService échoué, fallback vers OSRM:', error);
        // Fall through to OSRM
      }
    }

    try {
      // Use different profiles for different vehicle types
      // Note: OSRM public only supports 'driving', but we can simulate truck behavior
      const profile = 'driving'; // OSRM public limitation
      const coordinates = `${from.coordinates.longitude},${from.coordinates.latitude};${to.coordinates.longitude},${to.coordinates.latitude}`;
      
      const url = `${this.osrmBaseUrl}/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=true`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Échec de l'API OSRM: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        let distance = route.distance / 1000; // Convert to kilometers
        let duration = route.duration / 60; // Convert to minutes

        // Apply vehicle-specific adjustments
        if (vehicleType === 'truck') {
          // Trucks are slower and may take longer routes
          distance *= 1.1; // 10% longer distance for truck routes (avoiding weight restrictions)
          duration *= 1.4; // 40% more time due to lower speeds and restrictions
        }

        const segment = {
          from,
          to,
          distance,
          duration,
          instructions: route.legs[0]?.steps?.map((step: any) => 
            step.maneuver?.instruction || `Continuer pendant ${(step.distance/1000).toFixed(1)}km`
          ) || [],
          polyline: route.geometry, // Keep GeoJSON geometry
        };

        // Cache the calculated segment with LRU eviction
        this.cacheSegment(cacheKey, segment);
        return segment;
      } else {
        throw new Error('Aucun trajet trouvé');
      }
    } catch (error) {
      logger.warn('Échec du calcul de segment, utilisation de la ligne droite:', error);
      
      // Fallback: straight line calculation with vehicle-specific speeds
      const distance = this.calculateDistance(from.coordinates, to.coordinates);
      const estimatedSpeed = vehicleType === 'truck' ? 50 : 70; // km/h - trucks slower
      const duration = (distance / estimatedSpeed) * 60; // minutes

      const fallbackSegment = {
        from,
        to,
        distance,
        duration,
        instructions: [`Parcourir ${distance.toFixed(1)}km vers ${to.address}`],
        polyline: null,
      };

      // Cache the fallback segment too with LRU eviction
      this.cacheSegment(cacheKey, fallbackSegment);
      return fallbackSegment;
    }
  }

  private calculateDistance(
    coord1: { latitude: number; longitude: number },
    coord2: { latitude: number; longitude: number }
  ): number {
    // Formule de Haversine
    const R = 6371; // Rayon de la Terre en kilomètres
    const dLat = this.degToRad(coord2.latitude - coord1.latitude);
    const dLon = this.degToRad(coord2.longitude - coord1.longitude);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.degToRad(coord1.latitude)) * Math.cos(this.degToRad(coord2.latitude)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private degToRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private generateRouteId(): string {
    return `route_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Calculate a segment using OpenRouteService API with driving-hgv (heavy goods vehicle) profile
   * This provides real truck routing with actual restrictions (weight, height, etc.)
   */
  private async calculateSegmentWithORS(
    from: Location,
    to: Location,
    cacheKey: string
  ): Promise<RouteSegment> {
    if (!from.coordinates || !to.coordinates) {
      throw new Error('Les deux emplacements doivent avoir des coordonnées');
    }

    const url = `${ORS_BASE_URL}/v2/directions/driving-hgv`;
    
    const body = {
      coordinates: [
        [from.coordinates.longitude, from.coordinates.latitude],
        [to.coordinates.longitude, to.coordinates.latitude]
      ],
      instructions: true,
      geometry: true,
      // Truck-specific parameters
      profile: 'driving-hgv',
      units: 'km',
      language: 'fr',
    };

    logger.debug('Appel OpenRouteService pour camion:', {
      from: from.address.substring(0, 30),
      to: to.address.substring(0, 30)
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.openRouteServiceApiKey!,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouteService API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('Aucun trajet camion trouvé');
    }

    const route = data.routes[0];
    const summary = route.summary;

    const segment: RouteSegment = {
      from,
      to,
      distance: summary.distance, // Already in km
      duration: summary.duration / 60, // Convert seconds to minutes
      instructions: route.segments?.[0]?.steps?.map((step: { instruction: string; distance: number }) => 
        step.instruction || `Continuer pendant ${step.distance.toFixed(1)}km`
      ) || [],
      polyline: route.geometry ? {
        type: 'LineString',
        coordinates: this.decodeORSGeometry(route.geometry)
      } : null,
    };

    logger.debug('Segment camion ORS calculé:', {
      distance: segment.distance.toFixed(1) + 'km',
      duration: segment.duration.toFixed(0) + 'min'
    });

    // Cache the segment
    this.cacheSegment(cacheKey, segment);
    return segment;
  }

  /**
   * Decode OpenRouteService encoded polyline geometry
   */
  private decodeORSGeometry(encoded: string): number[][] {
    // ORS uses Google's polyline encoding
    const coordinates: number[][] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      let shift = 0;
      let result = 0;
      let b: number;

      // Decode latitude
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;

      shift = 0;
      result = 0;

      // Decode longitude
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;

      coordinates.push([lng / 1e5, lat / 1e5]);
    }

    return coordinates;
  }

  // LRU-like cache management for segments
  private cacheSegment(key: string, segment: RouteSegment): void {
    // If cache is full, remove oldest entries
    while (this.segmentCache.size >= MAX_SEGMENT_CACHE_SIZE && this.segmentCacheOrder.length > 0) {
      const oldestKey = this.segmentCacheOrder.shift();
      if (oldestKey) {
        this.segmentCache.delete(oldestKey);
        logger.debug(`Cache segment évincé (LRU): ${oldestKey.substring(0, 30)}...`);
      }
    }
    
    // Add new segment to cache
    this.segmentCache.set(key, segment);
    this.segmentCacheOrder.push(key);
  }

  private factorial(n: number): number {
    if (n <= 1) return 1;
    return n * this.factorial(n - 1);
  }
}

// Exporter l'instance singleton
export const freeRoutingService = new OpenStreetMapRoutingService();
