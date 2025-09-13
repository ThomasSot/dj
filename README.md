# 🎵 YouTube Music Downloader

Una aplicación de escritorio multiplataforma desarrollada con **Electron** que permite buscar y descargar música de YouTube en formato MP3 de manera rápida y sencilla.

## ✨ Características

- 🔍 **Búsqueda inteligente**: Busca canciones, artistas o álbumes en YouTube
- ⬇️ **Descarga de audio**: Convierte automáticamente videos a MP3 (192kbps)
- 📁 **Gestión de carpetas**: Selecciona tu carpeta de descarga preferida
- 📊 **Progreso en tiempo real**: Barra de progreso con información detallada
- 🎨 **Interfaz moderna**: Diseño responsivo con Tailwind CSS
- 🔔 **Notificaciones**: Sistema de alertas para informar el estado
- 🎯 **Fácil de usar**: Interfaz intuitiva y minimalista

## 🛠️ Tecnologías Utilizadas

- **Electron** - Framework para aplicaciones de escritorio
- **Node.js** - Runtime de JavaScript
- **YouTube Search API** - Búsqueda de videos
- **ytdl-core** - Descarga de videos de YouTube
- **FFmpeg** - Conversión de audio a MP3
- **Tailwind CSS** - Framework de CSS
- **Font Awesome** - Iconos

## 📋 Requisitos Previos

- **Node.js** v14 o superior
- **npm** v6 o superior
- Conexión a internet

## 🚀 Instalación

1. **Clona o descarga** este proyecto:
   ```bash
   git clone <url-del-repositorio>
   cd prueb-mp3
   ```

2. **Instala las dependencias**:
   ```bash
   npm install
   ```

3. **Ejecuta la aplicación**:
   ```bash
   npm start
   ```

## 🎮 Uso de la Aplicación

### Paso 1: Configurar Carpeta de Descarga
1. Haz clic en **"Seleccionar Carpeta"** en la parte superior
2. Elige la carpeta donde quieres guardar tus MP3
3. La carpeta seleccionada aparecerá en el header

### Paso 2: Buscar Música
1. Escribe el nombre de la canción, artista o álbum en el campo de búsqueda
2. Presiona **"Buscar"** o la tecla Enter
3. Espera a que aparezcan los resultados (máximo 5)

### Paso 3: Descargar
1. Haz clic en **"Descargar MP3"** en el resultado que desees
2. Observa el progreso en la ventana modal
3. El archivo se guardará con el formato: `Artista - Título.mp3`

## 📁 Estructura del Proyecto

```
prueb-mp3/
├── main.js          # Proceso principal de Electron
├── renderer.js      # Lógica del frontend
├── index.html       # Interfaz de usuario
├── styles.css       # Estilos personalizados
├── package.json     # Configuración y dependencias
└── README.md        # Este archivo
```

## 🔧 Scripts Disponibles

```bash
# Ejecutar la aplicación
npm start

# Ejecutar en modo desarrollo (con DevTools)
npm run dev
```

## 📦 Dependencias

### Principales
- `electron` - Framework de aplicaciones de escritorio
- `ytdl-core` - Descarga de videos de YouTube
- `youtube-search-api` - API de búsqueda de YouTube
- `ffmpeg-static` - FFmpeg empaquetado estáticamente

### CDN (Cargadas desde internet)
- `Tailwind CSS` - Framework de CSS
- `Font Awesome` - Biblioteca de iconos

## 🎛️ Configuración

### Calidad de Audio
La aplicación descarga audio en:
- **Bitrate**: 192 kbps
- **Formato**: MP3
- **Sample Rate**: 44.1 kHz

### Carpeta por Defecto
Si no seleccionas una carpeta, los archivos se guardan en:
- **Windows**: `%USERPROFILE%/Music`
- **macOS**: `~/Music`
- **Linux**: `~/Music`

## 🚨 Limitaciones y Consideraciones

- ⚖️ **Uso legal**: Solo para uso personal y educativo
- 🌐 **Conexión**: Requiere internet para buscar y descargar
- 📝 **Derechos de autor**: Respeta los derechos de autor del contenido
- 🎵 **Calidad**: La calidad depende del video original de YouTube

## 🐛 Solución de Problemas

### Error: "No se encontraron formatos de audio"
- **Causa**: El video no tiene audio disponible
- **Solución**: Intenta con otro resultado de búsqueda

### Error: "Error en la conversión"
- **Causa**: Problema con FFmpeg
- **Solución**: Reinicia la aplicación y vuelve a intentar

### Error: "El archivo ya existe"
- **Causa**: Ya descargaste esa canción
- **Solución**: Verifica tu carpeta de descargas o renombra el archivo existente

### La búsqueda no funciona
- **Causa**: Problemas de conexión o API
- **Solución**: Verifica tu conexión a internet

## 🔄 Actualizaciones Futuras

- [ ] Lista de reproducción personalizada
- [ ] Diferentes calidades de audio
- [ ] Descargas por lotes
- [ ] Integración con servicios de música
- [ ] Modo oscuro
- [ ] Historial de descargas

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## ⚠️ Aviso Legal

Esta aplicación es solo para **uso personal y educativo**. Los usuarios son responsables de cumplir con las leyes de derechos de autor de su país. No nos hacemos responsables del uso indebido de esta herramienta.

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📞 Soporte

Si encuentras algún problema o tienes sugerencias:

- 🐛 Reporta bugs en los Issues
- 💡 Propón mejoras
- 📧 Contacta al desarrollador

---

**¡Disfruta descargando tu música favorita! 🎶**