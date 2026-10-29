# Repository Guidelines

## Project Structure & Module Organization
AnnecySims is a TypeScript simulation of Annecy built with Vite and Three.js. `src/main.ts` initializes the application; `src/style.css` contains application styles. Keep rendering code in `src/render/`, simulation logic and its Web Worker in `src/sim/`, command UI in `src/ui/`, and shared types, catalogs, geography, and interpretation helpers in `src/shared/`.

`server/interpret.ts` handles Claude-backed command interpretation through Vite development middleware. `scripts/` contains map preparation and headless simulation tools. `public/city.json` supplies city data, while `index.html` provides the page shell. There is currently no dedicated test directory.

## Build, Test, and Development Commands
- `npm ci`: install dependencies from the committed lockfile.
- `npm run dev`: start Vite with the development interpretation endpoint.
- `npm run typecheck`: check all TypeScript sources without emitting files.
- `npm run build`: type-check and create the production bundle in `dist/`.
- `npm run preview`: serve the production bundle locally; the development-only API middleware is not installed here.
- `npm run sim:headless -- 5000 2`: simulate 5,000 residents for two days and print performance metrics and daily reports.
- `npm run fetch-osm` and `npm run build-city`: fetch map inputs and generate city data; inspect the scripts before regenerating assets.

## Coding Style & Naming Conventions
Follow existing TypeScript conventions: two-space indentation, double-quoted strings, semicolons, and ES module imports. Strict type checking is enabled. Use camelCase for functions and variables, PascalCase for classes and interfaces, and uppercase names for constants such as `DEFAULT_POLICY`. Keep filenames descriptive and consistent with neighboring modules. No formatter or linter is configured; match surrounding code. Preserve French user-facing text.

## Testing Guidelines
No automated test framework or coverage threshold is configured. Before submitting changes, run type checking and the production build. For simulation changes, also run the seeded headless simulation and inspect reports and timings. For rendering or command UI changes, verify behavior in the development browser.

## Commit & Pull Request Guidelines
Existing commits use short, descriptive French subjects without conventional prefixes. Follow that style and keep each commit focused. Pull requests should describe the behavior changed, include validation commands and results, link relevant issues, and attach screenshots for visible UI changes.

## Security & Configuration
Copy `.env.example` to `.env` when configuring `ANTHROPIC_API_KEY`. Keep the key server-side; never give it a `VITE_` prefix or commit credentials. Without a key, command interpretation falls back to local keywords.
