# Ejecutar Sistema SG-SST

Ejecute los comandos desde la raíz del repositorio, donde están `docker-compose.yml`, `backend/` y `frontend/`.

## Con Docker

Levanta PostgreSQL, Redis, la API y la PWA en contenedores.

```bash
cd <ruta-del-proyecto>
docker compose up -d --build
```

Abra la aplicación en <http://localhost:8080>. La API queda disponible internamente a través de `/api`.

## Desarrollo local

Use este modo para editar con recarga en caliente. Necesita tres terminales desde la raíz del proyecto.

```bash
# Terminal 1: infraestructura
docker compose up -d postgres redis

# Terminal 2: backend NestJS
pnpm dev:api

# Terminal 3: frontend Angular
pnpm dev:web
```

La API se sirve en <http://localhost:3000/api> y la PWA en <http://localhost:4200>.

Si el contenedor `api` está activo, deténgalo antes de iniciar `pnpm dev:api` para evitar un conflicto en el puerto 3000:

```bash
docker compose stop api
```

## Comandos útiles

```bash
docker compose ps              # Servicios activos
docker compose logs -f api     # Logs en vivo de la API
docker compose stop            # Apaga contenedores sin borrar datos
docker compose up -d           # Vuelve a encender contenedores
pnpm build                     # Compila backend y frontend
pnpm lint                      # Ejecuta el linter en ambos proyectos
```
