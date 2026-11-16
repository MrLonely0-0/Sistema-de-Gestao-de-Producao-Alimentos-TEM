import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  globalIgnores([".next/**", "out/**", "backups/**", "next-env.d.ts"]),
  {
    rules: {
      // Efeitos de carregamento assíncrono (fetch + setState no retorno) são o
      // padrão do painel; a regra sinaliza o callback do loader, não um render em cascata.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);
