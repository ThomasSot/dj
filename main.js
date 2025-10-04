const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ytdl = require('@distube/ytdl-core');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const youtubeSearch = require('youtube-search-api');
const axios = require('axios');
const cheerio = require('cheerio');
const SpotifyWebApi = require('spotify-web-api-node');
const mm = require('music-metadata');
const NodeID3 = require('node-id3');

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
app.whenReady().then(async () => {
    createWindow();

    // Inicializar credenciales de Spotify automáticamente
    await initializeSpotifyCredentials();
});

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

// Inicializar credenciales de Spotify al arrancar
async function initializeSpotifyCredentials() {
    if (spotifyCredentials.clientId && spotifyCredentials.clientSecret) {
        console.log('Inicializando credenciales de Spotify...');
        try {
            const token = await getSpotifyAccessToken(spotifyCredentials.clientId, spotifyCredentials.clientSecret);
            if (token) {
                spotifyCredentials.accessToken = token;
                console.log('✅ Credenciales de Spotify inicializadas correctamente');
            } else {
                console.log('❌ No se pudo obtener token de acceso de Spotify');
            }
        } catch (error) {
            console.error('Error inicializando Spotify:', error);
        }
    }
}

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
            } else if (spotifyInfo && spotifyInfo.type === 'playlist') {
                console.log('Detectada playlist de Spotify:', spotifyInfo.id);

                // Para playlists, retornar información especial
                const playlistInfo = await getSpotifyPlaylistInfo(spotifyInfo.id);
                if (playlistInfo.success) {
                    return {
                        success: true,
                        isPlaylist: true,
                        playlistName: playlistInfo.playlistName,
                        tracks: playlistInfo.tracks,
                        totalTracks: playlistInfo.totalTracks
                    };
                } else {
                    // Si falla la extracción automática, ofrecer modo manual
                    return {
                        success: true,
                        isPlaylist: true,
                        isManualMode: true,
                        playlistId: spotifyInfo.id,
                        playlistUrl: query,
                        error: playlistInfo.error
                    };
                }
            } else {
                console.log('Link de Spotify no es un track o playlist válido, o no se pudo extraer ID');
                // Para otros tipos, usar el query original
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

// Descargar playlist completa
ipcMain.handle('download-playlist', async (event, playlistData, downloadPath) => {
    try {
        const playlistName = sanitizeFilename(playlistData.playlistName);
        const playlistFolder = path.join(downloadPath, playlistName);

        // Crear carpeta de la playlist si no existe
        if (!fs.existsSync(playlistFolder)) {
            fs.mkdirSync(playlistFolder, { recursive: true });
        }

        console.log(`Iniciando descarga de playlist: ${playlistName} (${playlistData.tracks.length} canciones)`);

        const results = {
            success: true,
            playlistName: playlistName,
            totalTracks: playlistData.tracks.length,
            downloaded: 0,
            failed: 0,
            errors: []
        };

        // Descargar cada canción de la playlist
        for (let i = 0; i < playlistData.tracks.length; i++) {
            const track = playlistData.tracks[i];

            try {
                // Enviar progreso de la playlist
                event.sender.send('playlist-progress', {
                    current: i + 1,
                    total: playlistData.tracks.length,
                    trackName: track.name,
                    artist: track.artists,
                    progress: Math.round(((i + 1) / playlistData.tracks.length) * 100)
                });

                console.log(`Buscando canción ${i + 1}/${playlistData.tracks.length}: ${track.searchQuery}`);

                // Buscar la canción en YouTube
                const searchResults = await youtubeSearch.GetListByKeyword(track.searchQuery, false, 3);

                if (searchResults.items && searchResults.items.length > 0) {
                    const bestMatch = searchResults.items[0]; // Tomar el primer resultado

                    const videoData = {
                        id: bestMatch.id,
                        title: bestMatch.title,
                        channel: bestMatch.channelTitle || 'Unknown',
                        url: `https://www.youtube.com/watch?v=${bestMatch.id}`
                    };

                    // Descargar la canción con información de metadatos
                    const downloadResult = await downloadSingleTrack(videoData, playlistFolder, event, `playlist-${i}`, track);

                    if (downloadResult.success) {
                        results.downloaded++;
                        console.log(`✓ Descargada: ${track.name} - ${track.artists}`);
                    } else {
                        results.failed++;
                        results.errors.push(`${track.name} - ${track.artists}: ${downloadResult.error}`);
                        console.log(`✗ Error descargando: ${track.name} - ${track.artists}: ${downloadResult.error}`);
                    }
                } else {
                    results.failed++;
                    results.errors.push(`${track.name} - ${track.artists}: No se encontró en YouTube`);
                    console.log(`✗ No encontrada en YouTube: ${track.name} - ${track.artists}`);
                }

                // Pequeña pausa entre descargas para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (trackError) {
                results.failed++;
                results.errors.push(`${track.name} - ${track.artists}: ${trackError.message}`);
                console.error(`Error procesando canción ${track.name}:`, trackError);
            }
        }

        console.log(`Descarga de playlist completada: ${results.downloaded} exitosas, ${results.failed} fallidas`);

        return results;

    } catch (error) {
        console.error('Error descargando playlist:', error);
        return {
            success: false,
            error: error.message
        };
    }
});

// Descargar y convertir video a MP3
ipcMain.handle('download-audio', async (event, videoData, downloadPath) => {
    return await downloadSingleTrack(videoData, downloadPath, event, videoData.id);
});

// Obtener metadatos de una canción
ipcMain.handle('get-track-metadata', async (event, trackName, artistName) => {
    try {
        console.log(`🎵 Solicitando metadatos para: ${artistName} - ${trackName}`);
        const metadata = await getSpotifyTrackMetadata(trackName, artistName);

        if (metadata) {
            console.log(`✅ Metadatos obtenidos:`, {
                bpm: metadata.bpm,
                key: metadata.key,
                energy: metadata.energy,
                danceability: metadata.danceability
            });
            return { success: true, metadata };
        } else {
            console.log(`⚠️ No se encontraron metadatos para: ${artistName} - ${trackName}`);
            return { success: false, error: 'No se encontraron metadatos' };
        }
    } catch (error) {
        console.error('Error obteniendo metadatos:', error);
        return { success: false, error: error.message };
    }
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
 * Función de respaldo usando yt-dlp-wrap cuando ytdl-core falla
 */
async function downloadWithYtDlp(videoUrl, outputPath, event, progressId) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log('🔄 Intentando descarga con yt-dlp como respaldo...');

            // Detectar la ruta de yt-dlp automáticamente
            let ytDlpPath = 'yt-dlp'; // Por defecto, usar PATH

            // Intentar rutas comunes
            const commonPaths = [
                '/opt/homebrew/bin/yt-dlp',  // Homebrew en macOS ARM
                '/usr/local/bin/yt-dlp',     // Homebrew en macOS Intel
                '/usr/bin/yt-dlp',           // Linux
                'yt-dlp'                     // PATH
            ];

            for (const testPath of commonPaths) {
                try {
                    if (fs.existsSync(testPath) || testPath === 'yt-dlp') {
                        ytDlpPath = testPath;
                        break;
                    }
                } catch (e) {
                    // Continuar con la siguiente ruta
                }
            }

            console.log('Usando yt-dlp desde:', ytDlpPath);

            // Crear instancia de yt-dlp
            const ytDlp = new YTDlpWrap(ytDlpPath);

            // Configurar opciones para yt-dlp
            const options = [
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '192K',
                '--output', outputPath.replace('.mp3', '.%(ext)s'),
                '--no-playlist',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--referer', 'https://www.youtube.com/',
                videoUrl
            ];

            console.log('Ejecutando yt-dlp con opciones:', options.join(' '));

            // Ejecutar yt-dlp
            const ytDlpProcess = ytDlp.exec(options);

            let hasError = false;

            // Manejar salida del proceso
            ytDlpProcess.stdout?.on('data', (data) => {
                const output = data.toString();
                console.log('yt-dlp stdout:', output);

                // Intentar extraer progreso si es posible
                if (event && output.includes('%')) {
                    const progressMatch = output.match(/(\d+(?:\.\d+)?)%/);
                    if (progressMatch) {
                        const progress = parseFloat(progressMatch[1]);
                        event.sender.send('download-progress', {
                            videoId: progressId,
                            progress: Math.round(progress),
                            downloaded: 'Descargando...',
                            total: 'Desconocido'
                        });
                    }
                }
            });

            ytDlpProcess.stderr?.on('data', (data) => {
                const error = data.toString();
                console.log('yt-dlp stderr:', error);

                // No marcar como error si es solo información
                if (!error.toLowerCase().includes('error') && !error.toLowerCase().includes('failed')) {
                    return;
                }

                hasError = true;
            });

            ytDlpProcess.on('close', (code) => {
                if (code === 0 && !hasError) {
                    console.log('✅ Descarga completada con yt-dlp');
                    resolve({
                        success: true,
                        fileName: path.basename(outputPath),
                        filePath: outputPath
                    });
                } else {
                    console.error('❌ yt-dlp terminó con código:', code);
                    resolve({
                        success: false,
                        error: `yt-dlp falló con código ${code}`
                    });
                }
            });

            ytDlpProcess.on('error', (error) => {
                console.error('Error ejecutando yt-dlp:', error);
                resolve({
                    success: false,
                    error: `Error ejecutando yt-dlp: ${error.message}`
                });
            });

        } catch (error) {
            console.error('Error en downloadWithYtDlp:', error);
            resolve({
                success: false,
                error: error.message
            });
        }
    });
}

/**
 * Función auxiliar para descargar una sola canción (usada por playlist y descarga individual)
 */
async function downloadSingleTrack(videoData, downloadPath, event, progressId, trackInfo = null) {
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

            console.log('Descargando:', videoUrl);
            console.log('Guardando en:', outputPath);

            // Configurar opciones mejoradas para ytdl-core
            const ytdlOptions = {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache',
                        'Referer': 'https://www.youtube.com/'
                    }
                }
            };

            let info, audioFormats, selectedFormat, stream;

            try {
                // Obtener información del video con opciones mejoradas
                info = await ytdl.getInfo(videoUrl, ytdlOptions);

                // Filtrar formatos de audio
                audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

                if (audioFormats.length === 0) {
                    throw new Error('No se encontraron formatos de audio disponibles');
                }

                // Seleccionar el mejor formato de audio
                selectedFormat = audioFormats.reduce((best, format) => {
                    const currentBitrate = parseInt(format.audioBitrate) || 0;
                    const bestBitrate = parseInt(best.audioBitrate) || 0;
                    return currentBitrate > bestBitrate ? format : best;
                });

                console.log('Formato seleccionado:', selectedFormat.itag, selectedFormat.audioBitrate);

                // Crear el stream de descarga con opciones mejoradas
                stream = ytdl(videoUrl, {
                    format: selectedFormat,
                    requestOptions: ytdlOptions.requestOptions
                });

            } catch (ytdlError) {
                console.error('Error con ytdl-core al obtener info:', ytdlError.message);
                console.log('🔄 Intentando con yt-dlp como respaldo...');

                try {
                    const ytDlpResult = await downloadWithYtDlp(videoUrl, outputPath, event, progressId);

                    if (ytDlpResult.success) {
                        console.log('✅ Descarga exitosa con yt-dlp');

                        // Obtener y escribir metadatos si tenemos información del track
                        if (trackInfo && trackInfo.name && trackInfo.artists) {
                            console.log(`🎵 Obteniendo metadatos para: ${trackInfo.artists} - ${trackInfo.name}`);

                            try {
                                const metadata = await getSpotifyTrackMetadata(trackInfo.name, trackInfo.artists);
                                if (metadata) {
                                    await writeID3Metadata(outputPath, metadata, trackInfo);
                                    console.log(`✅ Metadatos agregados a: ${fileName}`);
                                } else {
                                    console.log(`⚠️ No se pudieron obtener metadatos para: ${trackInfo.artists} - ${trackInfo.name}`);
                                }
                            } catch (metadataError) {
                                console.error('Error procesando metadatos:', metadataError);
                            }
                        }

                        resolve(ytDlpResult);
                        return;
                    } else {
                        resolve({
                            success: false,
                            error: `Error con ytdl-core y yt-dlp: ${ytdlError.message} | ${ytDlpResult.error}`
                        });
                        return;
                    }
                } catch (ytDlpError) {
                    console.error('Error con yt-dlp:', ytDlpError);
                    resolve({
                        success: false,
                        error: `Error obteniendo información del video: ${ytdlError.message}`
                    });
                    return;
                }
            }

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

            // Manejar progreso de descarga (solo si se proporciona event)
            if (event) {
                stream.on('progress', (chunkLength, downloaded, total) => {
                    downloadedBytes = downloaded;
                    totalBytes = total;
                    const progress = totalBytes > 0 ? Math.min((downloaded / total) * 100, 99) : 0;

                    event.sender.send('download-progress', {
                        videoId: progressId || videoData.id,
                        progress: Math.round(progress),
                        downloaded: formatBytes(downloaded),
                        total: formatBytes(total)
                    });
                });
            }

            // Manejar errores del stream
            stream.on('error', async (error) => {
                console.error('Error en stream de descarga:', error);
                ffmpegProcess.kill();

                // Intentar con yt-dlp como respaldo
                console.log('🔄 ytdl-core falló, intentando con yt-dlp...');
                try {
                    const ytDlpResult = await downloadWithYtDlp(videoUrl, outputPath, event, progressId);

                    if (ytDlpResult.success) {
                        console.log('✅ Descarga exitosa con yt-dlp');

                        // Obtener y escribir metadatos si tenemos información del track
                        if (trackInfo && trackInfo.name && trackInfo.artists) {
                            console.log(`🎵 Obteniendo metadatos para: ${trackInfo.artists} - ${trackInfo.name}`);

                            try {
                                const metadata = await getSpotifyTrackMetadata(trackInfo.name, trackInfo.artists);
                                if (metadata) {
                                    await writeID3Metadata(outputPath, metadata, trackInfo);
                                    console.log(`✅ Metadatos agregados a: ${fileName}`);
                                } else {
                                    console.log(`⚠️ No se pudieron obtener metadatos para: ${trackInfo.artists} - ${trackInfo.name}`);
                                }
                            } catch (metadataError) {
                                console.error('Error procesando metadatos:', metadataError);
                            }
                        }

                        resolve(ytDlpResult);
                    } else {
                        resolve({
                            success: false,
                            error: `Error con ytdl-core y yt-dlp: ${error.message} | ${ytDlpResult.error}`
                        });
                    }
                } catch (ytDlpError) {
                    console.error('Error con yt-dlp:', ytDlpError);
                    resolve({
                        success: false,
                        error: `Error descargando video: ${error.message}`
                    });
                }
            });

            // Manejar errores de FFmpeg
            ffmpegProcess.on('error', (error) => {
                console.error('Error en FFmpeg:', error);
                resolve({
                    success: false,
                    error: `Error en conversión: ${error.message}`
                });
            });

            // Manejar finalización exitosa
            ffmpegProcess.on('close', async (code) => {
                if (code === 0) {
                    console.log('Descarga completada exitosamente:', fileName);

                    // Obtener y escribir metadatos si tenemos información del track
                    if (trackInfo && trackInfo.name && trackInfo.artists) {
                        console.log(`🎵 Obteniendo metadatos para: ${trackInfo.artists} - ${trackInfo.name}`);

                        try {
                            const metadata = await getSpotifyTrackMetadata(trackInfo.name, trackInfo.artists);
                            if (metadata) {
                                await writeID3Metadata(outputPath, metadata, trackInfo);
                                console.log(`✅ Metadatos agregados a: ${fileName}`);
                            } else {
                                console.log(`⚠️ No se pudieron obtener metadatos para: ${trackInfo.artists} - ${trackInfo.name}`);
                            }
                        } catch (metadataError) {
                            console.error('Error procesando metadatos:', metadataError);
                        }
                    }

                    resolve({
                        success: true,
                        fileName: fileName,
                        filePath: outputPath
                    });
                } else {
                    console.error('FFmpeg terminó con código:', code);
                    resolve({
                        success: false,
                        error: `Error en conversión (código ${code})`
                    });
                }
            });

            // Conectar el stream al proceso FFmpeg
            stream.pipe(ffmpegProcess.stdin);

        } catch (error) {
            console.error('Error en downloadSingleTrack:', error);
            resolve({
                success: false,
                error: error.message
            });
        }
    });
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

// Configuración de la API de Spotify
let spotifyApi = null;
let spotifyCredentials = {
    clientId: 'a8d66560dbeb4985899ed9ba448116d6',
    clientSecret: '4acd81d1dbba44408695c698156812e8',
    accessToken: "BQAQmaH1wmd3WyQbAaexNw7E7uCvZ2CGpgKixFks81F9tzFzADnsrG8wmaQbwJMF27sM-L6sx6gI8oyaUkLqMky9N_xGcrwFJL_mtqZzPyIi-TuszSYuhWy6Ja8XBO2iNIFMXe2JhV2axWrkg_ksioKq-F5yEyTw-sVk4cXQo8WMzayIKjAOvYJs9mccTorKYAqtnHCIbhnkFPOFrIfAJ3zyuHSjM8DcrSlzVaJKAH9C-H8U0AvgpUJKRXhFYTohUx95G6v2iZXf9YaP2RQxYLx2tXouxITVWVxwrkJPt-c"
};

// Handler para configurar credenciales de Spotify
ipcMain.handle('set-spotify-credentials', async (event, clientId, clientSecret) => {
    try {
        spotifyCredentials.clientId = clientId;
        spotifyCredentials.clientSecret = clientSecret;

        // Obtener token de acceso
        const token = await getSpotifyAccessToken(clientId, clientSecret);
        if (token) {
            spotifyCredentials.accessToken = token;
            console.log('Credenciales de Spotify configuradas correctamente');
            return { success: true };
        } else {
            return { success: false, error: 'No se pudo obtener token de acceso' };
        }
    } catch (error) {
        console.error('Error configurando credenciales de Spotify:', error);
        return { success: false, error: error.message };
    }
});

// Obtener token de acceso de Spotify
async function getSpotifyAccessToken(clientId, clientSecret) {
    try {
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        const response = await axios.post('https://accounts.spotify.com/api/token',
            'grant_type=client_credentials',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                }
            }
        );

        return response.data.access_token;
    } catch (error) {
        console.error('Error obteniendo token de Spotify:', error);
        return null;
    }
}

// Obtener información de playlist usando la API oficial de Spotify
async function getSpotifyPlaylistWithAPI(playlistId) {
    if (!spotifyCredentials.accessToken) {
        throw new Error('No hay credenciales de Spotify configuradas');
    }

    try {
        // Obtener información básica de la playlist
        const playlistResponse = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}`, {
            headers: {
                'Authorization': `Bearer ${spotifyCredentials.accessToken}`
            }
        });

        const playlist = playlistResponse.data;
        const tracks = [];

        // Obtener todas las canciones (manejar paginación)
        let tracksUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;

        while (tracksUrl) {
            const tracksResponse = await axios.get(tracksUrl, {
                headers: {
                    'Authorization': `Bearer ${spotifyCredentials.accessToken}`
                }
            });

            const tracksData = tracksResponse.data;

            for (const item of tracksData.items) {
                if (item.track && item.track.name && item.track.artists) {
                    const trackName = item.track.name;
                    const artistNames = item.track.artists.map(artist => artist.name).join(', ');

                    tracks.push({
                        name: trackName,
                        artists: artistNames,
                        searchQuery: `${artistNames} ${trackName}`
                    });
                }
            }

            tracksUrl = tracksData.next; // URL para la siguiente página
        }

        return {
            success: true,
            playlistName: playlist.name,
            tracks: tracks,
            totalTracks: tracks.length
        };

    } catch (error) {
        console.error('Error obteniendo playlist con API:', error);
        throw error;
    }
}

// Extraer información de playlist de Spotify
async function getSpotifyPlaylistInfo(playlistId) {
    try {
        console.log('Obteniendo información de playlist de Spotify:', playlistId);

        // Método 1: Intentar usar la API oficial si tenemos credenciales
        if (spotifyCredentials.accessToken) {
            console.log('Intentando con API oficial de Spotify...');
            try {
                const apiResult = await getSpotifyPlaylistWithAPI(playlistId);
                if (apiResult.success) {
                    console.log('✅ Playlist obtenida exitosamente con API oficial');
                    return apiResult;
                }
            } catch (apiError) {
                console.log('Error con API oficial, continuando con scraping:', apiError.message);
            }
        } else {
            console.log('No hay credenciales de Spotify, usando método de scraping');
        }

        // Método 2: Scraping como fallback
        let playlistName = `Playlist_${playlistId}`;
        let tracks = [];

        try {
            // Método alternativo: usar el endpoint embed de Spotify
            const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
            console.log('Obteniendo datos desde embed:', embedUrl);

            const response = await axios.get(embedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });

            const html = response.data;

            // Extraer nombre de la playlist
            const titleMatch = html.match(/<title>([^<]+)<\/title>/);
            if (titleMatch) {
                playlistName = titleMatch[1].replace(' | Spotify', '').trim();
            }

            console.log('Nombre de playlist extraído:', playlistName);

            // Buscar datos JSON embebidos en el HTML
            const jsonMatches = html.match(/window\.__SPOTIFY_INITIAL_STATE__\s*=\s*({.+?});/);
            if (jsonMatches) {
                try {
                    const data = JSON.parse(jsonMatches[1]);
                    tracks = extractTracksFromSpotifyData(data);
                    console.log(`Extraídas ${tracks.length} canciones desde datos embebidos`);
                } catch (parseError) {
                    console.log('Error parseando datos embebidos:', parseError.message);
                }
            }

            // Si no encontramos datos embebidos, buscar patrones en el HTML
            if (tracks.length === 0) {
                console.log('Buscando patrones de tracks en HTML...');
                tracks = extractTracksFromHTML(html);
                console.log(`Extraídas ${tracks.length} canciones desde HTML`);
            }

        } catch (embedError) {
            console.log('Error con método embed:', embedError.message);
        }

        // Si aún no tenemos tracks, usar método de scraping mejorado
        if (tracks.length === 0) {
            console.log('Intentando método de scraping directo...');
            const directUrl = `https://open.spotify.com/playlist/${playlistId}`;

            try {
                const response = await axios.get(directUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1'
                    },
                    timeout: 15000
                });

                tracks = extractTracksFromHTML(response.data);
                console.log(`Extraídas ${tracks.length} canciones desde scraping directo`);

                // También intentar extraer el nombre si no lo tenemos
                if (playlistName === `Playlist_${playlistId}`) {
                    const $ = cheerio.load(response.data);
                    const pageTitle = $('title').text();
                    if (pageTitle && pageTitle.includes(' | Spotify')) {
                        playlistName = pageTitle.replace(' | Spotify', '').trim();
                    }
                }

            } catch (directError) {
                console.log('Error con scraping directo:', directError.message);
            }
        }

        if (tracks.length === 0) {
            throw new Error('No se pudieron extraer las canciones de la playlist. La playlist podría ser privada, estar vacía, o requerir autenticación.');
        }

        console.log(`Playlist extraída exitosamente: "${playlistName}" con ${tracks.length} canciones`);

        // Mostrar algunas canciones de ejemplo
        console.log('Primeras canciones encontradas:');
        tracks.slice(0, Math.min(5, tracks.length)).forEach((track, i) => {
            console.log(`  ${i + 1}. ${track.artists} - ${track.name}`);
        });

        return {
            success: true,
            playlistName: playlistName,
            tracks: tracks,
            totalTracks: tracks.length
        };

    } catch (error) {
        console.error('Error extrayendo información de playlist de Spotify:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}



// Extraer tracks desde datos estructurados de Spotify
function extractTracksFromSpotifyData(data) {
    const tracks = [];

    try {
        // Buscar en diferentes ubicaciones posibles de los datos
        const searchPaths = [
            'entities.items',
            'data.playlistV2.content.items',
            'data.playlist.tracks.items',
            'initialState.entities.items'
        ];

        for (const path of searchPaths) {
            const items = getNestedProperty(data, path);
            if (items) {
                console.log(`Encontrados datos en: ${path}`);

                if (Array.isArray(items)) {
                    for (const item of items) {
                        const track = extractTrackFromSpotifyItem(item);
                        if (track) tracks.push(track);
                    }
                } else if (typeof items === 'object') {
                    for (const [key, item] of Object.entries(items)) {
                        const track = extractTrackFromSpotifyItem(item);
                        if (track) tracks.push(track);
                    }
                }

                if (tracks.length > 0) break;
            }
        }
    } catch (error) {
        console.log('Error extrayendo tracks de datos estructurados:', error.message);
    }

    return tracks;
}

// Extraer track individual desde item de Spotify
function extractTrackFromSpotifyItem(item) {
    try {
        let track = null;
        let trackName = '';
        let artistName = '';

        // Buscar en diferentes estructuras posibles
        if (item.track) {
            track = item.track;
        } else if (item.data && item.data.track) {
            track = item.data.track;
        } else if (item.name && item.artists) {
            track = item;
        }

        if (track) {
            trackName = track.name || '';

            if (track.artists && Array.isArray(track.artists)) {
                artistName = track.artists.map(artist => artist.name).join(', ');
            } else if (track.artist && track.artist.name) {
                artistName = track.artist.name;
            }

            if (trackName && artistName && isValidTrackInfo(trackName, artistName)) {
                return {
                    name: trackName,
                    artists: artistName,
                    searchQuery: `${artistName} ${trackName}`
                };
            }
        }
    } catch (error) {
        // Ignorar errores individuales
    }

    return null;
}

// Extraer tracks desde HTML usando patrones
function extractTracksFromHTML(html) {
    const tracks = [];
    const foundTracks = new Map();

    // Patrones mejorados para extraer información de tracks
    const patterns = [
        // Patrón principal para datos JSON
        /"name":"([^"]{2,100})"[^}]*?"artists":\[{"name":"([^"]{2,100})"/g,
        // Patrón con estructura de track
        /"track":{"name":"([^"]{2,100})"[^}]*?"artists":\[{"name":"([^"]{2,100})"/g,
        // Patrón simplificado
        /{"name":"([^"]{2,100})","artists":\[{"name":"([^"]{2,100})"/g,
        // Patrón para metadatos alternativos
        /"trackName":"([^"]{2,100})"[^}]*?"artistName":"([^"]{2,100})"/g,
        // Patrón para datos embebidos
        /"title":"([^"]{2,100})"[^}]*?"subtitle":"([^"]{2,100})"/g
    ];

    for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        let match;
        let patternMatches = 0;

        while ((match = pattern.exec(html)) !== null && patternMatches < 200) {
            let trackName = match[1];
            let artistName = match[2];

            // Para el patrón title/subtitle, podría necesitar intercambio
            if (i === 4 && artistName.length > trackName.length) {
                [trackName, artistName] = [artistName, trackName];
            }

            // Limpiar y validar
            trackName = trackName.trim();
            artistName = artistName.trim();

            if (isValidTrackInfo(trackName, artistName)) {
                const trackKey = `${trackName.toLowerCase()}|||${artistName.toLowerCase()}`;

                if (!foundTracks.has(trackKey)) {
                    foundTracks.set(trackKey, {
                        name: trackName,
                        artists: artistName,
                        searchQuery: `${artistName} ${trackName}`
                    });
                    patternMatches++;
                }
            }
        }

        if (foundTracks.size > 0) {
            console.log(`Patrón ${i + 1} encontró ${foundTracks.size} canciones únicas`);
            break;
        }
    }

    return Array.from(foundTracks.values());
}

/**
 * Funciones para obtener metadatos musicales
 */

// Obtener metadatos de Spotify para una canción
async function getSpotifyTrackMetadata(trackName, artistName) {
    if (!spotifyCredentials.accessToken) {
        return null;
    }

    try {
        // Buscar la canción en Spotify
        const searchQuery = `track:"${trackName}" artist:"${artistName}"`;
        const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=1`;

        const response = await axios.get(searchUrl, {
            headers: {
                'Authorization': `Bearer ${spotifyCredentials.accessToken}`
            }
        });

        const tracks = response.data.tracks.items;
        if (tracks.length === 0) {
            return null;
        }

        const track = tracks[0];

        // Obtener características de audio (BPM, key, etc.)
        const audioFeaturesUrl = `https://api.spotify.com/v1/audio-features/${track.id}`;
        const audioAnalysisUrl = `https://api.spotify.com/v1/audio-analysis/${track.id}`;

        const [featuresResponse, analysisResponse] = await Promise.allSettled([
            axios.get(audioFeaturesUrl, {
                headers: { 'Authorization': `Bearer ${spotifyCredentials.accessToken}` }
            }),
            axios.get(audioAnalysisUrl, {
                headers: { 'Authorization': `Bearer ${spotifyCredentials.accessToken}` }
            })
        ]);

        const features = featuresResponse.status === 'fulfilled' ? featuresResponse.value.data : null;
        const analysis = analysisResponse.status === 'fulfilled' ? analysisResponse.value.data : null;

        // Mapear key number a nota musical
        const keyMap = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const modeMap = ['minor', 'major'];

        const metadata = {
            source: 'spotify',
            bpm: features ? Math.round(features.tempo) : null,
            key: features && features.key !== -1 ? `${keyMap[features.key]} ${modeMap[features.mode]}` : null,
            energy: features ? Math.round(features.energy * 100) : null,
            danceability: features ? Math.round(features.danceability * 100) : null,
            valence: features ? Math.round(features.valence * 100) : null, // Positividad
            acousticness: features ? Math.round(features.acousticness * 100) : null,
            instrumentalness: features ? Math.round(features.instrumentalness * 100) : null,
            liveness: features ? Math.round(features.liveness * 100) : null,
            speechiness: features ? Math.round(features.speechiness * 100) : null,
            loudness: features ? Math.round(features.loudness) : null,
            duration: track.duration_ms,
            popularity: track.popularity,
            explicit: track.explicit,
            preview_url: track.preview_url,
            spotify_id: track.id,
            spotify_url: track.external_urls.spotify,
            album: track.album.name,
            release_date: track.album.release_date,
            genres: track.artists[0].genres || [],
            // Datos adicionales del análisis
            time_signature: features ? features.time_signature : null,
            sections: analysis && analysis.sections ? analysis.sections.length : null,
            bars: analysis && analysis.bars ? analysis.bars.length : null,
            beats: analysis && analysis.beats ? analysis.beats.length : null,
            tatums: analysis && analysis.tatums ? analysis.tatums.length : null
        };

        console.log(`Metadatos de Spotify obtenidos para "${artistName} - ${trackName}":`, {
            bpm: metadata.bpm,
            key: metadata.key,
            energy: metadata.energy,
            danceability: metadata.danceability
        });

        return metadata;

    } catch (error) {
        console.error('Error obteniendo metadatos de Spotify:', error.message);
        return null;
    }
}

// Función para validar información de track
function isValidTrackInfo(trackName, artistName) {
    // Verificar longitudes básicas
    if (!trackName || !artistName ||
        trackName.length < 2 || trackName.length > 100 ||
        artistName.length < 2 || artistName.length > 100) {
        return false;
    }

    // Filtrar contenido que no parece ser música
    const invalidPatterns = [
        /^https?:\/\//i,  // URLs
        /\\[nt]/,         // Caracteres de escape
        /[<>{}]/,         // Caracteres HTML/JSON
        /^\d+$/,          // Solo números
        /^[^a-zA-Z]*$/,   // Sin letras
        /playlist|album|artist|spotify/i  // Metadatos de Spotify
    ];

    for (const pattern of invalidPatterns) {
        if (pattern.test(trackName) || pattern.test(artistName)) {
            return false;
        }
    }

    return true;
}

// Escribir metadatos ID3 al archivo MP3
async function writeID3Metadata(filePath, metadata, trackInfo) {
    try {
        const tags = {
            title: trackInfo.name,
            artist: trackInfo.artists,
            album: metadata.album || 'Unknown Album',
            year: metadata.release_date ? metadata.release_date.substring(0, 4) : null,
            genre: metadata.genres && metadata.genres.length > 0 ? metadata.genres[0] : 'Electronic',
            comment: {
                language: 'eng',
                text: `Downloaded from YouTube | BPM: ${metadata.bpm || 'Unknown'} | Key: ${metadata.key || 'Unknown'}`
            },
            // Campos personalizados para DJ software
            TBPM: metadata.bpm ? metadata.bpm.toString() : null, // BPM
            TKEY: metadata.key || null, // Key
            // Campos adicionales que algunos DJ software reconocen
            userDefinedText: [
                {
                    description: 'ENERGY',
                    value: metadata.energy ? metadata.energy.toString() : null
                },
                {
                    description: 'DANCEABILITY',
                    value: metadata.danceability ? metadata.danceability.toString() : null
                },
                {
                    description: 'VALENCE',
                    value: metadata.valence ? metadata.valence.toString() : null
                },
                {
                    description: 'SPOTIFY_ID',
                    value: metadata.spotify_id || null
                },
                {
                    description: 'SPOTIFY_URL',
                    value: metadata.spotify_url || null
                }
            ].filter(field => field.value !== null)
        };

        // Remover campos null
        Object.keys(tags).forEach(key => {
            if (tags[key] === null) {
                delete tags[key];
            }
        });

        const success = NodeID3.write(tags, filePath);

        if (success) {
            console.log(`✅ Metadatos ID3 escritos para: ${trackInfo.artists} - ${trackInfo.name}`);
            return true;
        } else {
            console.log(`❌ Error escribiendo metadatos ID3 para: ${trackInfo.artists} - ${trackInfo.name}`);
            return false;
        }

    } catch (error) {
        console.error('Error escribiendo metadatos ID3:', error);
        return false;
    }
}

// Función auxiliar para obtener propiedades anidadas
function getNestedProperty(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : null;
    }, obj);
}


