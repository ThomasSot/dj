const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const youtubeSearch = require('youtube-search-api');
const axios = require('axios');
const cheerio = require('cheerio');

// Mantener referencia global de la ventana
let mainWindow;

/**
 * Crear la ventana principal de la aplicación
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'assets', 'icon.png'), // Opcional
        show: false
    });

    // Cargar el archivo HTML
    mainWindow.loadFile('index.html');

    // Mostrar ventana cuando esté lista
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Opcional: Abrir DevTools en desarrollo
    // mainWindow.webContents.openDevTools();
}

/**
 * Configuración de la aplicación
 */
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

/**
 * IPC Handlers - Comunicación entre frontend y backend
 */

// Buscar videos en YouTube
ipcMain.handle('search-youtube', async (event, query) => {
    try {
        let searchQuery = query;
        let isFromSpotify = false;

        // Verificar si el query es un link de Spotify
        if (isSpotifyUrl(query)) {
            console.log('Detectado link de Spotify:', query);

            const spotifyInfo = extractSpotifyId(query);
            if (spotifyInfo && spotifyInfo.type === 'track') {
                console.log('Extrayendo información del track:', spotifyInfo.id);

                const trackInfo = await getSpotifyTrackInfo(spotifyInfo.id);
                if (trackInfo.success) {
                    searchQuery = trackInfo.searchQuery;
                    isFromSpotify = true;
                    console.log('Buscando en YouTube:', searchQuery);
                } else {
                    console.error('Error obteniendo info de Spotify:', trackInfo.error);
                    // Continuar con el query original si falla la extracción
                }
            } else {
                console.log('Link de Spotify no es un track o no se pudo extraer ID');
                // Para álbumes o playlists, usar el query original
            }
        }

        const results = await youtubeSearch.GetListByKeyword(searchQuery, false, 10);
        return {
            success: true,
            isFromSpotify: isFromSpotify,
            originalQuery: query,
            searchQuery: searchQuery,
            videos: results.items.map(item => ({
                id: item.id,
                title: item.title,
                thumbnail: item.thumbnail?.thumbnails?.[0]?.url || '',
                channel: item.channelTitle,
                duration: item.length?.simpleText || 'N/A',
                url: `https://www.youtube.com/watch?v=${item.id}`
            }))
        };
    } catch (error) {
        console.error('Error buscando en YouTube:', error);
        return {
            success: false,
            error: error.message
        };
    }
});

// Seleccionar carpeta de descarga
ipcMain.handle('select-download-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Seleccionar carpeta de descarga'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Descargar y convertir video a MP3
ipcMain.handle('download-audio', async (event, videoData, downloadPath) => {
    return new Promise(async (resolve, reject) => {
        try {
            const videoUrl = videoData.url;
            const fileName = sanitizeFilename(`${videoData.channel} - ${videoData.title}.mp3`);
            const outputPath = path.join(downloadPath, fileName);

            // Verificar si el archivo ya existe
            if (fs.existsSync(outputPath)) {
                resolve({
                    success: false,
                    error: 'El archivo ya existe en la carpeta de destino'
                });
                return;
            }

            console.log('Obteniendo información del video:', videoUrl);

            // Obtener información del video con opciones mejoradas
            const info = await ytdl.getInfo(videoUrl, {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                }
            });

            // Filtrar formatos de audio
            const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
            
            if (audioFormats.length === 0) {
                // Si no hay formatos solo de audio, intentar con formatos que tengan audio
                const audioVideoFormats = ytdl.filterFormats(info.formats, 'audio');
                if (audioVideoFormats.length === 0) {
                    throw new Error('No se encontraron formatos de audio disponibles');
                }
                // Usar el primer formato disponible
                var selectedFormat = audioVideoFormats[0];
            } else {
                // Seleccionar el mejor formato de audio (ordenar por bitrate)
                audioFormats.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
                var selectedFormat = audioFormats[0];
            }

            console.log('Formato seleccionado:', selectedFormat.itag, selectedFormat.audioBitrate);

            // Crear el stream de descarga
            const stream = ytdl(videoUrl, { 
                format: selectedFormat,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                }
            });

            // Crear proceso FFmpeg para convertir a MP3
            const ffmpegProcess = spawn(ffmpeg, [
                '-i', 'pipe:0',
                '-acodec', 'libmp3lame',
                '-ab', '192k',
                '-ar', '44100',
                '-f', 'mp3',
                '-y', // Sobrescribir archivo si existe
                outputPath
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Variables para el progreso
            let downloadedBytes = 0;
            let totalBytes = parseInt(selectedFormat.contentLength) || 0;

            // Manejar progreso de descarga
            stream.on('progress', (chunkLength, downloaded, total) => {
                downloadedBytes = downloaded;
                totalBytes = total;
                const progress = totalBytes > 0 ? Math.min((downloaded / total) * 100, 99) : 0;
                
                event.sender.send('download-progress', {
                    videoId: videoData.id,
                    progress: Math.round(progress),
                    downloaded: formatBytes(downloaded),
                    total: formatBytes(total)
                });
            });

            // Pipe del stream de audio a FFmpeg
            stream.pipe(ffmpegProcess.stdin);

            // Manejar la finalización del proceso FFmpeg
            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    // Enviar progreso del 100%
                    event.sender.send('download-progress', {
                        videoId: videoData.id,
                        progress: 100,
                        downloaded: formatBytes(totalBytes),
                        total: formatBytes(totalBytes)
                    });

                    resolve({
                        success: true,
                        filePath: outputPath,
                        fileName: fileName
                    });
                } else {
                    resolve({
                        success: false,
                        error: `Error en la conversión FFmpeg (código: ${code})`
                    });
                }
            });

            // Manejar errores de FFmpeg
            ffmpegProcess.on('error', (error) => {
                console.error('Error FFmpeg:', error);
                resolve({
                    success: false,
                    error: `Error en FFmpeg: ${error.message}`
                });
            });

            // Manejar errores del stream
            stream.on('error', (error) => {
                console.error('Error stream:', error);
                resolve({
                    success: false,
                    error: `Error en la descarga: ${error.message}`
                });
            });

            // Timeout de seguridad (10 minutos)
            const timeout = setTimeout(() => {
                stream.destroy();
                ffmpegProcess.kill();
                resolve({
                    success: false,
                    error: 'Timeout: La descarga tardó demasiado tiempo'
                });
            }, 600000); // 10 minutos

            // Limpiar timeout si todo sale bien
            ffmpegProcess.on('close', () => clearTimeout(timeout));
            stream.on('error', () => clearTimeout(timeout));

        } catch (error) {
            console.error('Error en download-audio:', error);
            resolve({
                success: false,
                error: `Error: ${error.message}`
            });
        }
    });
});

/**
 * Funciones auxiliares
 */

// Limpiar nombre de archivo de caracteres no válidos
function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200); // Limitar longitud
}

// Formatear bytes a formato legible
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Funciones para manejo de Spotify
 */

// Detectar si el input es un link de Spotify
function isSpotifyUrl(input) {
    const spotifyRegex = /^(https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist)\/[a-zA-Z0-9]+|spotify:(track|album|playlist):[a-zA-Z0-9]+)/;
    return spotifyRegex.test(input.trim());
}

// Extraer ID de Spotify desde URL
function extractSpotifyId(url) {
    // Para URLs web: https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=...
    // También maneja: https://open.spotify.com/intl-es/track/4iV5W9uYEdYUVa79Axb7Rh?si=...
    const webMatch = url.match(/https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist)\/([a-zA-Z0-9]+)/);
    if (webMatch) {
        return {
            type: webMatch[1],
            id: webMatch[2]
        };
    }

    // Para URIs: spotify:track:4iV5W9uYEdYUVa79Axb7Rh
    const uriMatch = url.match(/spotify:(track|album|playlist):([a-zA-Z0-9]+)/);
    if (uriMatch) {
        return {
            type: uriMatch[1],
            id: uriMatch[2]
        };
    }

    return null;
}

// Extraer metadatos de Spotify usando web scraping
async function getSpotifyTrackInfo(trackId) {
    try {
        const url = `https://open.spotify.com/track/${trackId}`;

        // Configurar headers para simular un navegador más reciente
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        };

        console.log('Obteniendo información de Spotify:', url);
        const response = await axios.get(url, { headers, timeout: 10000 });

        const $ = cheerio.load(response.data);

        // Intentar extraer información del título de la página
        const pageTitle = $('title').text();
        console.log('Título de página:', pageTitle);

        // El título puede tener varios formatos:
        // "Song Name - song by Artist Name | Spotify"
        // "Song Name - song and lyrics by Artist Name | Spotify"
        let trackName = '';
        let artistName = '';

        if (pageTitle.includes(' | Spotify')) {
            // Remover la parte de Spotify del final
            let cleanTitle = pageTitle.replace(' | Spotify', '').trim();

            // Buscar patrones comunes
            if (cleanTitle.includes(' - song by ')) {
                const parts = cleanTitle.split(' - song by ');
                if (parts.length >= 2) {
                    trackName = parts[0].trim();
                    artistName = parts[1].trim();
                }
            } else if (cleanTitle.includes(' - song and lyrics by ')) {
                const parts = cleanTitle.split(' - song and lyrics by ');
                if (parts.length >= 2) {
                    trackName = parts[0].trim();
                    artistName = parts[1].trim();
                }
            }
        }

        // Intentar extraer de meta tags como fallback
        if (!trackName || !artistName) {
            const ogTitle = $('meta[property="og:title"]').attr('content');
            const ogDescription = $('meta[property="og:description"]').attr('content');

            if (ogTitle) {
                // og:title suele ser "Song Name"
                trackName = ogTitle.trim();
            }

            if (ogDescription) {
                // og:description suele contener el artista
                const artistMatch = ogDescription.match(/by\s+(.+?)(?:\s+on\s+|$)/i);
                if (artistMatch) {
                    artistName = artistMatch[1].trim();
                }
            }
        }

        // Si aún no tenemos información, intentar con JSON-LD
        if (!trackName || !artistName) {
            const scripts = $('script[type="application/ld+json"]');
            scripts.each((i, script) => {
                try {
                    const data = JSON.parse($(script).html());
                    if (data['@type'] === 'MusicRecording') {
                        trackName = data.name || trackName;
                        if (data.byArtist && data.byArtist.name) {
                            artistName = data.byArtist.name;
                        }
                    }
                } catch (e) {
                    // Ignorar errores de parsing JSON
                }
            });
        }

        console.log('Información extraída:', { trackName, artistName });

        if (trackName && artistName) {
            return {
                success: true,
                trackName: trackName,
                artistName: artistName,
                searchQuery: `${artistName} - ${trackName}`
            };
        } else {
            throw new Error('No se pudo extraer información completa de la canción');
        }

    } catch (error) {
        console.error('Error extrayendo información de Spotify:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}
