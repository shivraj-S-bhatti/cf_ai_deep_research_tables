import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { handleApiRequest } from "./src/worker/core/app";

function localWorkerApiPlugin(workerEnv: Record<string, string>): Plugin {
  return {
    name: "local-worker-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          next();
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", async () => {
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          const origin = `http://${req.headers.host ?? "localhost:8080"}`;
          const request = new Request(new URL(req.url ?? "/", origin), {
            method: req.method,
            headers: req.headers as HeadersInit,
            body:
              body && !["GET", "HEAD"].includes((req.method ?? "GET").toUpperCase()) ? body : undefined,
          });

          const response = await handleApiRequest(request, workerEnv);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          const arrayBuffer = await response.arrayBuffer();
          res.end(Buffer.from(arrayBuffer));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), localWorkerApiPlugin(loadEnv(mode, process.cwd(), ""))],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
}));
