# LuckyBall

Aplicación personal que reproduce un frasco de frases sin repeticiones dentro de una ronda.

## Arquitectura

- GitHub Pages sirve `index.html`.
- Google Apps Script recibe formularios POST y responde por `postMessage`.
- Google Sheets conserva frases, ronda actual e historial.

No hay dependencias, proceso de compilación ni credenciales en el frontend.

## Archivos

- `index.html`: interfaz aprobada y cliente del backend.
- `apps-script/Code.gs`: API y lógica transaccional protegida por `LockService`.
- `apps-script/appsscript.json`: manifiesto de Apps Script.

## Despliegue

1. Abre la hoja **LuckyBall Database**.
2. Ve a **Extensiones → Apps Script**.
3. Sustituye el contenido de `Code.gs` por `apps-script/Code.gs`.
4. En **Configuración del proyecto**, activa la visualización del archivo de manifiesto y sustituye `appsscript.json`.
5. Ejecuta `setup` una vez y autoriza el acceso a la hoja.
6. Ve a **Implementar → Nueva implementación → Aplicación web**.
7. Configura **Ejecutar como: Yo** y **Quién tiene acceso: Cualquier persona**.
8. Copia la URL terminada en `/exec`.
9. En `index.html`, sustituye `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` por esa URL y publica el cambio.
10. En GitHub abre **Settings → Pages**, selecciona **Deploy from a branch**, rama `main` y carpeta `/ (root)`.

La URL del endpoint no es una contraseña. Aun así, quien la conozca podría invocarlo. La API limita las respuestas al origen `https://aarondlth3.github.io`, pero no implementa autenticación.

## Actualizaciones

Después de cambiar `Code.gs`, crea una versión nueva en **Administrar implementaciones**. La URL `/exec` del despliegue puede mantenerse.
