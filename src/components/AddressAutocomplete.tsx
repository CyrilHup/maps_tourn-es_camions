import { useState, useRef, useEffect, useCallback } from 'react';
import { MapPin, Search, Loader2, X } from 'lucide-react';
import { useAddressSearch, AddressSuggestion } from '../hooks/useAddressSearch.ts';

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  onEscape?: () => void;
  onEnterWithoutSelection?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoSelectText?: boolean; // New prop for auto-selecting text
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  onEscape,
  onEnterWithoutSelection,
  onBlur,
  placeholder = "Rechercher une adresse...",
  className = "",
  disabled = false,
  autoSelectText = false
}: AddressAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const { suggestions, isLoading, error, searchAddresses, clearSuggestions } = useAddressSearch();

  // Track mounted state to prevent state updates after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear all timeouts on unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  // Fonction pour gérer la fermeture et le callback onBlur
  const handleBlurAction = useCallback(() => {
    if (!isMountedRef.current) return;
    setIsOpen(false);
    setSelectedIndex(-1);
    if (onBlur) {
      onBlur();
    }
  }, [onBlur]);

  // Recherche avec debounce optimisé
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (value.length >= 3) {
      timeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          searchAddresses(value);
          setIsOpen(true);
        }
      }, 500); // Délai de 500ms pour réduire les appels API
    } else {
      clearSuggestions();
      setIsOpen(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, searchAddresses, clearSuggestions]);

  // Gérer les clics à l'extérieur
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleBlurAction();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onBlur]);

  // Auto-focus and select text when component mounts (for editing mode)
  useEffect(() => {
    if (inputRef.current && autoSelectText && value) {
      inputRef.current.focus();
      // Small delay to ensure the input is ready, then select all text
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.select();
        }
      }, 50);
    }
  }, [autoSelectText, value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        if (!isOpen || suggestions.length === 0) return;
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      
      case 'ArrowUp':
        if (!isOpen || suggestions.length === 0) return;
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      
      case 'Enter':
        e.preventDefault();
        if (isOpen && selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSelectSuggestion(suggestions[selectedIndex]);
        } else if (onEnterWithoutSelection) {
          onEnterWithoutSelection();
        }
        break;
      
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSelectedIndex(-1);
        if (onEscape) {
          onEscape();
        } else {
          inputRef.current?.blur();
        }
        break;
    }
  };

  const handleSelectSuggestion = (suggestion: AddressSuggestion) => {
    // Utiliser le formatage propre au lieu du display_name complet
    const cleanAddress = formatAddress(suggestion);
    onChange(cleanAddress);
    onSelect(suggestion);
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.blur();
  };

  const formatAddress = (suggestion: AddressSuggestion) => {
    const { address } = suggestion;
    const parts = [];
    
    // Construire l'adresse principale (sans code postal)
    if (address.house_number && address.road) {
      parts.push(`${address.house_number} ${address.road}`);
    } else if (address.road) {
      parts.push(address.road);
    }
    
    // Ajouter la ville
    if (address.city) {
      parts.push(address.city);
    } else if (address.town) {
      parts.push(address.town);
    } else if (address.village) {
      parts.push(address.village);
    }
    
    // Si on n'a pas réussi à extraire des parties, utiliser le display_name mais nettoyer
    if (parts.length === 0) {
      // Nettoyer le display_name en enlevant les codes postaux et informations redondantes
      let cleaned = suggestion.display_name;
      // Enlever les codes postaux (5 chiffres)
      cleaned = cleaned.replace(/,?\s*\d{5}\s*,?/g, '');
      // Enlever "France" à la fin
      cleaned = cleaned.replace(/,?\s*France\s*$/i, '');
      // Enlever les départements/régions en fin
      cleaned = cleaned.replace(/,?\s*[A-Za-zÀ-ÿ\-\s]+,?\s*$/g, '');
      return cleaned.trim();
    }

    return parts.join(', ');
  };

  const formatSecondaryInfo = (suggestion: AddressSuggestion) => {
    const { address } = suggestion;
    const parts = [];
    
    // Ajouter département/région si disponible
    if (address.state && !address.city?.includes(address.state)) {
      parts.push(address.state);
    }
    
    // Toujours ajouter "France" si pas déjà présent
    if (!suggestion.display_name.includes('France')) {
      parts.push('France');
    }
    
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const getAddressType = (suggestion: AddressSuggestion) => {
    const type = suggestion.type || suggestion.address.city ? 'city' : 'address';
    const typeIcons = {
      city: '🏘️',
      village: '🏡',
      town: '🏘️',
      address: '📍',
      road: '🛣️',
      building: '🏢',
    };
    
    return typeIcons[type as keyof typeof typeIcons] || '📍';
  };

  const clearInput = () => {
    onChange('');
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          {isLoading ? (
            <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />
          ) : (
            <Search className="h-4 w-4 text-gray-400" />
          )}
        </div>
        
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) {
              setIsOpen(true);
            }
          }}
          onBlur={() => {
            // Add a small delay to allow click events on suggestions to fire first
            // The click-outside handler will handle immediate outside clicks without delay
            // Clear any existing blur timeout to prevent double-firing
            if (blurTimeoutRef.current) {
              clearTimeout(blurTimeoutRef.current);
            }
            blurTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                handleBlurAction();
              }
            }, 150);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md shadow-sm 
            focus:outline-none focus:ring-blue-500 focus:border-blue-500
            disabled:bg-gray-100 disabled:cursor-not-allowed
            text-selectable
            ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}
          `}
          autoComplete="off"
          style={{
            // Prevent zoom on iOS when focusing input
            fontSize: '16px'
          }}
        />
        
        {value && (
          <button
            type="button"
            onClick={clearInput}
            className="absolute inset-y-0 right-0 pr-3 flex items-center hover:text-gray-600"
          >
            <X className="h-4 w-4 text-gray-400" />
          </button>
        )}
      </div>

      {/* Messages d'erreur */}
      {error && (
        <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-600 z-50">
          {error}
        </div>
      )}

      {/* Liste des suggestions */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.place_id}-${index}`}
              type="button"
              onClick={() => handleSelectSuggestion(suggestion)}
              className={`
                w-full px-4 py-3 text-left hover:bg-gray-50 flex items-start space-x-3
                focus:outline-none focus:bg-blue-50 focus:text-blue-900
                ${index === selectedIndex ? 'bg-blue-50 text-blue-900' : 'text-gray-900'}
                ${index !== suggestions.length - 1 ? 'border-b border-gray-100' : ''}
              `}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="text-lg flex-shrink-0 mt-0.5">
                {getAddressType(suggestion)}
              </span>
              
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">
                  {formatAddress(suggestion)}
                </div>
                
                {formatSecondaryInfo(suggestion) && (
                  <div className="text-xs text-gray-500 truncate mt-1">
                    {formatSecondaryInfo(suggestion)}
                  </div>
                )}
                
                <div className="flex items-center mt-1 text-xs text-gray-400">
                  <MapPin className="h-3 w-3 mr-1" />
                  <span>
                    {parseFloat(suggestion.lat).toFixed(4)}, {parseFloat(suggestion.lon).toFixed(4)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Message quand aucun résultat */}
      {isOpen && !isLoading && suggestions.length === 0 && value.length >= 3 && (
        <div className="absolute top-full left-0 right-0 mt-1 p-4 bg-white border border-gray-200 rounded-md shadow-lg z-50 text-center text-gray-500">
          <Search className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Aucune adresse trouvée pour "{value}"</p>
          <p className="text-xs text-gray-400 mt-1">
            Essayez une recherche plus spécifique
          </p>
        </div>
      )}
    </div>
  );
}
