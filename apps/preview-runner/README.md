# Preview Runner

This service compiles generated Vue and React source files for isolated previews.

## Boundaries

- `src/server.mjs` accepts a bounded JSON request and starts one short-lived build process.
- `src/build-preview.mjs` uses fixed Vite configuration and fixed installed packages; it does not read a project config or install packages from generated output.
- `src/contracts.mjs` validates accepted file paths and source limits.
- `Dockerfile` runs the service without application credentials. Compose attaches it only to the private preview network; production resource limits are defined beside the service.
- Generated source is compiled, then executed only in an iframe with `sandbox="allow-scripts"` and a restrictive CSP.

The runner must not receive database URLs, model credentials, object-storage credentials, Docker sockets, or generated package manifests. Temporary source trees live under the operating system temp directory and are removed after each build.

## Commands

```bash
pnpm install --filter preview-runner
pnpm --filter preview-runner test
pnpm --filter preview-runner build
```
