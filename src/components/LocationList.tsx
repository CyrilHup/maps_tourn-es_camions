import { useState, useRef, useCallback } from 'react';
import { Lock, LockOpen, GripVertical, X, Edit, MapPin, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';
import { Location } from '../types/index.ts';
import { trimAddress } from '../utils/routeUtils.ts';
import AddressAutocomplete from './AddressAutocomplete.tsx';
import { AddressSuggestion } from '../hooks/useAddressSearch.ts';

interface LocationListProps {
  locations: Location[];
  onLocationUpdate: (locations: Location[]) => void;
  onLocationEdit: (id: string, newAddress: string, coordinates?: { latitude: number; longitude: number }) => void;
  onLocationDelete: (id: string) => void;
  onLocationLock: (id: string) => void;
}

interface DragState {
  draggedIndex: number | null;
  dragOverIndex: number | null;
}

export default function LocationList({
  locations,
  onLocationUpdate,
  onLocationEdit,
  onLocationDelete,
  onLocationLock
}: LocationListProps) {
  const [dragState, setDragState] = useState<DragState>({
    draggedIndex: null,
    dragOverIndex: null
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const dragCounterRef = useRef(0);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragState(prev => ({ ...prev, draggedIndex: index }));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    
    // Style visuel pour l'élément traîné
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDragState({ draggedIndex: null, dragOverIndex: null });
    dragCounterRef.current = 0;
    
    // Restaurer l'opacité
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    setDragState(prev => ({ ...prev, dragOverIndex: index }));
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragState(prev => ({ ...prev, dragOverIndex: index }));
  };

  const handleDragLeave = () => {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragState(prev => ({ ...prev, dragOverIndex: null }));
    }
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragState.draggedIndex;
    
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragState({ draggedIndex: null, dragOverIndex: null });
      return;
    }

    // Vérifier si les emplacements peuvent être déplacés (pas verrouillés)
    const draggedLocation = locations[dragIndex];
    const targetLocation = locations[dropIndex];
    
    if (draggedLocation.isLocked || targetLocation.isLocked) {
      setDragState({ draggedIndex: null, dragOverIndex: null });
      return;
    }

    // Créer une nouvelle liste avec l'ordre modifié
    const newLocations = [...locations];
    const [movedLocation] = newLocations.splice(dragIndex, 1);
    newLocations.splice(dropIndex, 0, movedLocation);
    
    // Mettre à jour les indices d'ordre
    const updatedLocations = newLocations.map((loc, index) => ({
      ...loc,
      order: index
    }));

    onLocationUpdate(updatedLocations);
    setDragState({ draggedIndex: null, dragOverIndex: null });
    dragCounterRef.current = 0;
  };

  const startEdit = useCallback((location: Location) => {
    setEditingId(location.id);
    setEditValue(location.address);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId && editValue.trim()) {
      onLocationEdit(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, editValue, onLocationEdit]);

  const saveEditFromSuggestion = useCallback((suggestion: AddressSuggestion) => {
    if (editingId) {
      // Sauvegarder avec les coordonnées de la suggestion
      onLocationEdit(editingId, suggestion.display_name, {
        latitude: parseFloat(suggestion.lat),
        longitude: parseFloat(suggestion.lon),
      });
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, onLocationEdit]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const moveLocationUp = useCallback((index: number) => {
    if (index > 0) {
      const newLocations = [...locations];
      [newLocations[index - 1], newLocations[index]] = [newLocations[index], newLocations[index - 1]];
      
      // Mettre à jour les indices d'ordre
      const updatedLocations = newLocations.map((loc, i) => ({
        ...loc,
        order: i
      }));
      
      onLocationUpdate(updatedLocations);
    }
  }, [locations, onLocationUpdate]);

  const moveLocationDown = useCallback((index: number) => {
    if (index < locations.length - 1) {
      const newLocations = [...locations];
      [newLocations[index], newLocations[index + 1]] = [newLocations[index + 1], newLocations[index]];
      
      // Mettre à jour les indices d'ordre
      const updatedLocations = newLocations.map((loc, i) => ({
        ...loc,
        order: i
      }));
      
      onLocationUpdate(updatedLocations);
    }
  }, [locations, onLocationUpdate]);

  if (locations.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <MapPin className="mx-auto h-12 w-12 text-gray-300 mb-4" />
        <p>Aucun emplacement ajouté</p>
        <p className="text-sm">Ajoutez des emplacements ci-dessus ou importez un fichier</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 scrollbar-thin">
      {/* Status indicator */}
      <div className="text-xs text-gray-500 mb-2 flex items-center justify-between">
        <div className="flex items-center">
          <GripVertical className="h-3 w-3 mr-1 drag-handle hidden sm:block" />
          <span className="hidden sm:inline">Glisser-déposer pour réorganiser</span>
          <span className="sm:hidden">Utilisez ↑↓ pour réorganiser</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-green-600 text-xs">
            ✓ {locations.filter(loc => loc.coordinates).length}
          </span>
          {locations.some(loc => !loc.coordinates) && (
            <span className="text-amber-600 text-xs">
              ⚠ {locations.filter(loc => !loc.coordinates).length}
            </span>
          )}
        </div>
      </div>
      
      {locations.map((location, index) => {
        const isDragging = dragState.draggedIndex === index;
        const isDragOver = dragState.dragOverIndex === index;
        const isEditing = editingId === location.id;
        
        return (
          <div
            key={location.id}
            draggable={!location.isLocked && !isEditing}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnter={(e) => handleDragEnter(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            className={`
              flex items-center p-2.5 rounded-lg border transition-all duration-200
              ${isDragging ? 'opacity-50 scale-95' : ''}
              ${isDragOver ? 'border-blue-400 bg-blue-50 transform scale-105' : 
                !location.coordinates ? 'border-amber-200 bg-amber-50' :
                location.isLocked ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}
              ${!location.isLocked && !isEditing ? 'cursor-move hover:bg-gray-100' : ''}
            `}
          >
            {/* Drag Handle & Order Number */}
            <div className="flex items-center mr-2">
              {!location.isLocked && !isEditing && (
                <GripVertical className="h-3 w-3 text-gray-400 mr-1 drag-handle hidden sm:block" />
              )}
              <span className={`
                w-5 h-5 text-white text-xs rounded-full flex items-center justify-center font-medium
                ${location.isLocked ? 'bg-red-600' : 'bg-blue-600'}
              `}>
                {index + 1}
              </span>
            </div>

            {/* Address Display/Edit */}
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <AddressAutocomplete
                        value={editValue}
                        onChange={setEditValue}
                        onSelect={saveEditFromSuggestion}
                        onEscape={cancelEdit}
                        onEnterWithoutSelection={saveEdit}
                        onBlur={cancelEdit}
                        placeholder="Modifier l'adresse..."
                        className="w-full text-sm"
                        autoSelectText={true}
                      />
                    </div>
                    {/* Cancel button visible on mobile */}
                    <button
                      onClick={cancelEdit}
                      className="sm:hidden p-1 text-gray-400 hover:text-red-600 transition-colors touch-manipulation"
                      title="Annuler"
                      aria-label="Annuler la modification"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    <span className="sm:hidden">Appuyez sur ✕ pour annuler</span>
                    <span className="hidden sm:inline">Clic extérieur pour annuler</span>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center">
                    <span className="text-sm text-gray-900 block truncate font-medium">
                      {trimAddress(location.address)}
                    </span>
                    {!location.coordinates && (
                      <AlertTriangle className="h-3 w-3 text-amber-500 ml-1 flex-shrink-0" />
                    )}
                  </div>
                  {location.coordinates ? (
                    <div className="text-xs text-gray-500">
                      📍 {location.coordinates.latitude.toFixed(3)}, {location.coordinates.longitude.toFixed(3)}
                    </div>
                  ) : (
                    <div className="text-xs text-amber-600 flex items-center justify-between">
                      <span>Adresse non trouvée</span>
                      <button
                        onClick={() => startEdit(location)}
                        className="text-blue-600 hover:text-blue-800 underline text-xs"
                      >
                        Résoudre
                      </button>
                    </div>
                  )}
                  {location.isLocked && (
                    <div className="text-xs text-red-600 flex items-center">
                      <Lock className="h-3 w-3 mr-1" />
                      Verrouillé
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-1 ml-1">
              {!isEditing && (
                <>
                  {/* Mobile reorder buttons (hidden on desktop where drag & drop works) */}
                  {!location.isLocked && (
                    <div className="flex flex-col sm:hidden -space-y-1">
                      <button
                        onClick={() => moveLocationUp(index)}
                        disabled={index === 0}
                        className="p-0.5 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed touch-manipulation"
                        title="Déplacer vers le haut"
                        aria-label={`Déplacer ${trimAddress(location.address)} vers le haut`}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveLocationDown(index)}
                        disabled={index === locations.length - 1}
                        className="p-0.5 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed touch-manipulation"
                        title="Déplacer vers le bas"
                        aria-label={`Déplacer ${trimAddress(location.address)} vers le bas`}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  
                  <button
                    onClick={() => startEdit(location)}
                    className="p-1 text-gray-400 hover:text-blue-600 transition-colors touch-manipulation"
                    title="Modifier"
                    aria-label={`Modifier l'adresse de ${trimAddress(location.address)}`}
                  >
                    <Edit className="h-3 w-3" />
                  </button>
                  
                  <button
                    onClick={() => onLocationLock(location.id)}
                    className={`p-1 transition-colors touch-manipulation ${
                      location.isLocked 
                        ? 'text-red-600 hover:text-red-800' 
                        : 'text-gray-400 hover:text-orange-600'
                    }`}
                    title={location.isLocked ? 'Déverrouiller' : 'Verrouiller'}
                    aria-label={location.isLocked ? `Déverrouiller ${trimAddress(location.address)}` : `Verrouiller ${trimAddress(location.address)}`}
                  >
                    {location.isLocked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                  </button>

                  <button
                    onClick={() => onLocationDelete(location.id)}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors touch-manipulation"
                    title="Supprimer"
                    aria-label={`Supprimer ${trimAddress(location.address)}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
