# Sincronización entre equipos (Windows y Linux)

Usa este procedimiento al empezar y terminar de trabajar en el proyecto, tanto en
Windows como en Linux. Así ambos equipos conservan el mismo código.

## Al iniciar una sesión

1. Abre una terminal en la carpeta raíz del repositorio.
2. Comprueba si quedaron cambios locales:

   ```bash
   git status
   ```

   Si aparecen cambios que no reconoces, **no ejecutes `git pull` todavía**. Revisa
   esos archivos o guárdalos con un commit antes de continuar.

3. Descarga los cambios publicados desde el otro equipo:

   ```bash
   git pull --ff-only origin main
   ```

   `--ff-only` evita crear merges automáticos. Si el comando termina correctamente,
   tu copia local ya está actualizada.

4. Si el proyecto recibió cambios en dependencias (`package.json` o `pnpm-lock.yaml`),
   actualízalas:

   ```bash
   pnpm install
   ```

5. Si llegaron migraciones nuevas en `backend/prisma/migrations`, aplícalas en tu base
   de datos local antes de iniciar la aplicación:

   ```bash
   pnpm db:generate
   cd backend && node --env-file=../.env ./node_modules/prisma/build/index.js migrate deploy && cd -
   ```

## Al terminar una sesión

Antes de cambiar de equipo, publica tu trabajo:

```bash
git status
git add <archivos-modificados>
git commit -m "Descripción breve del cambio"
git push origin main
```

Verifica que el último comando termine sin errores. Solo entonces el otro equipo podrá
recibir tus cambios con `git pull`.

## Si `git pull` no funciona

- **Hay cambios locales:** haz commit y `git push`, o guarda temporalmente el trabajo:

  ```bash
  git stash push -m "Trabajo pendiente"
  git pull --ff-only origin main
  git stash pop
  ```

- **La rama local y la remota divergen:** no fuerces el pull ni uses `git reset --hard`.
  Revisa los commits con `git log --oneline --decorate -10` y resuelve el caso antes de
  continuar.

- **Git pide autenticación:** inicia sesión con la cuenta que tenga acceso al repositorio
  de GitHub. En Windows puede abrirse Git Credential Manager; en Linux puedes usar una
  clave SSH o un token personal.

## Rutina recomendada

| Momento | Acción |
| --- | --- |
| Inicio en cualquiera de los equipos | `git status` y `git pull --ff-only origin main` |
| Antes de pasar al otro equipo | `git add`, `git commit` y `git push origin main` |
| Después de recibir cambios de dependencias | `pnpm install` |
| Después de recibir migraciones | `pnpm db:generate` y `migrate deploy` |

> Nunca copies manualmente archivos del proyecto entre los dos equipos: el repositorio
> remoto debe ser la fuente de sincronización.
