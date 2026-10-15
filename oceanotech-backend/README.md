# Oceanotech — Backend de autenticación

Backend en Node.js + Express para el login de Oceanotech: registro, inicio de sesión,
tokens de acceso (JWT) y de refresco (cookie httpOnly), bloqueo de cuenta por intentos
fallidos, rate limiting, y un punto ya preparado para conectar reCAPTCHA cuando lo necesites.

## 1. Instalar

Requiere Node 18 o superior.

```bash
cd oceanotech-backend
npm install
cp .env.example .env
```

Abre `.env` y configura los valores, especialmente:
- `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET`: usa valores aleatorios distintos
  de al menos 32 caracteres (genera cada uno con
  `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)
- `CORS_ORIGIN` → origen exacto de la interfaz (protocolo + dominio + puerto),
  por ejemplo `http://localhost:5500`; en producción configura el dominio HTTPS.

## 2. Correr

```bash
npm start          # producción
npm run dev         # con recarga automática
```

El servidor queda en `http://localhost:4000`. La base de datos es un archivo SQLite
(`oceanotech.sqlite`) que se crea solo la primera vez que corres el servidor.

En producción el proceso escucha en `0.0.0.0` y en el puerto de `PORT` que asigne
el hosting. Configura `NODE_ENV=production`, `PORT`, los dos secretos JWT y
`CORS_ORIGIN`. Si se configura `DB_PATH`, debe apuntar a almacenamiento persistente
del proveedor; el hosting debe enrutar el puerto público al proceso Node.

En la interfaz, `index.html` permite fijar el origen del backend en
`<meta name="aquatwins-api-base" content="">`. Déjalo vacío para usar el mismo
origen (requiere que el hosting enrute `/api` al backend) o configura allí el
origen HTTPS del servicio de API (sin `/api` al final). No uses `localhost` en
la versión publicada: el navegador lo resolvería en el equipo de cada visitante.
Por la cookie de refresco `SameSite=Strict`, usa el mismo origen (recomendado
con proxy inverso) o subdominios del mismo sitio. Si frontend y API pertenecen
a sitios distintos, la renovación de sesión requiere una decisión explícita
sobre cookies cross-site y no está soportada por defecto.

No hay endpoints de recuperación de contraseña en este backend. La interfaz no
ofrece un flujo de restablecimiento; esta función requiere configurar y probar
un proveedor de correo y tokens de recuperación antes de habilitarla.

La cuenta demo no se crea automáticamente ni tiene credenciales predeterminadas.
Para crear una en desarrollo, configura `DEMO_USER_EMAIL` y `DEMO_USER_PASSWORD`
en el entorno local y ejecuta `npm run seed`. El comando no imprime esos valores.

## 2.1 Pruebas

```bash
npm test
```

Las pruebas usan una base SQLite temporal y no alteran la base de datos local.

## 2.2 Despliegue de producción (Node.js separado de Cloudflare)

Este backend **no es un Cloudflare Worker**: depende de Express, `bcrypt` y
`better-sqlite3`, por lo que debe desplegarse en un servicio que ejecute un
proceso Node.js persistente. No apuntes Cloudflare a esta carpeta como assets ni
intentes ejecutar `src/server.js` en Workers.

Configuración del servicio compatible con Node.js:

| Ajuste | Valor |
|---|---|
| Directorio raíz | `oceanotech-backend` |
| Instalación | `npm ci` |
| Inicio | `npm start` |
| Runtime | Node.js 18 o superior |
| Puerto | el valor de `PORT` que asigne el proveedor; el servidor escucha en `0.0.0.0` en producción |
| Health check | `GET /api/health` |

Configura estos valores como variables/secretos del proveedor, nunca en Git ni
en archivos publicados:

```dotenv
NODE_ENV=production
# PORT lo asigna normalmente el proveedor; no lo fijes si su plataforma lo inyecta.
PORT=4000
DB_PATH=/ruta-del-volumen-persistente/oceanotech.sqlite
CORS_ORIGIN=https://fix-auth-backend-connecti-gemelo-digital-en-desarrollo-modelo-2.igorvillota.workers.dev
JWT_ACCESS_SECRET=<valor-aleatorio-distinto-de-al-menos-32-caracteres>
JWT_REFRESH_SECRET=<otro-valor-aleatorio-distinto-de-al-menos-32-caracteres>
PUBLIC_REGISTRATION_ENABLED=false
```

Genera los dos secretos JWT de forma independiente, por ejemplo con
`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.
Cuando exista el dominio final del frontend, añádelo o reemplaza el valor de
`CORS_ORIGIN` por ese origen HTTPS exacto (se aceptan varios orígenes separados
por coma). El proxy conserva el encabezado `Origin`, por lo que este ajuste debe
incluir la URL de la vista previa mientras se la use.

El Worker de Cloudflare usa un secreto llamado `API_ORIGIN`. Cuando el backend
tenga una URL HTTPS real, desde la raíz del repositorio ejecuta:

```bash
npx wrangler secret put API_ORIGIN
# Introduce sólo el origen, por ejemplo: https://api.tu-dominio.example
```

No se ha fijado ni inventado una URL de backend en este repositorio. Mientras el
secreto no exista, `/api/*` devuelve `503` en vez de simular un inicio de sesión.

### Persistencia SQLite

`DB_PATH` debe apuntar a un volumen/disco persistente y escribible. El sistema de
archivos efímero de un hosting serverless normalmente pierde `oceanotech.sqlite`
en reinicios, redespliegues o escalado, y no es adecuado. SQLite también requiere
una sola instancia escritora para esta aplicación; no escales horizontalmente sin
un diseño de base de datos distinto.

Antes de aprovisionar un disco, revisa el coste y las garantías de persistencia
del proveedor elegido: algunos planes sólo ofrecen volúmenes persistentes de pago.
Alternativas sin crear recursos ahora son usar una instancia Node de una sola
réplica con almacenamiento persistente ya disponible, o planificar una migración
a PostgreSQL administrado antes de escalar. Ningún recurso externo se crea desde
este repositorio.

El alta pública queda deshabilitada por defecto cuando `NODE_ENV=production`.
Sólo habilítala mediante `PUBLIC_REGISTRATION_ENABLED=true` tras una decisión
explícita de producto y una revisión de seguridad.

## 3. Endpoints

| Método | Ruta                  | Qué hace                                             |
|--------|-----------------------|-------------------------------------------------------|
| POST   | `/api/auth/register`  | Crea un usuario (email + contraseña + nombre opcional) |
| POST   | `/api/auth/login`     | Inicia sesión, devuelve `accessToken` y setea cookie de refresco |
| POST   | `/api/auth/refresh`   | Renueva el `accessToken` usando la cookie httpOnly     |
| POST   | `/api/auth/logout`    | Cierra sesión, revoca el token de refresco             |
| GET    | `/api/auth/me`        | Ejemplo de ruta protegida (requiere `Authorization: Bearer <accessToken>`) |

### Probar con curl

```bash
# Registro
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@oceanotech.com","password":"Clave-Segura123!","name":"Tu Nombre"}'

# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"tu@oceanotech.com","password":"Clave-Segura123!"}'

# Ruta protegida (reemplaza EL_TOKEN por el accessToken que devolvió el login)
curl http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer EL_TOKEN"
```

## 4. Qué seguridad ya trae

- **Contraseñas** con `bcrypt` (12 rondas de sal), nunca en texto plano.
- **JWT de acceso** de corta duración (15 min por defecto) + **token de refresco**
  guardado en cookie `httpOnly`, `sameSite: strict` y `secure` en producción — no
  es accesible desde JavaScript en el navegador.
- **Bloqueo de cuenta**: tras 5 intentos fallidos (configurable), la cuenta se
  bloquea 15 minutos.
- **Rate limiting** por IP en `/login` y `/register`, además del límite general
  de toda la API.
- **Mensajes de error genéricos**: nunca se revela si un correo existe o no.
- **Helmet** (cabeceras de seguridad), **CORS** restringido a tu dominio, y
  límite de tamaño del body (20kb) contra payloads abusivos.
- **Registro de intentos de login** (`login_events`) para poder auditar accesos
  sospechosos más adelante.

## 5. Conectar con tu `login.html`

En el formulario, reemplaza el `alert()` de demo por una llamada real:

```js
const res = await fetch('http://localhost:4000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // para que la cookie de refresco viaje
  body: JSON.stringify({ email, password /*, recaptchaToken */ })
});
const data = await res.json();

if (res.ok) {
  // guarda data.accessToken en memoria (variable JS), NUNCA en localStorage
} else {
  // muestra data.error
}
```

## 6. Siguientes pasos (para cuando armemos "seguridad extrema" + reCAPTCHA)

Ya dejé los puntos de enganche listos para no tener que reescribir nada:

- **reCAPTCHA**: en `src/utils/recaptcha.js`. Solo necesitas tus claves de Google,
  ponerlas en `.env` y cambiar `RECAPTCHA_ENABLED=true`. El login ya envía
  `recaptchaToken` al backend y lo verifica antes de procesar la contraseña.
- **2FA / TOTP**: se agregaría como un campo `two_factor_secret` en `users` y un
  paso extra entre login y emisión del token.
- **Rotación de refresh tokens**: hoy se revocan en logout; se puede además
  rotarlos en cada `/refresh` para detectar robo de tokens.
- **HTTPS obligatorio y HSTS**: Helmet ya deja HSTS listo para cuando despliegues
  detrás de HTTPS.
- **Alertas de intentos sospechosos**: ya se registran en `login_events`; falta
  solo un job que revise patrones raros (muchas IPs distintas, etc.).
- **Migrar de SQLite a Postgres** si esperas mucho tráfico concurrente.

## 7. Estructura del proyecto

```
oceanotech-backend/
├── package.json
├── .env.example
├── src/
│   ├── server.js          # arranque, seguridad global, montaje de rutas
│   ├── db.js               # conexión SQLite + esquema
│   ├── routes/auth.js      # register / login / refresh / logout / me
│   ├── middleware/
│   │   ├── auth.js         # verifica el JWT en rutas protegidas
│   │   └── rateLimiter.js  # límites de tasa
│   └── utils/
│       ├── jwt.js          # firmar/verificar tokens
│       ├── validators.js   # validación de email/contraseña
│       └── recaptcha.js    # verificación reCAPTCHA (apagada por defecto)
```
