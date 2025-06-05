class RouteOptimizer {
    constructor() {
        this.stops = [];
        this.currentLocation = null;
        this.optimizedRoute = null;
        this.db = null;
        this.deferredPrompt = null;
        this.map = null;
        this.mapVisible = false;
        this.markers = [];

        this.initializeApp();
        this.setupEventListeners();
        this.initializeDatabase().then(() => {
            this.loadSavedRoutes();
        }).catch(error => {
            console.log('IndexedDB não disponível, funcionando sem persistência');
        });
        this.getHighAccuracyLocation();
        this.loadLeafletMap();
    }

    async initializeApp() {
        // PWA installation
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            document.getElementById('installBtn').style.display = 'block';
        });

        // Service Worker registration
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('sw.js');
                console.log('Service Worker registrado com sucesso');
            } catch (error) {
                console.log('Erro ao registrar Service Worker:', error);
            }
        }
    }

    setupEventListeners() {
        document.getElementById('addBtn').addEventListener('click', () => this.addStop());
        document.getElementById('voiceBtn').addEventListener('click', () => this.startVoiceInput());
        document.getElementById('optimizeBtn').addEventListener('click', () => this.optimizeRoute());
        document.getElementById('clearBtn').addEventListener('click', () => this.clearStops());
        document.getElementById('openMapsBtn').addEventListener('click', () => this.openInGoogleMaps());
        document.getElementById('saveRouteBtn').addEventListener('click', () => this.saveCurrentRoute());
        document.getElementById('installBtn').addEventListener('click', () => this.installApp());
        document.getElementById('toggleMapBtn').addEventListener('click', () => this.toggleMap());

        document.getElementById('addressInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addStop();
        });

        // Autocompletar endereços
        let autocompleteTimeout;
        document.getElementById('addressInput').addEventListener('input', (e) => {
            clearTimeout(autocompleteTimeout);
            autocompleteTimeout = setTimeout(() => {
                this.showAddressSuggestions(e.target.value);
            }, 500);
        });
    }

    async initializeDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('RouteOptimizerDB', 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('routes')) {
                    db.createObjectStore('routes', { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    getCurrentLocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.currentLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    console.log('Localização atual obtida:', this.currentLocation);

                    // Centralizar mapa na localização atual se já estiver inicializado
                    if (this.map) {
                        this.centerMapOnCurrentLocation();
                    }
                },
                (error) => {
                    console.log('Geolocalização não disponível, usando Fortaleza como padrão');
                    // Usar localização padrão (Fortaleza)
                    this.currentLocation = { lat: -3.7319, lng: -38.5267 };

                    if (this.map) {
                        this.centerMapOnCurrentLocation();
                    }
                },
                {
                    timeout: 10000,
                    enableHighAccuracy: false
                }
            );
        } else {
            console.log('Geolocalização não suportada, usando Fortaleza como padrão');
            this.currentLocation = { lat: -3.7319, lng: -38.5267 };
        }
    }

    startVoiceInput() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            alert('Reconhecimento de voz não suportado neste navegador');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();

        recognition.lang = 'pt-BR';
        recognition.continuous = false;
        recognition.interimResults = false;

        const voiceBtn = document.getElementById('voiceBtn');
        const voiceStatus = document.getElementById('voiceStatus');

        voiceBtn.classList.add('listening');
        voiceStatus.textContent = 'Escutando... Fale o endereço';

        recognition.onresult = (event) => {
            const result = event.results[0][0].transcript;
            document.getElementById('addressInput').value = result;
            voiceStatus.textContent = `Escutei: "${result}"`;
        };

        recognition.onerror = (event) => {
            voiceStatus.textContent = 'Erro no reconhecimento de voz';
        };

        recognition.onend = () => {
            voiceBtn.classList.remove('listening');
            setTimeout(() => {
                voiceStatus.textContent = '';
            }, 3000);
        };

        recognition.start();
    }

    async showAddressSuggestions(query) {
        const suggestionsContainer = document.getElementById('addressSuggestions');
        if (!suggestionsContainer) {
            // Criar container de sugestões se não existir
            const container = document.createElement('div');
            container.id = 'addressSuggestions';
            container.className = 'address-suggestions';
            document.querySelector('.input-group').appendChild(container);
        }

        if (query.length < 3) {
            document.getElementById('addressSuggestions').innerHTML = '';
            return;
        }

        try {
            const suggestions = await this.searchAddressWithAutocomplete(query);
            const suggestionsHTML = suggestions.map(suggestion => 
                `<div class="suggestion-item" onclick="routeOptimizer.selectSuggestion('${suggestion.display_name}', ${suggestion.lat}, ${suggestion.lng})">${suggestion.display_name}</div>`
            ).join('');
            
            document.getElementById('addressSuggestions').innerHTML = suggestionsHTML;
        } catch (error) {
            console.error('Erro ao buscar sugestões:', error);
        }
    }

    selectSuggestion(address, lat, lng) {
        document.getElementById('addressInput').value = address;
        document.getElementById('addressSuggestions').innerHTML = '';
        
        // Adicionar parada automaticamente
        const stop = {
            id: Date.now(),
            address: address,
            coordinates: { lat: lat, lng: lng }
        };

        this.stops.push(stop);
        document.getElementById('addressInput').value = '';
        this.updateStopsList();
        this.updateOptimizeButton();
    }

    async addStop() {
        const input = document.getElementById('addressInput');
        const address = input.value.trim();

        if (!address) return;

        // Validar endereço
        const validation = this.validateAddress(address);
        if (!validation.isValid) {
            alert(`Endereço inválido: ${validation.suggestions}`);
            return;
        }

        try {
            let finalAddress = address;
            let coordinates;

            // Verificar se é um CEP
            if (this.isCEP(address)) {
                const cepData = await this.getCEPInfo(address);
                finalAddress = this.formatAddressFromCEP(cepData);
                coordinates = await this.geocodeAddress(finalAddress);
            } else {
                // Geocodificar endereço usando OpenStreetMap
                coordinates = await this.geocodeAddress(address);
            }

            const stop = {
                id: Date.now(),
                address: finalAddress,
                coordinates: coordinates
            };

            this.stops.push(stop);
            input.value = '';
            document.getElementById('addressSuggestions').innerHTML = '';
            this.updateStopsList();
            this.updateOptimizeButton();

        } catch (error) {
            alert('Endereço não encontrado. Tente ser mais específico.');
        }
    }

    isCEP(input) {
        // Remove tudo que não é número
        const numbers = input.replace(/\D/g, '');
        // CEP deve ter exatamente 8 dígitos
        return numbers.length === 8;
    }

    async getCEPInfo(cep) {
        // Remove formatação do CEP
        const cleanCEP = cep.replace(/\D/g, '');

        const response = await fetch(`https://viacep.com.br/ws/${cleanCEP}/json/`);
        const data = await response.json();

        if (data.erro) {
            throw new Error('CEP não encontrado');
        }

        return data;
    }

    formatAddressFromCEP(cepData) {
        // Formatar endereço usando os dados do CEP
        let address = '';

        if (cepData.logradouro) {
            address += cepData.logradouro;
        }

        if (cepData.bairro) {
            address += address ? `, ${cepData.bairro}` : cepData.bairro;
        }

        if (cepData.localidade) {
            address += address ? `, ${cepData.localidade}` : cepData.localidade;
        }

        if (cepData.uf) {
            address += ` - ${cepData.uf}`;
        }

        return address || `CEP ${cepData.cep}`;
    }

    async geocodeAddress(address) {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=br&limit=1`
        );

        const data = await response.json();

        if (data.length === 0) {
            throw new Error('Endereço não encontrado');
        }

        return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon)
        };
    }

    updateStopsList() {
        const stopsList = document.getElementById('stopsList');

        if (this.stops.length === 0) {
            stopsList.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Nenhuma parada adicionada</p>';
        } else {
            stopsList.innerHTML = this.stops.map((stop, index) => `
                <div class="stop-item" draggable="true" data-stop-id="${stop.id}" ondragstart="routeOptimizer.dragStart(event)" ondragover="routeOptimizer.dragOver(event)" ondrop="routeOptimizer.drop(event)">
                    <span class="drag-handle">⋮⋮</span>
                    <div class="stop-content">
                        <div class="stop-text"><strong>${index + 1}.</strong> ${stop.address}</div>
                        <div class="time-estimate" id="time-${stop.id}">Calculando tempo...</div>
                    </div>
                    <button class="remove-btn" onclick="routeOptimizer.removeStop(${stop.id})">❌</button>
                </div>
            `).join('');
            
            // Calcular tempo estimado para cada parada
            this.updateTimeEstimates();
        }

        // Atualizar mapa
        this.updateMapMarkers();
    }

    removeStop(id) {
        this.stops = this.stops.filter(stop => stop.id !== id);
        this.updateStopsList();
        this.updateOptimizeButton();
    }

    clearStops() {
        this.stops = [];
        this.updateStopsList();
        this.updateOptimizeButton();
        document.getElementById('resultSection').style.display = 'none';
    }

    updateOptimizeButton() {
        const optimizeBtn = document.getElementById('optimizeBtn');
        optimizeBtn.disabled = this.stops.length < 2;
    }

    async optimizeRoute() {
        if (this.stops.length < 2) return;

        document.getElementById('loading').style.display = 'flex';

        try {
            // Algoritmo simples de otimização: Nearest Neighbor
            const optimizedStops = await this.nearestNeighborOptimization();

            this.optimizedRoute = optimizedStops;
            this.displayOptimizedRoute();

        } catch (error) {
            alert('Erro ao otimizar rota: ' + error.message);
        } finally {
            document.getElementById('loading').style.display = 'none';
        }
    }

    async nearestNeighborOptimization() {
        if (!this.currentLocation) {
            throw new Error('Localização atual não disponível');
        }

        const unvisited = [...this.stops];
        const route = [];
        let currentPos = this.currentLocation;

        while (unvisited.length > 0) {
            let nearestIndex = 0;
            let minDistance = this.calculateDistance(currentPos, unvisited[0].coordinates);

            for (let i = 1; i < unvisited.length; i++) {
                const distance = this.calculateDistance(currentPos, unvisited[i].coordinates);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestIndex = i;
                }
            }

            const nearestStop = unvisited.splice(nearestIndex, 1)[0];
            route.push(nearestStop);
            currentPos = nearestStop.coordinates;
        }

        return route;
    }

    calculateDistance(pos1, pos2) {
        const R = 6371; // Raio da Terra em km
        const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
        const dLon = (pos2.lng - pos1.lng) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    async displayOptimizedRoute() {
        const resultSection = document.getElementById('resultSection');
        const routeInfo = document.getElementById('routeInfo');

        let totalDistance = 0;
        let totalTime = 0;
        let currentPos = this.currentLocation;

        let routeHTML = `
            <div class="route-step">
                <div class="step-number">🏠</div>
                <div>Ponto de partida: Sua localização atual</div>
            </div>
        `;

        // Calcular distâncias e tempos para cada parada
        for (let index = 0; index < this.optimizedRoute.length; index++) {
            const stop = this.optimizedRoute[index];
            const distance = this.calculateDistance(currentPos, stop.coordinates);
            const estimatedTime = await this.calculateEstimatedTime(currentPos, stop.coordinates);

            totalDistance += distance;
            totalTime += estimatedTime;

            routeHTML += `
                <div class="route-step">
                    <div class="step-number">${index + 1}</div>
                    <div>
                        <strong>${stop.address}</strong><br>
                        <small>📏 ${distance.toFixed(1)} km • ⏱️ ${estimatedTime} min</small>
                    </div>
                </div>
            `;
            currentPos = stop.coordinates;
        }

        const totalHours = Math.floor(totalTime / 60);
        const totalMinutes = totalTime % 60;
        const timeDisplay = totalHours > 0 ? 
            `${totalHours}h ${totalMinutes}min` : 
            `${totalMinutes} min`;

        routeHTML += `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #ddd;">
                <strong>📏 Distância total: ${totalDistance.toFixed(1)} km</strong><br>
                <strong>⏱️ Tempo total estimado: ${timeDisplay}</strong>
            </div>
        `;

        routeInfo.innerHTML = routeHTML;
        resultSection.style.display = 'block';
    }

    async calculateEstimatedTime(origin, destination) {
        const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=false`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.routes && data.routes.length > 0) {
                const durationInSeconds = data.routes[0].duration;
                const durationInMinutes = Math.round(durationInSeconds / 60);
                return durationInMinutes;
            } else {
                console.warn("No route found or error in OSRM response:", data);
                return 0; // Retorna 0 em caso de erro ou rota não encontrada
            }
        } catch (error) {
            console.error("Erro ao calcular o tempo estimado:", error);
            return 0; // Retorna 0 em caso de erro
        }
    }

    openInGoogleMaps() {
        if (!this.optimizedRoute || this.optimizedRoute.length === 0) return;

        const waypoints = this.optimizedRoute.map(stop => 
            `${stop.coordinates.lat},${stop.coordinates.lng}`
        ).join('|');

        const destination = this.optimizedRoute[this.optimizedRoute.length - 1];
        const destCoords = `${destination.coordinates.lat},${destination.coordinates.lng}`;

        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=current+location&destination=${destCoords}&waypoints=${waypoints}&travelmode=driving`;

        window.open(mapsUrl, '_blank');
    }

    async saveCurrentRoute() {
        if (!this.optimizedRoute || this.optimizedRoute.length === 0) return;

        if (!this.db) {
            alert('Funcionalidade de salvar não disponível no momento');
            return;
        }

        const routeName = prompt('Nome para esta rota:') || `Rota ${new Date().toLocaleDateString()}`;

        const routeData = {
            name: routeName,
            date: new Date().toISOString(),
            stops: this.stops,
            optimizedRoute: this.optimizedRoute
        };

        try {
            await this.saveRouteToDatabase(routeData);
            alert('Rota salva com sucesso!');
            this.loadSavedRoutes();
        } catch (error) {
            alert('Erro ao salvar rota: ' + error.message);
        }
    }

    async saveRouteToDatabase(routeData) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['routes'], 'readwrite');
            const store = transaction.objectStore('routes');
            const request = store.add(routeData);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadSavedRoutes() {
        if (!this.db) {
            this.displaySavedRoutes([]);
            return;
        }

        try {
            const routes = await this.getSavedRoutesFromDatabase();
            this.displaySavedRoutes(routes);
        } catch (error) {
            console.log('Erro ao carregar rotas salvas, funcionando sem persistência');
            this.displaySavedRoutes([]);
        }
    }

    async getSavedRoutesFromDatabase() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['routes'], 'readonly');
            const store = transaction.objectStore('routes');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    displaySavedRoutes(routes) {
        const savedRoutesList = document.getElementById('savedRoutesList');

        if (routes.length === 0) {
            savedRoutesList.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Nenhuma rota salva</p>';
            return;
        }

        savedRoutesList.innerHTML = routes.map(route => `
            <div class="saved-route-item">
                <div class="saved-route-header">
                    <div class="saved-route-name">${route.name}</div>
                    <div class="saved-route-date">${new Date(route.date).toLocaleDateString()}</div>
                </div>
                <div style="font-size: 0.9rem; color: #666; margin-bottom: 10px;">
                    ${route.stops.length} paradas
                </div>
                <div class="saved-route-actions">
                    <button class="load-btn" onclick="routeOptimizer.loadSavedRoute(${route.id})">Carregar</button>
                    <button class="delete-btn" onclick="routeOptimizer.deleteSavedRoute(${route.id})">Excluir</button>
                </div>
            </div>
        `).join('');
    }

    async loadSavedRoute(id) {
        try {
            const route = await this.getRouteFromDatabase(id);
            this.stops = route.stops;
            this.optimizedRoute = route.optimizedRoute;

            this.updateStopsList();
            this.updateOptimizeButton();
            this.displayOptimizedRoute();

            alert('Rota carregada com sucesso!');
        } catch (error) {
            alert('Erro ao carregar rota: ' + error.message);
        }
    }

    async getRouteFromDatabase(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['routes'], 'readonly');
            const store = transaction.objectStore('routes');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteSavedRoute(id) {
        if (!confirm('Tem certeza que deseja excluir esta rota?')) return;

        try {
            await this.deleteRouteFromDatabase(id);
            alert('Rota excluída com sucesso!');
            this.loadSavedRoutes();
        } catch (error) {
            alert('Erro ao excluir rota: ' + error.message);
        }
    }

    async deleteRouteFromDatabase(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['routes'], 'readwrite');
            const store = transaction.objectStore('routes');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadLeafletMap() {
        // Carregar Leaflet CSS e JS dinamicamente
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => {
            this.initializeMap();
        };
        document.head.appendChild(script);
    }

    initializeMap() {
        // Inicializar o mapa centrado no Brasil
        const defaultCenter = [-14.235004, -51.92528]; // Centro do Brasil

        this.map = L.map('mapContainer', {
            zoomControl: true,
            attributionControl: true
        }).setView(defaultCenter, 4);

        // Adicionar tiles do OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Aguardar localização atual para centralizar o mapa
        if (this.currentLocation) {
            this.centerMapOnCurrentLocation();
        }
    }

    centerMapOnCurrentLocation() {
        if (this.currentLocation && this.map) {
            this.map.setView([this.currentLocation.lat, this.currentLocation.lng], 13);

            // Adicionar marcador da localização atual
            const currentLocationIcon = L.divIcon({
                html: '🏠',
                iconSize: [30, 30],
                className: 'current-location-marker'
            });

            L.marker([this.currentLocation.lat, this.currentLocation.lng], {
                icon: currentLocationIcon
            }).addTo(this.map).bindPopup('Sua localização atual');
        }
    }

    toggleMap() {
        const mapContainer = document.getElementById('mapContainer');
        this.mapVisible = !this.mapVisible;

        if (this.mapVisible) {
            mapContainer.style.display = 'block';
            if (this.map) {
                setTimeout(() => {
                    this.map.invalidateSize();
                    if (this.currentLocation) {
                        this.centerMapOnCurrentLocation();
                    }
                    this.updateMapMarkers();
                }, 100);
            }
        } else {
            mapContainer.style.display = 'none';
        }
    }

    updateMapMarkers() {
        if (!this.map) return;

        // Limpar marcadores existentes
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];

        // Adicionar marcadores das paradas
        this.stops.forEach((stop, index) => {
            const icon = L.divIcon({
                html: `<div style="background: linear-gradient(135deg, #f72585, #b5179e); color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);">${index + 1}</div>`,
                iconSize: [30, 30],
                className: 'stop-marker'
            });

            const marker = L.marker([stop.coordinates.lat, stop.coordinates.lng], {
                icon: icon
            }).addTo(this.map);

            marker.bindPopup(`
                <div style="font-size: 14px;">
                    <strong>Parada ${index + 1}</strong><br>
                    ${stop.address}
                </div>
            `);

            this.markers.push(marker);
        });

        // Ajustar zoom para mostrar todas as paradas
        if (this.stops.length > 0) {
            const group = new L.featureGroup(this.markers);

            if (this.currentLocation) {
                const currentLocationIcon = L.divIcon({
                    html: '🏠',
                    iconSize: [30, 30],
                    className: 'current-location-marker'
                });

                const currentMarker = L.marker([this.currentLocation.lat, this.currentLocation.lng], {
                    icon: currentLocationIcon
                }).addTo(this.map);

                group.addLayer(currentMarker);
            }

            this.map.fitBounds(group.getBounds().pad(0.1));
        }

        // Atualizar informações do mapa
        this.updateMapInfo();
    }

    updateMapInfo() {
        const mapInfo = document.getElementById('mapInfo');
        if (this.stops.length === 0) {
            mapInfo.innerHTML = 'Adicione pelo menos uma parada para visualizar no mapa';
        } else {
            mapInfo.innerHTML = `${this.stops.length} parada(s) adicionada(s). ${this.mapVisible ? 'Clique nos marcadores para ver detalhes.' : 'Clique em "Mostrar Mapa" para visualizar.'}`;
        }
    }

    async installApp() {
        if (!this.deferredPrompt) return;

        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            console.log('PWA instalado');
        }

        this.deferredPrompt = null;
        document.getElementById('installBtn').style.display = 'none';
    }

    // Métodos para arrastar e soltar
    dragStart(e) {
        e.dataTransfer.setData('text/plain', e.target.dataset.stopId);
        e.target.style.opacity = '0.5';
    }

    dragOver(e) {
        e.preventDefault();
        e.target.style.backgroundColor = '#f0f8ff';
    }

    drop(e) {
        e.preventDefault();
        e.target.style.backgroundColor = '';
        
        const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
        const targetId = parseInt(e.target.closest('.stop-item').dataset.stopId);
        
        if (draggedId !== targetId) {
            this.reorderStops(draggedId, targetId);
        }
        
        // Restaurar opacidade
        document.querySelector(`[data-stop-id="${draggedId}"]`).style.opacity = '1';
    }

    reorderStops(draggedId, targetId) {
        const draggedIndex = this.stops.findIndex(stop => stop.id === draggedId);
        const targetIndex = this.stops.findIndex(stop => stop.id === targetId);
        
        const [draggedStop] = this.stops.splice(draggedIndex, 1);
        this.stops.splice(targetIndex, 0, draggedStop);
        
        this.updateStopsList();
    }

    // Calcular tempo estimado em tempo real
    async updateTimeEstimates() {
        if (!this.currentLocation) return;

        for (let i = 0; i < this.stops.length; i++) {
            const stop = this.stops[i];
            const timeElement = document.getElementById(`time-${stop.id}`);
            
            if (timeElement) {
                try {
                    const estimatedTime = await this.calculateEstimatedTime(this.currentLocation, stop.coordinates);
                    const distance = this.calculateDistance(this.currentLocation, stop.coordinates);
                    
                    timeElement.innerHTML = `📍 ${distance.toFixed(1)} km • ⏱️ ${estimatedTime} min da sua localização`;
                    timeElement.style.color = '#28a745';
                } catch (error) {
                    timeElement.innerHTML = '⚠️ Tempo não disponível';
                    timeElement.style.color = '#dc3545';
                }
            }
        }
    }

    // Exportar rota para diferentes formatos
    exportRoute(format) {
        if (!this.optimizedRoute || this.optimizedRoute.length === 0) {
            alert('Nenhuma rota otimizada para exportar');
            return;
        }

        const routeData = {
            name: prompt('Nome da rota:') || 'Rota Exportada',
            date: new Date().toISOString(),
            currentLocation: this.currentLocation,
            stops: this.optimizedRoute,
            totalStops: this.optimizedRoute.length
        };

        switch (format) {
            case 'json':
                this.downloadFile(`${routeData.name}.json`, JSON.stringify(routeData, null, 2), 'application/json');
                break;
            case 'csv':
                this.exportToCSV(routeData);
                break;
            case 'gpx':
                this.exportToGPX(routeData);
                break;
        }
    }

    exportToCSV(routeData) {
        let csv = 'Ordem,Endereço,Latitude,Longitude\n';
        csv += `0,Ponto de Partida,${routeData.currentLocation.lat},${routeData.currentLocation.lng}\n`;
        
        routeData.stops.forEach((stop, index) => {
            csv += `${index + 1},"${stop.address}",${stop.coordinates.lat},${stop.coordinates.lng}\n`;
        });

        this.downloadFile(`${routeData.name}.csv`, csv, 'text/csv');
    }

    exportToGPX(routeData) {
        let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Otimizador de Rotas">
    <trk>
        <name>${routeData.name}</name>
        <trkseg>`;

        // Adicionar ponto de partida
        gpx += `
            <trkpt lat="${routeData.currentLocation.lat}" lon="${routeData.currentLocation.lng}">
                <name>Ponto de Partida</name>
            </trkpt>`;

        // Adicionar paradas
        routeData.stops.forEach((stop, index) => {
            gpx += `
            <trkpt lat="${stop.coordinates.lat}" lon="${stop.coordinates.lng}">
                <name>Parada ${index + 1}: ${stop.address}</name>
            </trkpt>`;
        });

        gpx += `
        </trkseg>
    </trk>
</gpx>`;

        this.downloadFile(`${routeData.name}.gpx`, gpx, 'application/gpx+xml');
    }

    downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Busca inteligente de endereços
    async searchAddressWithAutocomplete(query) {
        if (query.length < 3) return [];

        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=5&addressdetails=1`
            );
            const data = await response.json();
            
            return data.map(item => ({
                display_name: item.display_name,
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon)
            }));
        } catch (error) {
            console.error('Erro na busca de endereços:', error);
            return [];
        }
    }

    // Validação de endereços
    validateAddress(address) {
        const minLength = 5;
        const hasNumbers = /\d/.test(address);
        const hasLetters = /[a-zA-Z]/.test(address);
        
        return {
            isValid: address.length >= minLength && hasNumbers && hasLetters,
            suggestions: address.length < minLength ? 'Endereço muito curto' : 
                        !hasNumbers ? 'Adicione número da casa/prédio' :
                        !hasLetters ? 'Endereço inválido' : ''
        };
    }

    // Detectar localização mais precisa
    async getHighAccuracyLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject('Geolocalização não suportada');
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.currentLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    };
                    console.log(`Localização obtida com precisão de ${position.coords.accuracy}m`);
                    resolve(this.currentLocation);
                },
                (error) => {
                    console.log('Usando localização padrão (Fortaleza)');
                    this.currentLocation = { lat: -3.7319, lng: -38.5267, accuracy: null };
                    resolve(this.currentLocation);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 300000 // 5 minutos
                }
            );
        });
    }
}

// Inicializar aplicação quando DOM estiver pronto
let routeOptimizer;
document.addEventListener('DOMContentLoaded', () => {
    routeOptimizer = new RouteOptimizer();
});