# Stockfish 19 third-party notice

Chess OS downloads the official Stockfish 19 Windows x86-64 universal release asset during the Windows build. It is not modified and runs as a separate operating-system process. Chess OS communicates with it using the standard text-based UCI protocol.

- Upstream project: https://github.com/official-stockfish/Stockfish
- Pinned source tag: `sf_19`
- Exact source tree: https://github.com/official-stockfish/Stockfish/tree/sf_19
- Exact Windows release asset: https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip
- SHA-256 of release archive: `3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7`
- License: GNU General Public License version 3 (GPL-3.0-only)

The unmodified upstream license and AUTHORS file are copied beside the executable into the installed application. The Windows installer therefore contains the third-party license notice and a direct pointer to the corresponding source code. Any future modified or rebuilt Stockfish binary must be accompanied by the exact corresponding source for that build.

Stockfish is an independent program. It is launched separately and communicates with Chess OS through standard input/output using UCI; it is not linked into the Chess OS executable.
