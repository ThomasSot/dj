const { ipcRenderer } = require('electron');

/**
 * Variables globales
 */
let currentDownloadPath = null;
let searchResults = [];
let isSearching = false;

/**
 * Elementos del DOM
 */
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const spotifyConfigBtn = document.getElementById('spotifyConfigBtn');
const currentFolderSpan = document.getElementById('currentFolder');
const loadingSpinner = document.getElementById('loadingSpinner');
const resultsContainer = document.getElementById('resultsContainer');
const resultsList = document.getElementById('resultsList');
const downloadModal = document.getElementById('downloadModal');
const spotifyConfigModal = document.getElementById('spotifyConfigModal');
const toastContainer = document.getElementById('toastContainer');

/**
 * Event Listeners
 */
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

/**
 * Inicializar la aplicación
 */
function initializeApp() {
    // Configurar carpeta de descarga por defecto (Documentos/Music)
    const os = require('os');
    const path = require('path');
    currentDownloadPath = path.join(os.homedir(), 'Music');
    updateCurrentFolderDisplay();
    
    showToast('¡Bienvenido! Selecciona una carpeta de descarga y comienza a buscar música.', 'success');
}

/**
 * Configurar event listeners
 */
function setupEventListeners() {
    // Búsqueda
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Selección de carpeta
    selectFolderBtn.addEventListener('click', selectDownloadFolder);

    // Configuración de Spotify
    spotifyConfigBtn.addEventListener('click', showSpotifyConfigModal);

    // Listener para progreso de descarga
    ipcRenderer.on('download-progress', (event, data) => {
        updateDownloadProgress(data);
    });

    // Listener para progreso de playlist
    ipcRenderer.on('playlist-progress', (event, data) => {
        updatePlaylistProgress(data);
    });
}

/**
 * Manejar búsqueda de música
 */
async function handleSearch() {
    const query = searchInput.value.trim();
    
    if (!query) {
        showToast('Por favor ingresa un término de búsqueda', 'warning');
        return;
    }

    if (isSearching) return;

    try {
        isSearching = true;
        showLoadingState(true);
        clearResults();

        const result = await ipcRenderer.invoke('search-youtube', query);

        if (result.success) {
            // Verificar si es una playlist
            if (result.isPlaylist) {
                if (result.isManualMode) {
                    displayManualPlaylistMode(result);
                    showToast(`⚠️ No se pudo extraer automáticamente la playlist. Usa el modo manual.`, 'warning');
                } else {
                    displayPlaylist(result);
                    showToast(`🎵 Playlist de Spotify detectada: "${result.playlistName}" con ${result.totalTracks} canciones`, 'success');
                }
            } else {
                searchResults = result.videos;
                displayResults(searchResults);

                // Mostrar mensaje especial si se detectó un link de Spotify
                if (result.isFromSpotify) {
                    showToast(`🎵 Link de Spotify detectado! Buscando: "${result.searchQuery}"`, 'success');
                } else {
                    showToast(`Se encontraron ${searchResults.length} resultados`, 'success');
                }
            }
        } else {
            showToast(`Error en la búsqueda: ${result.error}`, 'error');
        }

    } catch (error) {
        console.error('Error en búsqueda:', error);
        showToast('Error inesperado durante la búsqueda', 'error');
    } finally {
        isSearching = false;
        showLoadingState(false);
    }
}

/**
 * Mostrar/ocultar estado de carga
 */
function showLoadingState(show) {
    searchBtn.disabled = show;
    
    if (show) {
        searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Buscando...';
        loadingSpinner.classList.remove('hidden');
        resultsContainer.classList.add('hidden');
    } else {
        searchBtn.innerHTML = '<i class="fas fa-search mr-2"></i>Buscar';
        loadingSpinner.classList.add('hidden');
    }
}

/**
 * Limpiar resultados anteriores
 */
function clearResults() {
    resultsList.innerHTML = '';
    resultsContainer.classList.add('hidden');
}

/**
 * Mostrar resultados de búsqueda
 */
function displayResults(videos) {
    if (videos.length === 0) {
        showToast('No se encontraron resultados', 'warning');
        return;
    }

    resultsContainer.classList.remove('hidden');
    resultsContainer.classList.add('fade-in');

    videos.forEach((video, index) => {
        const resultCard = createResultCard(video, index);
        resultsList.appendChild(resultCard);
    });
}

/**
 * Crear tarjeta de resultado
 */
function createResultCard(video, index) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-md p-4 result-card fade-in';
    card.style.animationDelay = `${index * 0.1}s`;

    // Truncar título si es muy largo
    const truncatedTitle = video.title.length > 60 
        ? video.title.substring(0, 60) + '...' 
        : video.title;

    card.innerHTML = `
        <div class="flex items-center space-x-4">
            <div class="flex-shrink-0">
                <img 
                    src="${video.thumbnail}" 
                    alt="${video.title}"
                    class="w-24 h-18 object-cover rounded-lg thumbnail"
                    onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiB2aWV3Qm94PSIwIDAgMTIwIDkwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik00OCA0MEw3MiA1NUw0OCA3MFY0MFoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+'"
                />
            </div>
            <div class="flex-1 min-w-0">
                <h4 class="text-lg font-semibold text-gray-800 mb-1" title="${video.title}">
                    ${truncatedTitle}
                </h4>
                <p class="text-gray-600 mb-2">
                    <i class="fas fa-user mr-1"></i>
                    ${video.channel}
                </p>
                <div class="flex items-center text-sm text-gray-500 space-x-4">
                    <span>
                        <i class="fas fa-clock mr-1"></i>
                        ${video.duration}
                    </span>
                    <span>
                        <i class="fab fa-youtube mr-1 text-red-600"></i>
                        YouTube
                    </span>
                </div>
            </div>
            <div class="flex-shrink-0">
                <div class="space-y-2">
                    <button
                        onclick="downloadAudio('${video.id}')"
                        class="download-btn text-white px-6 py-3 rounded-lg ripple w-full"
                        id="download-btn-${video.id}"
                    >
                        <i class="fas fa-download mr-2"></i>
                        Descargar MP3
                    </button>
                    <button
                        onclick="getTrackMetadata('${video.id}', '${video.title}', '${video.channel}')"
                        class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm transition-colors w-full"
                        id="metadata-btn-${video.id}"
                    >
                        <i class="fas fa-music mr-2"></i>
                        Metadatos
                    </button>
                </div>
            </div>
        </div>
    `;

    return card;
}

/**
 * Seleccionar carpeta de descarga
 */
async function selectDownloadFolder() {
    try {
        const folderPath = await ipcRenderer.invoke('select-download-folder');
        
        if (folderPath) {
            currentDownloadPath = folderPath;
            updateCurrentFolderDisplay();
            showToast('Carpeta de descarga actualizada', 'success');
        }
    } catch (error) {
        console.error('Error seleccionando carpeta:', error);
        showToast('Error al seleccionar carpeta', 'error');
    }
}

/**
 * Actualizar display de carpeta actual
 */
function updateCurrentFolderDisplay() {
    if (currentDownloadPath) {
        const path = require('path');
        const folderName = path.basename(currentDownloadPath);
        currentFolderSpan.textContent = folderName;
        currentFolderSpan.title = currentDownloadPath;
    } else {
        currentFolderSpan.textContent = 'No seleccionada';
    }
}

/**
 * Descargar audio
 */
async function downloadAudio(videoId) {
    if (!currentDownloadPath) {
        showToast('Por favor selecciona una carpeta de descarga primero', 'warning');
        return;
    }

    const video = searchResults.find(v => v.id === videoId);
    if (!video) {
        showToast('Video no encontrado', 'error');
        return;
    }

    const downloadBtn = document.getElementById(`download-btn-${videoId}`);
    
    try {
        // Deshabilitar botón y mostrar estado de descarga
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Descargando...';

        // Mostrar modal de progreso
        showDownloadModal(video);

        // Iniciar descarga
        const result = await ipcRenderer.invoke('download-audio', video, currentDownloadPath);

        if (result.success) {
            showToast(`✅ Descarga completada: ${result.fileName}`, 'success');
            updateDownloadModalSuccess(result.fileName);
        } else {
            showToast(`❌ Error en descarga: ${result.error}`, 'error');
            updateDownloadModalError(result.error);
        }

    } catch (error) {
        console.error('Error en descarga:', error);
        showToast('Error inesperado durante la descarga', 'error');
        updateDownloadModalError('Error inesperado');
    } finally {
        // Restaurar botón
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = '<i class="fas fa-download mr-2"></i>Descargar MP3';
        
        // Ocultar modal después de un delay
        setTimeout(() => {
            hideDownloadModal();
        }, 3000);
    }
}

/**
 * Mostrar modal de descarga
 */
function showDownloadModal(video) {
    document.getElementById('downloadTitle').textContent = video.title;
    document.getElementById('downloadArtist').textContent = video.channel;
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('progressSize').textContent = '0 MB / 0 MB';
    document.getElementById('downloadStatus').textContent = 'Iniciando descarga...';
    
    downloadModal.classList.remove('hidden');
    downloadModal.classList.add('flex');
}

/**
 * Ocultar modal de descarga
 */
function hideDownloadModal() {
    downloadModal.classList.add('hidden');
    downloadModal.classList.remove('flex');
}

/**
 * Actualizar progreso de descarga
 */
function updateDownloadProgress(data) {
    document.getElementById('progressBar').style.width = `${data.progress}%`;
    document.getElementById('progressPercent').textContent = `${data.progress}%`;
    document.getElementById('progressSize').textContent = `${data.downloaded} / ${data.total}`;
    
    if (data.progress < 50) {
        document.getElementById('downloadStatus').textContent = 'Descargando audio...';
    } else if (data.progress < 90) {
        document.getElementById('downloadStatus').textContent = 'Convirtiendo a MP3...';
    } else {
        document.getElementById('downloadStatus').textContent = 'Finalizando...';
    }
}

/**
 * Actualizar modal con éxito
 */
function updateDownloadModalSuccess(fileName) {
    document.getElementById('downloadStatus').innerHTML = `
        <i class="fas fa-check-circle text-green-600 mr-2"></i>
        ¡Descarga completada!<br>
        <small class="text-gray-600">${fileName}</small>
    `;
}

/**
 * Actualizar modal con error
 */
function updateDownloadModalError(error) {
    document.getElementById('downloadStatus').innerHTML = `
        <i class="fas fa-exclamation-circle text-red-600 mr-2"></i>
        Error en descarga<br>
        <small class="text-gray-600">${error}</small>
    `;
}

/**
 * Mostrar notificación toast
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} p-4 rounded-lg shadow-lg text-sm max-w-sm slide-in`;
    
    const icon = type === 'success' ? 'check-circle' : 
                 type === 'error' ? 'exclamation-circle' : 
                 type === 'warning' ? 'exclamation-triangle' : 'info-circle';
    
    toast.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-${icon} mr-2"></i>
            <span>${message}</span>
            <button onclick="removeToast(this.parentElement.parentElement)" class="ml-auto text-lg">&times;</button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Auto-remove después de 5 segundos
    setTimeout(() => {
        removeToast(toast);
    }, 5000);
}

/**
 * Remover notificación toast
 */
function removeToast(toast) {
    if (toast && toast.parentElement) {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }
}

/**
 * Mostrar modo manual para playlist
 */
function displayManualPlaylistMode(playlistData) {
    clearResults();
    resultsContainer.classList.remove('hidden');
    resultsContainer.classList.add('fade-in');

    // Crear interfaz manual
    const manualContainer = document.createElement('div');
    manualContainer.className = 'bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6';
    manualContainer.innerHTML = `
        <div class="text-center mb-6">
            <div class="text-yellow-600 text-4xl mb-3">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <h3 class="text-xl font-bold text-yellow-800 mb-2">Modo Manual Requerido</h3>
            <p class="text-yellow-700 mb-4">
                No se pudo extraer automáticamente la información de la playlist.<br>
                <strong>Razón:</strong> ${playlistData.error}
            </p>
            <div class="bg-white rounded-lg p-4 mb-4">
                <p class="text-sm text-gray-600 mb-2">
                    <strong>Playlist URL:</strong> <a href="${playlistData.playlistUrl}" target="_blank" class="text-blue-600 hover:underline">${playlistData.playlistUrl}</a>
                </p>
            </div>
        </div>

        <div class="mb-6">
            <label class="block text-sm font-semibold text-gray-700 mb-2">
                Nombre de la Playlist:
            </label>
            <input
                type="text"
                id="manualPlaylistName"
                placeholder="Ej: Mi Playlist Favorita"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
        </div>

        <div class="mb-6">
            <label class="block text-sm font-semibold text-gray-700 mb-2">
                Lista de Canciones (una por línea):
            </label>
            <textarea
                id="manualTracksList"
                rows="10"
                placeholder="Ingresa las canciones en formato: Artista - Canción&#10;Ejemplo:&#10;The Beatles - Hey Jude&#10;Queen - Bohemian Rhapsody&#10;Led Zeppelin - Stairway to Heaven"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 font-mono text-sm"
            ></textarea>
            <p class="text-xs text-gray-500 mt-1">
                Formato recomendado: "Artista - Canción" (una por línea)
            </p>
        </div>

        <div class="text-center">
            <button
                onclick="processManualPlaylist()"
                class="bg-yellow-600 hover:bg-yellow-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors">
                <i class="fas fa-list-music mr-2"></i>
                Procesar Playlist Manual
            </button>
        </div>
    `;

    resultsList.appendChild(manualContainer);

    // Guardar datos para uso posterior
    window.currentManualPlaylist = playlistData;
}

/**
 * Procesar playlist manual
 */
function processManualPlaylist() {
    const playlistName = document.getElementById('manualPlaylistName').value.trim();
    const tracksList = document.getElementById('manualTracksList').value.trim();

    if (!playlistName) {
        showToast('Por favor ingresa un nombre para la playlist', 'warning');
        return;
    }

    if (!tracksList) {
        showToast('Por favor ingresa al menos una canción', 'warning');
        return;
    }

    // Procesar las líneas de canciones
    const lines = tracksList.split('\n').filter(line => line.trim());
    const tracks = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            // Intentar diferentes formatos de separación
            let trackName = '';
            let artistName = '';

            if (trimmedLine.includes(' - ')) {
                const parts = trimmedLine.split(' - ');
                artistName = parts[0].trim();
                trackName = parts.slice(1).join(' - ').trim();
            } else if (trimmedLine.includes(' by ')) {
                const parts = trimmedLine.split(' by ');
                trackName = parts[0].trim();
                artistName = parts.slice(1).join(' by ').trim();
            } else {
                // Si no hay separador claro, usar toda la línea como búsqueda
                trackName = trimmedLine;
                artistName = 'Unknown';
            }

            if (trackName) {
                tracks.push({
                    name: trackName,
                    artists: artistName,
                    searchQuery: artistName !== 'Unknown' ? `${artistName} ${trackName}` : trackName
                });
            }
        }
    }

    if (tracks.length === 0) {
        showToast('No se pudieron procesar las canciones. Verifica el formato.', 'error');
        return;
    }

    // Crear objeto de playlist manual
    const manualPlaylist = {
        playlistName: playlistName,
        tracks: tracks,
        totalTracks: tracks.length,
        isManual: true
    };

    // Mostrar la playlist procesada
    displayPlaylist(manualPlaylist);
    showToast(`✅ Playlist manual procesada: ${tracks.length} canciones`, 'success');
}

/**
 * Mostrar información de playlist
 */
function displayPlaylist(playlistData) {
    clearResults();
    resultsContainer.classList.remove('hidden');
    resultsContainer.classList.add('fade-in');

    // Crear header de la playlist
    const playlistHeader = document.createElement('div');
    playlistHeader.className = 'bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg p-6 mb-6';
    playlistHeader.innerHTML = `
        <div class="flex items-center justify-between">
            <div>
                <h3 class="text-2xl font-bold mb-2">
                    <i class="fab fa-spotify mr-3"></i>
                    ${playlistData.playlistName}
                </h3>
                <p class="text-green-100">
                    <i class="fas fa-music mr-2"></i>
                    ${playlistData.totalTracks} canciones
                </p>
            </div>
            <button
                onclick="downloadPlaylist()"
                class="bg-white text-green-600 hover:bg-green-50 px-6 py-3 rounded-lg font-semibold transition-colors flex items-center">
                <i class="fas fa-download mr-2"></i>
                Descargar Playlist
            </button>
        </div>
    `;

    resultsList.appendChild(playlistHeader);

    // Mostrar lista de canciones
    const tracksContainer = document.createElement('div');
    tracksContainer.className = 'space-y-3';

    playlistData.tracks.forEach((track, index) => {
        const trackCard = document.createElement('div');
        trackCard.className = 'bg-white rounded-lg shadow-sm border p-4 flex items-center justify-between hover:shadow-md transition-shadow';
        trackCard.innerHTML = `
            <div class="flex items-center space-x-4">
                <div class="bg-gray-100 rounded-full w-10 h-10 flex items-center justify-center text-gray-600 font-semibold">
                    ${index + 1}
                </div>
                <div>
                    <h4 class="font-semibold text-gray-800">${track.name}</h4>
                    <p class="text-gray-600 text-sm">${track.artists}</p>
                </div>
            </div>
            <div class="text-gray-400">
                <i class="fas fa-music"></i>
            </div>
        `;
        tracksContainer.appendChild(trackCard);
    });

    resultsList.appendChild(tracksContainer);

    // Guardar datos de la playlist globalmente
    window.currentPlaylist = playlistData;
}

/**
 * Descargar playlist completa
 */
async function downloadPlaylist() {
    if (!window.currentPlaylist) {
        showToast('No hay playlist seleccionada', 'error');
        return;
    }

    if (!currentDownloadPath) {
        showToast('Por favor selecciona una carpeta de descarga primero', 'warning');
        return;
    }

    try {
        // Mostrar modal de progreso de playlist
        showPlaylistDownloadModal(window.currentPlaylist);

        // Iniciar descarga
        const result = await ipcRenderer.invoke('download-playlist', window.currentPlaylist, currentDownloadPath);

        if (result.success) {
            showToast(`✅ Playlist descargada: ${result.downloaded}/${result.totalTracks} canciones exitosas`, 'success');
            updatePlaylistModalSuccess(result);
        } else {
            showToast(`❌ Error descargando playlist: ${result.error}`, 'error');
            updatePlaylistModalError(result.error);
        }

    } catch (error) {
        console.error('Error descargando playlist:', error);
        showToast('Error inesperado descargando playlist', 'error');
        updatePlaylistModalError('Error inesperado');
    }
}

/**
 * Mostrar modal de progreso de playlist
 */
function showPlaylistDownloadModal(playlistData) {
    const modal = document.getElementById('downloadModal');
    const modalContent = modal.querySelector('.bg-white');

    modalContent.innerHTML = `
        <div class="p-6">
            <h3 class="text-lg font-semibold mb-4 text-center">
                <i class="fab fa-spotify text-green-500 mr-2"></i>
                Descargando Playlist
            </h3>
            <div class="text-center mb-4">
                <h4 class="font-semibold text-gray-800">${playlistData.playlistName}</h4>
                <p class="text-gray-600">${playlistData.totalTracks} canciones</p>
            </div>

            <div class="mb-4">
                <div class="bg-gray-200 rounded-full h-3 mb-2">
                    <div id="playlistProgressBar" class="bg-green-500 h-3 rounded-full transition-all duration-300" style="width: 0%"></div>
                </div>
                <div class="flex justify-between text-sm text-gray-600">
                    <span id="playlistProgressText">Iniciando...</span>
                    <span id="playlistProgressPercent">0%</span>
                </div>
            </div>

            <div id="currentTrackInfo" class="text-center text-sm text-gray-600 bg-gray-50 p-3 rounded-lg mb-4">
                Preparando descarga...
            </div>

            <div class="text-center">
                <button
                    onclick="closeDownloadModal()"
                    class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors">
                    <i class="fas fa-times mr-2"></i>
                    Cerrar
                </button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
}

/**
 * Actualizar progreso de playlist
 */
function updatePlaylistProgress(data) {
    const progressBar = document.getElementById('playlistProgressBar');
    const progressText = document.getElementById('playlistProgressText');
    const progressPercent = document.getElementById('playlistProgressPercent');
    const currentTrackInfo = document.getElementById('currentTrackInfo');

    if (progressBar) {
        progressBar.style.width = `${data.progress}%`;
    }

    if (progressText) {
        progressText.textContent = `${data.current}/${data.total} canciones`;
    }

    if (progressPercent) {
        progressPercent.textContent = `${data.progress}%`;
    }

    if (currentTrackInfo) {
        currentTrackInfo.innerHTML = `
            <div class="font-semibold">${data.trackName}</div>
            <div class="text-gray-500">${data.artist}</div>
        `;
    }
}

/**
 * Actualizar modal con éxito de playlist
 */
function updatePlaylistModalSuccess(result) {
    const modal = document.getElementById('downloadModal');
    const modalContent = modal.querySelector('.bg-white');

    modalContent.innerHTML = `
        <div class="p-6 text-center">
            <div class="text-green-500 text-6xl mb-4">
                <i class="fas fa-check-circle"></i>
            </div>
            <h3 class="text-xl font-semibold mb-2 text-gray-800">¡Playlist Descargada!</h3>
            <p class="text-gray-600 mb-4">
                ${result.downloaded} de ${result.totalTracks} canciones descargadas exitosamente
            </p>
            ${result.failed > 0 ? `
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                    <p class="text-yellow-800 text-sm">
                        <i class="fas fa-exclamation-triangle mr-1"></i>
                        ${result.failed} canciones no se pudieron descargar
                    </p>
                </div>
            ` : ''}
            <button
                onclick="closeDownloadModal()"
                class="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-lg transition-colors">
                <i class="fas fa-times mr-2"></i>
                Cerrar
            </button>
        </div>
    `;
}

/**
 * Actualizar modal con error de playlist
 */
function updatePlaylistModalError(error) {
    const modal = document.getElementById('downloadModal');
    const modalContent = modal.querySelector('.bg-white');

    modalContent.innerHTML = `
        <div class="p-6 text-center">
            <div class="text-red-500 text-6xl mb-4">
                <i class="fas fa-times-circle"></i>
            </div>
            <h3 class="text-xl font-semibold mb-2 text-gray-800">Error en la Descarga</h3>
            <p class="text-gray-600 mb-4">${error}</p>
            <button
                onclick="closeDownloadModal()"
                class="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg transition-colors">
                <i class="fas fa-times mr-2"></i>
                Cerrar
            </button>
        </div>
    `;
}

/**
 * Cerrar modal de descarga
 */
function closeDownloadModal() {
    const modal = document.getElementById('downloadModal');
    modal.classList.add('hidden');
}

/**
 * Obtener metadatos de una canción
 */
async function getTrackMetadata(videoId, title, channel) {
    try {
        // Extraer nombre de canción y artista del título
        const { trackName, artistName } = parseTrackInfo(title, channel);

        if (!trackName || !artistName) {
            showToast('No se pudo extraer información de la canción', 'warning');
            return;
        }

        const metadataBtn = document.getElementById(`metadata-btn-${videoId}`);
        const originalText = metadataBtn.innerHTML;

        // Mostrar estado de carga
        metadataBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Obteniendo...';
        metadataBtn.disabled = true;

        console.log(`Solicitando metadatos para: ${artistName} - ${trackName}`);

        const result = await ipcRenderer.invoke('get-track-metadata', trackName, artistName);

        if (result.success) {
            displayTrackMetadata(videoId, result.metadata, trackName, artistName);
            showToast('✅ Metadatos obtenidos de Spotify', 'success');
        } else {
            showToast(`❌ No se encontraron metadatos: ${result.error}`, 'error');
        }

        // Restaurar botón
        metadataBtn.innerHTML = originalText;
        metadataBtn.disabled = false;

    } catch (error) {
        console.error('Error obteniendo metadatos:', error);
        showToast('Error obteniendo metadatos', 'error');

        // Restaurar botón
        const metadataBtn = document.getElementById(`metadata-btn-${videoId}`);
        metadataBtn.innerHTML = '<i class="fas fa-music mr-2"></i>Metadatos';
        metadataBtn.disabled = false;
    }
}

/**
 * Parsear información de track desde título y canal
 */
function parseTrackInfo(title, channel) {
    // Patrones comunes para extraer artista y canción
    const patterns = [
        /^(.+?)\s*[-–—]\s*(.+?)(?:\s*\(.*\))?(?:\s*\[.*\])?$/,  // "Artista - Canción"
        /^(.+?)\s*:\s*(.+?)(?:\s*\(.*\))?(?:\s*\[.*\])?$/,      // "Artista: Canción"
        /^(.+?)\s*by\s*(.+?)(?:\s*\(.*\))?(?:\s*\[.*\])?$/i,    // "Canción by Artista"
    ];

    for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match) {
            let [, part1, part2] = match;

            // Limpiar texto
            part1 = part1.trim().replace(/["""'']/g, '');
            part2 = part2.trim().replace(/["""'']/g, '');

            // Para "by" pattern, intercambiar
            if (pattern.source.includes('by')) {
                return { trackName: part1, artistName: part2 };
            } else {
                return { trackName: part2, artistName: part1 };
            }
        }
    }

    // Si no coincide con patrones, usar el canal como artista
    return {
        trackName: title.replace(/["""'']/g, '').trim(),
        artistName: channel.trim()
    };
}

/**
 * Mostrar metadatos de la canción
 */
function displayTrackMetadata(videoId, metadata, trackName, artistName) {
    // Buscar el card del video
    const card = document.getElementById(`metadata-btn-${videoId}`).closest('.result-card');

    // Verificar si ya existe un contenedor de metadatos
    let metadataContainer = card.querySelector('.metadata-container');

    if (!metadataContainer) {
        // Crear contenedor de metadatos
        metadataContainer = document.createElement('div');
        metadataContainer.className = 'metadata-container mt-4 p-4 bg-green-50 border border-green-200 rounded-lg';

        // Insertar después del contenido principal
        const mainContent = card.querySelector('.flex.items-center.space-x-4');
        mainContent.parentNode.insertBefore(metadataContainer, mainContent.nextSibling);
    }

    metadataContainer.innerHTML = `
        <div class="flex items-center mb-3">
            <i class="fab fa-spotify text-green-500 text-lg mr-2"></i>
            <h5 class="font-semibold text-green-700">Metadatos de Spotify</h5>
        </div>

        <div class="text-sm text-green-800 mb-3">
            <strong>${artistName}</strong> - <strong>${trackName}</strong>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            ${metadata.bpm ? `
                <div class="bg-white p-2 rounded border">
                    <div class="font-semibold text-gray-700">BPM</div>
                    <div class="text-lg font-bold text-green-600">${metadata.bpm}</div>
                </div>
            ` : ''}

            ${metadata.key ? `
                <div class="bg-white p-2 rounded border">
                    <div class="font-semibold text-gray-700">Tonalidad</div>
                    <div class="text-lg font-bold text-green-600">${metadata.key}</div>
                </div>
            ` : ''}

            ${metadata.energy !== null ? `
                <div class="bg-white p-2 rounded border">
                    <div class="font-semibold text-gray-700">Energía</div>
                    <div class="text-lg font-bold text-green-600">${metadata.energy}%</div>
                </div>
            ` : ''}

            ${metadata.danceability !== null ? `
                <div class="bg-white p-2 rounded border">
                    <div class="font-semibold text-gray-700">Bailabilidad</div>
                    <div class="text-lg font-bold text-green-600">${metadata.danceability}%</div>
                </div>
            ` : ''}

            ${metadata.valence !== null ? `
                <div class="bg-white p-2 rounded border">
                    <div class="font-semibold text-gray-700">Positividad</div>
                    <div class="text-lg font-bold text-green-600">${metadata.valence}%</div>
                </div>
            ` : ''}

            ${metadata.popularity !== null ? `
                <div class="bg-white p-2 rounded border">
                    <div class="font-semibold text-gray-700">Popularidad</div>
                    <div class="text-lg font-bold text-green-600">${metadata.popularity}%</div>
                </div>
            ` : ''}
        </div>

        ${metadata.spotify_url ? `
            <div class="mt-3 pt-3 border-t border-green-200">
                <a href="${metadata.spotify_url}" target="_blank"
                   class="inline-flex items-center text-green-600 hover:text-green-700 text-sm">
                    <i class="fab fa-spotify mr-1"></i>
                    Ver en Spotify
                    <i class="fas fa-external-link-alt ml-1 text-xs"></i>
                </a>
            </div>
        ` : ''}
    `;

    // Animar la aparición
    metadataContainer.style.opacity = '0';
    metadataContainer.style.transform = 'translateY(-10px)';

    setTimeout(() => {
        metadataContainer.style.transition = 'all 0.3s ease';
        metadataContainer.style.opacity = '1';
        metadataContainer.style.transform = 'translateY(0)';
    }, 100);
}

/**
 * Mostrar modal de configuración de Spotify
 */
function showSpotifyConfigModal() {
    spotifyConfigModal.classList.remove('hidden');
}

/**
 * Cerrar modal de configuración de Spotify
 */
function closeSpotifyConfigModal() {
    spotifyConfigModal.classList.add('hidden');
    // Limpiar campos
    document.getElementById('spotifyClientId').value = '';
    document.getElementById('spotifyClientSecret').value = '';
}

/**
 * Guardar credenciales de Spotify
 */
async function saveSpotifyCredentials() {
    const clientId = document.getElementById('spotifyClientId').value.trim();
    const clientSecret = document.getElementById('spotifyClientSecret').value.trim();

    if (!clientId || !clientSecret) {
        showToast('Por favor ingresa tanto el Client ID como el Client Secret', 'warning');
        return;
    }

    try {
        showToast('Configurando credenciales de Spotify...', 'info');

        const result = await ipcRenderer.invoke('set-spotify-credentials', clientId, clientSecret);

        if (result.success) {
            showToast('✅ Credenciales de Spotify configuradas correctamente', 'success');
            closeSpotifyConfigModal();

            // Cambiar el color del botón para indicar que está configurado
            spotifyConfigBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
            spotifyConfigBtn.classList.add('bg-green-500', 'hover:bg-green-600');
            spotifyConfigBtn.innerHTML = '<i class="fab fa-spotify mr-2"></i>Spotify Configurado ✓';
        } else {
            showToast(`❌ Error configurando Spotify: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error configurando Spotify:', error);
        showToast('Error inesperado configurando Spotify', 'error');
    }
}

/**
 * Funciones auxiliares globales para el HTML
 */
window.downloadAudio = downloadAudio;
window.downloadPlaylist = downloadPlaylist;
window.processManualPlaylist = processManualPlaylist;
window.saveSpotifyCredentials = saveSpotifyCredentials;
window.closeSpotifyConfigModal = closeSpotifyConfigModal;
window.closeDownloadModal = closeDownloadModal;
window.getTrackMetadata = getTrackMetadata;
window.removeToast = removeToast;