<button class="route-modal-close">&times;</button>
                </div>
                <div class="route-modal-body">
                    <div class="route-search">
                        <input type="text" placeholder="Buscar rota..." id="routeSearch">
                    </div>
                    <div class="route-list">
                        ${this.savedRoutes.map((route, index) => `
                            <div class="route-item" data-index="${index}">
                                <div class="route-item-header">
                                    <h4>${route.name}</h4>
                                    <span class="route-date">${new Date(route.date).toLocaleDateString()}</span>
                                </div>
                                <div class="route-item-stats">
                                    <span>📍 ${route.addresses.length} paradas</span>
                                    ${route.stats ? `
                                        <span>📏 ${route.stats.totalDistance.toFixed(1)} km</span>
                                        <span>⏱️ ${Math.round(route.stats.estimatedTime)} min</span>
                                    ` : ''}
                                </div>
                                <div class="route-item-actions">
                                    <button class="load-route-btn" data-index="${index}">Carregar</button>
                                    <button class="delete-route-btn" data-index="${index}">Excluir</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners do modal
        modal.querySelector('.route-modal-close').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        // Busca de rotas
        const searchInput = modal.querySelector('#routeSearch');
        searchInput.addEventListener('input', (e) => {
            const filter = e.target.value.toLowerCase();
            const routeItems = modal.querySelectorAll('.route-item');
            routeItems.forEach(item => {
                const routeName = item.querySelector('h4').textContent.toLowerCase();
                item.style.display = routeName.includes(filter) ? 'block' : 'none';
            });
        });

        // Carregar rota
        modal.addEventListener('click', async (e) => {
            if (e.target.classList.contains('load-route-btn')) {
                const index = parseInt(e.target.dataset.index);
                await this.loadRoute(this.savedRoutes[index]);
                modal.remove();
            }

            if (e.target.classList.contains('delete-route-btn')) {
                const index = parseInt(e.target.dataset.index);
                if (confirm('Deseja excluir esta rota?')) {
                    await this.deleteRoute(index);
                    modal.remove();
                    this.showLoadRouteDialog(); // Reabrir dialog atualizado
                }
            }
        });
    }

    async deleteRoute(index) {
        try {
            const route = this.savedRoutes[index];
            if (route.id) {
                await this.deleteFromIndexedDB('routes', route.id);
            }
            this.savedRoutes.splice(index, 1);

            await this.saveToHistory('route_deleted', {
                routeName: route.name
            });

            this.showStatus('Rota excluída com sucesso!', 'success');
        } catch (error) {
            this.showStatus('Erro ao excluir rota', 'error');
        }
    }

    loadRoute(routeData) {
        this.clearAddresses();
        this.addresses = [...routeData.addresses];
        this.updateAddressList();

        // Add markers to map
        this.addresses.forEach(addr => this.addMarkerToMap(addr));

        this.showStatus(`Rota "${routeData.name}" carregada!`, 'success');
    }

    openInGoogleMaps() {
        if (!this.optimizedRoute || this.optimizedRoute.length < 2) return;

        const waypoints = this.optimizedRoute.map(addr => 
            `${addr.lat},${addr.lng}`
        ).join('/');

        const url = `https://www.google.com/maps/dir/${waypoints}`;
        window.open(url, '_blank');

        this.showStatus('Abrindo no Google Maps...', 'info');
    }

    showLoading(show) {
        this.elements.loading.style.display = show ? 'flex' : 'none';
    }

    showHistoryModal() {
        const modal = document.createElement('div');
        modal.className = 'route-modal';
        modal.innerHTML = `
            <div class="route-modal-content">
                <div class="route-modal-header">
                    <h3>📋 Histórico de Atividades</h3>
                    <button class="route-modal-close">&times;</button>
                </div>
                <div class="route-modal-body">
                    <div class="history-list">
                        ${this.routeHistory.length === 0 ? 
                            '<p class="no-history">Nenhuma atividade registrada</p>' :
                            this.routeHistory.map(entry => `
                                <div class="history-item">
                                    <div class="history-icon">${this.getHistoryIcon(entry.action)}</div>
                                    <div class="history-content">
                                        <div class="history-action">${this.getHistoryText(entry.action, entry.data)}</div>
                                        <div class="history-date">${new Date(entry.timestamp).toLocaleString()}</div>
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.route-modal-close').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    }

    getHistoryIcon(action) {
        const icons = {
            'route_optimized': '⚡',
            'route_saved': '💾',
            'route_deleted': '🗑️',
            'address_added': '📍',
            'address_removed': '❌'
        };
        return icons[action] || '📝';
    }

    getHistoryText(action, data) {
        const texts = {
            'route_optimized': `Rota otimizada com ${data.addresses} paradas (${data.distance?.toFixed(1)} km)`,
            'route_saved': `Rota "${data.routeName}" salva com ${data.stops} paradas`,
            'route_deleted': `Rota "${data.routeName}" excluída`,
            'address_added': `Endereço adicionado: ${data.address}`,
            'address_removed': `Endereço removido: ${data.address}`
        };
        return texts[action] || 'Ação não identificada';
    }

    async exportRoute() {
        if (!this.optimizedRoute || this.optimizedRoute.length === 0) {
            this.showStatus('Nenhuma rota para exportar', 'error');
            return;
        }

        const routeData = {
            name: `Rota_${new Date().toISOString().split('T')[0]}`,
            timestamp: new Date().toISOString(),
            addresses: this.addresses,
            optimizedRoute: this.optimizedRoute,
            stats: {
                totalDistance: this.calculateTotalDistance(this.optimizedRoute),
                estimatedTime: this.calculateTotalDistance(this.optimizedRoute) / 50 * 60,
                stops: this.optimizedRoute.length
            },
            coordinates: this.optimizedRoute.map(addr => ({
                lat: addr.lat,
                lng: addr.lng,
                address: addr.address || addr.displayName
            }))
        };

        // Exportar como JSON
        const dataStr = JSON.stringify(routeData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${routeData.name}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        await this.saveToHistory('route_exported', {
            routeName: routeData.name,
            stops: routeData.stats.stops
        });

        this.showStatus('Rota exportada com sucesso!', 'success');
    }

    // Método para limpeza periódica do cache
    async cleanupCache() {
        try {
            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const transaction = this.db.transaction(['addressCache'], 'readwrite');
            const store = transaction.objectStore('addressCache');
            const index = store.index('timestamp');

            const range = IDBKeyRange.upperBound(oneWeekAgo);
            const request = index.openCursor(range);

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
        } catch (error) {
            console.error('Erro na limpeza do cache:', error);
        }
    }

    showStatus(message, type) {
        this.elements.statusMessage.textContent = message;
        this.elements.statusMessage.className = `status-message ${type} show`;

        setTimeout(() => {
            this.elements.statusMessage.classList.remove('show');
        }, 3000);
    }

    async initMap() {
        this.map = L.map('map').setView([-14.2350, -51.9253], 4);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        this.routeLayerGroup = L.layerGroup().addTo(this.map);
        this.speedCamerasLayer = L.layerGroup().addTo(this.map);

        // Get user location
        this.getUserLocation();

        // Load speed cameras
        this.loadSpeedCameras();
    }

    async geocodeAddress(query) {
        // Check cache first
        const cached = await this.getFromCache(query);
        if (cached) {
            return cached;
        }

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=5`;
            const response = await fetch(url);
            const data = await response.json();

            if (data && data.length > 0) {
                const result = data[0];
                const geocoded = {
                    lat: parseFloat(result.lat),
                    lng: parseFloat(result.lon),
                    displayName: result.display_name,
                    address: query
                };

                // Cache the result
                await this.saveToCache(query, geocoded);

                return geocoded;
            }

            throw new Error('Endereço não encontrado');
        } catch (error) {
            console.error('Erro na geocodificação:', error);
            throw error;
        }
    }

    async loadSpeedCameras() {
        try {
            // Buscar radares de velocidade do OpenStreetMap usando Overpass API
            const bounds = this.map.getBounds();
            if (!bounds) return;

            const south = bounds.getSouth();
            const west = bounds.getWest();
            const north = bounds.getNorth();
            const east = bounds.getEast();

            const query = `
                [out:json][timeout:25];
                (
                    node["highway"="speed_camera"](${south},${west},${north},${east});
                    way["highway"="speed_camera"](${south},${west},${north},${east});
                    relation["highway"="speed_camera"](${south},${west},${north},${east});
                );
                out geom;
            `;

            const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            const response = await fetch(overpassUrl);
            const data = await response.json();

            this.displaySpeedCameras(data.elements);

        } catch (error) {
            console.log('Erro ao carregar radares:', error);
            // Fallback: usar dados simulados para demonstração
            this.loadMockSpeedCameras();
        }
    }

    loadMockSpeedCameras() {
        // Dados simulados de radares para demonstração
        const mockCameras = [
            { lat: -23.5505, lng: -46.6333, maxspeed: '60', type: 'fixed' }, // São Paulo
            { lat: -22.9068, lng: -43.1729, maxspeed: '80', type: 'fixed' }, // Rio de Janeiro
            { lat: -19.9167, lng: -43.9345, maxspeed: '60', type: 'mobile' }, // Belo Horizonte
            { lat: -25.4284, lng: -49.2733, maxspeed: '50', type: 'fixed' }, // Curitiba
            { lat: -30.0346, lng: -51.2177, maxspeed: '60', type: 'mobile' }, // Porto Alegre
        ];

        this.displaySpeedCameras(mockCameras.map(camera => ({
            lat: camera.lat,
            lon: camera.lng,
            tags: {
                maxspeed: camera.maxspeed,
                enforcement: camera.type
            }
        })));
    }

    displaySpeedCameras(cameras) {
        // Limpar radares anteriores
        this.speedCamerasLayer.clearLayers();

        cameras.forEach(camera => {
            if (camera.lat && camera.lon) {
                const lat = camera.lat;
                const lng = camera.lon;
                const maxspeed = camera.tags?.maxspeed || '50';
                const enforcement = camera.tags?.enforcement || 'speed_camera';

                // Criar ícone personalizado para radar
                const cameraIcon = L.divIcon({
                    className: 'speed-camera-marker',
                    html: `
                        <div class="camera-icon">
                            📷
                            <div class="speed-limit">${maxspeed}</div>
                        </div>
                    `,
                    iconSize: [40, 40],
                    iconAnchor: [20, 40]
                });

                const marker = L.marker([lat, lng], { icon: cameraIcon })
                    .bindPopup(`
                        <div class="camera-popup">
                            <h4>📷 Radar de Velocidade</h4>
                            <p><strong>Limite:</strong> ${maxspeed} km/h</p>
                            <p><strong>Tipo:</strong> ${enforcement === 'mobile' ? 'Móvel' : 'Fixo'}</p>
                            <p><strong>Coordenadas:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}</p>
                        </div>
                    `, {
                        maxWidth: 250
                    });

                this.speedCamerasLayer.addLayer(marker);
            }
        });

        this.showStatus(`${cameras.length} radares carregados`, 'success');
    }

// Map events
        this.map.on('moveend', () => {
            this.updateUrlWithMapState();
            // Recarregar radares quando o mapa se mover significativamente
            clearTimeout(this.cameraLoadTimeout);
            this.cameraLoadTimeout = setTimeout(() => {
                this.loadSpeedCameras();
            }, 1000);
        });
// Map control events
        this.elements.centerMapBtn.addEventListener('click', () => {
            if (this.addresses.length > 0) {
                this.centerMapOnAddresses();
            } else if (this.userLocation) {
                this.map.setView([this.userLocation.lat, this.userLocation.lng], 13);
            }
        });

        this.elements.fullscreenBtn.addEventListener('click', () => {
            if (this.map.isFullscreen()) {
                this.map.exitFullscreen();
            } else {
                this.map.requestFullscreen();
            }
        });

        // Toggle speed cameras
        this.elements.toggleCamerasBtn = document.getElementById('toggleCamerasBtn');
        this.showCameras = true;

        this.elements.toggleCamerasBtn.addEventListener('click', () => {
            this.showCameras = !this.showCameras;

            if (this.showCameras) {
                this.map.addLayer(this.speedCamerasLayer);
                this.elements.toggleCamerasBtn.classList.add('cameras-active');
                this.elements.toggleCamerasBtn.textContent = '📷 Radares';
                this.loadSpeedCameras();
            } else {
                this.map.removeLayer(this.speedCamerasLayer);
                this.elements.toggleCamerasBtn.classList.remove('cameras-active');
                this.elements.toggleCamerasBtn.textContent = '📷 Radares (Off)';
            }
        });
    }

    async optimizeRoute() {
        if (this.addresses.length < 2) {
            this.showStatus('Adicione pelo menos 2 endereços', 'error');
            return;
        }

        this.showLoading(true);

        try {
            const returnToStart = document.getElementById('returnToStart').checked;

            // Get route type
            const routeType = document.querySelector('input[name="routeType"]:checked').value;

            // Simple optimization algorithm (Nearest Neighbor)
            const optimized = this.nearestNeighborOptimization([...this.addresses]);

            if (returnToStart && optimized.length > 0) {
                optimized.push(optimized[0]);
            }

            this.optimizedRoute = optimized;

            // Get real route between points
            await this.getRealRouteAndDisplay();
            this.updateRouteInfo();

            await this.saveToHistory('route_optimized', {
                addresses: this.addresses.length,
                distance: this.calculateTotalDistance(this.optimizedRoute)
            });

            this.showStatus('Rota otimizada com sucesso!', 'success');
        } catch (error) {
            this.showStatus('Erro ao otimizar rota', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async getRealRouteAndDisplay() {
        this.routeLayerGroup.clearLayers();

        if (this.optimizedRoute.length === 0) return;

        // Add markers
        this.optimizedRoute.forEach((addr, index) => {
            const isStart = index === 0;
            const isEnd = index === this.optimizedRoute.length - 1;
            const isDuplicate = index > 0 && 
                addr.lat === this.optimizedRoute[0].lat && 
                addr.lng === this.optimizedRoute[0].lng;

            if (!isDuplicate) {
                const marker = this.createMarker(addr, index + 1, isStart, isEnd);
                this.routeLayerGroup.addLayer(marker);
            }
        });

        // Get real route between consecutive points
        if (this.optimizedRoute.length > 1) {
            await this.drawRealRoute();
        }

        // Center map on route
        this.centerMapOnAddresses();

        // Show Google Maps button
        this.elements.openGoogleMaps.style.display = 'block';
    }

    async drawRealRoute() {
        try {
            const allRouteCoords = [];
            let totalRealDistance = 0;

            for (let i = 0; i < this.optimizedRoute.length - 1; i++) {
                const start = this.optimizedRoute[i];
                const end = this.optimizedRoute[i + 1];

                const routeData = await this.getRouteFromORS(start, end);

                if (routeData && routeData.coordinates) {
                    // Convert ORS coordinates to Leaflet format
                    const segmentCoords = routeData.coordinates.map(coord => [coord[1], coord[0]]);
                    allRouteCoords.push(...segmentCoords);
                    totalRealDistance += routeData.distance || 0;

                    // Draw individual segment
                    const routeLine = L.polyline(segmentCoords, {
                        color: '#2196F3',
                        weight: 5,
                        opacity: 0.8,
                        className: 'route-line'
                    });
                    this.routeLayerGroup.addLayer(routeLine);

                    // Add distance label for this segment
                    if (segmentCoords.length > 0) {
                        const midPoint = segmentCoords[Math.floor(segmentCoords.length / 2)];
                        const distanceKm = (routeData.distance / 1000).toFixed(1);
                        const distanceMarker = L.marker(midPoint, {
                            icon: L.divIcon({
                                className: 'distance-marker',
                                html: `<div class="distance-label">${distanceKm} km</div>`,
                                iconSize: [60, 20],
                                iconAnchor: [30, 10]
                            })
                        });
                        this.routeLayerGroup.addLayer(distanceMarker);
                    }
                }
            }

            // Store real distance for statistics
            this.realTotalDistance = totalRealDistance;

        } catch (error) {
            console.error('Erro ao obter rota real:', error);
            // Fallback to straight lines
            this.drawStraightLineRoute();
        }
    }

    async getRouteFromORS(start, end) {
        try {
            // Using OpenRouteService free API (requires signup but is free)
            // For demo purposes, we'll use a basic routing service
            const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=YOUR_FREE_API_KEY&start=${start.lng},${start.lat}&end=${end.lng},${end.lat}`;

            // Since we can't use real API key in demo, let's use GraphHopper free API
            const graphHopperUrl = `https://graphhopper.com/api/1/route?point=${start.lat},${start.lng}&point=${end.lat},${end.lng}&vehicle=car&locale=pt_BR&calc_points=true&debug=true&elevation=false&points_encoded=false&type=json&key=YOUR_FREE_GRAPHHOPPER_KEY`;

            // For demonstration, we'll use OSRM free service
            const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?geometries=geojson&overview=full`;

            const response = await fetch(osrmUrl);

            if (!response.ok) {
                throw new Error('Erro na API de roteamento');
            }

            const data = await response.json();

            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                return {
                    coordinates: route.geometry.coordinates,
                    distance: route.distance,
                    duration: route.duration
                };
            }

            throw new Error('Nenhuma rota encontrada');

        } catch (error) {
            console.error('Erro ao buscar rota:', error);
            // Fallback to Nominatim directions (basic)
            return await this.getBasicRoute(start, end);
        }
    }

    async getBasicRoute(start, end) {
        // Fallback: create a simple route with some intermediate points
        const coords = this.interpolateRoute(start, end);
        const distance = this.calculateDistance(start, end) * 1000; // Convert to meters

        return {
            coordinates: coords.map(coord => [coord.lng, coord.lat]),
            distance: distance,
            duration: distance / 50 * 3.6 // Rough estimate: 50 km/h average
        };
    }

    interpolateRoute(start, end) {
        const points = [];
        const steps = 5; // Number of intermediate points

        for (let i = 0; i <= steps; i++) {
            const ratio = i / steps;
            const lat = start.lat + (end.lat - start.lat) * ratio;
            const lng = start.lng + (end.lng - start.lng) * ratio;
            points.push({ lat, lng });
        }

        return points;
    }

    drawStraightLineRoute() {
        // Fallback: draw straight lines if routing fails
        const routeCoords = this.optimizedRoute.map(addr => [addr.lat, addr.lng]);
        const routeLine = L.polyline(routeCoords, {
            color: '#FF5722',
            weight: 4,
            opacity: 0.8,
            dashArray: '10, 10' // Dashed line to indicate it's not real route
        });
        this.routeLayerGroup.addLayer(routeLine);
    }

    displayRouteOnMap() {
        // This method is now replaced by getRealRouteAndDisplay
        this.getRealRouteAndDisplay();
    }

    updateRouteInfo() {
        if (!this.optimizedRoute || this.optimizedRoute.length === 0) {
            this.elements.routeInfo.style.display = 'none';
            return;
        }

        // Use real distance if available, otherwise calculate straight-line distance
        const totalDistance = this.realTotalDistance ? 
            (this.realTotalDistance / 1000) : // Convert meters to km
            this.calculateTotalDistance(this.optimizedRoute);

        const estimatedTime = totalDistance / 45 * 60; // Assuming 45 km/h average speed for real roads

        this.elements.totalDistance.textContent = `${totalDistance.toFixed(1)} km`;
        this.elements.estimatedTime.textContent = `${Math.round(estimatedTime)} min`;
        this.elements.totalStops.textContent = `${this.optimizedRoute.length} paradas`;

        this.elements.routeInfo.style.display = 'block';
    }
    
    constructor() {
        this.addresses = [];
        this.optimizedRoute = [];
        this.map = null;
        this.routeLayerGroup = null;
        this.speedCamerasLayer = null;
        this.userLocation = null;
        this.db = null;
        this.savedRoutes = [];
        this.routeHistory = [];
        this.addressCache = new Map();
        this.showCameras = true;
        this.cameraLoadTimeout = null;
        this.realTotalDistance = null;
    }
// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.routeOptimizer = new RouteOptimizer();
});