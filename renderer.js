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
const currentFolderSpan = document.getElementById('currentFolder');
const loadingSpinner = document.getElementById('loadingSpinner');
const resultsContainer = document.getElementById('resultsContainer');
const resultsList = document.getElementById('resultsList');
const downloadModal = document.getElementById('downloadModal');
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

    // Listener para progreso de descarga
    ipcRenderer.on('download-progress', (event, data) => {
        updateDownloadProgress(data);
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
            searchResults = result.videos;
            displayResults(searchResults);

            // Mostrar mensaje especial si se detectó un link de Spotify
            if (result.isFromSpotify) {
                showToast(`🎵 Link de Spotify detectado! Buscando: "${result.searchQuery}"`, 'success');
            } else {
                showToast(`Se encontraron ${searchResults.length} resultados`, 'success');
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
                <button 
                    onclick="downloadAudio('${video.id}')"
                    class="download-btn text-white px-6 py-3 rounded-lg ripple"
                    id="download-btn-${video.id}"
                >
                    <i class="fas fa-download mr-2"></i>
                    Descargar MP3
                </button>
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
 * Funciones auxiliares globales para el HTML
 */
window.downloadAudio = downloadAudio;
window.removeToast = removeToast;