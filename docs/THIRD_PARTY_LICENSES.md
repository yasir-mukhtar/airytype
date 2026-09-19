# Third-party software

Installed runtime packages were inspected on 12 September 2026. Exact transitive versions are pinned by `package-lock.json`; package copyright/license files remain in the installed distributions. This file does not change their licenses or assign a license to the AiryType application.

| Package | Installed version | License |
| --- | --- | --- |
| React / React DOM | 19.3.0 | MIT |
| CodeMirror bundle | 6.0.2 | MIT |
| @codemirror/view | 6.43.11 | MIT |
| @codemirror/state | 6.7.4 | MIT |
| @codemirror/commands | 6.11.0 | MIT |
| @codemirror/lang-markdown | 6.5.2 | MIT |
| @codemirror/language | 6.12.4 | MIT |
| @codemirror/search | 6.7.2 | MIT |
| @codemirror/autocomplete | 6.20.3 | MIT |
| @lezer/highlight | 1.2.3 | MIT |
| Dexie | 4.4.6 | Apache-2.0 |
| fflate | 0.8.3 | MIT |
| @supabase/supabase-js | 2.116.0 | MIT |
| Lucide React | 1.45.0 | ISC |
| @fontsource/inter | 5.3.0 | OFL-1.1 |
| @fontsource-variable/lora (preserved development POC) | 5.3.0 | OFL-1.1 |

The notebook now serves the unmodified Roboto regular, bold, and extra-bold fonts from the design study at `2df1df1`. They are bundled in `src/assets/fonts/`, with the complete original copyright and SIL Open Font License at `public/licenses/Roboto-OFL.txt`, served at `/licenses/Roboto-OFL.txt`.

The legacy Inter package and its original license remain in the repository at `public/licenses/Inter-OFL.txt`; the notebook no longer imports it. [Inter project](https://rsms.me/inter/).

CodeMirror's shipped TypeScript declarations were used to verify `EditorView.requestMeasure`, wrapped-line boundaries, compartments, scroll handling, and the state API. The installed distributions identify their current upstream repository; an archived mirror was not treated as proof of maintenance status. [CodeMirror reference](https://codemirror.net/docs/ref/).

Cloudflare static routing and runtime bindings were checked against the installed Wrangler schema and generated runtime types. [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

The preserved development POC serves the unmodified Lora font. Its original copyright and SIL Open Font License are retained at `public/licenses/Lora-OFL.txt`.
