import { cn } from "@/lib/utils";

/** Simple monochrome marks for each provider (no brand assets bundled). */
export function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  const common = { viewBox: "0 0 24 24", className: cn("shrink-0", className), "aria-hidden": true as const, fill: "currentColor" };
  switch (provider) {
    case "github":
      return (
        <svg {...common}>
          <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
        </svg>
      );
    case "slack":
      return (
        <svg {...common}>
          <path d="M6 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5Zm2-9a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 1 1 0 4H4a2 2 0 1 1 0-4h5Zm9 2a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0v5Zm-2 9a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
        </svg>
      );
    case "bitbucket":
      return (
        <svg {...common}>
          <path d="M3.3 3a.7.7 0 0 0-.7.82l2.85 17.3c.07.43.45.75.89.76h11.4c.34 0 .63-.24.69-.58L21.4 3.82a.7.7 0 0 0-.7-.82H3.3Zm10.98 12.5H9.76L8.53 9.1h7Z" />
        </svg>
      );
    case "jira":
      return (
        <svg {...common}>
          <path d="M21.6 11.3 12.7 2.4 12 1.7 5.3 8.4l-2.9 2.9a1 1 0 0 0 0 1.4l6.1 6.1L12 22.3l6.7-6.7.1-.1 2.8-2.8a1 1 0 0 0 0-1.4ZM12 15l-3-3 3-3 3 3-3 3Z" />
        </svg>
      );
    default:
      return null;
  }
}
