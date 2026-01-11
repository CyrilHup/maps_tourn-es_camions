// Environment configuration
import { configLogger as logger } from '../utils/logger';

export const config = {
  mapbox: {
    accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '',
    defaultStyle: 'mapbox://styles/mapbox/streets-v12',
  },
  google: {
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
  },
  here: {
    apiKey: import.meta.env.VITE_HERE_API_KEY || '',
  },
  app: {
    env: import.meta.env.VITE_APP_ENV || 'development',
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api',
  },
  features: {
    enableTruckRouting: import.meta.env.VITE_ENABLE_TRUCK_ROUTING === 'true',
    enableFileUpload: import.meta.env.VITE_ENABLE_FILE_UPLOAD === 'true',
    enableAnalytics: import.meta.env.VITE_ENABLE_ANALYTICS === 'true',
  },
  map: {
    defaultCenter: {
      latitude: 48.8566,
      longitude: 2.3522, // Paris, France as default
    },
    defaultZoom: 10,
  },
};

// Validate required environment variables
export const validateConfig = () => {
  const errors: string[] = [];

  if (!config.mapbox.accessToken && !config.google.apiKey) {
    errors.push('VITE_MAPBOX_ACCESS_TOKEN ou VITE_GOOGLE_MAPS_API_KEY est requis');
  }

  if (errors.length > 0) {
    logger.warn('Avertissements de configuration:', errors);
  }

  return errors.length === 0;
};
