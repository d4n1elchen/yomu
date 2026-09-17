/**
 * Loads `.env.local` for scripts that talk to the model.
 *
 * Next reads it for the app; a script run with plain `node` does not, and falls
 * back to Ollama's default `127.0.0.1:11434`. On the machine that serves the
 * app that default is right -- the model runs there too -- which is why the
 * older scripts never needed this. From a development machine it is not: the
 * host is somewhere else on the network, and the script fails with a connection
 * refused that looks like the model being down rather than a missing variable.
 *
 * Import for side effect, before anything that reads `process.env`.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // Absent is normal: the served machine has its values in the systemd unit,
  // and a fresh clone has no local file until someone writes one.
}
