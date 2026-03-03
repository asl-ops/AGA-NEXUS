# AGA Nexus - Puesta en marcha por URL (oficina Windows)

Este manual deja AGA Nexus accesible por enlace web, sin instalar ni ejecutar terminal en cada PC.

## 1) Requisitos (solo en tu equipo administrador)

- Tener acceso al repositorio GitHub.
- Tener Node.js instalado.
- Tener permisos sobre Firebase del proyecto.

## 2) Preparar Firebase CLI (solo una vez)

```bash
cd "/Users/antoniosanchez/AaaMisaplicaciones/AGA Nexus"
npx firebase-tools login
```

## 3) Vincular el proyecto Firebase (solo una vez)

Si ya sabes el ID del proyecto Firebase:

```bash
cd "/Users/antoniosanchez/AaaMisaplicaciones/AGA Nexus"
npx firebase-tools use --add
```

Cuando lo pida:
- Selecciona el proyecto correcto.
- Pon alias `default`.

## 4) Desplegar solo la web (hosting)

```bash
cd "/Users/antoniosanchez/AaaMisaplicaciones/AGA Nexus"
npm run deploy:web
```

Al terminar, Firebase mostrará una URL similar a:
- `https://<tu-proyecto>.web.app`
- `https://<tu-proyecto>.firebaseapp.com`

Esa es la URL que usarán los equipos Windows.

## 5) Desplegar web + índices Firestore (cuando toque)

```bash
cd "/Users/antoniosanchez/AaaMisaplicaciones/AGA Nexus"
npm run deploy:firebase
```

## 6) Uso en los PCs de la oficina (Windows)

No necesitan Node ni Git.

Solo:
1. Abrir navegador (Chrome/Edge).
2. Entrar a la URL pública de AGA Nexus.
3. Guardar en favoritos o en acceso directo del escritorio.

## 7) Actualización diaria/semanal

Cada vez que quieras publicar cambios:

```bash
cd "/Users/antoniosanchez/AaaMisaplicaciones/AGA Nexus"
git pull
npm run deploy:web
```

## 8) Comprobación rápida de que quedó bien

```bash
cd "/Users/antoniosanchez/AaaMisaplicaciones/AGA Nexus"
npx firebase-tools hosting:sites:list
```

Y después prueba en navegador con recarga dura:
- macOS: `Cmd + Shift + R`
- Windows: `Ctrl + F5`

## 9) Recomendación para mañana (pruebas en oficina)

- Publica con `npm run deploy:web`.
- Pasa **una sola URL** a todos.
- Evitas problemas de scripts locales, puertos y terminales.
