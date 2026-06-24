import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Pin the workspace root to this app dir — a stray lockfile in a parent dir
// otherwise makes Next infer the wrong root.
const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root },
  // snarkjs uses Node-native features (fs, worker_threads, big wasm). Opt it out
  // of Server Component / Route Handler bundling so it's `require`d natively at
  // runtime instead of being bundled (which breaks under Turbopack).
  serverExternalPackages: ["snarkjs"],
};

export default nextConfig;
